use axum::response::IntoResponse;
use axum::{
    body::Body,
    http::{HeaderMap, Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
const ORIGIN: &str = "http://localhost:48731";
struct Fixture {
    _dir: tempfile::TempDir,
    app: axum::Router,
    pool: sqlx::SqlitePool,
    cookie: String,
    csrf: String,
    board: i64,
    list: i64,
}
async fn request(
    app: &axum::Router,
    path: &str,
    data: Value,
    cookie: &str,
    csrf: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header("origin", ORIGIN)
                .header("content-type", "application/json")
                .header("cookie", cookie)
                .header("x-csrf-token", csrf)
                .body(Body::from(data.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let s = r.status();
    let h = r.headers().clone();
    let b = r.into_body().collect().await.unwrap().to_bytes().to_vec();
    (s, h, b)
}
impl Fixture {
    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let url = format!("sqlite://{}", dir.path().join("test.sqlite").display());
        norns::init_admin(&url, "admin", "synthetic-password-123")
            .await
            .unwrap();
        let app = norns::app(&url, ORIGIN, false).await;
        let (s, h, b) = request(
            &app,
            "/api/login",
            json!({"username":"admin","password":"synthetic-password-123"}),
            "",
            "",
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let cookie = h["set-cookie"].to_str().unwrap().into();
        let csrf = serde_json::from_slice::<Value>(&b).unwrap()["csrf"]
            .as_str()
            .unwrap()
            .into();
        let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
        let board = sqlx::query_scalar("SELECT id FROM boards WHERE inbox_owner_id=1")
            .fetch_one(&pool)
            .await
            .unwrap();
        let list = sqlx::query_scalar("SELECT id FROM lists WHERE board_id=?")
            .bind(board)
            .fetch_one(&pool)
            .await
            .unwrap();
        Self {
            _dir: dir,
            app,
            pool,
            cookie,
            csrf,
            board,
            list,
        }
    }
    fn selection(&self) -> Value {
        json!({"board_ids":[self.board],"include_completed":false,"include_archived":false,"format":"json"})
    }
    async fn call(&self, path: &str, v: Value) -> (StatusCode, HeaderMap, Vec<u8>) {
        request(&self.app, path, v, &self.cookie, &self.csrf).await
    }
    async fn preview(&self, v: Value) -> Value {
        let (s, _, b) = self.call("/api/exports/preview", v).await;
        assert_eq!(s, StatusCode::OK, "{}", String::from_utf8_lossy(&b));
        serde_json::from_slice(&b).unwrap()
    }
}
#[tokio::test]
async fn own_inbox_preview_download_is_guarded_and_read_only() {
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO cards(list_id,title,position) VALUES(?,'hello',0)")
        .bind(f.list)
        .execute(&f.pool)
        .await
        .unwrap();
    let before: Vec<(i64, i64)> = sqlx::query_as("SELECT id,revision FROM boards ORDER BY id")
        .fetch_all(&f.pool)
        .await
        .unwrap();
    let mut v = f.selection();
    let p = f.preview(v.clone()).await;
    assert_eq!(p["task_count"], 1);
    v["expected_snapshot"] = p["expected_snapshot"].clone();
    let (s, h, b) = f.call("/api/exports/download", v.clone()).await;
    assert_eq!(s, StatusCode::OK, "{}", String::from_utf8_lossy(&b));
    assert_eq!(h["cache-control"], "no-store");
    assert_eq!(h["x-content-type-options"], "nosniff");
    assert_eq!(
        h["content-length"]
            .to_str()
            .unwrap()
            .parse::<usize>()
            .unwrap(),
        b.len()
    );
    assert!(
        h["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment; filename=\"norns-export-")
    );
    let doc: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(doc["tasks"][0]["title"], "hello");
    assert_eq!(doc["schema_version"], 1);
    assert_eq!(
        sqlx::query_as::<_, (i64, i64)>("SELECT id,revision FROM boards ORDER BY id")
            .fetch_all(&f.pool)
            .await
            .unwrap(),
        before
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT touch_version FROM cards")
            .fetch_one(&f.pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        request(&f.app, "/api/exports/download", v.clone(), "", "")
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&f.app, "/api/exports/download", v, &f.cookie, "wrong")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn selection_validation_and_mixed_foreign_inbox_never_leak_counts() {
    let f = Fixture::new().await;
    // Foreign owner is deliberately also a site admin; ownership is still absolute.
    let (s, _, _) = request(
        &f.app,
        "/api/admin/users",
        json!({"username":"other","password":"synthetic-password-123"}),
        &f.cookie,
        &f.csrf,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let foreign: i64 = sqlx::query_scalar("SELECT id FROM boards WHERE inbox_owner_id=2")
        .fetch_one(&f.pool)
        .await
        .unwrap();
    for ids in [
        json!([foreign]),
        json!([f.board, foreign]),
        json!([f.board, 987654]),
    ] {
        let mut v = f.selection();
        v["board_ids"] = ids;
        let (s, _, b) = f.call("/api/exports/preview", v).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        assert_eq!(
            serde_json::from_slice::<Value>(&b).unwrap(),
            json!({"code":"not_found","message":"资源不存在或无权访问"})
        );
    }
    for ids in [
        json!([]),
        json!([f.board, f.board]),
        json!((1..=21).collect::<Vec<_>>()),
        json!([-1]),
    ] {
        let mut v = f.selection();
        v["board_ids"] = ids;
        assert_eq!(
            f.call("/api/exports/preview", v).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    for key in ["include_completed", "include_archived", "format"] {
        let mut v = f.selection();
        v.as_object_mut().unwrap().remove(key);
        assert_eq!(
            f.call("/api/exports/preview", v).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let mut v = f.selection();
    v["format"] = json!("tar");
    assert_eq!(
        f.call("/api/exports/preview", v).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
async fn document(f: &Fixture, mut v: Value) -> (Value, Vec<u8>) {
    let p = f.preview(v.clone()).await;
    v["expected_snapshot"] = p["expected_snapshot"].clone();
    let (s, _, b) = f.call("/api/exports/download", v).await;
    assert_eq!(s, StatusCode::OK, "{}", String::from_utf8_lossy(&b));
    (serde_json::from_slice(&b).unwrap_or(Value::Null), b)
}
#[tokio::test]
async fn independent_status_filters_children_references_and_deterministic_order() {
    let f = Fixture::new().await;
    for (id, completed, archived, pos) in [
        (10, true, false, 0),
        (11, false, false, 3),
        (12, false, true, 2),
        (13, true, true, 1),
    ] {
        sqlx::query("INSERT INTO cards(id,list_id,title,position,completed,archived,schedule,anchor_schedule,series_id,occurrence_no,predecessor_id,assignee_id) VALUES(?,?,?, ?,?,?,?,?,'series',?, ?,1)").bind(id).bind(f.list).bind(format!("task{id}")).bind(pos).bind(completed).bind(archived).bind(r#"{"start_date":"2096-01-01","timezone":"Asia/Shanghai","repeat":{"unit":"day"}}"#).bind(r#"{"start_date":"2096-01-01","timezone":"Asia/Shanghai"}"#).bind(id-9).bind(if id==11 {Some(10)}else{None}).execute(&f.pool).await.unwrap();
        sqlx::query("INSERT INTO comments(card_id,author_id,body,created_at) VALUES(?,1,?,100)")
            .bind(id)
            .bind(format!("comment{id}"))
            .execute(&f.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO checklist_items(card_id,title,position) VALUES(?,'item',0)")
            .bind(id)
            .execute(&f.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO attachments(id,card_id,filename,size,mime,state,staging,final_key,expires_at,created_at) VALUES(?,?,'file.txt',42,'text/plain','ready',?, ?,9999999999,100)").bind(format!("a{id}")).bind(id).bind(format!("private-staging{id}")).bind(format!("private-final{id}")).execute(&f.pool).await.unwrap();
    }
    let before: Vec<(i64, i64)> = sqlx::query_as("SELECT id,touch_version FROM cards ORDER BY id")
        .fetch_all(&f.pool)
        .await
        .unwrap();
    for (completed, archived, expected) in [
        (false, false, vec![11]),
        (true, false, vec![10, 11]),
        (false, true, vec![12, 11]),
        (true, true, vec![10, 13, 12, 11]),
    ] {
        let mut v = f.selection();
        v["include_completed"] = json!(completed);
        v["include_archived"] = json!(archived);
        let p1 = f.preview(v.clone()).await;
        let p2 = f.preview(v.clone()).await;
        assert_eq!(p1, p2);
        let (doc, b) = document(&f, v).await;
        assert_eq!(
            doc["tasks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|x| x["id"].as_i64().unwrap())
                .collect::<Vec<_>>(),
            expected
        );
        for key in ["checklist", "comments", "attachments"] {
            assert_eq!(doc[key].as_array().unwrap().len(), expected.len());
        }
        assert_eq!(doc["users"], json!([{"id":1,"username":"admin"}]));
        assert_eq!(
            doc["tasks"]
                .as_array()
                .unwrap()
                .iter()
                .find(|x| x["id"] == 11)
                .unwrap()["references_outside_selection"],
            if completed {
                json!([])
            } else {
                json!([{"field":"predecessor_id","id":10}])
            }
        );
        assert!(doc["tasks"][0]["schedule"]["repeat"].is_object());
        assert!(doc["tasks"][0]["anchor_schedule"].is_object());
        let raw = String::from_utf8(b).unwrap();
        for forbidden in [
            "password_hash",
            "csrf",
            "token_hash",
            "sessions",
            "staging",
            "final_key",
            "private-",
            "expires_at",
            "bucket",
            "endpoint",
            "signed_url",
        ] {
            assert!(!raw.contains(forbidden), "{forbidden}");
        }
    }
    assert_eq!(
        sqlx::query_as::<_, (i64, i64)>("SELECT id,touch_version FROM cards ORDER BY id")
            .fetch_all(&f.pool)
            .await
            .unwrap(),
        before
    );
}
#[tokio::test]
async fn csv_neutralizes_formulas_but_json_preserves_unicode_quotes_multiline() {
    let f = Fixture::new().await;
    let titles = [
        "=1+1",
        " +cmd",
        "\t@evil",
        "\r\n-evil",
        "\u{1} =evil",
        "普通任务\"quoted\"\nsecond",
        "\ttext",
        " \ttext",
        "\ntext",
        "@evil",
    ];
    for (pos, title) in titles.iter().enumerate() {
        sqlx::query("INSERT INTO cards(list_id,title,description,position) VALUES(?,?,?,?)")
            .bind(f.list)
            .bind(title)
            .bind("多行\r\n描述,\"原文\"")
            .bind(pos as i64)
            .execute(&f.pool)
            .await
            .unwrap();
    }
    let (doc, _) = document(&f, f.selection()).await;
    for (n, title) in titles.iter().enumerate() {
        assert_eq!(doc["tasks"][n]["title"], *title);
        assert_eq!(doc["tasks"][n]["description"], "多行\r\n描述,\"原文\"");
    }
    let mut v = f.selection();
    v["format"] = json!("csv");
    let (_, b) = document(&f, v).await;
    assert_eq!(&b[..3], &[239, 187, 191]);
    let text = String::from_utf8(b[3..].to_vec()).unwrap();
    assert!(text.ends_with("\r\n"));
    for title in titles.iter().filter(|x| !x.starts_with('普')) {
        assert!(
            text.contains(&format!("\"'{}\"", title.replace('"', "\"\""))),
            "{title:?}: {text}"
        );
    }
    assert!(text.contains("\"普通任务\"\"quoted\"\"\nsecond\""));
    assert!(text.contains("\"多行\r\n描述,\"\"原文\"\"\""));
}
#[tokio::test]
async fn snapshot_drift_and_revocation_require_new_authorized_preview() {
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO cards(list_id,title,position) VALUES(?,'first',0)")
        .bind(f.list)
        .execute(&f.pool)
        .await
        .unwrap();
    let mut v = f.selection();
    v["expected_snapshot"] = f.preview(v.clone()).await["expected_snapshot"].clone();
    sqlx::query("UPDATE cards SET description='changed' WHERE list_id=?")
        .bind(f.list)
        .execute(&f.pool)
        .await
        .unwrap();
    let (s, _, b) = f.call("/api/exports/download", v.clone()).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        serde_json::from_slice::<Value>(&b).unwrap()["code"],
        "export_snapshot_changed"
    );
    sqlx::query("UPDATE users SET active=0 WHERE id=1")
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        f.call("/api/exports/download", v).await.0,
        StatusCode::UNAUTHORIZED
    );
}
#[tokio::test]
async fn bounded_tasks_children_and_bytes_reject_before_snapshot() {
    let f = Fixture::new().await;
    sqlx::query("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<5001) INSERT INTO cards(list_id,title,position) SELECT ?,'x',x FROM n").bind(f.list).execute(&f.pool).await.unwrap();
    let (s, _, b) = f.call("/api/exports/preview", f.selection()).await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(String::from_utf8(b).unwrap().contains("select fewer"));
    sqlx::query("DELETE FROM cards WHERE id<>(SELECT MIN(id) FROM cards)")
        .execute(&f.pool)
        .await
        .unwrap();
    let card: i64 = sqlx::query_scalar("SELECT id FROM cards")
        .fetch_one(&f.pool)
        .await
        .unwrap();
    sqlx::query("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO checklist_items(card_id,title,position) SELECT ?,'x',x FROM n").bind(card).execute(&f.pool).await.unwrap();
    assert_eq!(
        f.call("/api/exports/preview", f.selection()).await.0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    sqlx::query("DELETE FROM checklist_items")
        .execute(&f.pool)
        .await
        .unwrap();
    for body in [
        "x".repeat(16 * 1024 * 1024 + 1),
        "\u{1}".repeat(3 * 1024 * 1024),
    ] {
        sqlx::query("UPDATE cards SET description=?")
            .bind(body)
            .execute(&f.pool)
            .await
            .unwrap();
        assert_eq!(
            f.call("/api/exports/preview", f.selection()).await.0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }
}

#[tokio::test]
async fn shared_board_member_export_and_revoked_mixed_download_are_all_or_nothing() {
    let f = Fixture::new().await;
    let (s, _, b) = f.call("/api/boards", json!({"title":"Shared"})).await;
    assert_eq!(s, StatusCode::CREATED);
    let shared = serde_json::from_slice::<Value>(&b).unwrap()["id"]
        .as_i64()
        .unwrap();
    sqlx::query("INSERT INTO lists(board_id,title,position) VALUES(?,'Work',0)")
        .bind(shared)
        .execute(&f.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO cards(list_id,title,position) SELECT id,'shared task',0 FROM lists WHERE board_id=?").bind(shared).execute(&f.pool).await.unwrap();
    let mut v = f.selection();
    v["board_ids"] = json!([shared, f.board]);
    let p = f.preview(v.clone()).await;
    assert_eq!(p["task_count"], 1);
    // Input order does not affect the canonical scope/hash.
    v["board_ids"] = json!([f.board, shared]);
    assert_eq!(f.preview(v.clone()).await, p);
    v["expected_snapshot"] = p["expected_snapshot"].clone();
    // No implicit expansion to unrelated accounts.
    f.call(
        "/api/admin/users",
        json!({"username":"outsider","password":"synthetic-password-123"}),
    )
    .await;
    let (s, _, b) = f.call("/api/exports/download", v.clone()).await;
    assert_eq!(s, StatusCode::OK);
    let doc: Value = serde_json::from_slice(&b).unwrap();
    assert_eq!(doc["users"], json!([]));
    sqlx::query("UPDATE board_members SET role='member' WHERE board_id=? AND user_id=1")
        .bind(shared)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        f.call("/api/exports/download", v.clone()).await.0,
        StatusCode::OK
    );
    sqlx::query("DELETE FROM board_members WHERE board_id=? AND user_id=1")
        .bind(shared)
        .execute(&f.pool)
        .await
        .unwrap();
    let (s, _, b) = f.call("/api/exports/download", v).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(!String::from_utf8(b).unwrap().contains("task_count"));
}
#[tokio::test]
async fn missing_snapshot_and_wrong_origin_are_rejected() {
    let f = Fixture::new().await;
    assert_eq!(
        f.call("/api/exports/download", f.selection()).await.0,
        StatusCode::BAD_REQUEST
    );
    for path in ["/api/exports/preview", "/api/exports/download"] {
        let r = f
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("content-type", "application/json")
                    .header("cookie", &f.cookie)
                    .header("x-csrf-token", &f.csrf)
                    .header("origin", "https://untrusted.invalid")
                    .body(Body::from(f.selection().to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
async fn zip_empty_selected_package_is_parseable() {
    let f = Fixture::new().await;
    let mut v = f.selection();
    v["format"] = json!("zip");
    let p = f.preview(v.clone()).await;
    assert_eq!(p["ready_original_count"], 0);
    assert_eq!(p["ready_original_bytes"], 0);
    assert_eq!(p["includes_attachment_content"], true);
    v["expected_snapshot"] = p["expected_snapshot"].clone();
    let (s, h, b) = f.call("/api/exports/download", v).await;
    assert_eq!(s, StatusCode::OK, "{}", String::from_utf8_lossy(&b));
    assert_eq!(h["content-type"], "application/zip");
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(b)).unwrap();
    assert_eq!(archive.len(), 3);
    let mut data = String::new();
    std::io::Read::read_to_string(&mut archive.by_name("data.json").unwrap(), &mut data).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&data).unwrap()["tasks"],
        json!([])
    );
    assert!(archive.by_name("tasks.csv").is_ok());
    assert!(archive.by_name("manifest.json").is_ok());
}

// This protocol server exercises the real signed HTTP storage read without cloud keys.
// The separate audit acceptance uses the existing filesystem S3 emulator and real upload/finalization.
#[tokio::test]
async fn zip_storage_original_bytes_and_failure_contract() {
    const FLAG: &str = "NORNS_ZIP_STORAGE_TEST_CHILD";
    if std::env::var_os(FLAG).is_none() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let service = axum::Router::new().route(
            "/{*path}",
            axum::routing::get(|uri: axum::http::Uri| async move {
                assert!(uri.query().unwrap_or_default().contains("X-Amz-Signature="));
                if uri.path().ends_with("/synthetic-original") {
                    (StatusCode::OK, vec![0, 255, 1, 2, 3, 4]).into_response()
                } else {
                    StatusCode::NOT_FOUND.into_response()
                }
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, service).await.unwrap();
        });
        let output = tokio::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "zip_storage_original_bytes_and_failure_contract",
                "--nocapture",
            ])
            .env(FLAG, "1")
            .env("S3_ENDPOINT", format!("http://{address}"))
            .env("S3_REGION", "us-east-1")
            .env("S3_BUCKET", "synthetic-test")
            .env("S3_ACCESS_KEY_ID", "synthetic-only")
            .env("S3_SECRET_ACCESS_KEY", "synthetic-only")
            .env("ATTACHMENT_MAX_BYTES", "100")
            .env("ATTACHMENT_BOARD_QUOTA_BYTES", "1000")
            .output()
            .await
            .unwrap();
        server.abort();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO cards(id,list_id,title,position) VALUES(10,?,'=task',0)")
        .bind(f.list)
        .execute(&f.pool)
        .await
        .unwrap();
    for (id, state, key) in [
        ("original-1", "ready", "synthetic-original"),
        ("pending-1", "pending", "not-fetched"),
    ] {
        sqlx::query("INSERT INTO attachments VALUES(?,10,'../../same.bin',6,'application/octet-stream',?,'stage-'||?, ?,9999999999,100)")
            .bind(id).bind(state).bind(id).bind(key).execute(&f.pool).await.unwrap();
    }
    let mut v = f.selection();
    v["format"] = json!("zip");
    let preview = f.preview(v.clone()).await;
    assert_eq!(preview["attachment_count"], 2);
    assert_eq!(preview["ready_original_count"], 1);
    assert_eq!(preview["ready_original_bytes"], 6);
    assert_eq!(preview["excluded_attachment_count"], 1);
    v["expected_snapshot"] = preview["expected_snapshot"].clone();
    let (status, headers, bytes) = f.call("/api/exports/download", v.clone()).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&bytes)
    );
    assert_eq!(headers["content-length"], bytes.len().to_string());
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut raw = Vec::new();
    std::io::Read::read_to_end(
        &mut z.by_name("attachments/10/original-1.bin").unwrap(),
        &mut raw,
    )
    .unwrap();
    assert_eq!(raw, vec![0, 255, 1, 2, 3, 4]);
    let mut manifest = String::new();
    std::io::Read::read_to_string(&mut z.by_name("manifest.json").unwrap(), &mut manifest).unwrap();
    let manifest: Value = serde_json::from_str(&manifest).unwrap();
    use sha2::{Digest, Sha256};
    let entry = manifest["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["attachment_id"] == "original-1")
        .unwrap();
    assert_eq!(entry["sha256"], format!("{:x}", Sha256::digest(&raw)));
    assert_eq!(manifest["excluded_attachments"][0]["state"], "pending");
    assert_eq!(z.len(), 4);
    for size in [5, 7, 101] {
        sqlx::query("UPDATE attachments SET size=? WHERE id='original-1'")
            .bind(size)
            .execute(&f.pool)
            .await
            .unwrap();
        if size == 101 {
            assert_eq!(
                f.call("/api/exports/preview", {
                    let mut p = v.clone();
                    p.as_object_mut().unwrap().remove("expected_snapshot");
                    p
                })
                .await
                .0,
                StatusCode::PAYLOAD_TOO_LARGE
            );
        } else {
            let mut p = v.clone();
            p.as_object_mut().unwrap().remove("expected_snapshot");
            v["expected_snapshot"] = f.preview(p).await["expected_snapshot"].clone();
            let (status, _, bytes) = f.call("/api/exports/download", v.clone()).await;
            assert_eq!(status, StatusCode::CONFLICT);
            assert_eq!(
                serde_json::from_slice::<Value>(&bytes).unwrap()["code"],
                "export_original_unavailable"
            );
        }
    }
    sqlx::query("UPDATE attachments SET size=6,final_key='missing-original' WHERE id='original-1'")
        .execute(&f.pool)
        .await
        .unwrap();
    let mut p = v.clone();
    p.as_object_mut().unwrap().remove("expected_snapshot");
    v["expected_snapshot"] = f.preview(p).await["expected_snapshot"].clone();
    assert_eq!(
        f.call("/api/exports/download", v).await.0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn zip_combined_metadata_keeps_inherited_16mib_limit() {
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO cards(list_id,title,description,position) VALUES(?,'task',?,0)")
        .bind(f.list)
        .bind("x".repeat(9 * 1024 * 1024))
        .execute(&f.pool)
        .await
        .unwrap();
    let mut v = f.selection();
    assert_eq!(
        f.call("/api/exports/preview", v.clone()).await.0,
        StatusCode::OK
    );
    v["format"] = json!("zip");
    assert_eq!(
        f.call("/api/exports/preview", v).await.0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn skipped_is_retained_by_default_in_json_csv_and_manifest() {
    let f = Fixture::new().await;
    sqlx::query("INSERT INTO cards(id,list_id,title,position,skipped) VALUES(99,?,'skipped',0,1)")
        .bind(f.list)
        .execute(&f.pool)
        .await
        .unwrap();
    let (doc, _) = document(&f, f.selection()).await;
    assert_eq!(doc["tasks"][0]["skipped"], true);
    let mut selection = f.selection();
    selection["format"] = json!("csv");
    let (_, bytes) = document(&f, selection).await;
    let csv = String::from_utf8(bytes).unwrap();
    let columns: Vec<_> = csv
        .lines()
        .next()
        .unwrap()
        .trim_start_matches('\u{feff}')
        .split(',')
        .collect();
    assert!(columns.contains(&"skipped"), "{csv}");
    let mut selection = f.selection();
    selection["format"] = json!("zip");
    let p = f.preview(selection.clone()).await;
    selection["expected_snapshot"] = p["expected_snapshot"].clone();
    let (s, _, bytes) = f.call("/api/exports/download", selection).await;
    assert_eq!(s, StatusCode::OK, "{}", String::from_utf8_lossy(&bytes));
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let manifest: Value = serde_json::from_reader(zip.by_name("manifest.json").unwrap()).unwrap();
    assert_eq!(manifest["tasks"][0]["id"], 99);
    assert_eq!(manifest["tasks"][0]["skipped"], true);
}
