//! Selected application metadata, not a database backup or an import format.
use crate::{
    AppState,
    auth::Actor,
    boards,
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::State,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Sqlite, Transaction};
use std::{collections::BTreeSet, io::Write};
const MAX_BYTES: usize = 16 * 1024 * 1024;
#[derive(Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Csv,
    Json,
    Zip,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    board_ids: Vec<i64>,
    include_completed: bool,
    include_archived: bool,
    format: Format,
    // Required by download, forbidden by preview. A shared shape keeps UI requests flat.
    expected_snapshot: Option<String>,
}
fn large() -> error::Error {
    error::Error(
        StatusCode::PAYLOAD_TOO_LARGE,
        "export_too_large",
        "Export exceeds 5000 tasks, 20000 children or 16 MiB metadata; select fewer boards or exclude completed/archived tasks",
    )
}
fn internal() -> error::Error {
    error::Error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "export_metadata_invalid",
        "Stored export metadata could not be encoded",
    )
}
impl Selection {
    fn ids(&self) -> Result<String> {
        let ids: BTreeSet<_> = self.board_ids.iter().copied().collect();
        if ids.is_empty()
            || ids.len() > 20
            || ids.len() != self.board_ids.len()
            || ids.iter().any(|i| *i <= 0)
        {
            return Err(error::invalid());
        }
        serde_json::to_string(&ids).map_err(|_| internal())
    }
}
async fn authorize(tx: &mut Transaction<'_, Sqlite>, a: &Actor, s: &Selection) -> Result<()> {
    // role rechecks the current session/active user, with no site-admin bypass.
    for id in &s.board_ids {
        boards::role(tx, a, *id).await?;
    }
    Ok(())
}
const SCOPE: &str = "WITH selected AS NOT MATERIALIZED (SELECT c.* FROM cards c JOIN lists l ON l.id=c.list_id WHERE l.board_id IN (SELECT value FROM json_each(?1)) AND (?2 OR c.completed=0) AND (?3 OR c.archived=0)) ";
async fn rows(
    tx: &mut Transaction<'_, Sqlite>,
    s: &Selection,
    ids: &str,
    query: &str,
) -> Result<Vec<Value>> {
    let values: Vec<String> = sqlx::query_scalar(&format!("{SCOPE}{query}"))
        .bind(ids)
        .bind(s.include_completed)
        .bind(s.include_archived)
        .fetch_all(&mut **tx)
        .await?;
    values
        .into_iter()
        .map(|v| serde_json::from_str(&v).map_err(|_| internal()))
        .collect()
}
// Serialize into a capped writer: never create an unbounded serialized snapshot.
struct Bounded(Vec<u8>);
impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_BYTES {
            return Err(std::io::Error::other("export limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn encode(doc: &Value) -> Result<Vec<u8>> {
    let mut b = Bounded(Vec::new());
    serde_json::to_writer(&mut b, doc).map_err(|_| large())?;
    Ok(b.0)
}
#[derive(sqlx::FromRow, serde::Serialize, PartialEq)]
struct Original {
    id: String,
    card_id: i64,
    list_id: i64,
    board_id: i64,
    final_key: String,
    size: i64,
    mime: String,
}
struct Snapshot {
    doc: Value,
    hash: String,
    originals: Vec<Original>,
}
async fn capture(state: &AppState, a: &Actor, s: &Selection) -> Result<Snapshot> {
    let ids = s.ids()?;
    let mut tx = state.pool.begin().await?;
    // All scopes are authorized before any counts, children or metadata are read.
    authorize(&mut tx, a, s).await?;
    let task_count: i64 = sqlx::query_scalar(&format!(
        "{SCOPE} SELECT COUNT(*) FROM (SELECT id FROM selected LIMIT 5001)"
    ))
    .bind(&ids)
    .bind(s.include_completed)
    .bind(s.include_archived)
    .fetch_one(&mut *tx)
    .await?;
    if task_count > 5000 {
        return Err(large());
    }
    let counts:(i64,i64,i64)=sqlx::query_as(&format!("{SCOPE} SELECT (SELECT COUNT(*) FROM (SELECT id FROM selected LIMIT 5001)), (SELECT COUNT(*) FROM (SELECT id FROM checklist_items WHERE card_id IN (SELECT id FROM selected) UNION ALL SELECT id FROM comments WHERE card_id IN (SELECT id FROM selected) UNION ALL SELECT id FROM attachments WHERE card_id IN (SELECT id FROM selected) LIMIT 20001)), (SELECT COUNT(*) FROM lists WHERE board_id IN (SELECT value FROM json_each(?1)))"))
 .bind(&ids).bind(s.include_completed).bind(s.include_archived).fetch_one(&mut *tx).await?;
    // Empty lists are exported too, so cap their otherwise unbounded overhead.
    if counts.0 > 5000 || counts.1 > 20000 || counts.2 > 20000 {
        return Err(large());
    }
    // Raw byte preflight before loading text. JSON escaping is checked by the capped writer.
    let bytes:i64=sqlx::query_scalar(&format!("{SCOPE} SELECT
 COALESCE((SELECT SUM(length(CAST(title||description||COALESCE(schedule,'')||COALESCE(anchor_schedule,'')||COALESCE(series_id,'')||COALESCE(due_date,'') AS BLOB))) FROM selected),0)+
 COALESCE((SELECT SUM(length(CAST(title AS BLOB))) FROM boards WHERE id IN (SELECT value FROM json_each(?1))),0)+
 COALESCE((SELECT SUM(length(CAST(title AS BLOB))) FROM lists WHERE board_id IN (SELECT value FROM json_each(?1))),0)+
 COALESCE((SELECT SUM(length(CAST(title AS BLOB))) FROM checklist_items WHERE card_id IN (SELECT id FROM selected)),0)+
 COALESCE((SELECT SUM(length(CAST(body AS BLOB))) FROM comments WHERE card_id IN (SELECT id FROM selected)),0)+
 COALESCE((SELECT SUM(length(CAST(id||filename||mime||state AS BLOB))) FROM attachments WHERE card_id IN (SELECT id FROM selected)),0)+
 COALESCE((SELECT SUM(length(CAST(username AS BLOB))) FROM users WHERE id=?4 OR id IN (SELECT assignee_id FROM selected) OR id IN (SELECT author_id FROM comments WHERE card_id IN (SELECT id FROM selected))),0)"))
 .bind(&ids).bind(s.include_completed).bind(s.include_archived).bind(a.user.id).fetch_one(&mut *tx).await?;
    if bytes > MAX_BYTES as i64 {
        return Err(large());
    }
    let bs=rows(&mut tx,s,&ids,"SELECT json_object('id',id,'title',title,'revision',revision,'inbox_owner_id',inbox_owner_id) FROM boards WHERE id IN (SELECT value FROM json_each(?1)) ORDER BY id").await?;
    let lists=rows(&mut tx,s,&ids,"SELECT json_object('id',id,'board_id',board_id,'title',title,'position',position,'inbox_default',json(CASE WHEN inbox_default THEN 'true' ELSE 'false' END)) FROM lists WHERE board_id IN (SELECT value FROM json_each(?1)) ORDER BY board_id,position,id").await?;
    let mut tasks=rows(&mut tx,s,&ids,"SELECT json_object('id',c.id,'board_id',l.board_id,'list_id',c.list_id,'title',c.title,'description',c.description,'position',c.position,'archived',json(CASE WHEN c.archived THEN 'true' ELSE 'false' END),'completed',json(CASE WHEN c.completed THEN 'true' ELSE 'false' END),'assignee_id',c.assignee_id,'due_date',c.due_date,'schedule',c.schedule,'anchor_schedule',c.anchor_schedule,'series_id',c.series_id,'predecessor_id',c.predecessor_id,'occurrence_no',c.occurrence_no,'touch_version',c.touch_version) FROM selected c JOIN lists l ON l.id=c.list_id ORDER BY l.board_id,l.position,l.id,c.position,c.id").await?;
    let selected: BTreeSet<i64> = tasks.iter().filter_map(|v| v["id"].as_i64()).collect();
    for task in &mut tasks {
        for key in ["schedule", "anchor_schedule"] {
            if let Some(raw) = task[key].as_str() {
                // Typed DTO rejects unknown keys; stored strings never become arbitrary JSON objects.
                let dto: crate::schedule::Schedule =
                    serde_json::from_str(raw).map_err(|_| internal())?;
                task[key] = serde_json::to_value(dto).map_err(|_| internal())?;
            }
        }
        task["references_outside_selection"] = json!(
            task["predecessor_id"]
                .as_i64()
                .filter(|id| !selected.contains(id))
                .map(|id| vec![json!({"field":"predecessor_id","id":id})])
                .unwrap_or_default()
        );
    }
    let checklist=rows(&mut tx,s,&ids,"SELECT json_object('id',id,'card_id',card_id,'title',title,'checked',json(CASE WHEN checked THEN 'true' ELSE 'false' END),'position',position) FROM checklist_items WHERE card_id IN (SELECT id FROM selected) ORDER BY card_id,position,id").await?;
    let comments=rows(&mut tx,s,&ids,"SELECT json_object('id',id,'card_id',card_id,'author_id',author_id,'body',body,'created_at',created_at) FROM comments WHERE card_id IN (SELECT id FROM selected) ORDER BY created_at,id").await?;
    let attachments=rows(&mut tx,s,&ids,"SELECT json_object('id',id,'card_id',card_id,'filename',filename,'size',size,'mime',mime,'state',state,'created_at',created_at) FROM attachments WHERE card_id IN (SELECT id FROM selected) ORDER BY card_id,created_at,id").await?;
    let users=rows(&mut tx,s,&ids,"SELECT json_object('id',id,'username',username) FROM users WHERE id IN (SELECT assignee_id FROM selected) OR id IN (SELECT author_id FROM comments WHERE card_id IN (SELECT id FROM selected)) ORDER BY id").await?;
    let actor: (i64, String) = sqlx::query_as("SELECT id,username FROM users WHERE id=?")
        .bind(a.user.id)
        .fetch_one(&mut *tx)
        .await?;
    // Storage identities belong to this same coherent read snapshot, never artifact metadata.
    let originals = if matches!(s.format, Format::Zip) {
        let (count, oversized_key): (i64, bool) = sqlx::query_as(&format!("{SCOPE} SELECT (SELECT COUNT(*) FROM (SELECT a.id FROM attachments a JOIN selected c ON c.id=a.card_id WHERE a.state='ready' LIMIT 201)), EXISTS(SELECT 1 FROM attachments a JOIN selected c ON c.id=a.card_id WHERE a.state='ready' AND length(CAST(a.final_key AS BLOB))>1024)"))
            .bind(&ids).bind(s.include_completed).bind(s.include_archived).fetch_one(&mut *tx).await?;
        if count > 200 {
            return Err(zip_large());
        }
        if oversized_key {
            return Err(zip_failed());
        }
        sqlx::query_as::<_, Original>(&format!("{SCOPE} SELECT a.id,a.card_id,c.list_id,l.board_id,a.final_key,a.size,a.mime FROM attachments a JOIN selected c ON c.id=a.card_id JOIN lists l ON l.id=c.list_id WHERE a.state='ready' ORDER BY a.card_id,a.created_at,a.id"))
            .bind(&ids).bind(s.include_completed).bind(s.include_archived).fetch_all(&mut *tx).await?
    } else {
        Vec::new()
    };
    tx.commit().await?;
    let doc = json!({"schema_version":1,"kind":"norns-selected-metadata","actor":{"id":actor.0,"username":actor.1},"filters":{"board_ids":serde_json::from_str::<Value>(&ids).map_err(|_|internal())?,"include_completed":s.include_completed,"include_archived":s.include_archived},"boards":bs,"lists":lists,"tasks":tasks,"checklist":checklist,"comments":comments,"attachments":attachments,"users":users});
    let bytes = encode(&doc)?;
    // serde_json maps are lexically ordered (preserve_order is not enabled).
    let mut digest = Sha256::new();
    digest.update(&bytes);
    if matches!(s.format, Format::Zip) {
        digest.update(b"norns-private-originals-v1");
        digest.update(encode(
            &serde_json::to_value(&originals).map_err(|_| internal())?,
        )?);
    }
    let hash = format!("{:x}", digest.finalize());
    Ok(Snapshot {
        doc,
        hash,
        originals,
    })
}
fn text(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        _ => v.to_string(),
    }
}
fn cell(value: &str) -> String {
    let start = value.trim_start_matches(|c: char| c.is_whitespace() || c.is_control());
    let dangerous = start.starts_with(['=', '+', '-', '@'])
        || value
            .chars()
            .take_while(|c| c.is_whitespace() || c.is_control())
            .any(|c| ['\t', '\r', '\n'].contains(&c));
    format!(
        "\"{}{}\"",
        if dangerous { "'" } else { "" },
        value.replace('"', "\"\"")
    )
}
fn csv(doc: &Value) -> Result<Vec<u8>> {
    let mut out = Bounded(vec![0xef, 0xbb, 0xbf]);
    let columns = [
        "task_id",
        "title",
        "description",
        "board_id",
        "board",
        "list_id",
        "list",
        "completed",
        "archived",
        "assignee_id",
        "assignee",
        "due_date",
        "start_date",
        "end_date",
        "start_time",
        "end_time",
        "timezone",
        "repeat",
        "checklist_count",
        "comment_count",
        "attachment_count",
    ];
    out.write_all((columns.join(",") + "\r\n").as_bytes())
        .map_err(|_| large())?;
    for task in doc["tasks"].as_array().ok_or_else(internal)? {
        let lookup = |kind: &str, id: &Value, key: &str| {
            doc[kind]
                .as_array()
                .and_then(|a| a.iter().find(|x| x["id"] == *id))
                .map(|x| text(&x[key]))
                .unwrap_or_default()
        };
        let count = |kind: &str| {
            doc[kind]
                .as_array()
                .map(|a| a.iter().filter(|x| x["card_id"] == task["id"]).count())
                .unwrap_or(0)
                .to_string()
        };
        let mut fields = vec![
            text(&task["id"]),
            text(&task["title"]),
            text(&task["description"]),
            text(&task["board_id"]),
            lookup("boards", &task["board_id"], "title"),
            text(&task["list_id"]),
            lookup("lists", &task["list_id"], "title"),
            text(&task["completed"]),
            text(&task["archived"]),
            text(&task["assignee_id"]),
            lookup("users", &task["assignee_id"], "username"),
            text(&task["due_date"]),
        ];
        for key in [
            "start_date",
            "end_date",
            "start_time",
            "end_time",
            "timezone",
            "repeat",
        ] {
            fields.push(text(&task["schedule"][key]));
        }
        for kind in ["checklist", "comments", "attachments"] {
            fields.push(count(kind));
        }
        out.write_all(
            (fields.iter().map(|s| cell(s)).collect::<Vec<_>>().join(",") + "\r\n").as_bytes(),
        )
        .map_err(|_| large())?;
    }
    Ok(out.0)
}
fn artifact(snapshot: &Snapshot, format: &Format) -> Result<Vec<u8>> {
    match format {
        Format::Csv => csv(&snapshot.doc),
        Format::Zip => Err(internal()),
        Format::Json => {
            let mut doc = snapshot.doc.clone();
            doc["generated_at"] =
                json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
            encode(&doc)
        }
    }
}
pub async fn preview(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Json(input): Json<Selection>,
) -> Result<Json<Value>> {
    if input.expected_snapshot.is_some() {
        return Err(error::invalid());
    }
    let snap = capture(&s, &a, &input).await?;
    let is_zip = matches!(input.format, Format::Zip);
    let bytes = if is_zip {
        original_limits(&s, &snap)?;
        let json = artifact(&snap, &Format::Json)?;
        let csv = artifact(&snap, &Format::Csv)?;
        metadata_length(&json, &csv)?
    } else {
        artifact(&snap, &input.format)?.len()
    };
    let mut result = json!({"expected_snapshot":snap.hash,"task_count":snap.doc["tasks"].as_array().map(Vec::len),"checklist_count":snap.doc["checklist"].as_array().map(Vec::len),"comment_count":snap.doc["comments"].as_array().map(Vec::len),"attachment_count":snap.doc["attachments"].as_array().map(Vec::len),"metadata_bytes":bytes,"includes_attachment_content":is_zip});
    if is_zip {
        result["ready_original_count"] = json!(snap.originals.len());
        result["ready_original_bytes"] = json!(snap.originals.iter().map(|o| o.size).sum::<i64>());
        result["excluded_attachment_count"] = json!(
            snap.doc["attachments"]
                .as_array()
                .ok_or_else(internal)?
                .len()
                - snap.originals.len()
        );
    }
    Ok(Json(result))
}
pub async fn download(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Json(input): Json<Selection>,
) -> Result<Response> {
    let expected = input
        .expected_snapshot
        .as_ref()
        .ok_or_else(error::invalid)?;
    if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(error::invalid());
    }
    let snap = capture(&s, &a, &input).await?;
    if &snap.hash != expected {
        return Err(error::Error(
            StatusCode::CONFLICT,
            "export_snapshot_changed",
            "Selected data changed; preview again before downloading",
        ));
    }
    if matches!(input.format, Format::Zip) {
        return zip_download(&s, &a, &input, snap).await;
    }
    let bytes = artifact(&snap, &input.format)?;
    // Recheck session and every scope in a fresh read transaction after capture/serialization.
    let mut tx = s.pool.begin().await?;
    authorize(&mut tx, &a, &input).await?;
    tx.commit().await?;
    let (ext, mime) = match input.format {
        Format::Json => ("json", "application/json; charset=utf-8"),
        Format::Csv => ("csv", "text/csv; charset=utf-8"),
        Format::Zip => unreachable!(),
    };
    let filename = format!(
        "attachment; filename=\"norns-export-{}.{}\"",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        ext
    );
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_owned()),
            (header::CONTENT_DISPOSITION, filename),
            (header::CONTENT_LENGTH, bytes.len().to_string()),
            (header::CACHE_CONTROL, "no-store".into()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
        ],
        bytes,
    )
        .into_response())
}

