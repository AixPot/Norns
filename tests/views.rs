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
    cookie: &str,
    csrf: &str,
) -> (StatusCode, Value, String) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("origin", ORIGIN)
        .header("content-type", "application/json");
    if !cookie.is_empty() {
        req = req.header("cookie", cookie).header("x-csrf-token", csrf);
    }
    let res = app
        .clone()
        .oneshot(req.body(Body::from(data.to_string())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let cookie = res
        .headers()
        .get("set-cookie")
        .map(|h| h.to_str().unwrap().to_string())
        .unwrap_or_default();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        cookie,
    )
}

async fn fixture() -> (tempfile::TempDir, String, axum::Router, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}", dir.path().join("db.sqlite").display());
    norns::init_admin(&url, "admin", "synthetic-password-123")
        .await
        .unwrap();
    let app = norns::app(&url, ORIGIN, false).await;
    let (_, v, c) = call(
        &app,
        "POST",
        "/api/login",
        json!({"username":"admin","password":"synthetic-password-123"}),
        "",
        "",
    )
    .await;
    (dir, url, app, c, v["csrf"].as_str().unwrap().into())
}
async fn login_as(app: &axum::Router, name: &str, password: &str) -> (String, String) {
    let (s, v, c) = call(
        app,
        "POST",
        "/api/login",
        json!({"username":name,"password":password}),
        "",
        "",
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    (c, v["csrf"].as_str().unwrap().into())
}

async fn board(app: &axum::Router, c: &str, t: &str, title: &str) -> Value {
    let (s, v, _) = call(app, "POST", "/api/boards", json!({"title":title}), c, t).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v
}
async fn mutate(
    app: &axum::Router,
    c: &str,
    t: &str,
    b: &Value,
    mut data: Value,
) -> (StatusCode, Value, String) {
    data["expected_revision"] = b["revision"].clone();
    call(
        app,
        "POST",
        &format!("/api/boards/{}/mutate", b["id"]),
        data,
        c,
        t,
    )
    .await
}

async fn apply(app: &axum::Router, c: &str, t: &str, b: &mut Value, data: Value) {
    let (s, v, _) = mutate(app, c, t, b, data).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    *b = v;
}

#[tokio::test]
async fn task_positions_follow_physical_reorders_without_changing_default_sort() {
    let (_dir, url, app, cookie, csrf) = fixture().await;
    let mut b = board(&app, &cookie, &csrf, "Physical order").await;
    for title in ["First", "Second"] {
        apply(
            &app,
            &cookie,
            &csrf,
            &mut b,
            json!({"action":"list_create","title":title}),
        )
        .await;
    }
    let first = b["lists"][0]["id"].clone();
    let second = b["lists"][1]["id"].clone();
    for (title, list) in [("A", &first), ("B", &first), ("C", &second)] {
        apply(
            &app,
            &cookie,
            &csrf,
            &mut b,
            json!({"action":"card_create","list_id":list,"title":title}),
        )
        .await;
    }
    let a = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["title"] == "A")
        .unwrap()["id"]
        .clone();
    let bb = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["title"] == "B")
        .unwrap()["id"]
        .clone();
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    // Date order deliberately differs from manual order; adding fields must not change SQL sorting.
    for (id, date) in [(&a, "2024-01-01"), (&bb, "2024-01-02")] {
        sqlx::query("UPDATE cards SET due_date=? WHERE id=?")
            .bind(date)
            .bind(id.as_i64().unwrap())
            .execute(&pool)
            .await
            .unwrap();
    }
    for reorder in [false, true] {
        if reorder {
            apply(
                &app,
                &cookie,
                &csrf,
                &mut b,
                json!({"action":"card_move","card_id":bb,"target_list_id":first,"index":0}),
            )
            .await;
            apply(
                &app,
                &cookie,
                &csrf,
                &mut b,
                json!({"action":"list_move","list_id":second,"index":0}),
            )
            .await;
        }
        let (status, found, _) = call(&app, "GET", "/api/tasks", json!({}), &cookie, &csrf).await;
        assert_eq!(status, StatusCode::OK);
        let tasks = found["tasks"].as_array().unwrap();
        assert_eq!(
            tasks
                .iter()
                .map(|t| t["title"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["A", "B", "C"]
        );
        for task in tasks {
            let (position, list_position): (i64, i64) = sqlx::query_as("SELECT c.position,l.position FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=?").bind(task["id"].as_i64().unwrap()).fetch_one(&pool).await.unwrap();
            assert_eq!(task["position"], json!(position), "card physical position");
            assert_eq!(
                task["list_position"],
                json!(list_position),
                "list physical position"
            );
        }
        let task_a = tasks.iter().find(|t| t["id"] == a).unwrap();
        assert_eq!(task_a["position"], json!(i64::from(reorder)));
        assert_eq!(task_a["list_position"], json!(i64::from(reorder)));
        let (_, filtered, _) = call(
            &app,
            "GET",
            "/api/tasks?q=A&status=incomplete",
            json!({}),
            &cookie,
            &csrf,
        )
        .await;
        assert_eq!(filtered["tasks"], json!([task_a]));
        for key in ["boards", "people", "inbox"] {
            assert_eq!(filtered[key], found[key]);
        }
        let (_, today, _) = call(
            &app,
            "GET",
            "/api/tasks?view=today",
            json!({}),
            &cookie,
            &csrf,
        )
        .await;
        assert_eq!(
            today["tasks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t["title"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["A", "B"]
        );
    }
}

#[tokio::test]
async fn order_metadata_obeys_membership_and_private_inbox_snapshot_scope() {
    let (_dir, url, app, cookie, csrf) = fixture().await;
    let (status, user, _) = call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"member","password":"synthetic-password-456"}),
        &cookie,
        &csrf,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (mc, mt) = login_as(&app, "member", "synthetic-password-456").await;
    let mut shared = board(&app, &cookie, &csrf, "Shared").await;
    apply(
        &app,
        &cookie,
        &csrf,
        &mut shared,
        json!({"action":"list_create","title":"List"}),
    )
    .await;
    let list = shared["lists"][0]["id"].clone();
    apply(
        &app,
        &cookie,
        &csrf,
        &mut shared,
        json!({"action":"card_create","list_id":list,"title":"Shared card"}),
    )
    .await;
    let card = shared["cards"][0]["id"].clone();
    let (_, absent, _) = call(&app, "GET", "/api/tasks", json!({}), &mc, &mt).await;
    assert_eq!(absent["tasks"], json!([]));
    assert_eq!(absent["boards"], json!([]));
    apply(
        &app,
        &cookie,
        &csrf,
        &mut shared,
        json!({"action":"member_set","username":"member","role":"member"}),
    )
    .await;
    let (_, mut own, _) = call(&app, "GET", "/api/inbox", json!({}), &mc, &mt).await;
    let own_list = own["lists"][0]["id"].clone();
    apply(
        &app,
        &mc,
        &mt,
        &mut own,
        json!({"action":"card_create","list_id":own_list,"title":"Own inbox"}),
    )
    .await;
    let (_, mut foreign, _) = call(&app, "GET", "/api/inbox", json!({}), &cookie, &csrf).await;
    let foreign_list = foreign["lists"][0]["id"].clone();
    apply(
        &app,
        &cookie,
        &csrf,
        &mut foreign,
        json!({"action":"card_create","list_id":foreign_list,"title":"Foreign inbox"}),
    )
    .await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE cards SET assignee_id=? WHERE id=?")
        .bind(user["id"].as_i64().unwrap())
        .bind(card.as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    // Sparse persisted positions prove these are not result-array indexes.
    sqlx::query("UPDATE cards SET position=37 WHERE id=?")
        .bind(card.as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE lists SET position=19 WHERE id=?")
        .bind(list.as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    // Legacy corrupt membership must not expose another user's inbox, including its positions.
    sqlx::query("DROP TRIGGER inbox_member_insert")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO board_members VALUES(?,?,'member')")
        .bind(foreign["id"].as_i64().unwrap())
        .bind(user["id"].as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let before: Vec<String> = sqlx::query_scalar(
        "SELECT json_object('id',id,'revision',revision) FROM boards ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let (_, all, _) = call(&app, "GET", "/api/tasks", json!({}), &mc, &mt).await;
    assert_eq!(all["tasks"].as_array().unwrap().len(), 2);
    assert!(!all.to_string().contains("Foreign inbox"));
    let task = all["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == card)
        .unwrap();
    assert_eq!(task["position"], 37);
    assert_eq!(task["list_position"], 19);
    let own_task = all["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["board_id"] == own["id"])
        .unwrap();
    assert_eq!(own_task["position"], own["cards"][0]["position"]);
    assert_eq!(own_task["list_position"], own["lists"][0]["position"]);
    assert_eq!(
        all["boards"],
        json!([{"id":shared["id"],"title":shared["title"],"revision":shared["revision"]}])
    );
    assert_eq!(all["people"], json!([{"id":user["id"],"name":"member"}]));
    assert_eq!(
        all["inbox"],
        json!({"id":own["id"],"title":own["title"],"revision":own["revision"]})
    );
    for query in [
        format!("board_id={}", foreign["id"]),
        "q=no-match&status=complete".into(),
    ] {
        let (status, empty, _) = call(
            &app,
            "GET",
            &format!("/api/tasks?{query}"),
            json!({}),
            &mc,
            &mt,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(empty["tasks"], json!([]));
        for key in ["boards", "people", "inbox"] {
            assert_eq!(empty[key], all[key]);
        }
    }
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT json_object('id',id,'revision',revision) FROM boards ORDER BY id"
        )
        .fetch_all(&pool)
        .await
        .unwrap(),
        before,
        "GET must not change revisions"
    );
    apply(
        &app,
        &cookie,
        &csrf,
        &mut shared,
        json!({"action":"member_remove","user_id":user["id"]}),
    )
    .await;
    let (_, revoked, _) = call(&app, "GET", "/api/tasks", json!({}), &mc, &mt).await;
    assert_eq!(revoked["tasks"], json!([own_task]));
    assert_eq!(revoked["boards"], json!([]));
    assert_eq!(revoked["people"], json!([]));
    assert_eq!(
        call(&app, "GET", "/api/tasks", json!({}), "", "").await.0,
        StatusCode::UNAUTHORIZED
    );
    call(&app, "POST", "/api/logout", json!({}), &mc, &mt).await;
    assert_eq!(
        call(&app, "GET", "/api/tasks", json!({}), &mc, &mt).await.0,
        StatusCode::UNAUTHORIZED
    );
}
