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

fn selected(b: &Value) -> Value {
    Value::Array(
        b["cards"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| json!({"id":c["id"],"touch_version":c["touch_version"]}))
            .collect(),
    )
}
async fn apply(app: &axum::Router, b: &mut Value, a: Value, c: &str, t: &str) {
    let (s, v, _) = mutate(app, b, a, c, t).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    *b = v;
}
#[tokio::test]
async fn bulk_keeps_independent_fields_and_clear_is_explicit() {
    let (_d, _url, app, c, t, mut b) = fixture().await;
    let l = b["lists"][0]["id"].clone();
    for title in ["one", "two"] {
        apply(&app,&mut b,json!({"action":"card_create","list_id":l,"title":title,"description":"keep","schedule":{"start_date":"2027-01-01","start_time":"09:00"}}),&c,&t).await;
    }
    let old = b.clone();
    let a = json!({"action":"cards_bulk","selected":selected(&b),"changes":{"archived":{"op":"set","value":true}}});
    apply(&app, &mut b, a, &c, &t).await;
    assert_eq!(
        b["revision"].as_i64().unwrap(),
        old["revision"].as_i64().unwrap() + 1
    );
    for card in b["cards"].as_array().unwrap() {
        assert_eq!(card["description"], "keep");
        assert_eq!(card["schedule"]["start_time"], "09:00");
        assert_eq!(card["archived"], true);
    }
    let a = json!({"action":"cards_bulk","selected":selected(&b),"changes":{"schedule":{"op":"clear"}}});
    apply(&app, &mut b, a, &c, &t).await;
    for card in b["cards"].as_array().unwrap() {
        assert!(card["schedule"].is_null());
        assert!(card["due_date"].is_null());
        assert_eq!(card["archived"], true);
    }
}