// A process-wide immediate gate bounds builds across router instances; no waiting queue.
static ZIP_GATE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
const ORIGINAL_BYTES: i64 = 128 * 1024 * 1024;
const ZIP_BYTES: u64 = 160 * 1024 * 1024;
fn zip_large() -> error::Error {
    error::Error(
        StatusCode::PAYLOAD_TOO_LARGE,
        "export_too_large",
        "ZIP exceeds 200 ready originals, 128 MiB originals, configured per-object limit or 160 MiB ZIP; select fewer tasks",
    )
}
fn zip_failed() -> error::Error {
    error::Error(
        StatusCode::CONFLICT,
        "export_original_unavailable",
        "A selected ready original is unavailable or changed; retry after checking attachments",
    )
}
fn original_limits(state: &AppState, snap: &Snapshot) -> Result<()> {
    if snap.originals.len() > 200 {
        return Err(zip_large());
    }
    let max = state
        .storage
        .as_ref()
        .map(|s| s.max)
        .unwrap_or(64 * 1024 * 1024)
        .min(64 * 1024 * 1024);
    let mut total = 0i64;
    for o in &snap.originals {
        if o.size <= 0 || o.size > max {
            return Err(zip_large());
        }
        total = total.checked_add(o.size).ok_or_else(zip_large)?;
        if total > ORIGINAL_BYTES {
            return Err(zip_large());
        }
        original_path(o)?;
    }
    Ok(())
}
fn original_path(o: &Original) -> Result<String> {
    if o.card_id <= 0
        || o.id.is_empty()
        || o.id.len() > 128
        || !o
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(zip_failed());
    }
    // Never interpolate the user filename, storage key, or user-supplied extension.
    let ext = match o.mime.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "application/pdf" => "pdf",
        "audio/ogg" => "ogg",
        "audio/mpeg" => "mp3",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "text/plain" => "txt",
        _ => "bin",
    };
    Ok(format!("attachments/{}/{}.{}", o.card_id, o.id, ext))
}
fn metadata_length(json: &[u8], csv: &[u8]) -> Result<usize> {
    let total = json.len().checked_add(csv.len()).ok_or_else(large)?;
    if total > MAX_BYTES {
        return Err(large());
    }
    Ok(total)
}
struct CappedFile(std::fs::File);
impl Write for CappedFile {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        use std::io::Seek;
        if self.0.stream_position()?.saturating_add(bytes.len() as u64) > ZIP_BYTES {
            return Err(std::io::Error::other("export limit"));
        }
        self.0.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}
