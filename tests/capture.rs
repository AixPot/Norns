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
    (
        s,
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
fn timed() -> Value {
    json!({"start_date":"2096-01-31","end_date":"2096-02-01","start_time":"09:30","end_time":"10:45","timezone":"Asia/Shanghai"})
}
#[tokio::test]
async fn timed_create_persists_schedule_atomically() {
    let (_d, _url, app, c, t, before) = fixture().await;
    let (s,v,_) = mutate(&app,&before,json!({"action":"card_create","list_id":before["lists"][0]["id"],"title":"  明天 literal  ","description":"exact\nbody","schedule":timed()}),&c,&t).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["revision"].as_i64(),
        before["revision"].as_i64().map(|v| v + 1)
    );
    let card = &v["cards"][0];
    assert_eq!(card["schedule"], timed());
    assert_eq!(card["anchor_schedule"], timed());
    assert_eq!(card["due_date"], "2096-01-31");
    assert_eq!(card["title"], "明天 literal");
    assert_eq!(card["description"], "exact\nbody");
    assert_eq!(card["occurrence_no"], 1);
    assert!(card["series_id"].is_null());
    assert!(card["predecessor_id"].is_null());
    let (s, stored, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", v["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(stored, v);
}

#[tokio::test]
async fn omitted_and_null_schedules_remain_undated() {
    let (_d, _url, app, c, t, mut snap) = fixture().await;
    for explicit_null in [false, true] {
        let mut a = json!({"action":"card_create","list_id":snap["lists"][0]["id"],"title":"明天 下午3点 literal"});
        if explicit_null {
            a["schedule"] = Value::Null;
        }
        let (s, v, _) = mutate(&app, &snap, a, &c, &t).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let card = v["cards"].as_array().unwrap().last().unwrap();
        for key in [
            "schedule",
            "due_date",
            "anchor_schedule",
            "series_id",
            "predecessor_id",
            "assignee_id",
        ] {
            assert!(card[key].is_null(), "{key}: {card}");
        }
        assert_eq!(card["title"], "明天 下午3点 literal");
        assert_eq!(card["description"], "");
        assert_eq!(card["occurrence_no"], 1);
        snap = v;
    }
}
#[tokio::test]
async fn invalid_schedules_leave_snapshot_count_revision_and_identity_unchanged() {
    let (_d, url, app, c, t, before) = fixture().await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let identity: i64 = sqlx::query_scalar("SELECT last_id FROM card_identity")
        .fetch_one(&pool)
        .await
        .unwrap();
    for schedule in [
        json!({"start_date":"2096-02-30"}),
        json!({"start_date":"2096-02-01","end_date":"2096-01-31"}),
        json!({"start_date":"2096-02-01","start_time":"24:00"}),
        json!({"start_date":"2096-02-01","start_time":"16:00","end_time":"15:00"}),
        json!({"start_date":"2096-02-01","timezone":"UTC"}),
        json!({"start_date":"2096-02-01","repeat":{"unit":"day","interval":0}}),
        json!({"start_date":"2096-02-01","repeat":{"unit":"week","weekdays":[]}}),
        json!({"start_date":"2096-02-01","repeat":{"unit":"week","weekdays":[0,0]}}),
    ] {
        let (s,error,_) = mutate(&app,&before,json!({"action":"card_create","list_id":before["lists"][0]["id"],"title":"invalid","schedule":schedule}),&c,&t).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{schedule}: {error}");
        assert_eq!(error["code"], "invalid_schedule");
        let (_, after, _) = call(
            &app,
            "GET",
            &format!("/api/boards/{}", before["id"]),
            json!({}),
            &c,
            &t,
        )
        .await;
        assert_eq!(after, before);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM cards")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT last_id FROM card_identity")
                .fetch_one(&pool)
                .await
                .unwrap(),
            identity
        );
    }
}
#[tokio::test]
async fn stale_create_cas_cannot_duplicate_a_scheduled_task() {
    let (_d, _url, app, c, t, before) = fixture().await;
    let a = json!({"action":"card_create","list_id":before["lists"][0]["id"],"title":"once","schedule":timed()});
    let (s, after, _) = mutate(&app, &before, a.clone(), &c, &t).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        mutate(&app, &before, a, &c, &t).await.0,
        StatusCode::CONFLICT
    );
    let (_, stored, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", before["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(stored, after);
    assert_eq!(stored["cards"].as_array().unwrap().len(), 1);
}
#[tokio::test]
async fn scheduled_create_respects_own_foreign_inbox_and_shared_membership() {
    let (_d, url, app, c, t, own) = fixture().await;
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/admin/users",
            json!({"username":"other","password":"synthetic-password-123"}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CREATED
    );
    let (oc, ot) = login(&app, "other").await;
    let (_, foreign, _) = call(&app, "GET", "/api/inbox", json!({}), &oc, &ot).await;
    let a = |snap: &Value| json!({"action":"card_create","list_id":snap["lists"][0]["id"],"title":"scheduled","schedule":timed()});
    assert_eq!(mutate(&app, &own, a(&own), &c, &t).await.0, StatusCode::OK);
    // Even a site admin cannot create in somebody else's private inbox.
    assert_eq!(
        mutate(&app, &foreign, a(&foreign), &c, &t).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        mutate(&app, &own, a(&own), &oc, &ot).await.0,
        StatusCode::NOT_FOUND
    );
    let (_, shared, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"Shared"}),
        &c,
        &t,
    )
    .await;
    let (_, shared, _) = mutate(
        &app,
        &shared,
        json!({"action":"list_create","title":"Tasks"}),
        &c,
        &t,
    )
    .await;
    assert_eq!(
        mutate(&app, &shared, a(&shared), &oc, &ot).await.0,
        StatusCode::NOT_FOUND
    );
    let (_, shared, _) = mutate(
        &app,
        &shared,
        json!({"action":"member_set","username":"other","role":"member"}),
        &c,
        &t,
    )
    .await;
    let (s, shared, _) = mutate(&app, &shared, a(&shared), &oc, &ot).await;
    assert_eq!(s, StatusCode::OK, "{shared}");
    assert_eq!(shared["cards"][0]["schedule"], timed());
    // An authorized board cannot be used to smuggle a foreign-inbox list ID.
    assert_eq!(
        mutate(&app, &shared, a(&foreign), &c, &t).await.0,
        StatusCode::NOT_FOUND
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM cards WHERE list_id=?")
            .bind(foreign["lists"][0]["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}
#[tokio::test]
async fn recurring_create_initializes_anchor_and_preserves_successor_undo_safety() {
    let (_d, _url, app, c, t, before) = fixture().await;
    let schedule = json!({"start_date":"2096-01-02","start_time":"09:30","timezone":"Asia/Shanghai","repeat":{"unit":"week","interval":1,"mode":"calendar","weekdays":[0,2],"count":3}});
    let (s,mut snap,_) = mutate(&app,&before,json!({"action":"card_create","list_id":before["lists"][0]["id"],"title":"repeat","schedule":schedule}),&c,&t).await;
    assert_eq!(s, StatusCode::OK);
    let root = snap["cards"][0]["id"].clone();
    let series = snap["cards"][0]["series_id"].clone();
    assert!(series.as_str().is_some_and(|v| !v.is_empty()));
    assert_eq!(snap["cards"][0]["anchor_schedule"], schedule);
    assert_eq!(snap["cards"][0]["occurrence_no"], 1);
    for touched in [false, true] {
        let (s, v, _) = mutate(
            &app,
            &snap,
            json!({"action":"card_complete","card_id":root,"completed":true}),
            &c,
            &t,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        snap = v;
        let successor = snap["cards"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["predecessor_id"] == root)
            .unwrap()
            .clone();
        assert_eq!(successor["series_id"], series);
        assert_eq!(successor["anchor_schedule"], schedule);
        assert_eq!(successor["occurrence_no"], 2);
        assert_eq!(successor["touch_version"], 0);
        assert_eq!(successor["due_date"], "2096-01-04");
        assert_eq!(successor["schedule"]["start_time"], "09:30");
        if touched {
            let (s,v,_) = mutate(&app,&snap,json!({"action":"comment_create","card_id":successor["id"],"body":"keep this work"}),&c,&t).await;
            assert_eq!(s, StatusCode::OK);
            snap = v;
        }
        let (s, v, _) = mutate(
            &app,
            &snap,
            json!({"action":"card_complete","card_id":root,"completed":false}),
            &c,
            &t,
        )
        .await;
        if touched {
            assert_eq!(s, StatusCode::CONFLICT, "{v}");
            assert_eq!(v["code"], "successor_touched");
            let (_, stored, _) = call(
                &app,
                "GET",
                &format!("/api/boards/{}", snap["id"]),
                json!({}),
                &c,
                &t,
            )
            .await;
            assert_eq!(stored, snap);
        } else {
            assert_eq!(s, StatusCode::OK, "{v}");
            assert_eq!(v["cards"].as_array().unwrap().len(), 1);
            assert_eq!(v["cards"][0]["completed"], false);
            snap = v;
        }
    }
}