async fn setup_cards(app: &axum::Router, b: &mut Value, c: &str, t: &str) {
    let l = b["lists"][0]["id"].clone();
    for title in ["one", "two"] {
        apply(
            app,
            b,
            json!({"action":"card_create","list_id":l,"title":title}),
            c,
            t,
        )
        .await;
    }
}
async fn unchanged(app: &axum::Router, b: &Value, c: &str, t: &str) {
    let (s, after, _) = call(
        app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        c,
        t,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(&after, b);
}
fn bulk(b: &Value, changes: Value) -> Value {
    json!({"action":"cards_bulk","selected":selected(b),"changes":changes})
}
#[tokio::test]
async fn strict_dto_limits_and_null_do_not_mean_clear() {
    let (_d, _url, app, c, t, mut b) = fixture().await;
    setup_cards(&app, &mut b, &c, &t).await;
    for a in [
        json!({"action":"cards_bulk","selected":selected(&b),"changes":{},"board_id":b["id"]}),
        bulk(
            &b,
            json!({"archived":{"op":"set","value":true},"assignee_id":1}),
        ),
        bulk(&b, json!({"archived":null})),
        bulk(&b, json!({"schedule":null})),
        bulk(&b, json!({"schedule":{"op":"set","value":null}})),
        bulk(&b, json!({"completed":{"op":"clear"}})),
        bulk(
            &b,
            json!({"target_list":{"op":"set","value":b["lists"][0]["id"],"board_id":b["id"]}}),
        ),
        json!({"action":"cards_bulk","selected":[{"id":b["cards"][0]["id"],"touch_version":0,"title":"bad"}],"changes":{"completed":{"op":"set","value":true}}}),
    ] {
        let (s, v, _) = mutate(&app, &b, a, &c, &t).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
        unchanged(&app, &b, &c, &t).await;
    }
    for a in [
        bulk(&b, json!({})),
        bulk(&b, json!({"schedule":{"op":"keep"}})),
        json!({"action":"cards_bulk","selected":[],"changes":{"completed":{"op":"set","value":true}}}),
        json!({"action":"cards_bulk","selected":[selected(&b)[0].clone(),selected(&b)[0].clone()],"changes":{"completed":{"op":"set","value":true}}}),
        json!({"action":"cards_bulk","selected":vec![selected(&b)[0].clone();101],"changes":{"archived":{"op":"set","value":true}}}),
    ] {
        assert_eq!(mutate(&app, &b, a, &c, &t).await.0, StatusCode::BAD_REQUEST);
        unchanged(&app, &b, &c, &t).await;
    }
    let before = b.clone();
    let a = bulk(
        &b,
        json!({"completed":{"op":"set","value":false},"archived":{"op":"set","value":false},"target_list":{"op":"set","value":b["lists"][0]["id"]},"schedule":{"op":"clear"}}),
    );
    apply(&app, &mut b, a, &c, &t).await;
    assert_eq!(b["cards"], before["cards"]);
    assert_eq!(
        b["revision"].as_i64().unwrap(),
        before["revision"].as_i64().unwrap() + 1
    );
}
#[tokio::test]
async fn stale_revision_touch_foreign_and_invalid_target_roll_back() {
    let (_d, url, app, c, t, mut b) = fixture().await;
    setup_cards(&app, &mut b, &c, &t).await;
    let (_, mut other, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"other"}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut other,
        json!({"action":"list_create","title":"foreign"}),
        &c,
        &t,
    )
    .await;
    setup_cards(&app, &mut other, &c, &t).await;
    let mut badtouch = bulk(&b, json!({"completed":{"op":"set","value":true}}));
    badtouch["selected"][1]["touch_version"] = json!(999);
    let mut foreign = bulk(&b, json!({"archived":{"op":"set","value":true}}));
    foreign["selected"][1] = selected(&other)[0].clone();
    for (a, expected) in [
        (badtouch, StatusCode::CONFLICT),
        (foreign, StatusCode::NOT_FOUND),
        (
            bulk(
                &b,
                json!({"target_list":{"op":"set","value":other["lists"][0]["id"]}}),
            ),
            StatusCode::NOT_FOUND,
        ),
    ] {
        assert_eq!(mutate(&app, &b, a, &c, &t).await.0, expected);
        unchanged(&app, &b, &c, &t).await;
        unchanged(&app, &other, &c, &t).await;
    }
    let mut stale = b.clone();
    stale["revision"] = json!(-1);
    assert_eq!(
        mutate(
            &app,
            &stale,
            bulk(&b, json!({"archived":{"op":"set","value":true}})),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT last_id FROM card_identity")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("CREATE TRIGGER fail_bulk BEFORE UPDATE OF archived ON cards WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT,'synthetic'); END").execute(&pool).await.unwrap();
    assert_eq!(
        mutate(
            &app,
            &b,
            bulk(&b, json!({"archived":{"op":"set","value":true}})),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    unchanged(&app, &b, &c, &t).await;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT last_id FROM card_identity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        before
    );
}
#[tokio::test]
async fn repeating_completion_undo_selected_child_and_touched_child_are_safe() {
    let (_d, url, app, c, t, mut b) = fixture().await;
    let l = b["lists"][0]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_create","list_id":l,"title":"repeat","schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    let original = b["cards"][0]["id"].clone();
    let a = bulk(&b, json!({"completed":{"op":"set","value":true}}));
    apply(&app, &mut b, a, &c, &t).await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
    let child = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == original)
        .unwrap()
        .clone();
    assert_eq!(child["touch_version"], 0);
    for reverse in [false, true] {
        let mut a = bulk(
            &b,
            json!({"completed":{"op":"set","value":false},"archived":{"op":"set","value":true}}),
        );
        if reverse {
            a["selected"].as_array_mut().unwrap().reverse();
        }
        let (s, v, _) = mutate(&app, &b, a, &c, &t).await;
        assert_eq!(s, StatusCode::CONFLICT, "{v}");
        assert_eq!(v["code"], "bulk_successor_selected");
        unchanged(&app, &b, &c, &t).await;
    }
    let mut only_original = bulk(&b, json!({"completed":{"op":"set","value":true}}));
    only_original["selected"] =
        json!([{"id":original,"touch_version":b["cards"][0]["touch_version"]}]);
    apply(&app, &mut b, only_original, &c, &t).await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
    let mut undo = bulk(&b, json!({"completed":{"op":"set","value":false}}));
    undo["selected"] = json!([{"id":original,"touch_version":b["cards"][0]["touch_version"]}]);
    apply(&app, &mut b, undo, &c, &t).await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 1);
    let a = bulk(&b, json!({"completed":{"op":"set","value":true}}));
    apply(&app, &mut b, a, &c, &t).await;
    let newer = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["predecessor_id"] == original)
        .unwrap()["id"]
        .clone();
    assert!(newer.as_i64().unwrap() > child["id"].as_i64().unwrap());
    apply(
        &app,
        &mut b,
        json!({"action":"comment_create","card_id":newer,"body":"processed"}),
        &c,
        &t,
    )
    .await;
    let mut undo = bulk(&b, json!({"completed":{"op":"set","value":false}}));
    undo["selected"] = json!([{"id":original,"touch_version":b["cards"][0]["touch_version"]}]);
    let (s, v, _) = mutate(&app, &b, undo, &c, &t).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(v["code"], "successor_touched");
    unchanged(&app, &b, &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM cards WHERE predecessor_id IS NOT NULL")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}
#[tokio::test]
async fn date_mutations_reject_entire_mixed_batch_and_never_clear_recurrence() {
    let (_d, _url, app, c, t, mut b) = fixture().await;
    setup_cards(&app, &mut b, &c, &t).await;
    let id = b["cards"][1]["id"].clone();
    apply(&app,&mut b,json!({"action":"card_schedule","card_id":id,"schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    for change in [
        json!({"op":"clear"}),
        json!({"op":"set","value":{"start_date":"2027-02-01"}}),
    ] {
        let (s, v, _) = mutate(
            &app,
            &b,
            bulk(
                &b,
                json!({"schedule":change,"archived":{"op":"set","value":true}}),
            ),
            &c,
            &t,
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
        unchanged(&app, &b, &c, &t).await;
    }
    apply(
        &app,
        &mut b,
        json!({"action":"card_schedule","card_id":id,"schedule":null}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut b,
        json!({"action":"card_complete","card_id":id,"completed":true}),
        &c,
        &t,
    )
    .await;
    assert_eq!(
        mutate(
            &app,
            &b,
            bulk(
                &b,
                json!({"schedule":{"op":"clear"},"completed":{"op":"set","value":false}})
            ),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    unchanged(&app, &b, &c, &t).await;
    let mut open = b.clone();
    open["cards"]
        .as_array_mut()
        .unwrap()
        .retain(|v| v["id"] != id);
    assert_eq!(mutate(&app,&b,bulk(&open,json!({"schedule":{"op":"set","value":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}})),&c,&t).await.0,StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn stable_move_then_completion_then_archive_only_originals() {
    let (_d, _url, app, c, t, _inbox) = fixture().await;
    let (_, mut b, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"shared"}),
        &c,
        &t,
    )
    .await;
    for title in ["source1", "target", "source2"] {
        apply(
            &app,
            &mut b,
            json!({"action":"list_create","title":title}),
            &c,
            &t,
        )
        .await;
    }
    let l1 = b["lists"][0]["id"].clone();
    let target = b["lists"][1]["id"].clone();
    let l2 = b["lists"][2]["id"].clone();
    for (list, title) in [
        (&l1, "A"),
        (&l1, "B"),
        (&target, "C"),
        (&target, "D"),
        (&l2, "E"),
    ] {
        apply(&app,&mut b,json!({"action":"card_create","list_id":list,"title":title,"schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    }
    let original = b.clone();
    let mut a = bulk(
        &b,
        json!({"target_list":{"op":"set","value":target},"completed":{"op":"set","value":true},"archived":{"op":"set","value":true}}),
    );
    a["selected"].as_array_mut().unwrap().reverse();
    apply(&app, &mut b, a, &c, &t).await;
    let mut originals: Vec<_> = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["predecessor_id"].is_null())
        .collect();
    originals.sort_by_key(|v| v["position"].as_i64().unwrap());
    assert_eq!(
        originals
            .iter()
            .map(|v| v["title"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["C", "D", "A", "B", "E"]
    );
    for v in originals {
        assert_eq!(v["list_id"], target);
        assert_eq!(v["completed"], true);
        assert_eq!(v["archived"], true);
    }
    let children: Vec<_> = b["cards"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| !v["predecessor_id"].is_null())
        .collect();
    assert_eq!(children.len(), 5);
    for v in children {
        assert_eq!(v["list_id"], target);
        assert_eq!(v["completed"], false);
        assert_eq!(v["archived"], false);
        assert_eq!(v["touch_version"], 0);
    }
    assert_eq!(
        b["revision"].as_i64().unwrap(),
        original["revision"].as_i64().unwrap() + 1
    );
    let a = bulk(
        &b,
        json!({"completed":{"op":"set","value":true},"archived":{"op":"set","value":false}}),
    );
    assert_eq!(mutate(&app, &b, a, &c, &t).await.0, StatusCode::BAD_REQUEST);
    unchanged(&app, &b, &c, &t).await;
}
#[tokio::test]
async fn successor_allocation_and_checklists_rollback_on_late_failure() {
    let (_d, url, app, c, t, mut b) = fixture().await;
    let l = b["lists"][0]["id"].clone();
    for title in ["one", "two"] {
        apply(&app,&mut b,json!({"action":"card_create","list_id":l,"title":title,"schedule":{"start_date":"2027-01-01","repeat":{"unit":"day"}}}),&c,&t).await;
    }
    let id = b["cards"][0]["id"].clone();
    apply(
        &app,
        &mut b,
        json!({"action":"checklist_create","card_id":id,"title":"inherited"}),
        &c,
        &t,
    )
    .await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let before: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT last_id FROM card_identity),(SELECT last_id FROM checklist_identity)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE TRIGGER fail_bulk_archive BEFORE UPDATE OF archived ON cards WHEN NEW.title='two' BEGIN SELECT RAISE(ABORT,'synthetic'); END").execute(&pool).await.unwrap();
    let (s, _, _) = mutate(
        &app,
        &b,
        bulk(
            &b,
            json!({"completed":{"op":"set","value":true},"archived":{"op":"set","value":true}}),
        ),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::INTERNAL_SERVER_ERROR);
    unchanged(&app, &b, &c, &t).await;
    let after: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT last_id FROM card_identity),(SELECT last_id FROM checklist_identity)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM checklist_items")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}
#[tokio::test]
async fn private_scope_session_csrf_and_origin_boundaries() {
    let (_d, url, app, c, t, mut b) = fixture().await;
    setup_cards(&app, &mut b, &c, &t).await;
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
    let (_, other, _) = call(&app, "GET", "/api/inbox", json!({}), &oc, &ot).await;
    assert_eq!(
        mutate(
            &app,
            &b,
            bulk(
                &b,
                json!({"target_list":{"op":"set","value":other["lists"][0]["id"]}})
            ),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        mutate(
            &app,
            &b,
            bulk(&b, json!({"archived":{"op":"set","value":true}})),
            &oc,
            &ot
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let a = bulk(&b, json!({"archived":{"op":"set","value":true}}));
    assert_eq!(
        mutate(&app, &b, a.clone(), &c, "wrong").await.0,
        StatusCode::FORBIDDEN
    );
    let mut body = a.clone();
    body["expected_revision"] = b["revision"].clone();
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/boards/{}/mutate", b["id"]))
        .header("origin", "https://evil.invalid")
        .header("content-type", "application/json")
        .header("cookie", &c)
        .header("x-csrf-token", &t)
        .body(Body::from(body.to_string()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    unchanged(&app, &b, &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE sessions SET csrf='replaced' WHERE user_id=1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        mutate(&app, &b, a.clone(), &c, &t).await.0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE sessions SET expires_at=0 WHERE user_id=1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        mutate(&app, &b, a, &c, &t).await.0,
        StatusCode::UNAUTHORIZED
    );
}
#[tokio::test]
async fn set_full_schedule_and_complete_uses_new_schedule_without_changing_other_fields() {
    let (_d, _url, app, c, t, mut b) = fixture().await;
    setup_cards(&app, &mut b, &c, &t).await;
    let a = bulk(
        &b,
        json!({"schedule":{"op":"set","value":{"start_date":"2027-03-01","end_date":"2027-03-02","start_time":"09:30","end_time":"17:00","timezone":"Asia/Shanghai"}},"completed":{"op":"set","value":true}}),
    );
    apply(&app, &mut b, a, &c, &t).await;
    for v in b["cards"].as_array().unwrap() {
        assert_eq!(v["schedule"]["end_date"], "2027-03-02");
        assert_eq!(v["due_date"], "2027-03-01");
        assert_eq!(v["completed"], true);
        assert_eq!(v["archived"], false);
        assert!(v["series_id"].is_null());
    }
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn bulk_keep_clear_unknown_fields_reject_without_any_mutation() {
    let mut failures = Vec::new();
    for (field, op) in [
        ("target_list", "keep"),
        ("schedule", "keep"),
        ("schedule", "clear"),
        ("completed", "keep"),
        ("archived", "keep"),
    ] {
        for (extra, value) in [("unexpected", json!(true)), ("value", json!(123))] {
            let (_d, url, app, c, t, mut b) = fixture().await;
            let list = b["lists"][0]["id"].clone();
            // Keep cases exercise successor/checklist allocation if mistakenly accepted.
            // Clear uses a nonrecurring schedule so the malformed DTO cannot hide
            // behind the semantic prohibition on clearing recurrence.
            let schedule = if op == "clear" {
                json!({"start_date":"2027-01-01"})
            } else {
                json!({"start_date":"2027-01-01","repeat":{"unit":"day"}})
            };
            apply(&app, &mut b, json!({"action":"card_create","list_id":list,"title":"strict DTO","schedule":schedule}), &c, &t).await;
            let id = b["cards"][0]["id"].clone();
            apply(
                &app,
                &mut b,
                json!({"action":"checklist_create","card_id":id,"title":"inherited"}),
                &c,
                &t,
            )
            .await;
            let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
            let before: (i64, i64) = sqlx::query_as(
                "SELECT (SELECT last_id FROM card_identity),(SELECT last_id FROM checklist_identity)",
            ).fetch_one(&pool).await.unwrap();
            let mut changes =
                json!({"archived":{"op":"set","value":true},"completed":{"op":"set","value":true}});
            changes[field] = json!({"op":op});
            changes[field][extra] = value;
            let (status, body, _) = mutate(&app, &b, bulk(&b, changes), &c, &t).await;
            let (_, after, _) = call(
                &app,
                "GET",
                &format!("/api/boards/{}", b["id"]),
                json!({}),
                &c,
                &t,
            )
            .await;
            let identities: (i64, i64) = sqlx::query_as(
                "SELECT (SELECT last_id FROM card_identity),(SELECT last_id FROM checklist_identity)",
            ).fetch_one(&pool).await.unwrap();
            println!(
                "{field}/{op}/{extra}: status={status}; body={body}; snapshot_unchanged={}; identities_unchanged={}",
                after == b,
                identities == before
            );
            if status != StatusCode::UNPROCESSABLE_ENTITY || after != b || identities != before {
                failures.push(format!("{field}/{op}/{extra}: {status}, snapshot unchanged={}, identities unchanged={}", after == b, identities == before));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[tokio::test]
async fn exact_bulk_keep_clear_and_legacy_actions_remain_valid() {
    let (_d, _url, app, c, t, mut b) = fixture().await;
    setup_cards(&app, &mut b, &c, &t).await;
    let id = b["cards"][0]["id"].clone();
    apply(
        &app,
        &mut b,
        json!({"action":"card_schedule","card_id":id,"schedule":{"start_date":"2027-01-01"}}),
        &c,
        &t,
    )
    .await;
    let before = b.clone();
    let a = bulk(
        &b,
        json!({"target_list":{"op":"keep"},"schedule":{"op":"keep"},"completed":{"op":"keep"},"archived":{"op":"set","value":true}}),
    );
    apply(&app, &mut b, a, &c, &t).await;
    for card in b["cards"].as_array().unwrap() {
        assert_eq!(card["archived"], true);
        let old = before["cards"]
            .as_array()
            .unwrap()
            .iter()
            .find(|old| old["id"] == card["id"])
            .unwrap();
        assert_eq!(card["schedule"], old["schedule"]);
        assert_eq!(card["list_id"], old["list_id"]);
        assert_eq!(card["completed"], old["completed"]);
    }
    let a = bulk(
        &b,
        json!({"target_list":{"op":"keep"},"schedule":{"op":"clear"},"completed":{"op":"keep"},"archived":{"op":"keep"}}),
    );
    apply(&app, &mut b, a, &c, &t).await;
    for card in b["cards"].as_array().unwrap() {
        assert!(card["schedule"].is_null());
        assert!(card["due_date"].is_null());
        assert_eq!(card["archived"], true);
    }
    apply(
        &app,
        &mut b,
        json!({"action":"card_schedule","card_id":id,"schedule":null}),
        &c,
        &t,
    )
    .await;
    // Restore first: completing archived cards remains prohibited.
    apply(
        &app,
        &mut b,
        json!({"action":"card_update","card_id":id,"title":"one","description":"","archived":false}),
        &c,
        &t,
    )
    .await;
    apply(
        &app,
        &mut b,
        json!({"action":"card_complete","card_id":id,"completed":true}),
        &c,
        &t,
    )
    .await;
    assert_eq!(b["cards"][0]["completed"], true);
}