impl std::io::Seek for CappedFile {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.0.seek(pos)
    }
}
fn zip_entry(zip: &mut zip::ZipWriter<CappedFile>, path: &str, bytes: &[u8]) -> Result<()> {
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o600);
    zip.start_file(path, options).map_err(|_| zip_large())?;
    zip.write_all(bytes).map_err(|_| zip_large())
}
async fn zip_download(
    state: &AppState,
    a: &Actor,
    input: &Selection,
    snap: Snapshot,
) -> Result<Response> {
    let _permit = ZIP_GATE.try_acquire().map_err(|_| {
        error::Error(
            StatusCode::TOO_MANY_REQUESTS,
            "export_busy",
            "Another ZIP is building; retry later",
        )
    })?;
    tokio::time::timeout(
        std::time::Duration::from_secs(120),
        build_zip(state, a, input, snap),
    )
    .await
    .map_err(|_| {
        error::Error(
            StatusCode::GATEWAY_TIMEOUT,
            "export_timeout",
            "ZIP build timed out; select fewer tasks and retry",
        )
    })?
}
async fn build_zip(
    state: &AppState,
    a: &Actor,
    input: &Selection,
    snap: Snapshot,
) -> Result<Response> {
    original_limits(state, &snap)?;
    // TempDir is random mode 0700; NamedTempFile is random mode 0600. Both clean up on cancellation/error.
    let dir = tempfile::Builder::new()
        .prefix("norns-export-")
        .permissions({
            use std::os::unix::fs::PermissionsExt;
            std::fs::Permissions::from_mode(0o700)
        })
        .tempdir()
        .map_err(|_| internal())?;
    let file = tempfile::NamedTempFile::new_in(dir.path()).map_err(|_| internal())?;
    let mut zip = zip::ZipWriter::new(CappedFile(file.reopen().map_err(|_| internal())?));
    let json = artifact(&snap, &Format::Json)?;
    let csv = artifact(&snap, &Format::Csv)?;
    metadata_length(&json, &csv)?;
    zip_entry(&mut zip, "data.json", &json)?;
    zip_entry(&mut zip, "tasks.csv", &csv)?;
    let mut entries = vec![
        json!({"path":"data.json","size":json.len(),"sha256":format!("{:x}",Sha256::digest(&json))}),
        json!({"path":"tasks.csv","size":csv.len(),"sha256":format!("{:x}",Sha256::digest(&csv))}),
    ];
    let mut total = 0usize;
    for o in &snap.originals {
        let store = state.storage.as_ref().ok_or_else(zip_failed)?;
        let bytes = store
            .export_original(&o.final_key, o.size)
            .await
            .map_err(|_| zip_failed())?;
        total = total.checked_add(bytes.len()).ok_or_else(zip_large)?;
        if total > ORIGINAL_BYTES as usize {
            return Err(zip_large());
        }
        let path = original_path(o)?;
        zip_entry(&mut zip, &path, &bytes)?;
        entries.push(json!({"path":path,"attachment_id":o.id,"card_id":o.card_id,"size":bytes.len(),"sha256":format!("{:x}",Sha256::digest(&bytes))}));
    }
    let exclusions: Vec<_>=snap.doc["attachments"].as_array().ok_or_else(internal)?.iter().filter(|v|v["state"]!="ready").map(|v|json!({"attachment_id":v["id"],"card_id":v["card_id"],"state":v["state"],"reason":"not_ready"})).collect();
    let manifest = json!({"schema_version":1,"kind":"norns-selected-originals","expected_snapshot":snap.hash,"ready_original_count":snap.originals.len(),"ready_original_bytes":total,"entries":entries,"excluded_attachments":exclusions});
    zip_entry(&mut zip, "manifest.json", &encode(&manifest)?)?;
    let written = zip.finish().map_err(|_| zip_large())?;
    written.0.sync_all().map_err(|_| internal())?;
    let length = written.0.metadata().map_err(|_| internal())?.len();
    if length > ZIP_BYTES {
        return Err(zip_large());
    }
    // Full allowed metadata + private identity hash, all scopes and live session checked after S3, before headers.
    let current = capture(state, a, input).await?;
    if current.hash != snap.hash {
        return Err(error::Error(
            StatusCode::CONFLICT,
            "export_snapshot_changed",
            "Selected data changed; preview again before downloading",
        ));
    }
    let mut response = tower_http::services::ServeFile::new(file.path())
        .try_call(axum::http::Request::new(axum::body::Body::empty()))
        .await
        .map_err(|_| internal())?
        .into_response();
    if response.status() != StatusCode::OK {
        return Err(internal());
    }
    // On Unix ServeFile has opened its own fd. Unlink now: EOF/disconnect drops that fd,
    // including abandoned responses, without keeping any publicly addressable spool path.
    drop(written);
    drop(file);
    drop(dir);
    let headers = response.headers_mut();
    for (key, value) in [
        (header::CONTENT_TYPE, "application/zip".to_owned()),
        (header::CONTENT_LENGTH, length.to_string()),
        (
            header::CONTENT_DISPOSITION,
            format!(
                "attachment; filename=\"norns-export-{}.zip\"",
                chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
            ),
        ),
        (header::CACHE_CONTROL, "no-store".into()),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
    ] {
        headers.insert(key, value.parse().map_err(|_| internal())?);
    }
    Ok(response)
}

