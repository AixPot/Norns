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
#[tokio::test]
async fn snapshot_create_owner_read_and_list() {
    let (_d, _url, app, c, t, before) = fixture().await;
    let (status,snap,_)=mutate(&app,&before,json!({"action":"card_create","list_id":before["lists"][0]["id"],"title":"task","description":"body"}),&c,&t).await;
    assert_eq!(status, StatusCode::OK);
    let request = json!({"name":"private template","source_board_id":snap["id"],"source_card_id":snap["cards"][0]["id"],"expected_revision":snap["revision"],"expected_touch_version":snap["cards"][0]["touch_version"]});
    let (s, v, _) = call(&app, "POST", "/api/templates", request, &c, &t).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["name"], "private template");
    assert_eq!(v["title"], "task");
    assert_eq!(v["description"], "body");
    assert_eq!(v["revision"], 1);
    assert_eq!(v["checklist"], json!([]));
    let (s, got, _) = call(
        &app,
        "GET",
        &format!("/api/templates/{}", v["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(got, v);
    let (s, list, _) = call(&app, "GET", "/api/templates", json!({}), &c, &t).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        list,
        json!([{"id":v["id"],"name":"private template","revision":1}])
    );
}
async fn saved(app: &axum::Router, before: &Value, c: &str, t: &str) -> (Value, Value) {
    let (s,b,_) = mutate(app,before,json!({"action":"card_create","list_id":before["lists"][0]["id"],"title":"source","description":"original"}),c,t).await;
    assert_eq!(s, StatusCode::OK);
    let (s, v, _) = call(app, "POST", "/api/templates", source_request(&b), c, t).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (b, v)
}
fn source_request(b: &Value) -> Value {
    json!({"name":"secret-template-marker","source_board_id":b["id"],"source_card_id":b["cards"][0]["id"],"expected_revision":b["revision"],"expected_touch_version":b["cards"][0]["touch_version"]})
}
#[tokio::test]
async fn owner_crud_cas_foreign_admin_no_bypass_and_strict_editing() {
    let (_d, _url, app, c, t, b) = fixture().await;
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
    let (_, ob, _) = call(&app, "GET", "/api/inbox", json!({}), &oc, &ot).await;
    let (_ob, v) = saved(&app, &ob, &oc, &ot).await;
    let path = format!("/api/templates/{}", v["id"]);
    let edit = json!({"expected_revision":1,"name":"new name","title":"new title","description":"new body","checklist":[{"title":"second"},{"title":"first"}]});
    assert_eq!(
        call(&app, "GET", "/api/templates", json!({}), &c, &t)
            .await
            .1,
        json!([])
    );
    for (method, body) in [
        ("GET", json!({})),
        ("PATCH", edit.clone()),
        ("DELETE", json!({"expected_revision":1})),
    ] {
        assert_eq!(
            call(&app, method, &path, body, &c, &t).await.0,
            StatusCode::NOT_FOUND
        );
    }
    let (s, updated, _) = call(&app, "PATCH", &path, edit.clone(), &oc, &ot).await;
    assert_eq!(s, StatusCode::OK, "{updated}");
    assert_eq!(updated["revision"], 2);
    assert_eq!(updated["title"], "new title");
    assert_eq!(
        updated["checklist"],
        json!([{"title":"second","position":0},{"title":"first","position":1}])
    );
    assert_eq!(
        call(&app, "PATCH", &path, edit.clone(), &oc, &ot).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            &path,
            json!({"expected_revision":1}),
            &oc,
            &ot
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let mut bad = edit.clone();
    bad["expected_revision"] = json!(2);
    bad["schedule"] = json!({"start_date":"2096-01-01"});
    assert_eq!(
        call(&app, "PATCH", &path, bad, &oc, &ot).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut bad = edit;
    bad["expected_revision"] = json!(2);
    bad["checklist"][0]["checked"] = json!(true);
    assert_eq!(
        call(&app, "PATCH", &path, bad, &oc, &ot).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(&app, "GET", &path, json!({}), &oc, &ot).await.1,
        updated
    );
    assert_eq!(
        call(
            &app,
            "DELETE",
            &path,
            json!({"expected_revision":2}),
            &oc,
            &ot
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "GET", &path, json!({}), &oc, &ot).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, "GET", "/api/templates/99999", json!({}), &c, &t)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}", b["id"]),
            json!({}),
            &c,
            &t
        )
        .await
        .1,
        b
    );
}
fn instantiate(v: &Value, b: &Value) -> Value {
    json!({"action":"card_from_template","list_id":b["lists"][0]["id"],"template_id":v["id"],"expected_template_revision":v["revision"]})
}
#[tokio::test]
async fn instantiate_rejects_unknown_fields_without_content_revision_or_identity_changes() {
    let (_d, url, app, c, t, b) = fixture().await;
    let (b, _) = saved(&app, &b, &c, &t).await;
    let (s, b, _) = mutate(
        &app,
        &b,
        json!({"action":"checklist_create","card_id":b["cards"][0]["id"],"title":"child"}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v, _) = call(&app, "POST", "/api/templates", source_request(&b), &c, &t).await;
    assert_eq!(s, StatusCode::CREATED);
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let identity_query =
        "SELECT (SELECT last_id FROM card_identity),(SELECT last_id FROM checklist_identity)";
    let identities: (i64, i64) = sqlx::query_as(identity_query)
        .fetch_one(&pool)
        .await
        .unwrap();
    for (key, value) in [
        ("unexpected_typo", json!(true)),
        ("completed", json!(true)),
        ("schedule_typo", json!({"start_date":"2096-01-01"})),
    ] {
        let mut request = instantiate(&v, &b);
        request[key] = value;
        let (status, _, _) = mutate(&app, &b, request, &c, &t).await;
        // Check rollback even when the status assertion would fail on permissive DTOs.
        let (_, after, _) = call(
            &app,
            "GET",
            &format!("/api/boards/{}", b["id"]),
            json!({}),
            &c,
            &t,
        )
        .await;
        let after_ids: (i64, i64) = sqlx::query_as(identity_query)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "accepted {key}; snapshot unchanged: {}; identities unchanged: {}",
            after == b,
            after_ids == identities
        );
        assert_eq!(after, b, "{key}");
        assert_eq!(after_ids, identities, "{key}");
    }
    let (s, after, _) = mutate(&app, &b, instantiate(&v, &b), &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{after}");
    assert_eq!(
        after["revision"].as_i64().unwrap(),
        b["revision"].as_i64().unwrap() + 1
    );
    assert_eq!(
        after["cards"].as_array().unwrap().len(),
        b["cards"].as_array().unwrap().len() + 1
    );
    // Existing actions deliberately retain their permissive flattened wire contract.
    let (s, after, _) = mutate(&app, &after,
        json!({"action":"card_create","list_id":b["lists"][0]["id"],"title":"legacy","legacy_extra":true}),
        &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{after}");
}
#[tokio::test]
async fn instantiate_clean_detached_ordered_content_and_atomic_guards() {
    let (_d, url, app, c, t, before) = fixture().await;
    let (s,mut b,_)=mutate(&app,&before,json!({"action":"card_create","list_id":before["lists"][0]["id"],"title":"source","description":"literal\nbody","schedule":{"start_date":"2096-01-01","repeat":{"unit":"day","interval":1}}}),&c,&t).await;
    assert_eq!(s, StatusCode::OK);
    let source = b["cards"][0]["id"].clone();
    for title in ["first", "second"] {
        b = mutate(
            &app,
            &b,
            json!({"action":"checklist_create","card_id":source,"title":title}),
            &c,
            &t,
        )
        .await
        .1;
    }
    let item = b["checklist"][0]["id"].clone();
    b=mutate(&app,&b,json!({"action":"checklist_update","card_id":source,"item_id":item,"title":"first","checked":true}),&c,&t).await.1;
    b = mutate(
        &app,
        &b,
        json!({"action":"comment_create","card_id":source,"body":"not copied"}),
        &c,
        &t,
    )
    .await
    .1;
    let (s, v, _) = call(&app, "POST", "/api/templates", source_request(&b), &c, &t).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(
        v.as_object().unwrap().keys().cloned().collect::<Vec<_>>(),
        vec![
            "checklist",
            "description",
            "id",
            "name",
            "revision",
            "title"
        ]
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let identity: i64 = sqlx::query_scalar("SELECT last_id FROM card_identity")
        .fetch_one(&pool)
        .await
        .unwrap();
    for a in [
        {
            let mut a = instantiate(&v, &b);
            a["list_id"] = json!(99999);
            a
        },
        {
            let mut a = instantiate(&v, &b);
            a["expected_template_revision"] = json!(0);
            a
        },
    ] {
        let (s, _, _) = mutate(&app, &b, a, &c, &t).await;
        assert!([StatusCode::NOT_FOUND, StatusCode::CONFLICT].contains(&s));
        assert_eq!(
            call(
                &app,
                "GET",
                &format!("/api/boards/{}", b["id"]),
                json!({}),
                &c,
                &t
            )
            .await
            .1,
            b
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT last_id FROM card_identity")
                .fetch_one(&pool)
                .await
                .unwrap(),
            identity
        );
    }
    let (s, after, _) = mutate(&app, &b, instantiate(&v, &b), &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{after}");
    assert_eq!(
        after["revision"].as_i64(),
        b["revision"].as_i64().map(|v| v + 1)
    );
    let new = after["cards"].as_array().unwrap().last().unwrap();
    assert!(new["id"].as_i64().unwrap() > identity);
    for key in [
        "schedule",
        "due_date",
        "anchor_schedule",
        "series_id",
        "predecessor_id",
        "assignee_id",
    ] {
        assert!(new[key].is_null(), "{key}: {new}");
    }
    assert_eq!(new["title"], "source");
    assert_eq!(new["description"], "literal\nbody");
    assert_eq!(new["completed"], false);
    assert_eq!(new["archived"], false);
    assert_eq!(new["occurrence_no"], 1);
    assert_eq!(new["touch_version"], 0);
    let children: Vec<_> = after["checklist"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["card_id"] == new["id"])
        .collect();
    assert_eq!(children.len(), 2);
    assert_eq!(children[0]["title"], "first");
    assert_eq!(children[1]["title"], "second");
    for i in children {
        assert_eq!(i["checked"], false);
        assert!(
            b["checklist"]
                .as_array()
                .unwrap()
                .iter()
                .all(|old| old["id"] != i["id"])
        );
    }
    assert_eq!(after["comments"], b["comments"]);
    assert_eq!(
        mutate(&app, &b, instantiate(&v, &b), &c, &t).await.0,
        StatusCode::CONFLICT
    );
    // A detached snapshot survives destruction of its source, and template edits/deletion never update instances.
    sqlx::query("DELETE FROM cards WHERE id=?")
        .bind(source.as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/templates/{}", v["id"]),
            json!({}),
            &c,
            &t
        )
        .await
        .1,
        v
    );
    let path = format!("/api/templates/{}", v["id"]);
    let (s,edit,_)=call(&app,"PATCH",&path,json!({"expected_revision":1,"name":"changed","title":"changed","description":"changed","checklist":[]}),&c,&t).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        call(
            &app,
            "DELETE",
            &path,
            json!({"expected_revision":edit["revision"]}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, stored, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}/cards/{}", b["id"], new["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(&stored, new);
}
#[tokio::test]
async fn shared_destination_requires_explicit_ack_and_template_ownership() {
    let (_d, _url, app, c, t, b) = fixture().await;
    let (_, v) = saved(&app, &b, &c, &t).await;
    let (_, shared, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"shared"}),
        &c,
        &t,
    )
    .await;
    let (_, shared, _) = mutate(
        &app,
        &shared,
        json!({"action":"list_create","title":"tasks"}),
        &c,
        &t,
    )
    .await;
    let (s, error, _) = mutate(&app, &shared, instantiate(&v, &shared), &c, &t).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{error}");
    assert_eq!(error["code"], "shared_content_ack_required");
    let mut a = instantiate(&v, &shared);
    a["ack_shared_content"] = json!(false);
    assert_eq!(
        mutate(&app, &shared, a.clone(), &c, &t).await.0,
        StatusCode::BAD_REQUEST
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
    let (_, shared, _) = mutate(
        &app,
        &shared,
        json!({"action":"member_set","username":"other","role":"member"}),
        &c,
        &t,
    )
    .await;
    a["ack_shared_content"] = json!(true);
    assert_eq!(
        mutate(&app, &shared, a.clone(), &oc, &ot).await.0,
        StatusCode::NOT_FOUND
    );
    let (_, ob, _) = call(&app, "GET", "/api/inbox", json!({}), &oc, &ot).await;
    assert_eq!(
        mutate(&app, &ob, instantiate(&v, &ob), &c, &t).await.0,
        StatusCode::NOT_FOUND
    );
    let (s, after, _) = mutate(&app, &shared, a, &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{after}");
    assert_eq!(after["cards"].as_array().unwrap().len(), 1);
    let (_, seen, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", shared["id"]),
        json!({}),
        &oc,
        &ot,
    )
    .await;
    assert_eq!(seen["cards"], after["cards"]);
}
#[tokio::test]
async fn snapshot_source_acl_stale_versions_and_limits_are_atomic() {
    let (_d, url, app, c, t, b) = fixture().await;
    let (b, v) = saved(&app, &b, &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    for field in ["expected_revision", "expected_touch_version"] {
        let mut a = source_request(&b);
        a[field] = json!(-1);
        assert_eq!(
            call(&app, "POST", "/api/templates", a, &c, &t).await.0,
            StatusCode::CONFLICT
        );
    }
    let mut a = source_request(&b);
    a["source_card_id"] = json!(9999);
    assert_eq!(
        call(&app, "POST", "/api/templates", a, &c, &t).await.0,
        StatusCode::NOT_FOUND
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
    assert_eq!(
        call(&app, "POST", "/api/templates", source_request(&b), &oc, &ot)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (_, ob, _) = call(&app, "GET", "/api/inbox", json!({}), &oc, &ot).await;
    let (ob, _) = saved(&app, &ob, &oc, &ot).await;
    assert_eq!(
        call(&app, "POST", "/api/templates", source_request(&ob), &c, &t)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let mut bad = source_request(&b);
    bad["title"] = json!("injected");
    assert_eq!(
        call(&app, "POST", "/api/templates", bad, &c, &t).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let path = format!("/api/templates/{}", v["id"]);
    for change in [
        json!({"title":"x".repeat(161)}),
        json!({"name":" "}),
        json!({"description":"x".repeat(20001)}),
        json!({"checklist":[{"title":"x".repeat(501)}]}),
        json!({"checklist":vec![json!({"title":"item"});101]}),
    ] {
        let mut edit =
            json!({"expected_revision":1,"name":"ok","title":"ok","description":"","checklist":[]});
        for (k, v) in change.as_object().unwrap() {
            edit[k] = v.clone();
        }
        assert_eq!(
            call(&app, "PATCH", &path, edit, &c, &t).await.0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(call(&app, "GET", &path, json!({}), &c, &t).await.1, v);
    }
    // Bound source checklist reads too: 101 entries are rejected rather than truncated.
    sqlx::query("INSERT INTO checklist_items(card_id,title,position) SELECT ?, 'item', value FROM json_each(?)").bind(b["cards"][0]["id"].as_i64().unwrap()).bind(serde_json::to_string(&(0..101).collect::<Vec<i64>>()).unwrap()).execute(&pool).await.unwrap();
    let (_, fresh, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/templates",
            source_request(&fresh),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // The cap is checked before insertion and does not count other owners.
    sqlx::query("INSERT INTO task_templates(owner_id,name,title,description) SELECT 1,'cap','cap','' FROM json_each(?)").bind(serde_json::to_string(&(0..99).collect::<Vec<i64>>()).unwrap()).execute(&pool).await.unwrap();
    sqlx::query("DELETE FROM checklist_items WHERE card_id=?")
        .bind(b["cards"][0]["id"].as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let (_, fresh, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    let (s, e, _) = call(
        &app,
        "POST",
        "/api/templates",
        source_request(&fresh),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(e["code"], "template_limit");
    assert_eq!(
        call(&app, "GET", "/api/templates", json!({}), &c, &t)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        100
    );
}
#[tokio::test]
async fn templates_security_headers_session_revocation_and_selected_export_exclusion() {
    let (_d, url, app, c, t, b) = fixture().await;
    let (b, v) = saved(&app, &b, &c, &t).await;
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/templates",
            source_request(&b),
            &c,
            "bad"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/templates")
                .header("origin", "https://evil.invalid")
                .header("cookie", &c)
                .header("x-csrf-token", &t)
                .header("content-type", "application/json")
                .body(Body::from(source_request(&b).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    let (status,_,_)=call(&app,"PATCH",&format!("/api/templates/{}",v["id"]),json!({"expected_revision":1,"name":"private-only-marker","title":"private-title-marker","description":"private-body-marker","checklist":[{"title":"private-item-marker"}]}),&c,&t).await;
    assert_eq!(status, StatusCode::OK);
    let select = json!({"board_ids":[b["id"]],"include_completed":true,"include_archived":true,"format":"json"});
    let (s, preview, _) = call(&app, "POST", "/api/exports/preview", select.clone(), &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{preview}");
    let mut select = select;
    select["expected_snapshot"] = preview["expected_snapshot"].clone();
    let (s, export, _) = call(&app, "POST", "/api/exports/download", select, &c, &t).await;
    assert_eq!(s, StatusCode::OK, "{export}");
    assert!(!export.to_string().contains("secret-template-marker"));
    assert!(export.get("templates").is_none());
    assert!(!export.to_string().contains("private-title-marker"));
    assert!(!export.to_string().contains("private-body-marker"));
    assert!(!export.to_string().contains("private-item-marker"));
    assert_eq!(export["tasks"].as_array().unwrap().len(), 1);
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("DELETE FROM sessions")
        .execute(&pool)
        .await
        .unwrap();
    for (method, path, body) in [
        ("GET", "/api/templates".to_string(), json!({})),
        ("POST", "/api/templates".to_string(), source_request(&b)),
        (
            "DELETE",
            format!("/api/templates/{}", v["id"]),
            json!({"expected_revision":1}),
        ),
    ] {
        assert_eq!(
            call(&app, method, &path, body, &c, &t).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
}
#[tokio::test]
async fn upgrade_v9_preserves_every_old_record_and_enforces_template_foreign_keys() {
    use sqlx::Row;
    let dir = tempfile::tempdir().unwrap();
    let old = tempfile::tempdir().unwrap();
    for entry in std::fs::read_dir("migrations").unwrap() {
        let p = entry.unwrap().path();
        if p.file_name().unwrap().to_str().unwrap() < "0010" {
            std::fs::copy(&p, old.path().join(p.file_name().unwrap())).unwrap();
        }
    }
    let url = format!(
        "sqlite://{}?mode=rwc",
        dir.path().join("v9.sqlite").display()
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::migrate::Migrator::new(old.path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    sqlx::raw_sql("INSERT INTO users(id,username,password_hash) VALUES(1,'old','synthetic'); INSERT INTO boards(id,title,revision) VALUES(40,'old board',9); INSERT INTO board_members VALUES(40,1,'admin'); INSERT INTO lists(id,board_id,title,position) VALUES(50,40,'old list',7); INSERT INTO cards(id,list_id,title,description,position,archived,completed,due_date,series_id,occurrence_no,touch_version) VALUES(60,50,'old task','original',3,1,1,'2024-01-01','legacy',2,12); INSERT INTO checklist_items(card_id,title,checked,position) VALUES(60,'kept',1,2); INSERT INTO comments(card_id,author_id,body,created_at) VALUES(60,1,'kept',9); INSERT INTO attachments VALUES('legacy',60,'old.txt',2,'text/plain','ready','stage','final',9999999999,1); INSERT INTO attachment_outbox(key,not_before) VALUES('stage',9999999999);").execute(&pool).await.unwrap();
    let tables:Vec<String>=sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='_sqlx_migrations' ORDER BY name").fetch_all(&pool).await.unwrap();
    let mut original = Vec::new();
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
        let q = format!("SELECT json_object({fields}) FROM {table} ORDER BY rowid");
        let rows: Vec<String> = sqlx::query_scalar(&q).fetch_all(&pool).await.unwrap();
        original.push((q, rows));
    }
    pool.close().await;
    let _app = norns::app(&url, ORIGIN, false).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    for (q, rows) in original {
        assert_eq!(
            sqlx::query_scalar::<_, String>(&q)
                .fetch_all(&pool)
                .await
                .unwrap(),
            rows,
            "{q}"
        );
    }
    assert!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap()
            .is_empty()
    );
    // Use one connection so foreign_keys is explicit even for this external test pool.
    let mut conn = pool.acquire().await.unwrap();
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&mut *conn)
        .await
        .unwrap();
    assert!(
        sqlx::query(
            "INSERT INTO task_templates(owner_id,name,title,description) VALUES(999,'a','b','')"
        )
        .execute(&mut *conn)
        .await
        .is_err()
    );
    let id = sqlx::query(
        "INSERT INTO task_templates(owner_id,name,title,description) VALUES(1,'a','b','')",
    )
    .execute(&mut *conn)
    .await
    .unwrap()
    .last_insert_rowid();
    sqlx::query("INSERT INTO task_template_items VALUES(?,'child',0)")
        .bind(id)
        .execute(&mut *conn)
        .await
        .unwrap();
    sqlx::query("DELETE FROM task_templates WHERE id=?")
        .bind(id)
        .execute(&mut *conn)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM task_template_items")
            .fetch_one(&mut *conn)
            .await
            .unwrap(),
        0
    );
    assert!(
        sqlx::query("INSERT INTO task_template_items VALUES(?,'orphan',0)")
            .bind(id)
            .execute(&mut *conn)
            .await
            .is_err()
    );
}
#[tokio::test]
async fn instance_checklist_ids_never_reuse_deleted_source_ids() {
    let (_d, url, app, c, t, b) = fixture().await;
    let (b, _) = saved(&app, &b, &c, &t).await;
    let (_,b,_)=mutate(&app,&b,json!({"action":"checklist_create","card_id":b["cards"][0]["id"],"title":"retained content"}),&c,&t).await;
    let old_id = b["checklist"][0]["id"].as_i64().unwrap();
    let (_, v, _) = call(&app, "POST", "/api/templates", source_request(&b), &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("DELETE FROM checklist_items")
        .execute(&pool)
        .await
        .unwrap();
    let (_, fresh, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    let (s, after, _) = mutate(&app, &fresh, instantiate(&v, &fresh), &c, &t).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        after["checklist"][0]["id"].as_i64().unwrap() > old_id,
        "checklist identity must not resurrect source child ID"
    );
}
#[tokio::test]
async fn failed_child_insert_rolls_back_all_identity_content_and_revision_writes() {
    let (_d, url, app, c, t, b) = fixture().await;
    let (b, _) = saved(&app, &b, &c, &t).await;
    let (_, b, _) = mutate(
        &app,
        &b,
        json!({"action":"checklist_create","card_id":b["cards"][0]["id"],"title":"child"}),
        &c,
        &t,
    )
    .await;
    let (_, v, _) = call(&app, "POST", "/api/templates", source_request(&b), &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let identities: (i64, i64) = sqlx::query_as(
        "SELECT (SELECT last_id FROM card_identity),(SELECT last_id FROM checklist_identity)",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("CREATE TRIGGER fail_template_child BEFORE INSERT ON checklist_items BEGIN SELECT RAISE(ABORT,'synthetic child failure'); END").execute(&pool).await.unwrap();
    assert_eq!(
        mutate(&app, &b, instantiate(&v, &b), &c, &t).await.0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}", b["id"]),
            json!({}),
            &c,
            &t
        )
        .await
        .1,
        b
    );
    assert_eq!(
        sqlx::query_as::<_, (i64, i64)>(
            "SELECT (SELECT last_id FROM card_identity),(SELECT last_id FROM checklist_identity)"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        identities
    );
    sqlx::query("DROP TRIGGER fail_template_child")
        .execute(&pool)
        .await
        .unwrap();
    // Concurrent creates with the same board CAS cannot create two instances.
    let a = instantiate(&v, &b);
    let (one, two) = tokio::join!(
        mutate(&app, &b, a.clone(), &c, &t),
        mutate(&app, &b, a, &c, &t)
    );
    assert!([one.0, two.0].contains(&StatusCode::OK));
    assert!([one.0, two.0].contains(&StatusCode::CONFLICT));
}
#[tokio::test]
async fn source_snapshot_whitelist_excludes_archived_complete_assignment_and_all_history() {
    let (_d, url, app, c, t, b) = fixture().await;
    let (b, _) = saved(&app, &b, &c, &t).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let card = b["cards"][0]["id"].as_i64().unwrap();
    sqlx::query("UPDATE cards SET archived=1,completed=1,assignee_id=1,due_date='2096-01-01',series_id='source-series',occurrence_no=4 WHERE id=?").bind(card).execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO comments(card_id,author_id,body,created_at) VALUES(?,1,'history-secret',1)",
    )
    .bind(card)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO attachments VALUES('secret',?,'secret.txt',2,'text/plain','ready','stage','final',9999999999,1)").bind(card).execute(&pool).await.unwrap();
    let (_, b, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    let (s, v, _) = call(&app, "POST", "/api/templates", source_request(&b), &c, &t).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, after, _) = mutate(&app, &b, instantiate(&v, &b), &c, &t).await;
    assert_eq!(s, StatusCode::OK);
    let new = after["cards"].as_array().unwrap().last().unwrap();
    assert_ne!(new["id"], b["cards"][0]["id"]);
    assert_eq!(new["completed"], false);
    assert_eq!(new["archived"], false);
    for key in [
        "assignee_id",
        "schedule",
        "anchor_schedule",
        "series_id",
        "due_date",
        "predecessor_id",
    ] {
        assert!(new[key].is_null(), "{key}");
    }
    assert_eq!(new["occurrence_no"], 1);
    assert_eq!(after["comments"], b["comments"]);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachments WHERE card_id=?")
            .bind(new["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    // The persisted schema itself cannot retain source references or hidden task fields.
    use sqlx::Row;
    let fields: Vec<String> = sqlx::query("PRAGMA table_info(task_templates)")
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|r| r.get("name"))
        .collect();
    assert_eq!(
        fields,
        vec!["id", "owner_id", "name", "title", "description", "revision"]
    );
}
#[tokio::test]
async fn owner_cas_update_delete_and_instantiation_races_serialize() {
    let (_d, _url, app, c, t, b) = fixture().await;
    let (b, v) = saved(&app, &b, &c, &t).await;
    let path = format!("/api/templates/{}", v["id"]);
    let edit = json!({"expected_revision":1,"name":"renamed","title":"new title","description":"new body","checklist":[]});
    let (one, two) = tokio::join!(
        call(&app, "PATCH", &path, edit.clone(), &c, &t),
        call(&app, "PATCH", &path, edit.clone(), &c, &t)
    );
    assert!([one.0, two.0].contains(&StatusCode::OK));
    assert!([one.0, two.0].contains(&StatusCode::CONFLICT));
    assert_eq!(
        mutate(&app, &b, instantiate(&v, &b), &c, &t).await.0,
        StatusCode::CONFLICT
    );
    let updated = call(&app, "GET", &path, json!({}), &c, &t).await.1;
    assert_eq!(updated["revision"], 2);
    let (delete, create) = tokio::join!(
        call(
            &app,
            "DELETE",
            &path,
            json!({"expected_revision":2}),
            &c,
            &t
        ),
        mutate(&app, &b, instantiate(&updated, &b), &c, &t)
    );
    assert_eq!(delete.0, StatusCode::NO_CONTENT);
    assert!([StatusCode::OK, StatusCode::NOT_FOUND].contains(&create.0));
    let (_, b, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(
        b["cards"].as_array().unwrap().len(),
        if create.0 == StatusCode::OK { 2 } else { 1 }
    );
}
#[tokio::test]
async fn shared_source_membership_revocation_does_not_revoke_detached_template() {
    let (_d, url, app, c, t, b) = fixture().await;
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
    let (_, shared, _) = call(
        &app,
        "POST",
        "/api/boards",
        json!({"title":"shared source"}),
        &c,
        &t,
    )
    .await;
    let (_, shared, _) = mutate(
        &app,
        &shared,
        json!({"action":"list_create","title":"source list"}),
        &c,
        &t,
    )
    .await;
    let (_, shared, _) = mutate(
        &app,
        &shared,
        json!({"action":"member_set","username":"other","role":"member"}),
        &c,
        &t,
    )
    .await;
    let (shared, v) = saved(&app, &shared, &oc, &ot).await;
    // A saved personal copy remains usable after the source board stops being accessible.
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("DELETE FROM board_members WHERE board_id=? AND user_id=2")
        .bind(shared["id"].as_i64().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/templates",
            source_request(&shared),
            &oc,
            &ot
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/templates/{}", v["id"]),
            json!({}),
            &oc,
            &ot
        )
        .await
        .1,
        v
    );
    let (_, inbox, _) = call(&app, "GET", "/api/inbox", json!({}), &oc, &ot).await;
    assert_eq!(
        mutate(&app, &inbox, instantiate(&v, &inbox), &oc, &ot)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        mutate(&app, &b, instantiate(&v, &b), &c, &t).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn instantiate_accepts_creation_schedule_atomically() {
    let (_d, _url, app, c, t, b) = fixture().await;
    let (b, v) = saved(&app, &b, &c, &t).await;
    let mut request = instantiate(&v, &b);
    request["schedule"] = json!({"start_date":"2026-10-28","timezone":"Asia/Shanghai"});
    let (status, after, _) = mutate(&app, &b, request.clone(), &c, &t).await;
    assert_eq!(status, StatusCode::OK, "{after}");
    let card = after["cards"].as_array().unwrap().last().unwrap();
    assert_eq!(card["schedule"]["start_date"], "2026-10-28");
    assert_eq!(card["due_date"], "2026-10-28");
    assert_eq!(card["touch_version"], 0);
    assert_eq!(
        mutate(&app, &b, request.clone(), &c, &t).await.0,
        StatusCode::CONFLICT
    );
    request["schedule"]["start_date"] = json!("2026-02-30");
    assert_eq!(
        mutate(&app, &after, request, &c, &t).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}", b["id"]),
            json!({}),
            &c,
            &t
        )
        .await
        .1,
        after
    );
}
