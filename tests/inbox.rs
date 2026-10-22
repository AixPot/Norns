use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
const ORIGIN: &str = "http://localhost:48731";
type PreservedCard = (i64, i64, i64, bool, bool, String, String, i64, String, i64);
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
    let status = r.status();
    let cookie = r
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().to_string())
        .unwrap_or_default();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
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
async fn fixture() -> (tempfile::TempDir, String, axum::Router, String, String) {
    let d = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}", d.path().join("test.sqlite").display());
    norns::init_admin(&url, "admin", "synthetic-password-123")
        .await
        .unwrap();
    let app = norns::app(&url, ORIGIN, false).await;
    let (c, t) = login(&app, "admin").await;
    (d, url, app, c, t)
}
async fn mutate(app: &axum::Router, b: i64, action: Value, c: &str, t: &str) -> Value {
    let (s, v, _) = call(app, "GET", &format!("/api/boards/{b}"), json!({}), c, t).await;
    assert_eq!(s, StatusCode::OK);
    let mut a = action;
    a["expected_revision"] = v["revision"].clone();
    let (s, v, _) = call(app, "POST", &format!("/api/boards/{b}/mutate"), a, c, t).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}
async fn destination(app: &axum::Router, c: &str, t: &str) -> (i64, i64) {
    let (s, v, _) = call(app, "POST", "/api/boards", json!({"title":"Shared"}), c, t).await;
    assert_eq!(s, StatusCode::CREATED);
    let b = v["id"].as_i64().unwrap();
    let v = mutate(
        app,
        b,
        json!({"action":"list_create","title":"To do"}),
        c,
        t,
    )
    .await;
    (b, v["lists"][0]["id"].as_i64().unwrap())
}
async fn preview(app: &axum::Router, card: i64, b: i64, l: i64, c: &str, t: &str) -> Value {
    let (s, v, _) = call(
        app,
        "GET",
        &format!("/api/inbox/cards/{card}/transfer-preview?target_board_id={b}&target_list_id={l}"),
        json!({}),
        c,
        t,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}
async fn transfer(
    app: &axum::Router,
    card: i64,
    p: Value,
    c: &str,
    t: &str,
) -> (StatusCode, Value, String) {
    call(
        app,
        "POST",
        &format!("/api/inbox/cards/{card}/transfer"),
        json!({"ack_visibility":true,"preview":p}),
        c,
        t,
    )
    .await
}
async fn chain(app: &axum::Router, c: &str, t: &str) -> (i64, i64, Vec<i64>) {
    let (_, v, _) = call(app, "GET", "/api/inbox", json!({}), c, t).await;
    let b = v["id"].as_i64().unwrap();
    let l = v["lists"][0]["id"].as_i64().unwrap();
    let v = mutate(
        app,
        b,
        json!({"action":"card_create","list_id":l,"title":"repeat"}),
        c,
        t,
    )
    .await;
    let root = v["cards"][0]["id"].as_i64().unwrap();
    mutate(app,b,json!({"action":"card_schedule","card_id":root,"schedule":{"start_date":"2026-01-01","repeat":{"unit":"day"}}}),c,t).await;
    let v = mutate(
        app,
        b,
        json!({"action":"card_complete","card_id":root,"completed":true}),
        c,
        t,
    )
    .await;
    let second = v["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == root)
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    // Editing the successor creates a new series while preserving predecessor ownership.
    mutate(app,b,json!({"action":"card_schedule","card_id":second,"schedule":{"start_date":"2026-02-01","repeat":{"unit":"month"}}}),c,t).await;
    let v = mutate(
        app,
        b,
        json!({"action":"card_complete","card_id":second,"completed":true}),
        c,
        t,
    )
    .await;
    let third = v["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == second)
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    mutate(app,b,json!({"action":"card_update","card_id":root,"title":"repeat","description":"private history","archived":true}),c,t).await;
    mutate(
        app,
        b,
        json!({"action":"comment_create","card_id":root,"body":"historical comment"}),
        c,
        t,
    )
    .await;
    (b, l, vec![root, second, third])
}
#[tokio::test]
async fn inbox_transfer_cross_series_archived_chain_atomic() {
    let (_d, url, app, c, t) = fixture().await;
    let (source, _, ids) = chain(&app, &c, &t).await;
    let (b, l) = destination(&app, &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    // Deleted metadata/outbox are retained without requiring storage configuration.
    sqlx::query("INSERT INTO attachments VALUES('gone',?,'history.txt',7,'text/plain','deleted','staging','final',9999999999,1)").bind(ids[0]).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO attachment_outbox(key,not_before) VALUES('final',9999999999)")
        .execute(&pool)
        .await
        .unwrap();
    let before:Vec<PreservedCard>=sqlx::query_as("SELECT id,position,touch_version,completed,archived,COALESCE(series_id,''),COALESCE(CAST(predecessor_id AS TEXT),''),occurrence_no,COALESCE(anchor_schedule,''),list_id FROM cards ORDER BY id").fetch_all(&pool).await.unwrap();
    let p = preview(&app, ids[2], b, l, &c, &t).await;
    assert_eq!(p["task_count"], 3);
    assert_eq!(p["archived_count"], 1);
    assert_eq!(p["comment_count"], 1);
    assert_eq!(p["attachment_count"], 1);
    assert_eq!(p["attachment_bytes"], 0);
    let (s, v, _) = transfer(&app, ids[2], p, &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["card_ids"], json!(ids));
    let after:Vec<PreservedCard>=sqlx::query_as("SELECT id,position,touch_version,completed,archived,COALESCE(series_id,''),COALESCE(CAST(predecessor_id AS TEXT),''),occurrence_no,COALESCE(anchor_schedule,''),list_id FROM cards ORDER BY id").fetch_all(&pool).await.unwrap();
    for (a, z) in before.iter().zip(&after) {
        assert_eq!(a.0, z.0);
        assert!(z.2 > a.2);
        assert_eq!(
            (&a.3, &a.4, &a.5, &a.6, &a.7, &a.8),
            (&z.3, &z.4, &z.5, &z.6, &z.7, &z.8)
        );
        assert_eq!(z.9, l);
        if a.4 {
            assert_eq!(a.1, z.1)
        }
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachment_outbox")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    for id in &ids {
        assert_eq!(
            call(
                &app,
                "GET",
                &format!("/api/boards/{source}/cards/{id}"),
                json!({}),
                &c,
                &t
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    let (_, snap, _) = call(&app, "GET", &format!("/api/boards/{b}"), json!({}), &c, &t).await;
    // Transfer increments sticky counters, conservatively refusing old completion withdrawal.
    assert_eq!(call(&app,"POST",&format!("/api/boards/{b}/mutate"),json!({"expected_revision":snap["revision"],"action":"card_complete","card_id":ids[1],"completed":false}),&c,&t).await.1["code"],"successor_touched");
    let v = mutate(
        &app,
        b,
        json!({"action":"card_complete","card_id":ids[2],"completed":true}),
        &c,
        &t,
    )
    .await;
    let next = v["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == ids[2])
        .unwrap();
    assert_eq!(next["list_id"], l);
    let next_id = next["id"].clone();
    let v = mutate(
        &app,
        b,
        json!({"action":"card_complete","card_id":ids[2],"completed":false}),
        &c,
        &t,
    )
    .await;
    assert!(
        !v["cards"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["id"] == next_id)
    );
}
#[tokio::test]
async fn discovery_smart_dates_private_boundaries() {
    let (_d, url, app, c, t) = fixture().await;
    let (_, v, _) = call(&app, "GET", "/api/inbox", json!({}), &c, &t).await;
    let l = v["lists"][0]["id"].as_i64().unwrap();
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    // Synthetic rows, all date calculations use the same SQLite Shanghai day as the API.
    for (title, start, end, done, archived, assignee) in [
        ("overdue", Some(-2), Some(-1), false, false, None),
        ("today", Some(0), Some(0), false, false, None),
        ("tomorrow", Some(1), Some(1), false, false, None),
        ("day6", Some(6), Some(6), false, false, None),
        ("day7", Some(7), Some(7), false, false, None),
        ("spanning", Some(-1), Some(2), false, false, None),
        ("undated", None, None, false, false, None),
        ("done", Some(-3), Some(-3), true, false, None),
        ("archived", Some(0), Some(0), false, true, None),
        ("assigned", None, None, false, false, Some(1)),
    ] {
        sqlx::query("INSERT INTO cards(list_id,title,position,due_date,schedule,completed,archived,assignee_id) VALUES(?,?,0,date('now','+8 hours',?),CASE WHEN ? IS NULL THEN NULL ELSE json_object('start_date',date('now','+8 hours',?),'end_date',date('now','+8 hours',?),'timezone','Asia/Shanghai') END,?,?,?)").bind(l).bind(title).bind(start.map(|n|format!("{n:+} days"))).bind(start).bind(start.map(|n|format!("{n:+} days"))).bind(end.map(|n|format!("{n:+} days"))).bind(done).bind(archived).bind(assignee).execute(&pool).await.unwrap();
    }
    for (view, want) in [
        ("today", vec!["overdue", "today", "spanning"]),
        ("tomorrow", vec!["tomorrow", "spanning"]),
        ("next7", vec!["today", "tomorrow", "day6", "spanning"]),
        ("mine", vec!["assigned"]),
        ("upcoming", vec!["tomorrow", "day6", "day7", "spanning"]),
    ] {
        let (s, v, _) = call(
            &app,
            "GET",
            &format!("/api/tasks?view={view}&status=incomplete"),
            json!({}),
            &c,
            &t,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{view}: {v}");
        let mut got: Vec<&str> = v["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["title"].as_str().unwrap())
            .collect();
        got.sort();
        let mut want = want;
        want.sort();
        assert_eq!(got, want, "{view}");
    }
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/tasks?view=today&status=complete",
            json!({}),
            &c,
            &t
        )
        .await
        .1["tasks"][0]["title"],
        "done"
    );
    // Calendar uses the existing from/to intersection, includes completed, never other owners.
    let today: String = sqlx::query_scalar("SELECT date('now','+8 hours')")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/tasks?from={today}&to={today}"),
            json!({}),
            &c,
            &t
        )
        .await
        .1["tasks"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"other","password":"synthetic-password-123"}),
        &c,
        &t,
    )
    .await;
    let (oc, ot) = login(&app, "other").await;
    assert!(
        call(&app, "GET", "/api/tasks?view=next7", json!({}), &oc, &ot)
            .await
            .1["tasks"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
#[tokio::test]
async fn inbox_transfer_failures_leave_exact_state() {
    let (_d, url, app, c, t) = fixture().await;
    let (source, _, ids) = chain(&app, &c, &t).await;
    let (b, l) = destination(&app, &c, &t).await;
    let card = ids[2];
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    for kind in [
        "missing_ack",
        "partial_chain",
        "stale_touch",
        "new_successor",
        "pending",
        "verifying",
        "ready_unconfigured",
        "membership",
        "midway_failure",
    ] {
        let p = preview(&app, card, b, l, &c, &t).await;
        match kind {
            "stale_touch" => {
                sqlx::query("INSERT INTO comments(card_id,author_id,body,created_at) VALUES(?,1,'new since preview',1)").bind(ids[0]).execute(&pool).await.unwrap();
            }
            "new_successor" => {
                mutate(
                    &app,
                    source,
                    json!({"action":"card_complete","card_id":card,"completed":true}),
                    &c,
                    &t,
                )
                .await;
            }
            "pending" | "verifying" | "ready_unconfigured" => {
                sqlx::query("INSERT INTO attachments VALUES(?,?, 'synthetic.txt',1,'text/plain',?,?,?,9999999999,1)").bind(kind).bind(ids[0]).bind(if kind=="ready_unconfigured"{"ready"}else{kind}).bind(format!("s-{kind}")).bind(format!("f-{kind}")).execute(&pool).await.unwrap();
            }
            "membership" => {
                call(
                    &app,
                    "POST",
                    "/api/admin/users",
                    json!({"username":"newmember","password":"synthetic-password-123"}),
                    &c,
                    &t,
                )
                .await;
                mutate(
                    &app,
                    b,
                    json!({"action":"member_set","username":"newmember","role":"member"}),
                    &c,
                    &t,
                )
                .await;
            }
            "midway_failure" => {
                sqlx::query(&format!("CREATE TRIGGER synthetic_transfer_failure BEFORE UPDATE OF list_id ON cards WHEN NEW.id={} BEGIN SELECT RAISE(ABORT,'synthetic midway failure'); END",ids[1])).execute(&pool).await.unwrap();
            }
            _ => {}
        }
        let p = if ["pending", "verifying", "ready_unconfigured"].contains(&kind) {
            preview(&app, card, b, l, &c, &t).await
        } else {
            p
        };
        let before = state(&app, source, b, &c, &t).await;
        let (s, v, _) = if kind == "missing_ack" {
            call(
                &app,
                "POST",
                &format!("/api/inbox/cards/{card}/transfer"),
                json!({"ack_visibility":false,"preview":p}),
                &c,
                &t,
            )
            .await
        } else if kind == "partial_chain" {
            let mut p = p;
            p["cards"].as_array_mut().unwrap().remove(0);
            transfer(&app, card, p, &c, &t).await
        } else {
            transfer(&app, card, p, &c, &t).await
        };
        let expected = match kind {
            "missing_ack" => StatusCode::BAD_REQUEST,
            "ready_unconfigured" => StatusCode::SERVICE_UNAVAILABLE,
            "midway_failure" => StatusCode::INTERNAL_SERVER_ERROR,
            _ => StatusCode::CONFLICT,
        };
        assert_eq!(s, expected, "{kind}: {v}");
        assert_eq!(
            state(&app, source, b, &c, &t).await,
            before,
            "rollback {kind}"
        );
        if ["pending", "verifying", "ready_unconfigured"].contains(&kind) {
            sqlx::query("UPDATE attachments SET state='deleted' WHERE id=?")
                .bind(kind)
                .execute(&pool)
                .await
                .unwrap();
        }
    }
}
async fn state(app: &axum::Router, source: i64, target: i64, c: &str, t: &str) -> Value {
    json!([
        call(
            app,
            "GET",
            &format!("/api/boards/{source}"),
            json!({}),
            c,
            t
        )
        .await
        .1,
        call(
            app,
            "GET",
            &format!("/api/boards/{target}"),
            json!({}),
            c,
            t
        )
        .await
        .1
    ])
}
#[tokio::test]
async fn inbox_transfer_chain_anomalies_and_target_acl() {
    let (_d, url, app, c, t) = fixture().await;
    let (source, list, ids) = chain(&app, &c, &t).await;
    let (b, l) = destination(&app, &c, &t).await;
    let card = ids[2];
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"other","password":"synthetic-password-123"}),
        &c,
        &t,
    )
    .await;
    let (oc, ot) = login(&app, "other").await;
    for (cookie, csrf) in [(&oc, &ot)] {
        let (s, v, _) = call(
            &app,
            "GET",
            &format!(
                "/api/inbox/cards/{card}/transfer-preview?target_board_id={b}&target_list_id={l}"
            ),
            json!({}),
            cookie,
            csrf,
        )
        .await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        assert_eq!(v["code"], "not_found");
    }
    let (ob, ol) = destination(&app, &oc, &ot).await;
    assert_eq!(
        call(
            &app,
            "GET",
            &format!(
                "/api/inbox/cards/{card}/transfer-preview?target_board_id={ob}&target_list_id={ol}"
            ),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(call(&app,"GET",&format!("/api/inbox/cards/{card}/transfer-preview?target_board_id={source}&target_list_id={list}"),json!({}),&c,&t).await.0,StatusCode::NOT_FOUND);
    // External actual predecessor must reject rather than exposing only the private half.
    sqlx::query("UPDATE cards SET list_id=? WHERE id=?")
        .bind(l)
        .bind(ids[0])
        .execute(&pool)
        .await
        .unwrap();
    let before = state(&app, source, b, &c, &t).await;
    let (s, v, _) = call(
        &app,
        "GET",
        &format!("/api/inbox/cards/{card}/transfer-preview?target_board_id={b}&target_list_id={l}"),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(v["code"], "invalid_recurrence_chain");
    assert_eq!(state(&app, source, b, &c, &t).await, before);
    sqlx::query("UPDATE cards SET list_id=? WHERE id=?")
        .bind(list)
        .bind(ids[0])
        .execute(&pool)
        .await
        .unwrap();
    // Same-series but disconnected corruption must not broaden disclosure to unrelated cards.
    sqlx::query("INSERT INTO cards(list_id,title,position,series_id) SELECT ?, 'unrelated',99,series_id FROM cards WHERE id=?").bind(list).bind(card).execute(&pool).await.unwrap();
    let (s, _, _) = call(
        &app,
        "GET",
        &format!("/api/inbox/cards/{card}/transfer-preview?target_board_id={b}&target_list_id={l}"),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    sqlx::query("DELETE FROM cards WHERE title='unrelated'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE cards SET predecessor_id=? WHERE id=?")
        .bind(card)
        .bind(ids[0])
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!(
                "/api/inbox/cards/{card}/transfer-preview?target_board_id={b}&target_list_id={l}"
            ),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query("UPDATE cards SET predecessor_id=NULL WHERE id=?")
        .bind(ids[0])
        .execute(&pool)
        .await
        .unwrap();
    // Ordinary move still rejects cross-board; no independent archived-history transfer.
    let (_, snap, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{source}"),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(call(&app,"POST",&format!("/api/boards/{source}/mutate"),json!({"expected_revision":snap["revision"],"action":"card_move","card_id":card,"target_list_id":l,"index":0}),&c,&t).await.0,StatusCode::NOT_FOUND);
    let p = preview(&app, ids[0], b, l, &c, &t).await;
    assert_eq!(p["task_count"], 3);
    assert_eq!(transfer(&app, ids[0], p, &c, &t).await.0, StatusCode::OK);
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{b}/cards/{card}"),
            json!({}),
            &oc,
            &ot
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    mutate(
        &app,
        b,
        json!({"action":"member_set","username":"other","role":"member"}),
        &c,
        &t,
    )
    .await;
    let (_, v, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{b}"),
        json!({}),
        &oc,
        &ot,
    )
    .await;
    assert_eq!(v["cards"].as_array().unwrap().len(), 3);
    assert_eq!(v["comments"][0]["body"], "historical comment");
}
#[tokio::test]
async fn inbox_upgrade_v8_preserves_all_original_rows_and_inactive_owners() {
    use sqlx::Row;
    let dir = tempfile::tempdir().unwrap();
    let old_dir = tempfile::tempdir().unwrap();
    for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if name.to_string_lossy()[..4].parse::<u32>().unwrap() <= 8 {
            std::fs::copy(entry.path(), old_dir.path().join(name)).unwrap();
        }
    }
    let url = format!(
        "sqlite://{}?mode=rwc",
        dir.path().join("old.sqlite").display()
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::migrate::Migrator::new(old_dir.path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    sqlx::raw_sql("INSERT INTO users(id,username,password_hash,active) VALUES(1,'old-active','synthetic',1),(2,'old-inactive','synthetic',0); INSERT INTO boards VALUES(40,'ordinary',9); INSERT INTO board_members VALUES(40,1,'admin'); INSERT INTO lists VALUES(50,40,'original',7); INSERT INTO cards(id,list_id,title,description,position,archived,completed,due_date,series_id,occurrence_no,touch_version) VALUES(60,50,'old archive','original',3,1,1,'2024-01-01','legacy',2,12); INSERT INTO checklist_items(card_id,title,checked,position) VALUES(60,'kept',1,2); INSERT INTO comments(card_id,author_id,body,created_at) VALUES(60,1,'kept',9); INSERT INTO attachments VALUES('legacy',60,'old.txt',2,'text/plain','ready','stage','final',9999999999,1); INSERT INTO attachment_outbox(key,not_before) VALUES('stage',9999999999);").execute(&pool).await.unwrap();
    let tables: [&str; 10] = [
        "users",
        "boards",
        "board_members",
        "lists",
        "cards",
        "checklist_items",
        "comments",
        "attachments",
        "attachment_outbox",
        "card_identity",
    ];
    let mut originals = Vec::new();
    for table in tables {
        let cols = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(&pool)
            .await
            .unwrap()
            .iter()
            .map(|r| r.get::<String, _>("name"))
            .collect::<Vec<_>>();
        let fields = cols
            .iter()
            .map(|c| format!("'{c}',{c}"))
            .collect::<Vec<_>>()
            .join(",");
        let query = format!("SELECT json_object({fields}) FROM {table} ORDER BY rowid");
        let rows: Vec<String> = sqlx::query_scalar(&query).fetch_all(&pool).await.unwrap();
        originals.push((query, rows));
    }
    pool.close().await;
    let _app = norns::app(&url, ORIGIN, false).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    for (query, rows) in originals {
        let after: Vec<String> = sqlx::query_scalar(&query).fetch_all(&pool).await.unwrap();
        for row in rows {
            assert!(after.contains(&row), "original lost: {query}: {row}");
        }
    }
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM boards WHERE inbox_owner_id IS NOT NULL"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM lists WHERE inbox_default=1")
            .fetch_one(&pool)
            .await
            .unwrap(),
        2
    );
    assert!(
        sqlx::query("UPDATE boards SET inbox_owner_id=2 WHERE id=40")
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("DELETE FROM lists WHERE inbox_default=1")
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE lists SET inbox_default=0 WHERE inbox_default=1")
            .execute(&pool)
            .await
            .is_err()
    );
    let _again = norns::app(&url, ORIGIN, false).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM boards WHERE inbox_owner_id IS NOT NULL"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
}
#[tokio::test]
async fn inbox_account_transactions_rollback_and_first_login_repair() {
    let (_d, url, app, c, t) = fixture().await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_inbox BEFORE INSERT ON lists WHEN NEW.inbox_default=1 BEGIN SELECT RAISE(ABORT,'synthetic inbox failure'); END").execute(&pool).await.unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/admin/users",
            json!({"username":"rollback","password":"synthetic-password-123"}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE username='rollback'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    sqlx::query("DROP TRIGGER fail_inbox")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO users(username,password_hash) SELECT 'repair',password_hash FROM users WHERE id=1").execute(&pool).await.unwrap();
    let ((c1, t1), (c2, t2)) = tokio::join!(login(&app, "repair"), login(&app, "repair"));
    let v1 = call(&app, "GET", "/api/inbox", json!({}), &c1, &t1).await.1;
    let v2 = call(&app, "GET", "/api/inbox", json!({}), &c2, &t2).await.1;
    assert_eq!(v1, v2);
    assert_eq!(v1["lists"].as_array().unwrap().len(), 1);
    assert_eq!(v1["inbox_owner_id"], 2);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM boards WHERE inbox_owner_id=2")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}
#[tokio::test]
async fn inbox_transfer_ready_metadata_aggregate_quota() {
    if std::env::var_os("NORNS_SYNTHETIC_STORAGE_CHILD").is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "inbox_transfer_ready_metadata_aggregate_quota",
                "--nocapture",
            ])
            .env("NORNS_SYNTHETIC_STORAGE_CHILD", "1")
            .env("S3_ENDPOINT", "http://127.0.0.1:48999")
            .env("S3_REGION", "synthetic")
            .env("S3_BUCKET", "synthetic")
            .env("S3_ACCESS_KEY_ID", "synthetic")
            .env("S3_SECRET_ACCESS_KEY", "synthetic")
            .env("ATTACHMENT_MAX_BYTES", "1")
            .env("ATTACHMENT_BOARD_QUOTA_BYTES", "10")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    // Metadata-only storage fixture: no PUT/GET/HEAD; background outbox has future timestamps.
    let (_d, url, app, c, t) = fixture().await;
    let (source, _, ids) = chain(&app, &c, &t).await;
    let (b, l) = destination(&app, &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    for (i, id) in ids.iter().take(2).enumerate() {
        sqlx::query("INSERT INTO attachments VALUES(?,?, 'synthetic.txt',6,'text/plain','ready',?,?,9999999999,1)").bind(format!("ready-{i}")).bind(id).bind(format!("stage-{i}")).bind(format!("final-{i}")).execute(&pool).await.unwrap();
    }
    let p = preview(&app, ids[2], b, l, &c, &t).await;
    assert_eq!(p["attachment_bytes"], 12);
    let before = state(&app, source, b, &c, &t).await;
    let (s, v, _) = transfer(&app, ids[2], p, &c, &t).await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE, "{v}");
    assert_eq!(v["code"], "quota");
    assert_eq!(state(&app, source, b, &c, &t).await, before);
    // Asynchronous metadata changes invalidate preview without board revision movement.
    let p = preview(&app, ids[2], b, l, &c, &t).await;
    sqlx::query("UPDATE attachments SET size=3 WHERE id='ready-0'")
        .execute(&pool)
        .await
        .unwrap();
    let before = state(&app, source, b, &c, &t).await;
    assert_eq!(
        transfer(&app, ids[2], p, &c, &t).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(state(&app, source, b, &c, &t).await, before);
    let (s, _, _) = transfer(
        &app,
        ids[2],
        preview(&app, ids[2], b, l, &c, &t).await,
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT SUM(a.size) FROM attachments a JOIN cards c ON c.id=a.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=? AND a.state!='deleted'").bind(b).fetch_one(&pool).await.unwrap(),9);
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{source}/cards/{}/attachments", ids[0]),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (s, v, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{b}/cards/{}/attachments", ids[0]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["items"][0]["id"], "ready-0");
    assert!(v["items"][0].get("final_key").is_none());
}
#[tokio::test]
async fn inbox_transfer_competes_with_completion_and_revoked_target() {
    let (_d, url, app, c, t) = fixture().await;
    let (source, _, ids) = chain(&app, &c, &t).await;
    let (b, l) = destination(&app, &c, &t).await;
    let card = ids[2];
    let p = preview(&app, card, b, l, &c, &t).await;
    let source_path = format!("/api/boards/{source}/mutate");
    let (a, z) = tokio::join!(
        transfer(&app, card, p.clone(), &c, &t),
        call(
            &app,
            "POST",
            &source_path,
            json!({"expected_revision":p["source_revision"],"action":"card_complete","card_id":card,"completed":true}),
            &c,
            &t
        )
    );
    assert!([a.0, z.0].contains(&StatusCode::OK));
    assert!([a.0, z.0].contains(&StatusCode::CONFLICT));
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let boards: Vec<i64> = sqlx::query_scalar(
        "SELECT DISTINCT l.board_id FROM cards c JOIN lists l ON l.id=c.list_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(boards.len(), 1, "never split a racing recurrence chain");
    // A stale confirmation cannot survive destination membership removal.
    let (_, inbox, _) = call(&app, "GET", "/api/inbox", json!({}), &c, &t).await;
    let v = mutate(
        &app,
        source,
        json!({"action":"card_create","list_id":inbox["lists"][0]["id"],"title":"revocation"}),
        &c,
        &t,
    )
    .await;
    let card = v["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["title"] == "revocation")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let p = preview(&app, card, b, l, &c, &t).await;
    sqlx::query("DELETE FROM board_members WHERE board_id=? AND user_id=1")
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
    let revs: Vec<i64> = sqlx::query_scalar("SELECT revision FROM boards ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(
        transfer(&app, card, p, &c, &t).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT revision FROM boards ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap(),
        revs
    );
}
#[tokio::test]
async fn inbox_transfer_standalone_preserves_identity_and_children() {
    let (_d, url, app, c, t) = fixture().await;
    let (_, v, _) = call(&app, "GET", "/api/inbox", json!({}), &c, &t).await;
    let source = v["id"].as_i64().unwrap();
    let list = v["lists"][0]["id"].as_i64().unwrap();
    let v = mutate(
        &app,
        source,
        json!({"action":"card_create","list_id":list,"title":"publish","description":"kept"}),
        &c,
        &t,
    )
    .await;
    let card = v["cards"][0]["id"].as_i64().unwrap();
    mutate(
        &app,
        source,
        json!({"action":"comment_create","card_id":card,"body":"history"}),
        &c,
        &t,
    )
    .await;
    mutate(
        &app,
        source,
        json!({"action":"checklist_create","card_id":card,"title":"item"}),
        &c,
        &t,
    )
    .await;
    let (b, l) = destination(&app, &c, &t).await;
    let p = preview(&app, card, b, l, &c, &t).await;
    assert_eq!(p["task_count"], 1);
    assert_eq!(p["comment_count"], 1);
    assert_eq!(p["checklist_count"], 1);
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let before: (i64, i64) = sqlx::query_as("SELECT list_id,touch_version FROM cards WHERE id=?")
        .bind(card)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (s, result, _) = transfer(&app, card, p.clone(), &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{result}");
    assert_eq!(result["card_ids"], json!([card]));
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{source}/cards/{card}"),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{source}/cards/{card}/attachments"),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, v, _) = call(&app, "GET", &format!("/api/boards/{b}"), json!({}), &c, &t).await;
    assert_eq!(v["cards"][0]["description"], "kept");
    assert_eq!(v["comments"][0]["body"], "history");
    assert_eq!(v["checklist"][0]["title"], "item");
    assert_eq!(v["cards"][0]["list_id"], json!(l));
    assert!(v["cards"][0]["touch_version"].as_i64().unwrap() > before.1);
    assert_eq!(
        result["source_revision"],
        p["source_revision"].as_i64().unwrap() + 1
    );
    assert_eq!(
        result["target_revision"],
        p["target_revision"].as_i64().unwrap() + 1
    );
    assert_eq!(
        transfer(&app, card, p, &c, &t).await.0,
        StatusCode::NOT_FOUND
    );
}
#[tokio::test]
async fn inbox_children_and_metadata_owner_only() {
    let (_d, url, app, c, t) = fixture().await;
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"member","password":"synthetic-password-123"}),
        &c,
        &t,
    )
    .await;
    let (mc, mt) = login(&app, "member").await;
    let (_, v, _) = call(&app, "GET", "/api/inbox", json!({}), &mc, &mt).await;
    let b = v["id"].as_i64().unwrap();
    let l = v["lists"][0]["id"].as_i64().unwrap();
    let (_, v, _) = call(
        &app,
        "POST",
        &format!("/api/boards/{b}/mutate"),
        json!({"expected_revision":0,"action":"card_create","list_id":l,"title":"private secret"}),
        &mc,
        &mt,
    )
    .await;
    let id = v["cards"][0]["id"].as_i64().unwrap();
    assert!(v["cards"][0]["assignee_id"].is_null());
    let (_, v, _) = call(&app, "GET", "/api/tasks", json!({}), &mc, &mt).await;
    assert!(
        v["boards"].as_array().unwrap().is_empty(),
        "ordinary navigation must exclude inbox: {v}"
    );
    assert_eq!(v["inbox"]["id"], json!(b));
    assert_eq!(v["tasks"].as_array().unwrap().len(), 1);
    // Simulate a corrupt legacy membership, bypassing only the insertion trigger: ACL must independently deny it.
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("DROP TRIGGER inbox_member_insert")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO board_members VALUES(?,1,'admin')")
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
    for path in [
        format!("/api/boards/{b}"),
        format!("/api/boards/{b}/cards/{id}"),
        format!("/api/boards/{b}/cards/{id}/attachments"),
        format!("/api/boards/{b}/cards/{id}/attachments/nope/content"),
    ] {
        assert_eq!(
            call(&app, "GET", &path, json!({}), &c, &t).await.0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/boards/{b}/mutate"),
            json!({"expected_revision":1,"action":"comment_create","card_id":id,"body":"leak"}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, v, _) = call(&app, "GET", "/api/tasks", json!({}), &c, &t).await;
    assert!(v["tasks"].as_array().unwrap().is_empty());
    assert!(v["boards"].as_array().unwrap().is_empty());
    assert_eq!(
        call(
            &app,
            "POST",
            &format!("/api/boards/{b}/cards/{id}/attachments"),
            json!({"filename":"x","size":1}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}
#[tokio::test]
async fn inbox_account_initialization_and_owner_acl() {
    let (_d, url, app, c, t) = fixture().await;
    let (s, v, _) = call(&app, "GET", "/api/inbox", json!({}), &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["lists"].as_array().unwrap().len(), 1);
    let bid = v["id"].as_i64().unwrap();
    assert_eq!(
        call(&app, "GET", "/api/boards", json!({}), &c, &t).await.1,
        json!([])
    );
    let (s, u, _) = call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"member","password":"synthetic-password-123"}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let uid = u["id"].as_i64().unwrap();
    let (mc, mt) = login(&app, "member").await;
    let (_, mv, _) = call(&app, "GET", "/api/inbox", json!({}), &mc, &mt).await;
    let mb = mv["id"].as_i64().unwrap();
    assert_ne!(bid, mb);
    for (cookie, csrf, board) in [(&c, &t, mb), (&mc, &mt, bid)] {
        assert_eq!(
            call(
                &app,
                "GET",
                &format!("/api/boards/{board}"),
                json!({}),
                cookie,
                csrf
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    for action in [
        json!({"action":"list_create","title":"bad"}),
        json!({"action":"member_set","username":"member","role":"member"}),
        json!({"action":"member_remove","user_id":1}),
    ] {
        let mut a = action;
        a["expected_revision"] = json!(0);
        assert_eq!(
            call(
                &app,
                "POST",
                &format!("/api/boards/{bid}/mutate"),
                a,
                &c,
                &t
            )
            .await
            .0,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        call(
            &app,
            "PATCH",
            &format!("/api/admin/users/{uid}"),
            json!({"active":false}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "GET", "/api/inbox", json!({}), &mc, &mt).await.0,
        StatusCode::UNAUTHORIZED
    );
    call(
        &app,
        "PATCH",
        &format!("/api/admin/users/{uid}"),
        json!({"active":true}),
        &c,
        &t,
    )
    .await;
    let ((c1, t1), (c2, t2)) = tokio::join!(login(&app, "member"), login(&app, "member"));
    assert_eq!(
        call(&app, "GET", "/api/inbox", json!({}), &c1, &t1).await.1["id"],
        json!(mb)
    );
    assert_eq!(
        call(&app, "GET", "/api/inbox", json!({}), &c2, &t2).await.1["id"],
        json!(mb)
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM boards WHERE inbox_owner_id=?")
            .bind(uid)
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
    assert!(
        sqlx::query("INSERT INTO board_members(board_id,user_id,role) VALUES(?,1,'admin')")
            .bind(mb)
            .execute(&pool)
            .await
            .is_err()
    );
}
