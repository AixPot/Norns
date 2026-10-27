use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
const ORIGIN: &str = "http://localhost:48731";
async fn call(
    app: &axum::Router,
    method: &str,
    path: &str,
    data: Value,
    c: &str,
    t: &str,
) -> (StatusCode, Value, String) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("origin", ORIGIN)
                .header("content-type", "application/json")
                .header("cookie", c)
                .header("x-csrf-token", t)
                .body(Body::from(data.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let s = r.status();
    let cookie = r
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    if !s.is_success() {
        println!(
            "API_EXAMPLE_ERROR {} {} {} {}",
            method,
            path,
            s.as_u16(),
            String::from_utf8_lossy(&bytes)
        );
    }
    (
        s,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned())),
        cookie,
    )
}
async fn login(app: &axum::Router, name: &str) -> (String, String) {
    let (s, v, c) = call(
        app,
        "POST",
        "/api/login",
        json!({"username":name,"password":"synthetic-password-123"}),
        "",
        "",
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    (c, v["csrf"].as_str().unwrap().into())
}
async fn fixture() -> (
    tempfile::TempDir,
    String,
    axum::Router,
    String,
    String,
    Value,
) {
    let d = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}", d.path().join("test.sqlite").display());
    norns::init_admin(&url, "admin", "synthetic-password-123")
        .await
        .unwrap();
    let app = norns::app(&url, ORIGIN, false).await;
    let (c, t) = login(&app, "admin").await;
    let (s, v, _) = call(&app, "GET", "/api/inbox", json!({}), &c, &t).await;
    assert_eq!(s, StatusCode::OK);
    (d, url, app, c, t, v)
}
async fn mutate(
    app: &axum::Router,
    snap: &Value,
    mut action: Value,
    c: &str,
    t: &str,
) -> (StatusCode, Value, String) {
    action["expected_revision"] = snap["revision"].clone();
    call(
        app,
        "POST",
        &format!("/api/boards/{}/mutate", snap["id"]),
        action,
        c,
        t,
    )
    .await
}

