use crate::{
    AppState,
    auth::{self, Actor},
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
#[derive(Clone)]
pub struct Storage {
    pub bucket: Box<s3::Bucket>,
    pub client: reqwest::Client,
    pub max: i64,
    pub quota: i64,
    pub gate: Arc<tokio::sync::Semaphore>,
    pub connect_origin: String,
}
fn unavailable() -> error::Error {
    error::Error(
        StatusCode::SERVICE_UNAVAILABLE,
        "storage_unavailable",
        "附件存储未配置或暂不可用，请重试",
    )
}
fn io<T, E>(r: std::result::Result<T, E>) -> Result<T> {
    r.map_err(|_| unavailable())
}
impl Storage {
    pub fn env() -> Option<Self> {
        let names = [
            "S3_ENDPOINT",
            "S3_REGION",
            "S3_BUCKET",
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
        ];
        let values: Vec<String> = names
            .iter()
            .map(|n| std::env::var(n).unwrap_or_default())
            .collect();
        if values.iter().all(|s| s.is_empty()) {
            return None;
        }
        assert!(
            values.iter().all(|s| !s.is_empty()),
            "incomplete S3 configuration"
        );
        let url = reqwest::Url::parse(&values[0]).expect("S3 endpoint URL");
        assert!(
            url.scheme() == "https"
                || (url.scheme() == "http"
                    && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))),
            "S3 endpoint requires HTTPS except loopback"
        );
        assert!(
            url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none(),
            "invalid S3 endpoint"
        );
        let creds =
            s3::creds::Credentials::new(Some(&values[3]), Some(&values[4]), None, None, None)
                .expect("S3 credentials");
        let mut bucket = s3::Bucket::new(
            &values[2],
            s3::Region::Custom {
                region: values[1].clone(),
                endpoint: values[0].clone(),
            },
            creds,
        )
        .expect("S3 bucket")
        .with_path_style();
        bucket.request_timeout = Some(Duration::from_secs(60));
        let number = |key: &str, default: i64| {
            std::env::var(key)
                .ok()
                .map(|s| s.parse::<i64>().expect("attachment size setting"))
                .unwrap_or(default)
        };
        let max = number("ATTACHMENT_MAX_BYTES", 16 * 1024 * 1024);
        assert!(
            (1..=64 * 1024 * 1024).contains(&max),
            "attachment max 1..64 MiB"
        );
        let quota = number("ATTACHMENT_BOARD_QUOTA_BYTES", 256 * 1024 * 1024);
        assert!(quota >= max, "board quota below file max");
        Some(Self {
            bucket,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(60))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("HTTP client"),
            max,
            quota,
            gate: Arc::new(tokio::sync::Semaphore::new(1)),
            connect_origin: url.origin().ascii_serialization(),
        })
    }
    async fn bytes(&self, key: &str, limit: i64) -> Result<Vec<u8>> {
        let url = io(self.bucket.presign_get(key, 60, None).await)?;
        let mut response = io(self.client.get(url).send().await)?
            .error_for_status()
            .map_err(|_| unavailable())?;
        if response.content_length().is_some_and(|n| n > limit as u64) {
            return Err(error::invalid());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = io(response.chunk().await)? {
            if bytes.len() + chunk.len() > limit as usize {
                return Err(error::invalid());
            }
            bytes.extend_from_slice(&chunk)
        }
        Ok(bytes)
    }
}
pub async fn authorize(s: &AppState, a: &Actor, b: i64, c: i64) -> Result<()> {
    let actor = auth::resolve(&s.pool, &a.session).await?;
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cards c JOIN lists l ON l.id=c.list_id JOIN board_members m ON m.board_id=l.board_id JOIN boards b ON b.id=l.board_id WHERE (b.inbox_owner_id IS NULL OR b.inbox_owner_id=m.user_id) AND c.id=? AND l.board_id=? AND m.user_id=?)").bind(c).bind(b).bind(actor.user.id).fetch_one(&s.pool).await?;
    if !exists {
        return Err(error::missing());
    }
    Ok(())
}
async fn tx_authorize(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    a: &Actor,
    b: i64,
    c: i64,
) -> Result<()> {
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cards c JOIN lists l ON l.id=c.list_id JOIN board_members m ON m.board_id=l.board_id JOIN boards b ON b.id=l.board_id JOIN users u ON u.id=m.user_id JOIN sessions s ON s.user_id=u.id WHERE (b.inbox_owner_id IS NULL OR b.inbox_owner_id=u.id) AND c.id=? AND l.board_id=? AND s.token_hash=? AND s.expires_at>? AND u.active=1)").bind(c).bind(b).bind(&a.session).bind(auth::now()).fetch_one(&mut **tx).await?;
    if !exists {
        return Err(error::missing());
    }
    Ok(())
}
#[derive(Deserialize)]
pub struct Init {
    filename: String,
    size: i64,
}
#[derive(sqlx::FromRow, serde::Serialize)]
pub struct Item {
    id: String,
    card_id: i64,
    filename: String,
    size: i64,
    mime: String,
    state: String,
    #[serde(skip)]
    staging: String,
    #[serde(skip)]
    final_key: String,
    expires_at: i64,
    created_at: i64,
}
async fn item(s: &AppState, c: i64, id: &str) -> Result<Item> {
    sqlx::query_as("SELECT * FROM attachments WHERE card_id=? AND id=? AND state!='deleted'")
        .bind(c)
        .bind(id)
        .fetch_optional(&s.pool)
        .await?
        .ok_or_else(error::missing)
}
pub async fn list(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((b, c)): Path<(i64, i64)>,
) -> Result<Json<Value>> {
    authorize(&s, &a, b, c).await?;
    let items: Vec<Item> = sqlx::query_as(
        "SELECT * FROM attachments WHERE card_id=? AND state!='deleted' ORDER BY created_at,id",
    )
    .bind(c)
    .fetch_all(&s.pool)
    .await?;
    Ok(Json(
        json!({"configured":s.storage.is_some(),"max_bytes":s.storage.as_ref().map(|v|v.max).unwrap_or(16777216),"items":items}),
    ))
}
pub async fn init(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((b, c)): Path<(i64, i64)>,
    Json(input): Json<Init>,
) -> Result<Json<Value>> {
    authorize(&s, &a, b, c).await?;
    let store = s.storage.as_ref().ok_or_else(unavailable)?;
    if input.filename.is_empty()
        || input.filename.len() > 255
        || input
            .filename
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(error::invalid());
    }
    validate_size(input.size, input.size, store.max)?;
    let id = uuid::Uuid::new_v4().to_string();
    let staging = format!("norns/staging/{id}");
    let final_key = format!("norns/final/{id}");
    let expires = auth::now() + 300;
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    tx_authorize(&mut tx, &a, b, c).await?;
    let used:i64=sqlx::query_scalar("SELECT COALESCE(SUM(a.size),0) FROM attachments a JOIN cards c ON c.id=a.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=? AND a.state!='deleted'").bind(b).fetch_one(&mut *tx).await?;
    if used + input.size > store.quota {
        return Err(error::Error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "quota",
            "附件配额不足",
        ));
    }
    sqlx::query("INSERT INTO attachments VALUES(?,?,?,?,?,'pending',?,?,?,?)")
        .bind(&id)
        .bind(c)
        .bind(&input.filename)
        .bind(input.size)
        .bind("application/octet-stream")
        .bind(&staging)
        .bind(&final_key)
        .bind(expires)
        .bind(auth::now())
        .execute(&mut *tx)
        .await?;
    // Durable compensation exists before any object can be written. Grace exceeds PUT expiry.
    for key in [&staging, &final_key] {
        sqlx::query("INSERT INTO attachment_outbox(key,not_before) VALUES(?,?)")
            .bind(key)
            .bind(expires + 120)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    let mut signed_headers = HeaderMap::new();
    signed_headers.insert(
        "content-length",
        input
            .size
            .to_string()
            .parse()
            .map_err(|_| error::invalid())?,
    );
    let url = io(store
        .bucket
        .presign_put(&staging, 300, Some(signed_headers), None)
        .await)?;
    Ok(Json(json!({"id":id,"put_url":url,"expires_at":expires})))
}
fn validate_size(expected: i64, actual: i64, max: i64) -> Result<()> {
    if expected <= 0 || expected > max || actual != expected {
        return Err(error::invalid());
    }
    Ok(())
}
fn sniff(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"%PDF-") {
        "application/pdf"
    } else if bytes.starts_with(b"OggS") {
        "audio/ogg"
    } else if bytes.starts_with(b"ID3") {
        "audio/mpeg"
    } else if bytes.len() > 12 && &bytes[4..8] == b"ftyp" {
        "video/mp4"
    } else if bytes.starts_with(b"\x1a\x45\xdf\xa3") {
        "video/webm"
    } else if std::str::from_utf8(bytes).is_ok() && !bytes.contains(&0) {
        "text/plain"
    } else {
        "application/octet-stream"
    }
}
fn content_type<'a>(mime: &'a str, bytes: &[u8]) -> &'a str {
    // Map legacy stored text/plain too; validate the full object before Range slicing.
    if mime == "text/plain" && std::str::from_utf8(bytes).is_ok() && !bytes.contains(&0) {
        "text/plain; charset=utf-8"
    } else {
        mime
    }
}
pub async fn complete(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((b, c, id)): Path<(i64, i64, String)>,
) -> Result<Json<Value>> {
    authorize(&s, &a, b, c).await?;
    let store = s.storage.as_ref().ok_or_else(unavailable)?;
    let _permit = store.gate.try_acquire().map_err(|_| {
        error::Error(
            StatusCode::TOO_MANY_REQUESTS,
            "busy",
            "附件处理中，请稍后重试",
        )
    })?;
    let row = item(&s, c, &id).await?;
    if row.state == "ready" {
        return Ok(Json(json!(row)));
    }
    if row.expires_at <= auth::now() {
        return Err(error::conflict());
    }
    sqlx::query("UPDATE attachments SET state='verifying' WHERE id=?")
        .bind(&id)
        .execute(&s.pool)
        .await?;
    let (head, _) = io(store.bucket.head_object(&row.staging).await)?;
    validate_size(row.size, head.content_length.unwrap_or(-1), store.max)?;
    let bytes = store.bytes(&row.staging, store.max).await?;
    validate_size(row.size, bytes.len() as i64, store.max)?;
    let mime = sniff(&bytes);
    io(store
        .bucket
        .put_object_with_content_type(&row.final_key, &bytes, mime)
        .await)?;
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    tx_authorize(&mut tx, &a, b, c).await?;
    sqlx::query("UPDATE attachments SET state='ready',mime=? WHERE id=? AND state='verifying'")
        .bind(mime)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM attachment_outbox WHERE key=?")
        .bind(&row.final_key)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!(item(&s, c, &id).await?)))
}
pub async fn delete(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((b, c, id)): Path<(i64, i64, String)>,
) -> Result<StatusCode> {
    authorize(&s, &a, b, c).await?;
    let store = s.storage.as_ref().ok_or_else(unavailable)?;
    let _permit = store.gate.try_acquire().map_err(|_| error::conflict())?;
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    tx_authorize(&mut tx, &a, b, c).await?;
    let row: Item = sqlx::query_as("SELECT * FROM attachments WHERE id=? AND card_id=?")
        .bind(id)
        .bind(c)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(error::missing)?;
    sqlx::query("UPDATE attachments SET state='deleted' WHERE id=?")
        .bind(&row.id)
        .execute(&mut *tx)
        .await?;
    for (key, at) in [
        (&row.final_key, auth::now()),
        (&row.staging, row.expires_at + 120),
    ] {
        sqlx::query("INSERT INTO attachment_outbox(key,not_before) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET not_before=excluded.not_before").bind(key).bind(at).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
pub struct Read {
    #[serde(default)]
    download: bool,
}
pub async fn read(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((b, c, id)): Path<(i64, i64, String)>,
    Query(query): Query<Read>,
    headers: HeaderMap,
) -> Result<Response> {
    authorize(&s, &a, b, c).await?;
    let row = item(&s, c, &id).await?;
    if row.state != "ready" {
        return Err(error::missing());
    }
    let store = s.storage.as_ref().ok_or_else(unavailable)?;
    let _permit = store.gate.try_acquire().map_err(|_| {
        error::Error(
            StatusCode::TOO_MANY_REQUESTS,
            "busy",
            "附件处理中，请稍后重试",
        )
    })?;
    let bytes = store.bytes(&row.final_key, store.max).await?;
    validate_size(row.size, bytes.len() as i64, store.max)?;
    authorize(&s, &a, b, c).await?;
    let total = bytes.len();
    let mut start = 0;
    let mut end = total - 1;
    let mut status = StatusCode::OK;
    if let Some(range) = headers.get("range").and_then(|v| v.to_str().ok()) {
        let parsed = (|| {
            let value = range.strip_prefix("bytes=")?;
            let (left, right) = value.split_once('-')?;
            if left.is_empty() {
                let n = right.parse::<usize>().ok()?;
                if n == 0 {
                    return None;
                }
                Some((total.saturating_sub(n), total - 1))
            } else {
                Some((
                    left.parse().ok()?,
                    if right.is_empty() {
                        total - 1
                    } else {
                        right.parse::<usize>().ok()?.min(total - 1)
                    },
                ))
            }
        })();
        let Some((a, z)) = parsed.filter(|(a, z)| a <= z && *a < total) else {
            return Ok((
                StatusCode::RANGE_NOT_SATISFIABLE,
                [("content-range", format!("bytes */{total}"))],
            )
                .into_response());
        };
        start = a;
        end = z;
        status = StatusCode::PARTIAL_CONTENT;
    }
    let inline = !query.download && row.mime != "application/octet-stream";
    let encoded = row
        .filename
        .as_bytes()
        .iter()
        .map(|b| format!("%{b:02X}"))
        .collect::<String>();
    let mut response = (status, bytes[start..=end].to_vec()).into_response();
    let h = response.headers_mut();
    for (key, value) in [
        ("content-type", content_type(&row.mime, &bytes).into()),
        (
            "content-disposition",
            format!(
                "{}; filename=\"download\"; filename*=UTF-8''{}",
                if inline { "inline" } else { "attachment" },
                encoded
            ),
        ),
        ("accept-ranges", "bytes".into()),
        (
            "content-security-policy",
            "sandbox; default-src 'none'; script-src 'none'; frame-ancestors 'self'".into(),
        ),
        ("x-content-type-options", "nosniff".into()),
        ("cache-control", "no-store".into()),
    ] {
        h.insert(
            axum::http::HeaderName::from_bytes(key.as_bytes()).unwrap(),
            value.parse().map_err(|_| error::invalid())?,
        );
    }
    if status == StatusCode::PARTIAL_CONTENT {
        h.insert(
            "content-range",
            format!("bytes {start}-{end}/{total}").parse().unwrap(),
        );
    }
    Ok(response)
}
pub async fn sweep(s: &AppState) -> Result<()> {
    let Some(store) = s.storage.as_ref() else {
        return Ok(());
    };
    let Ok(_permit) = store.gate.try_acquire() else {
        return Ok(());
    };
    sqlx::query("UPDATE attachments SET state='deleted' WHERE state IN ('pending','verifying') AND expires_at+120<=?").bind(auth::now()).execute(&s.pool).await?;
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT key,attempts FROM attachment_outbox WHERE not_before<=? LIMIT 20")
            .bind(auth::now())
            .fetch_all(&s.pool)
            .await?;
    for (key, attempts) in rows {
        match store.bucket.delete_object(&key).await {
            Ok(_) => {
                sqlx::query("DELETE FROM attachment_outbox WHERE key=?")
                    .bind(key)
                    .execute(&s.pool)
                    .await?;
            }
            Err(_) => {
                sqlx::query(
                    "UPDATE attachment_outbox SET attempts=attempts+1,not_before=? WHERE key=?",
                )
                .bind(auth::now() + 30 * (attempts + 1).min(120))
                .bind(key)
                .execute(&s.pool)
                .await?;
            }
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn content_is_not_client_mime() {
        assert_eq!(sniff(b"<svg><script>x</script></svg>"), "text/plain");
        assert_eq!(sniff(b"%PDF-1.7 test"), "application/pdf");
        assert_eq!(sniff(&[0, 255, 1]), "application/octet-stream");
    }
    #[test]
    fn text_response_charset_requires_valid_full_utf8() {
        let chinese = "手机附件".as_bytes();
        assert_eq!(
            content_type("text/plain", chinese),
            "text/plain; charset=utf-8"
        );
        assert_eq!(
            content_type("text/plain", b"<script>x</script>"),
            "text/plain; charset=utf-8"
        );
        assert_eq!(content_type("text/plain", &[0xff]), "text/plain");
        assert_eq!(content_type("text/plain", b"a\0b"), "text/plain");
        for mime in [
            "image/png",
            "application/pdf",
            "video/mp4",
            "application/octet-stream",
        ] {
            assert_eq!(content_type(mime, chinese), mime);
        }
    }
    #[test]
    fn bounded_actual_size() {
        assert!(validate_size(4, 4, 16).is_ok());
        assert!(validate_size(4, 5, 16).is_err());
        assert!(validate_size(17, 17, 16).is_err());
    }
}