#[cfg(test)]
mod zip_tests {
    use super::*;
    use std::io::{Seek, SeekFrom};
    #[test]
    fn actual_zip_writer_rejects_bytes_over_cap_including_final_headers() {
        let mut writer = CappedFile(tempfile::tempfile().unwrap());
        writer.seek(SeekFrom::Start(ZIP_BYTES - 1)).unwrap();
        writer.write_all(&[1]).unwrap();
        assert!(writer.write_all(&[2]).is_err());
        assert_eq!(writer.0.metadata().unwrap().len(), ZIP_BYTES);
        writer.seek(SeekFrom::Start(ZIP_BYTES - 100)).unwrap();
        let mut zip = zip::ZipWriter::new(writer);
        assert!(zip_entry(&mut zip, "data.json", &[0; 200]).is_err());
        zip.abort_file().unwrap();
        zip.finish().unwrap();
    }
    #[test]
    fn identity_paths_never_use_untrusted_names_or_extensions() {
        let mut o = Original {
            id: "safe-1_id".into(),
            card_id: 10,
            list_id: 1,
            board_id: 1,
            final_key: "never-exported".into(),
            size: 1,
            mime: "../../evil".into(),
        };
        assert_eq!(original_path(&o).unwrap(), "attachments/10/safe-1_id.bin");
        for id in ["../escape", "/absolute", "a\\b", ".", "", "汉字"] {
            o.id = id.into();
            assert!(original_path(&o).is_err());
        }
    }
}