async fn apply(app: &axum::Router, b: &mut Value, a: Value, c: &str, t: &str) {
    let (s, v, _) = mutate(app, b, a, c, t).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    *b = v;
}
#[tokio::test]
async fn skip_preserves_original_creates_clean_unique_successor_and_unskip() {
    let (_d, _url, app, c, t, mut b) = fixture().await;
    let l = b["lists"][0]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_create","list_id":l,"title":"repeat","description":"keep","schedule":{"start_date":"2027-01-31","repeat":{"unit":"month","count":2}}}),&c,&t).await;
    let id = b["cards"][0]["id"].clone();
    apply(
        &app,
        &mut b,
        json!({"action":"comment_create","card_id":id,"body":"keep"}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut b,
        json!({"action":"checklist_create","card_id":id,"title":"item"}),
        &c,
        &t,
    )
    .await;
    let path = format!("/api/boards/{}/cards/{}/skip-preview", b["id"], id);
    let (s, p, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{p}");
    let original = b["cards"][0].clone();
    apply(
        &app,
        &mut b,
        json!({"action":"card_skip","card_id":id,"preview":p}),
        &c,
        &t,
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
    let old = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id)
        .unwrap();
    assert_eq!(old["skipped"], true);
    assert_eq!(old["completed"], false);
    assert_eq!(old["schedule"], original["schedule"]);
    assert_eq!(b["comments"].as_array().unwrap().len(), 1);
    let child = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == id)
        .unwrap()
        .clone();
    assert_eq!(child["touch_version"], 0);
    assert_eq!(child["skipped"], false);
    assert_eq!(child["schedule"]["start_date"], "2027-02-28");
    let (_, filtered, _) = call(&app, "GET", "/api/tasks?status=skipped", json!({}), &c, &t).await;
    assert_eq!(filtered["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"card_complete","card_id":id,"completed":true}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    apply(
        &app,
        &mut b,
        json!({"action":"card_unskip","card_id":id}),
        &c,
        &t,
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 1);
    assert_eq!(b["cards"][0]["skipped"], false);
    let (_, p, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    apply(
        &app,
        &mut b,
        json!({"action":"card_skip","card_id":id,"preview":p}),
        &c,
        &t,
    )
    .await;
    let newer = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == id)
        .unwrap()["id"]
        .clone();
    assert!(newer.as_i64() > child["id"].as_i64());
    let (_, last, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}/cards/{}/skip-preview", b["id"], newer),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert!(last["next_schedule"].is_null());
    apply(
        &app,
        &mut b,
        json!({"action":"card_skip","card_id":newer,"preview":last}),
        &c,
        &t,
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"card_unskip","card_id":id}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, mut shared, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"publish skipped history"}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut shared,
        json!({"action":"list_create","title":"published"}),
        &c,
        &t,
    )
    .await;
    let path = format!(
        "/api/inbox/cards/{}/transfer-preview?target_board_id={}&target_list_id={}",
        id, shared["id"], shared["lists"][0]["id"]
    );
    let (status, preview, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preview["skipped_count"], 2);
    let (status, result, _) = call(
        &app,
        "POST",
        &format!("/api/inbox/cards/{}/transfer", id),
        json!({"ack_visibility":true,"preview":preview}),
        &c,
        &t,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let (_, published, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", shared["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert!(
        published["cards"]
            .as_array()
            .unwrap()
            .iter()
            .all(|v| v["skipped"] == true && v["completed"] == false)
    );
    let (_, empty, _) = call(&app, "GET", "/api/inbox", json!({}), &c, &t).await;
    assert!(empty["cards"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn member_removes_list_moving_all_history_and_stale_touch_rolls_back() {
    let (_d, url, app, c, t, _) = fixture().await;
    let (_, mut b, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"shared"}),
        &c,
        &t,
    )
    .await;
    for title in ["source", "target"] {
        apply(
            &app,
            &mut b,
            json!({"action":"list_create","title":title}),
            &c,
            &t,
        )
        .await;
    }
    let source = b["lists"][0]["id"].clone();
    let target = b["lists"][1]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_create","list_id":source,"title":"history","schedule":{"start_date":"2027-01-01","repeat":{"unit":"day","count":2}}}),&c,&t).await;
    let id = b["cards"][0]["id"].clone();
    let (_, p, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}/cards/{}/skip-preview", b["id"], id),
        json!({}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut b,
        json!({"action":"card_skip","card_id":id,"preview":p}),
        &c,
        &t,
    )
    .await;
    let child = b["cards"][1]["id"].clone();
    apply(
        &app,
        &mut b,
        json!({"action":"card_complete","card_id":child,"completed":true}),
        &c,
        &t,
    )
    .await;
    apply(&app,&mut b,json!({"action":"card_update","card_id":id,"title":"history","description":"","archived":true}),&c,&t).await;
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"member","password":"synthetic-password-123"}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut b,
        json!({"action":"member_set","username":"member","role":"member"}),
        &c,
        &t,
    )
    .await;
    let (mc, mt) = login(&app, "member").await;
    let path = format!(
        "/api/boards/{}/lists/{}/remove-preview?target_list_id={}",
        b["id"], source, target
    );
    let (s, preview, _) = call(&app, "GET", &path, json!({}), &mc, &mt).await;
    assert_eq!(s, StatusCode::OK, "{preview}");
    assert_eq!(preview["task_count"], 2);
    assert_eq!(preview["skipped_count"], 1);
    assert_eq!(preview["completed_count"], 1);
    assert_eq!(preview["incomplete_count"], 0);
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE cards SET touch_version=touch_version+1 WHERE id=?")
        .bind(id.as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"list_remove","preview":preview}),
            &mc,
            &mt
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, preview, _) = call(&app, "GET", &path, json!({}), &mc, &mt).await;
    let old = b.clone();
    apply(
        &app,
        &mut b,
        json!({"action":"list_remove","preview":preview}),
        &mc,
        &mt,
    )
    .await;
    assert_eq!(b["lists"].as_array().unwrap().len(), 1);
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
    assert_eq!(
        b["revision"].as_i64().unwrap(),
        old["revision"].as_i64().unwrap() + 1
    );
    for v in b["cards"].as_array().unwrap() {
        assert_eq!(v["list_id"], target);
    }
    assert_eq!(b["cards"][0]["skipped"], true);
    assert_eq!(b["cards"][0]["archived"], true);
    let (s, history, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}/cards/{}/history", b["id"], child),
        json!({}),
        &mc,
        &mt,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{history}");
    assert_eq!(history["cards"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn skipped_preview_drift_touch_and_complete_undo_cannot_delete_skipped_child() {
    let (_d, url, app, c, t, mut b) = fixture().await;
    let l = b["lists"][0]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_create","list_id":l,"title":"repeat","schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    let id = b["cards"][0]["id"].clone();
    let path = format!("/api/boards/{}/cards/{}/skip-preview", b["id"], id);
    let (_, preview, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    let mut bad = preview.clone();
    bad["next_schedule"]["start_date"] = json!("2099-01-01");
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"card_skip","card_id":id,"preview":bad}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE cards SET touch_version=touch_version+1 WHERE id=?")
        .bind(id.as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"card_skip","card_id":id,"preview":preview}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    apply(
        &app,
        &mut b,
        json!({"action":"card_complete","card_id":id,"completed":true}),
        &c,
        &t,
    )
    .await;
    let child = b["cards"][1]["id"].clone();
    let (_, preview, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}/cards/{}/skip-preview", b["id"], child),
        json!({}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut b,
        json!({"action":"card_skip","card_id":child,"preview":preview}),
        &c,
        &t,
    )
    .await;
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"card_complete","card_id":id,"completed":false}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(b["cards"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn removal_acl_protection_attachment_drift_and_late_failure_are_atomic() {
    let (_d, url, app, c, t, inbox) = fixture().await;
    let (_, mut b, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"shared"}),
        &c,
        &t,
    )
    .await;
    for title in ["source", "target"] {
        apply(
            &app,
            &mut b,
            json!({"action":"list_create","title":title}),
            &c,
            &t,
        )
        .await;
    }
    let source = b["lists"][0]["id"].clone();
    let target = b["lists"][1]["id"].clone();
    apply(
        &app,
        &mut b,
        json!({"action":"card_create","list_id":source,"title":"keep"}),
        &c,
        &t,
    )
    .await;
    let id = b["cards"][0]["id"].as_i64().unwrap();
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    // More than the bulk cap: removal is not a loop of capped bulk commands.
    for n in 1..=101 {
        sqlx::query("INSERT INTO cards(list_id,title,position) VALUES(?,'history',?)")
            .bind(source.as_i64().unwrap())
            .bind(n)
            .execute(&pool)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO attachments(id,card_id,filename,size,mime,state,staging,final_key,expires_at,created_at) VALUES('file',?,'keep.txt',4,'text/plain','pending','staging','final',9999999999,1)").bind(id).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO attachment_outbox(key,not_before) VALUES('old',0)")
        .execute(&pool)
        .await
        .unwrap();
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"outsider","password":"synthetic-password-123"}),
        &c,
        &t,
    )
    .await;
    let (oc, ot) = login(&app, "outsider").await;
    let path = format!(
        "/api/boards/{}/lists/{}/remove-preview?target_list_id={}",
        b["id"], source, target
    );
    assert_eq!(
        call(&app, "GET", &path, json!({}), &oc, &ot).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, "GET", &path, json!({}), &c, &t).await.0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE attachments SET state='verifying' WHERE id='file'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", &path, json!({}), &c, &t).await.0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE attachments SET state='ready' WHERE id='file'")
        .execute(&pool)
        .await
        .unwrap();
    let (_, p, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    assert_eq!(p["task_count"], 102);
    assert_eq!(p["attachment_count"], 1);
    let mut wrong = p.clone();
    wrong["cards"][0]["touch_version"] = json!(999999);
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"list_remove","preview":wrong}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    println!("API_EXAMPLE_REMOVE_PREVIEW={p}");
    sqlx::query("UPDATE attachments SET filename='changed.txt' WHERE id='file'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"list_remove","preview":p}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, p, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    let before: Vec<(i64, i64, i64, i64)> =
        sqlx::query_as("SELECT id,list_id,position,touch_version FROM cards ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    sqlx::query("CREATE TRIGGER fail_remove BEFORE DELETE ON lists BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END").execute(&pool).await.unwrap();
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"list_remove","preview":p}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        before,
        sqlx::query_as::<_, (i64, i64, i64, i64)>(
            "SELECT id,list_id,position,touch_version FROM cards ORDER BY id"
        )
        .fetch_all(&pool)
        .await
        .unwrap()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT revision FROM boards WHERE id=?")
            .bind(b["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap(),
        b["revision"].as_i64().unwrap()
    );
    sqlx::query("DROP TRIGGER fail_remove")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!(
                "/api/boards/{}/lists/{}/remove-preview?target_list_id={}",
                b["id"], source, source
            ),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!(
                "/api/boards/{}/lists/{}/remove-preview?target_list_id={}",
                b["id"], source, inbox["lists"][0]["id"]
            ),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_ne!(
        call(
            &app,
            "GET",
            &format!(
                "/api/boards/{}/lists/{}/remove-preview?target_list_id={}",
                inbox["id"], inbox["lists"][0]["id"], inbox["lists"][0]["id"]
            ),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, p, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    apply(
        &app,
        &mut b,
        json!({"action":"list_remove","preview":p}),
        &c,
        &t,
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 102);
    assert_eq!(
        sqlx::query_as::<_, (String, String)>(
            "SELECT filename,final_key FROM attachments WHERE id='file'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        ("changed.txt".into(), "final".into())
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachment_outbox WHERE key='old'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert_ne!(
        call(
            &app,
            "GET",
            &format!(
                "/api/boards/{}/lists/{}/remove-preview?target_list_id={}",
                b["id"], target, target
            ),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn malformed_chain_history_and_removal_never_leak_or_move() {
    let (_d, url, app, c, t, mut b) = fixture().await;
    let l = b["lists"][0]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_create","list_id":l,"title":"private","schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    let id = b["cards"][0]["id"].clone();
    let (_, mut shared, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"shared"}),
        &c,
        &t,
    )
    .await;
    for title in ["source", "target"] {
        apply(
            &app,
            &mut shared,
            json!({"action":"list_create","title":title}),
            &c,
            &t,
        )
        .await;
    }
    let source = shared["lists"][0]["id"].clone();
    let target = shared["lists"][1]["id"].clone();
    apply(&app,&mut shared,json!({"action":"card_create","list_id":source,"title":"shared","schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    let sid = shared["cards"][0]["id"].as_i64().unwrap();
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE cards SET predecessor_id=? WHERE id=?")
        .bind(id.as_i64().unwrap())
        .bind(sid)
        .execute(&pool)
        .await
        .unwrap();
    for path in [
        format!("/api/boards/{}/cards/{}/history", shared["id"], sid),
        format!(
            "/api/boards/{}/lists/{}/remove-preview?target_list_id={}",
            shared["id"], source, target
        ),
    ] {
        let (s, v, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
        assert_eq!(s, StatusCode::CONFLICT);
        assert_eq!(v["code"], "invalid_recurrence_chain");
        assert!(v["cards"].is_null());
    }
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}/cards/{}/skip-preview", shared["id"], sid),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE cards SET predecessor_id=id WHERE id=?")
        .bind(sid)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}/cards/{}/history", shared["id"], sid),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    // Missing predecessor is simulated using an independent foreign_keys=off test connection.
    sqlx::query("PRAGMA foreign_keys=OFF")
        .execute(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("PRAGMA foreign_keys=OFF")
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query("UPDATE cards SET predecessor_id=999999 WHERE id=?")
        .bind(sid)
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}/cards/{}/history", shared["id"], sid),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn skip_relative_preserves_resources_and_metadata_blocks_unskip() {
    let (_d, url, app, c, t, mut b) = fixture().await;
    let list = b["lists"][0]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_create","list_id":list,"title":"relative","description":"saved body","schedule":{"start_date":"2020-01-01","start_time":"09:00","end_time":"11:00","repeat":{"unit":"day","interval":3,"mode":"relative","count":2}}}),&c,&t).await;
    let id = b["cards"][0]["id"].clone();
    let uid = b["members"][0]["user_id"].clone();
    apply(
        &app,
        &mut b,
        json!({"action":"card_details","card_id":id,"assignee_id":uid,"due_date":"2020-01-01"}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut b,
        json!({"action":"checklist_create","card_id":id,"title":"checked item"}),
        &c,
        &t,
    )
    .await;
    let item = b["checklist"][0]["id"].clone();
    apply(&app,&mut b,json!({"action":"checklist_update","card_id":id,"item_id":item,"title":"checked item","checked":true}),&c,&t).await;
    apply(
        &app,
        &mut b,
        json!({"action":"comment_create","card_id":id,"body":"original comment"}),
        &c,
        &t,
    )
    .await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("INSERT INTO attachments(id,card_id,filename,size,mime,state,staging,final_key,expires_at,created_at) VALUES('retained',?,'saved.txt',4,'text/plain','ready','retained-stage','retained-key',9999999999,1)").bind(id.as_i64().unwrap()).execute(&pool).await.unwrap();
    let (_, fresh, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    b = fresh;
    let before = b["cards"][0].clone();
    let path = format!("/api/boards/{}/cards/{}/skip-preview", b["id"], id);
    let (_, preview, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    let next = preview["next_schedule"].clone();
    let today = (chrono::Utc::now() + chrono::Duration::hours(8)).date_naive();
    assert_eq!(
        next["start_date"],
        (today + chrono::Duration::days(3)).to_string()
    );
    apply(
        &app,
        &mut b,
        json!({"action":"card_skip","card_id":id,"preview":preview}),
        &c,
        &t,
    )
    .await;
    let original = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == id)
        .unwrap();
    for key in [
        "id",
        "title",
        "description",
        "schedule",
        "assignee_id",
        "due_date",
        "series_id",
        "anchor_schedule",
        "occurrence_no",
        "predecessor_id",
        "archived",
    ] {
        assert_eq!(original[key], before[key], "{key}");
    }
    let child = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == id)
        .unwrap()
        .clone();
    for key in [
        "title",
        "description",
        "assignee_id",
        "series_id",
        "anchor_schedule",
    ] {
        assert_eq!(child[key], before[key], "{key}");
    }
    assert_eq!(child["schedule"], next);
    assert_eq!(child["occurrence_no"], 2);
    assert_eq!(child["touch_version"], 0);
    assert_eq!(child["archived"], false);
    let items = b["checklist"].as_array().unwrap();
    assert_eq!(
        items.iter().find(|v| v["card_id"] == id).unwrap()["checked"],
        true
    );
    assert_eq!(
        items.iter().find(|v| v["card_id"] == child["id"]).unwrap()["checked"],
        false
    );
    assert_eq!(b["comments"].as_array().unwrap().len(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachments WHERE card_id=?")
            .bind(child["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    for (status, count) in [("incomplete", 1), ("all", 2), ("complete", 0)] {
        let (s, v, _) = call(
            &app,
            "GET",
            &format!("/api/tasks?status={status}"),
            json!({}),
            &c,
            &t,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["tasks"].as_array().unwrap().len(), count);
    }
    // Deleted metadata still represents real user processing, even with a future touch regression.
    sqlx::query("INSERT INTO attachments(id,card_id,filename,size,mime,state,staging,final_key,expires_at,created_at) VALUES('deleted-child',?,'old.txt',4,'text/plain','deleted','child-stage','child-key',1,1)").bind(child["id"].as_i64().unwrap()).execute(&pool).await.unwrap();
    sqlx::query("UPDATE cards SET touch_version=0 WHERE id=?")
        .bind(child["id"].as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        mutate(
            &app,
            &b,
            json!({"action":"card_unskip","card_id":id}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        sqlx::query_as::<_, (i64, String)>(
            "SELECT card_id,final_key FROM attachments WHERE id='retained'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        (id.as_i64().unwrap(), "retained-key".into())
    );
    assert!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty()
    );
    println!("API_EXAMPLE_SKIP_PREVIEW={preview}");
    println!("API_EXAMPLE_SKIPPED_SNAPSHOT={b}");
}

#[tokio::test]
async fn next_stage_actions_reject_unrecognized_payload_fields() {
    let (_d, _url, app, c, t, mut b) = fixture().await;
    let list = b["lists"][0]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_create","list_id":list,"title":"strict","schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    let id = b["cards"][0]["id"].clone();
    let (_, p, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}/cards/{}/skip-preview", b["id"], id),
        json!({}),
        &c,
        &t,
    )
    .await;
    for action in [
        json!({"action":"card_skip","card_id":id,"preview":p,"completed":true}),
        json!({"action":"card_unskip","card_id":id,"unknown":true}),
        json!({"action":"list_remove","preview":{"board_id":1,"source_list_id":1,"target_list_id":2,"revision":0,"cards":[],"task_count":0,"incomplete_count":0,"completed_count":0,"skipped_count":0,"archived_count":0,"comment_count":0,"checklist_count":0,"attachment_count":0,"pending_upload_count":0,"verifying_upload_count":0,"attachment_fingerprint":"none"},"unknown":true}),
    ] {
        assert_eq!(
            mutate(&app, &b, action, &c, &t).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}
