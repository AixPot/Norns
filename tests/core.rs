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
#[tokio::test]
async fn login_logout_and_no_web_bootstrap() {
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite://{}", dir.path().join("db.sqlite").display());
    let app = norns::app(&url, ORIGIN, false).await;
    // CLI uses this same public service to initialize, never an HTTP bootstrap.
    norns::init_admin(&url, "root-admin", "synthetic-password-123")
        .await
        .unwrap();
    assert!(
        norns::init_admin(&url, "other", "synthetic-password-123")
            .await
            .is_err()
    );
    let (status, _, _) = call(&app, "POST", "/api/bootstrap", json!({}), "", "").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = call(
        &app,
        "POST",
        "/api/login",
        json!({"username":"root-admin","password":"wrong"}),
        "",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, login, cookie) = call(
        &app,
        "POST",
        "/api/login",
        json!({"username":"root-admin","password":"synthetic-password-123"}),
        "",
        "",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Strict"));
    let csrf = login["csrf"].as_str().unwrap();
    assert_eq!(
        call(&app, "GET", "/api/me", json!({}), &cookie, csrf)
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "POST", "/api/logout", json!({}), &cookie, csrf)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&app, "GET", "/api/me", json!({}), &cookie, csrf)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
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
#[tokio::test]
async fn admin_accounts_reset_disable_and_csrf() {
    let (_d, _url, app, c, t) = fixture().await;
    let input = json!({"username":"member","password":"synthetic-password-456"});
    let (s, u, _) = call(&app, "POST", "/api/admin/users", input.clone(), &c, &t).await;
    assert_eq!(s, StatusCode::CREATED);
    let id = u["id"].as_i64().unwrap();
    let (mc, mt) = login_as(&app, "member", "synthetic-password-456").await;
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/admin/users",
            json!({"username":"illegal","password":"synthetic-password-456"}),
            &mc,
            &mt
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(&app, "POST", "/api/admin/users", input.clone(), &c, "")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let req = Request::builder()
        .method("POST")
        .uri("/api/admin/users")
        .header("origin", "https://evil.invalid")
        .header("cookie", &c)
        .header("x-csrf-token", &t)
        .header("content-type", "application/json")
        .body(Body::from(input.to_string()))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            &format!("/api/admin/users/{id}"),
            json!({"password":"reset-password-789"}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "GET", "/api/me", json!({}), &mc, &mt).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/login",
            json!({"username":"member","password":"synthetic-password-456"}),
            "",
            ""
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let (mc, mt) = login_as(&app, "member", "reset-password-789").await;
    assert_eq!(
        call(
            &app,
            "PATCH",
            &format!("/api/admin/users/{id}"),
            json!({"active":false}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "GET", "/api/me", json!({}), &mc, &mt).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/login",
            json!({"username":"member","password":"reset-password-789"}),
            "",
            ""
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(&app, "GET", "/api/admin/users", json!({}), &c, &t)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        2
    );
}
#[tokio::test]
async fn login_failure_rate_limit() {
    let (_d, _url, app, _c, _t) = fixture().await;
    for _ in 0..10 {
        assert_eq!(
            call(
                &app,
                "POST",
                "/api/login",
                json!({"username":"nobody","password":"wrong"}),
                "",
                ""
            )
            .await
            .0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/login",
            json!({"username":"nobody","password":"wrong"}),
            "",
            ""
        )
        .await
        .0,
        StatusCode::TOO_MANY_REQUESTS
    );
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
#[tokio::test]
async fn boards_membership_isolation_and_last_admin() {
    let (_d, _url, app, c, t) = fixture().await;
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"member","password":"synthetic-password-456"}),
        &c,
        &t,
    )
    .await;
    let (mc, mt) = login_as(&app, "member", "synthetic-password-456").await;
    let mut b = board(&app, &mc, &mt, "私有看板").await;
    assert_eq!(b["role"], "admin");
    let path = format!("/api/boards/{}", b["id"]);
    // Site admin is NOT implicitly a member.
    assert_eq!(
        call(&app, "GET", &path, json!({}), &c, &t).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"member_set","username":"admin","role":"admin"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, "GET", "/api/boards", json!({}), &c, &t).await.1,
        json!([])
    );
    let (s, v, _) = mutate(
        &app,
        &mc,
        &mt,
        &b,
        json!({"action":"member_set","username":"admin","role":"member"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    b = v;
    assert_eq!(
        call(&app, "GET", &path, json!({}), &c, &t).await.0,
        StatusCode::OK
    );
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"member_remove","user_id":b["members"][0]["user_id"]})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let owner = b["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["role"] == "admin")
        .unwrap()["user_id"]
        .clone();
    assert_eq!(
        mutate(
            &app,
            &mc,
            &mt,
            &b,
            json!({"action":"member_remove","user_id":owner})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (s, v, _) = mutate(
        &app,
        &mc,
        &mt,
        &b,
        json!({"action":"member_set","username":"admin","role":"admin"}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    b = v;
    let (s, v, _) = mutate(
        &app,
        &c,
        &t,
        &b,
        json!({"action":"member_remove","user_id":owner}),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    b = v;
    assert_eq!(
        call(&app, "GET", &path, json!({}), &mc, &mt).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        mutate(
            &app,
            &mc,
            &mt,
            &b,
            json!({"action":"member_set","username":"member","role":"admin"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

async fn apply(app: &axum::Router, c: &str, t: &str, b: &mut Value, data: Value) {
    let (s, v, _) = mutate(app, c, t, b, data).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    *b = v;
}
#[tokio::test]
async fn cards_lists_sorting_and_cross_board_ids() {
    let (_d, _url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "工作").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"待办"}),
    )
    .await;
    let l1 = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_update","list_id":l1,"title":"计划"}),
    )
    .await;
    assert_eq!(b["lists"][0]["title"], "计划");
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"完成"}),
    )
    .await;
    let l2 = b["lists"][1]["id"].clone();
    for title in ["A", "B", "C"] {
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"card_create","list_id":l1,"title":title}),
        )
        .await;
    }
    let a = b["cards"][0]["id"].clone();
    let cc = b["cards"][2]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_move","card_id":cc,"target_list_id":l1,"index":0}),
    )
    .await;
    assert_eq!(
        b["cards"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["title"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["C", "A", "B"]
    );
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_move","card_id":a,"target_list_id":l2,"index":0}),
    )
    .await;
    for lid in [&l1, &l2] {
        let positions: Vec<i64> = b["cards"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| &c["list_id"] == lid)
            .map(|c| c["position"].as_i64().unwrap())
            .collect();
        assert_eq!(positions, (0..positions.len() as i64).collect::<Vec<_>>());
    }
    apply(&app,&c,&t,&mut b,json!({"action":"card_update","card_id":a,"title":"A edited","description":"描述持久化","archived":true})).await;
    assert!(
        b["cards"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == a)
            .unwrap()["archived"]
            .as_bool()
            .unwrap()
    );
    let mut other = board(&app, &c, &t, "另一个").await;
    apply(
        &app,
        &c,
        &t,
        &mut other,
        json!({"action":"list_create","title":"秘密"}),
    )
    .await;
    let foreign = other["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut other,
        json!({"action":"card_create","list_id":foreign,"title":"私有卡片"}),
    )
    .await;
    let fid = other["cards"][0]["id"].clone();
    for action in [
        json!({"action":"card_move","card_id":cc,"target_list_id":foreign,"index":0}),
        json!({"action":"card_update","card_id":fid,"title":"伪造","description":"","archived":false}),
        json!({"action":"list_update","list_id":foreign,"title":"伪造"}),
        json!({"action":"card_create","list_id":foreign,"title":"伪造"}),
    ] {
        assert_eq!(
            mutate(&app, &c, &t, &b, action).await.0,
            StatusCode::NOT_FOUND
        );
    }
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}/cards/{fid}", b["id"]),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, after, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(after, b);
}

#[tokio::test]
async fn successful_logins_do_not_consume_failure_budget() {
    let (_d, _url, app, _c, _t) = fixture().await;
    for _ in 0..11 {
        login_as(&app, "admin", "synthetic-password-123").await;
    }
}
#[tokio::test]
async fn conflicts_rollback_and_sqlite_file_reopen() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "持久化").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"待办"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    for title in ["A", "B", "C"] {
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"card_create","list_id":lid,"title":title}),
        )
        .await;
    }
    let old = b.clone();
    let cid = b["cards"][0]["id"].clone();
    apply(&app,&c,&t,&mut b,json!({"action":"card_update","card_id":cid,"title":"服务端已保存","description":"持久化描述","archived":false})).await;
    assert_eq!(mutate(&app,&c,&t,&old,json!({"action":"card_update","card_id":cid,"title":"过时覆盖","description":"过时","archived":false})).await.0,StatusCode::CONFLICT);
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_sort BEFORE UPDATE OF position ON cards WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").execute(&pool).await.unwrap();
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"card_move","card_id":cid,"target_list_id":lid,"index":2})
        )
        .await
        .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let (_, after, _) = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(after, b);
    sqlx::query("DROP TRIGGER fail_sort")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let reopened = norns::app(&url, ORIGIN, false).await;
    let (_, after, _) = call(
        &reopened,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(after, b);
}

#[tokio::test]
async fn serves_frontend_with_security_headers() {
    let (_d, url, _app, _c, _t) = fixture().await;
    let assets = tempfile::tempdir().unwrap();
    std::fs::write(
        assets.path().join("index.html"),
        "<!doctype html><title>Norns</title>",
    )
    .unwrap();
    let app = norns::app_with_static(&url, ORIGIN, false, assets.path().to_str().unwrap()).await;
    let res = app
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()["x-content-type-options"], "nosniff");
}

#[tokio::test]
async fn cannot_disable_only_active_board_admin() {
    let (_d, _url, app, c, t) = fixture().await;
    let (_, u, _) = call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"owner","password":"synthetic-password-456"}),
        &c,
        &t,
    )
    .await;
    let (oc, ot) = login_as(&app, "owner", "synthetic-password-456").await;
    let mut b = board(&app, &oc, &ot, "归属保护").await;
    let target = format!("/api/admin/users/{}", u["id"]);
    assert_eq!(
        call(&app, "PATCH", &target, json!({"active":false}), &c, &t)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&app, "GET", "/api/me", json!({}), &oc, &ot).await.0,
        StatusCode::OK
    );
    apply(
        &app,
        &oc,
        &ot,
        &mut b,
        json!({"action":"member_set","username":"admin","role":"admin"}),
    )
    .await;
    assert_eq!(
        call(&app, "PATCH", &target, json!({"active":false}), &c, &t)
            .await
            .0,
        StatusCode::OK
    );
    // Inactive admin membership cannot justify removing the last active administrator.
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"member_remove","user_id":1})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn ordinary_member_can_edit_cards_but_nonmember_cannot_read_child() {
    let (_d, _url, app, c, t) = fixture().await;
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"member","password":"synthetic-password-456"}),
        &c,
        &t,
    )
    .await;
    let (mc, mt) = login_as(&app, "member", "synthetic-password-456").await;
    let mut b = board(&app, &c, &t, "成员编辑").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"待办"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"保密"}),
    )
    .await;
    let cid = b["cards"][0]["id"].clone();
    let path = format!("/api/boards/{}/cards/{cid}", b["id"]);
    assert_eq!(
        call(&app, "GET", &path, json!({}), &mc, &mt).await.0,
        StatusCode::NOT_FOUND
    );
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"member_set","username":"member","role":"member"}),
    )
    .await;
    apply(&app,&mc,&mt,&mut b,json!({"action":"card_update","card_id":cid,"title":"成员已编辑","description":"成员描述","archived":false})).await;
    apply(
        &app,
        &mc,
        &mt,
        &mut b,
        json!({"action":"list_create","title":"成员列"}),
    )
    .await;
    assert_eq!(
        call(&app, "GET", &path, json!({}), &mc, &mt).await.1["title"],
        "成员已编辑"
    );
}

#[tokio::test]
async fn expired_session_rejected_and_simultaneous_writes_conflict() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "并发").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"待办"}),
    )
    .await;
    let one = json!({"action":"list_update","list_id":b["lists"][0]["id"],"title":"更新一"});
    let two = json!({"action":"list_update","list_id":b["lists"][0]["id"],"title":"更新二"});
    let (r1, r2) = tokio::join!(mutate(&app, &c, &t, &b, one), mutate(&app, &c, &t, &b, two));
    assert!([r1.0, r2.0].contains(&StatusCode::OK));
    assert!([r1.0, r2.0].contains(&StatusCode::CONFLICT));
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE sessions SET expires_at=0")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    assert_eq!(
        call(&app, "GET", "/api/me", json!({}), &c, &t).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn active_admin_can_remove_inactive_coadmin() {
    let (_d, url, app, c, t) = fixture().await;
    let (status, owner, _) = call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"owner","password":"synthetic-password-456"}),
        &c,
        &t,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (oc, ot) = login_as(&app, "owner", "synthetic-password-456").await;
    let mut b = board(&app, &oc, &ot, "停用管理员清理").await;
    apply(
        &app,
        &oc,
        &ot,
        &mut b,
        json!({"action":"member_set","username":"admin","role":"admin"}),
    )
    .await;
    assert_eq!(
        call(
            &app,
            "PATCH",
            &format!("/api/admin/users/{}", owner["id"]),
            json!({"active":false}),
            &c,
            &t,
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&app, "GET", "/api/me", json!({}), &oc, &ot).await.0,
        StatusCode::UNAUTHORIZED
    );
    let path = format!("/api/boards/{}", b["id"]);
    let (status, before, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    assert_eq!(status, StatusCode::OK);
    let members = before["members"].as_array().unwrap();
    assert_eq!(members.len(), 2);
    let remaining = members.iter().find(|m| m["active"] == true).unwrap();
    assert_eq!(remaining["role"], "admin");
    let remaining_id = remaining["user_id"].clone();
    assert!(
        members
            .iter()
            .any(|m| m["user_id"] == owner["id"] && m["role"] == "admin" && m["active"] == false)
    );
    // The inactive membership must not permit removal of the last active admin.
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &before,
            json!({"action":"member_remove","user_id":remaining_id})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(call(&app, "GET", &path, json!({}), &c, &t).await.1, before);
    let (status, after, _) = mutate(
        &app,
        &c,
        &t,
        &before,
        json!({"action":"member_remove","user_id":owner["id"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(
        after["revision"].as_i64().unwrap(),
        before["revision"].as_i64().unwrap() + 1
    );
    assert_eq!(after["members"], json!([remaining]));
    assert_eq!(call(&app, "GET", &path, json!({}), &c, &t).await.1, after);
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &after,
            json!({"action":"member_remove","user_id":remaining_id})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let reopened = norns::app(&url, ORIGIN, false).await;
    assert_eq!(
        call(&reopened, "GET", &path, json!({}), &c, &t).await.1,
        after
    );
}

#[tokio::test]
async fn phase2_checklist_scoped_crud_sort_conflict_persists() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "details").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"task"}),
    )
    .await;
    let cid = b["cards"][0]["id"].clone();
    for title in ["one", "two"] {
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"checklist_create","card_id":cid,"title":title}),
        )
        .await;
    }
    let item = b["checklist"][0]["id"].clone();
    let old = b.clone();
    apply(&app,&c,&t,&mut b,json!({"action":"checklist_update","card_id":cid,"item_id":item,"title":"edited","checked":true})).await;
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &old,
            json!({"action":"checklist_delete","card_id":cid,"item_id":item})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"checklist_move","card_id":cid,"item_id":item,"index":1}),
    )
    .await;
    assert_eq!(b["checklist"][1]["title"], "edited");
    assert_eq!(b["checklist"][1]["checked"], true);
    let other = board(&app, &c, &t, "foreign").await;
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &other,
            json!({"action":"checklist_create","card_id":cid,"title":"forged"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"checklist_delete","card_id":cid,"item_id":item}),
    )
    .await;
    assert_eq!(b["checklist"][0]["position"], 0);
    let reopened = norns::app(&url, ORIGIN, false).await;
    assert_eq!(
        call(
            &reopened,
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

#[tokio::test]
async fn phase2_assignment_date_member_removal_atomic() {
    let (_d, url, app, c, t) = fixture().await;
    let (_, u, _) = call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"worker","password":"synthetic-password-456"}),
        &c,
        &t,
    )
    .await;
    let mut b = board(&app, &c, &t, "assignment").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"task"}),
    )
    .await;
    let cid = b["cards"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_details","card_id":cid,"assignee_id":null,"due_date":"2028-02-29"}),
    )
    .await;
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"card_details","card_id":cid,"assignee_id":u["id"],"due_date":null})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"member_set","username":"worker","role":"member"}),
    )
    .await;
    apply(&app,&c,&t,&mut b,json!({"action":"card_details","card_id":cid,"assignee_id":u["id"],"due_date":"2028-02-29"})).await;
    assert_eq!(b["cards"][0]["assignee_id"], u["id"]);
    for date in [
        "2027-02-29",
        "2028-13-01",
        "2028-2-01",
        "2028-01-01T00:00:00Z",
    ] {
        assert_eq!(
            mutate(
                &app,
                &c,
                &t,
                &b,
                json!({"action":"card_details","card_id":cid,"assignee_id":null,"due_date":date})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_remove BEFORE DELETE ON board_members BEGIN SELECT RAISE(ABORT,'fail'); END").execute(&pool).await.unwrap();
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"member_remove","user_id":u["id"]})
        )
        .await
        .0,
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
    sqlx::query("DROP TRIGGER fail_remove")
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"member_remove","user_id":u["id"]}),
    )
    .await;
    assert!(b["cards"][0]["assignee_id"].is_null());
    assert_eq!(b["cards"][0]["due_date"], "2028-02-29");
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_details","card_id":cid,"assignee_id":null,"due_date":null}),
    )
    .await;
    assert!(b["cards"][0]["due_date"].is_null());
}

#[tokio::test]
async fn phase2_comments_author_admin_acl_and_reopen() {
    let (_d, url, app, c, t) = fixture().await;
    for name in ["alice", "bob"] {
        call(
            &app,
            "POST",
            "/api/admin/users",
            json!({"username":name,"password":"synthetic-password-456"}),
            &c,
            &t,
        )
        .await;
    }
    let (ac, at) = login_as(&app, "alice", "synthetic-password-456").await;
    let (bc, bt) = login_as(&app, "bob", "synthetic-password-456").await;
    let mut b = board(&app, &c, &t, "comments").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"task"}),
    )
    .await;
    let cid = b["cards"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"comment_create","card_id":cid,"body":"admin note"}),
    )
    .await;
    for action in [
        json!({"action":"comment_create","card_id":cid,"body":"forbidden"}),
        json!({"action":"checklist_create","card_id":cid,"title":"forbidden"}),
    ] {
        assert_eq!(
            mutate(&app, &ac, &at, &b, action).await.0,
            StatusCode::NOT_FOUND
        );
    }
    for name in ["alice", "bob"] {
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"member_set","username":name,"role":"member"}),
        )
        .await;
    }
    apply(
        &app,
        &ac,
        &at,
        &mut b,
        json!({"action":"comment_create","card_id":cid,"body":"alice note"}),
    )
    .await;
    let note = b["comments"][1].clone();
    assert_eq!(note["author"], "alice");
    assert!(note["created_at"].as_i64().unwrap() > 0);
    assert_eq!(
        mutate(
            &app,
            &bc,
            &bt,
            &b,
            json!({"action":"comment_delete","card_id":cid,"comment_id":note["id"]})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let reopened = norns::app(&url, ORIGIN, false).await;
    assert_eq!(
        call(
            &reopened,
            "GET",
            &format!("/api/boards/{}", b["id"]),
            json!({}),
            &ac,
            &at
        )
        .await
        .1["comments"],
        b["comments"]
    );
    apply(
        &app,
        &ac,
        &at,
        &mut b,
        json!({"action":"comment_delete","card_id":cid,"comment_id":note["id"]}),
    )
    .await;
    apply(
        &app,
        &ac,
        &at,
        &mut b,
        json!({"action":"comment_create","card_id":cid,"body":"moderate me"}),
    )
    .await;
    let note = b["comments"][1].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"comment_delete","card_id":cid,"comment_id":note["id"]}),
    )
    .await;
    assert_eq!(b["comments"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn attachments_unconfigured_still_authorized() {
    let (_d, _url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "attachments").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let l = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":l,"title":"task"}),
    )
    .await;
    let path = format!(
        "/api/boards/{}/cards/{}/attachments",
        b["id"], b["cards"][0]["id"]
    );
    let (s, v, _) = call(&app, "GET", &path, json!({}), &c, &t).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["configured"], false);
    assert_eq!(
        call(&app, "GET", &path, json!({}), "", "").await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &app,
            "POST",
            &path,
            json!({"filename":"x.txt","size":3}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[tokio::test]
async fn completion_is_independent_position_stable_and_bulk_archive_preserves_it() {
    let (_d, _url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "completion").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    for title in ["one", "two"] {
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"card_create","list_id":lid,"title":title}),
        )
        .await;
    }
    let cid = b["cards"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":cid,"completed":true}),
    )
    .await;
    assert_eq!(b["cards"][0]["completed"], true);
    assert_eq!(b["cards"][0]["archived"], false);
    assert_eq!(b["cards"][0]["position"], 0);
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_archive_completed","list_id":lid}),
    )
    .await;
    assert_eq!(b["cards"][0]["archived"], true);
    assert_eq!(b["cards"][1]["archived"], false);
    apply(&app,&c,&t,&mut b,json!({"action":"card_update","card_id":cid,"title":"one","description":"","archived":false})).await;
    assert_eq!(b["cards"][0]["completed"], true);
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":cid,"completed":false}),
    )
    .await;
    assert_eq!(b["cards"][0]["completed"], false);
}

#[tokio::test]
async fn schedule_validates_and_legacy_due_date_remains_compatible() {
    let (_d, _url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "schedule").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"one"}),
    )
    .await;
    let cid = b["cards"][0]["id"].clone();
    let schedule = json!({"start_date":"2028-01-31","end_date":"2028-02-02","start_time":"09:30","end_time":"18:00","timezone":"Asia/Shanghai","repeat":{"unit":"month","interval":1,"mode":"calendar","weekdays":[],"count":3}});
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_schedule","card_id":cid,"schedule":schedule}),
    )
    .await;
    assert_eq!(b["cards"][0]["schedule"], schedule);
    assert_eq!(b["cards"][0]["due_date"], "2028-01-31");
    for bad in [
        json!({"start_date":"2027-02-29"}),
        json!({"start_date":"2028-01-01","end_date":"2027-12-31"}),
        json!({"start_date":"2028-01-01","start_time":"25:00"}),
        json!({"start_date":"2028-01-01","start_time":"18:00","end_time":"09:00"}),
        json!({"start_date":"2028-01-01","repeat":{"unit":"day","interval":0}}),
        json!({"start_date":"2028-01-01","repeat":{"unit":"week","interval":1,"weekdays":[]}}),
    ] {
        assert_eq!(
            mutate(
                &app,
                &c,
                &t,
                &b,
                json!({"action":"card_schedule","card_id":cid,"schedule":bad})
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_details","card_id":cid,"assignee_id":null,"due_date":"2029-03-01"}),
    )
    .await;
    assert_eq!(b["cards"][0]["schedule"]["start_date"], "2029-03-01");
    assert!(b["cards"][0]["schedule"]["repeat"].is_null());
}

#[tokio::test]
async fn recurring_completion_is_atomic_unique_inherits_only_safe_fields_and_guarded_undo() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "recurrence").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"repeat","description":"inherit"}),
    )
    .await;
    let cid = b["cards"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"checklist_create","card_id":cid,"title":"reset me"}),
    )
    .await;
    let item = b["checklist"][0]["id"].clone();
    apply(&app,&c,&t,&mut b,json!({"action":"checklist_update","card_id":cid,"item_id":item,"title":"reset me","checked":true})).await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"comment_create","card_id":cid,"body":"do not copy"}),
    )
    .await;
    apply(&app,&c,&t,&mut b,json!({"action":"card_schedule","card_id":cid,"schedule":{"start_date":"2020-01-31","timezone":"Asia/Shanghai","repeat":{"unit":"month","interval":1,"weekdays":[],"count":2}}})).await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_details","card_id":cid,"assignee_id":1,"due_date":"2020-01-31"}),
    )
    .await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("INSERT INTO attachments(id,card_id,filename,size,state,staging,final_key,expires_at,created_at) VALUES('previous-only',?,'previous.txt',1,'ready','previous-stage','previous-final',9999999999,1)").bind(cid.as_i64().unwrap()).execute(&pool).await.unwrap();
    // Touch metadata in snapshot reflects database triggers; fetch the exact authoritative baseline.
    b = call(
        &app,
        "GET",
        &format!("/api/boards/{}", b["id"]),
        json!({}),
        &c,
        &t,
    )
    .await
    .1;
    let complete = json!({"action":"card_complete","card_id":cid,"completed":true});
    let (a, z) = tokio::join!(
        mutate(&app, &c, &t, &b, complete.clone()),
        mutate(&app, &c, &t, &b, complete.clone())
    );
    assert!([a.0, z.0].contains(&StatusCode::OK));
    assert!([a.0, z.0].contains(&StatusCode::CONFLICT));
    b = if a.0 == StatusCode::OK { a.1 } else { z.1 };
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
    assert_eq!(b["cards"][0]["position"], 0);
    assert_eq!(b["cards"][0]["completed"], true);
    let successor = b["cards"][1].clone();
    assert_eq!(successor["completed"], false);
    assert_eq!(successor["description"], "inherit");
    assert_eq!(successor["assignee_id"], 1);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachments WHERE card_id=?")
            .bind(successor["id"].as_i64().unwrap())
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(successor["predecessor_id"], cid);
    assert_eq!(successor["occurrence_no"], 2);
    assert_eq!(b["checklist"][1]["checked"], false);
    assert_eq!(b["comments"].as_array().unwrap().len(), 1);
    apply(&app, &c, &t, &mut b, complete).await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":cid,"completed":false}),
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 1);
    assert_eq!(b["checklist"].as_array().unwrap().len(), 1);
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":cid,"completed":true}),
    )
    .await;
    let next = b["cards"][1]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"comment_create","card_id":next,"body":"new user data"}),
    )
    .await;
    let blocked = mutate(
        &app,
        &c,
        &t,
        &b,
        json!({"action":"card_complete","card_id":cid,"completed":false}),
    )
    .await;
    assert_eq!(blocked.0, StatusCode::CONFLICT);
    assert_eq!(blocked.1["code"], "successor_touched");
    let reopened = norns::app(&url, ORIGIN, false).await;
    assert_eq!(
        call(
            &reopened,
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
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":next,"completed":true}),
    )
    .await;
    assert_eq!(
        b["cards"].as_array().unwrap().len(),
        2,
        "count includes original, skipped dates do not count"
    );
}

#[tokio::test]
async fn archive_previous_does_not_touch_successor_and_archived_current_pauses() {
    let (_d, _url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "pause").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"one"}),
    )
    .await;
    apply(&app,&c,&t,&mut b,json!({"action":"card_schedule","card_id":1,"schedule":{"start_date":"2020-01-01","repeat":{"unit":"day","interval":1}}})).await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_update","card_id":1,"title":"one","description":"","archived":true}),
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 1);
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"card_complete","card_id":1,"completed":true})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_update","card_id":1,"title":"one","description":"","archived":false}),
    )
    .await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":1,"completed":true}),
    )
    .await;
    let next = b["cards"][1].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_update","card_id":1,"title":"one","description":"","archived":true}),
    )
    .await;
    assert_eq!(
        b["cards"][1], next,
        "archiving previous must not process successor"
    );
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":1,"completed":false}),
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn upgrade_from_old_schema_preserves_archive_dates_and_auxiliary_data() {
    let dir = tempfile::tempdir().unwrap();
    let old = dir.path().join("old-migrations");
    std::fs::create_dir(&old).unwrap();
    for name in [
        "0001_auth.sql",
        "0002_boards.sql",
        "0003_task_details.sql",
        "0004_attachments.sql",
    ] {
        std::fs::copy(
            std::path::Path::new("migrations").join(name),
            old.join(name),
        )
        .unwrap();
    }
    let path = dir.path().join("legacy.sqlite");
    let url = format!("sqlite://{}?mode=rwc", path.display());
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::migrate::Migrator::new(old)
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    sqlx::raw_sql("INSERT INTO boards(id,title) VALUES(1,'old'); INSERT INTO lists(id,board_id,title,position) VALUES(1,1,'todo',0); INSERT INTO cards(id,list_id,title,description,position,archived,due_date) VALUES(1,1,'old archived','keep',7,1,'2028-02-29'); INSERT INTO checklist_items(card_id,title,checked,position) VALUES(1,'keep checklist',1,0);").execute(&pool).await.unwrap();
    pool.close().await;
    let _app = norns::app(&url, ORIGIN, false).await;
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    let row:(bool,bool,String,String,i64)=sqlx::query_as("SELECT archived,completed,due_date,json_extract(schedule,'$.start_date'),position FROM cards WHERE id=1").fetch_one(&pool).await.unwrap();
    assert_eq!(
        row,
        (true, false, "2028-02-29".into(), "2028-02-29".into(), 7)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT checked FROM checklist_items")
            .fetch_one(&pool)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn successor_touch_guards_survive_reverted_text_checklist_and_attachment_processing() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "sticky").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    for kind in [
        "text",
        "checklist",
        "attachment",
        "move",
        "archive",
        "completion",
    ] {
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"card_create","list_id":lid,"title":kind}),
        )
        .await;
        let cid = b["cards"].as_array().unwrap().last().unwrap()["id"].clone();
        apply(&app,&c,&t,&mut b,json!({"action":"card_schedule","card_id":cid,"schedule":{"start_date":"2020-01-01","repeat":{"unit":"day","interval":1}}})).await;
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"card_complete","card_id":cid,"completed":true}),
        )
        .await;
        let next = b["cards"].as_array().unwrap().last().unwrap()["id"].clone();
        match kind {
            "text" => {
                for title in ["changed", kind] {
                    apply(&app,&c,&t,&mut b,json!({"action":"card_update","card_id":next,"title":title,"description":"","archived":false})).await;
                }
            }
            "checklist" => {
                apply(
                    &app,
                    &c,
                    &t,
                    &mut b,
                    json!({"action":"checklist_create","card_id":next,"title":"new"}),
                )
                .await;
            }
            "attachment" => {
                let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
                sqlx::query("INSERT INTO attachments(id,card_id,filename,size,state,staging,final_key,expires_at,created_at) VALUES('synthetic',?,'test',1,'pending','s','f',9999999999,1)").bind(next.as_i64().unwrap()).execute(&pool).await.unwrap();
                sqlx::query("UPDATE attachments SET state='verifying' WHERE id='synthetic'")
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            "move" => {
                apply(
                    &app,
                    &c,
                    &t,
                    &mut b,
                    json!({"action":"card_move","card_id":next,"target_list_id":lid,"index":0}),
                )
                .await;
            }
            "archive" => {
                apply(&app,&c,&t,&mut b,json!({"action":"card_update","card_id":next,"title":kind,"description":"","archived":true})).await;
            }
            _ => {
                apply(
                    &app,
                    &c,
                    &t,
                    &mut b,
                    json!({"action":"card_complete","card_id":next,"completed":true}),
                )
                .await;
            }
        }
        let result = mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"card_complete","card_id":cid,"completed":false}),
        )
        .await;
        assert_eq!(result.0, StatusCode::CONFLICT, "{kind}");
        assert_eq!(result.1["code"], "successor_touched", "{kind}");
    }
}

#[tokio::test]
async fn recurrence_authorization_cross_board_cas_and_generation_failure_rollback() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "atomic").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"one"}),
    )
    .await;
    apply(&app,&c,&t,&mut b,json!({"action":"card_schedule","card_id":1,"schedule":{"start_date":"2020-01-01","repeat":{"unit":"day"}}})).await;
    let other = board(&app, &c, &t, "other").await;
    for action in [
        json!({"action":"card_complete","card_id":1,"completed":true}),
        json!({"action":"card_schedule","card_id":1,"schedule":null}),
        json!({"action":"list_archive_completed","list_id":lid}),
    ] {
        assert_eq!(
            mutate(&app, &c, &t, &other, action).await.0,
            StatusCode::NOT_FOUND
        );
    }
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("CREATE TRIGGER reject_successor BEFORE INSERT ON cards WHEN NEW.predecessor_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic generation failure'); END").execute(&pool).await.unwrap();
    assert_eq!(
        mutate(
            &app,
            &c,
            &t,
            &b,
            json!({"action":"card_complete","card_id":1,"completed":true})
        )
        .await
        .0,
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
    sqlx::query("DROP TRIGGER reject_successor")
        .execute(&pool)
        .await
        .unwrap();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":1,"completed":true}),
    )
    .await;
    assert_eq!(b["cards"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn withdrawn_successor_identity_is_never_reassigned_to_new_user_data() {
    let (_d, _url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "identity").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"repeat"}),
    )
    .await;
    apply(&app,&c,&t,&mut b,json!({"action":"card_schedule","card_id":1,"schedule":{"start_date":"2020-01-01","repeat":{"unit":"day"}}})).await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":1,"completed":true}),
    )
    .await;
    let withdrawn = b["cards"][1]["id"].as_i64().unwrap();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_complete","card_id":1,"completed":false}),
    )
    .await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"unrelated new user data"}),
    )
    .await;
    assert!(
        b["cards"][1]["id"].as_i64().unwrap() > withdrawn,
        "a stale child URL must not resolve to an unrelated new card"
    );
    assert_eq!(
        call(
            &app,
            "GET",
            &format!("/api/boards/{}/cards/{}", b["id"], withdrawn),
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn discovery_membership_filters_and_session_revocation() {
    let (_d, url, app, c, t) = fixture().await;
    call(
        &app,
        "POST",
        "/api/admin/users",
        json!({"username":"worker","password":"synthetic-password-456"}),
        &c,
        &t,
    )
    .await;
    let (wc, wt) = login_as(&app, "worker", "synthetic-password-456").await;
    let mut private = board(&app, &wc, &wt, "private worker board").await;
    apply(
        &app,
        &wc,
        &wt,
        &mut private,
        json!({"action":"list_create","title":"secret"}),
    )
    .await;
    let lid = private["lists"][0]["id"].clone();
    apply(
        &app,
        &wc,
        &wt,
        &mut private,
        json!({"action":"card_create","list_id":lid,"title":"secret needle"}),
    )
    .await;
    let mut b = board(&app, &c, &t, "shared").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(&app,&c,&t,&mut b,json!({"action":"card_create","list_id":lid,"title":"visible","description":"Needle 100%_"})).await;
    let cid = b["cards"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_details","card_id":cid,"assignee_id":1,"due_date":"2028-02-29"}),
    )
    .await;
    let (s, v, _) = call(
        &app,
        "GET",
        "/api/tasks?q=Needle&assignee_id=1&status=incomplete&from=2028-02-29&to=2028-02-29",
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(v["tasks"][0]["id"], cid);
    assert_eq!(v["tasks"][0]["board_title"], "shared");
    assert_eq!(v["tasks"][0]["list_title"], "todo");
    for query in [
        "q=absent",
        "status=complete",
        "assignee_id=2",
        "from=2028-03-01",
        "to=2028-02-28",
        "q=%25_%25",
    ] {
        let (s, v, _) = call(
            &app,
            "GET",
            &format!("/api/tasks?{query}"),
            json!({}),
            &c,
            &t,
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["tasks"], json!([]), "{query}");
    }
    assert_eq!(
        call(&app, "GET", "/api/tasks?view=mine", json!({}), &c, &t)
            .await
            .1["tasks"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        call(&app, "GET", "/api/tasks?from=2028-02-30", json!({}), &c, &t)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/tasks?from=2028-03-01&to=2028-02-01",
            json!({}),
            &c,
            &t
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        call(&app, "GET", "/api/tasks", json!({}), "", "").await.0,
        StatusCode::UNAUTHORIZED
    );
    let (_, ordinary, _) = call(&app, "GET", "/api/tasks", json!({}), &wc, &wt).await;
    assert_eq!(ordinary["tasks"].as_array().unwrap().len(), 1);
    assert_eq!(ordinary["tasks"][0]["board_title"], "private worker board");
    assert_eq!(
        call(&app, "GET", "/api/tasks?q=100%25_", json!({}), &c, &t)
            .await
            .1["tasks"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for query in [
        "status=invalid",
        "view=invalid",
        "from=0000-01-01",
        "unknown=true",
    ] {
        assert_eq!(
            call(
                &app,
                "GET",
                &format!("/api/tasks?{query}"),
                json!({}),
                &c,
                &t
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("DELETE FROM board_members WHERE user_id=1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", "/api/tasks", json!({}), &c, &t).await.1["tasks"],
        json!([]),
        "site admin must not bypass membership"
    );
    sqlx::query("UPDATE users SET active=0 WHERE id=1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", "/api/tasks", json!({}), &c, &t).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn discovery_calendar_ranges_upcoming_archive_and_membership_loss() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "dates").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    let today = (chrono::Utc::now() + chrono::Duration::hours(8)).date_naive();
    let day = |n: i64| (today + chrono::Duration::days(n)).to_string();
    for (name, start, end, complete, archived) in [
        ("overdue", -2, -1, false, false),
        ("spanning", -1, 1, false, false),
        ("today", 0, 0, false, false),
        ("seventh", 7, 7, false, false),
        ("eighth", 8, 8, false, false),
        ("done", 1, 1, true, false),
        ("archive", 1, 1, false, true),
    ] {
        apply(
            &app,
            &c,
            &t,
            &mut b,
            json!({"action":"card_create","list_id":lid,"title":name}),
        )
        .await;
        let cid = b["cards"].as_array().unwrap().last().unwrap()["id"].clone();
        apply(&app,&c,&t,&mut b,json!({"action":"card_schedule","card_id":cid,"schedule":{"start_date":day(start),"end_date":day(end),"timezone":"Asia/Shanghai"}})).await;
        if complete {
            apply(
                &app,
                &c,
                &t,
                &mut b,
                json!({"action":"card_complete","card_id":cid,"completed":true}),
            )
            .await;
        }
        if archived {
            apply(&app,&c,&t,&mut b,json!({"action":"card_update","card_id":cid,"title":name,"description":"","archived":true})).await;
        }
    }
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"undated"}),
    )
    .await;
    async fn names(app: &axum::Router, c: &str, t: &str, q: &str) -> Vec<String> {
        let (s, v, _) = call(app, "GET", &format!("/api/tasks?{q}"), json!({}), c, t).await;
        assert_eq!(s, StatusCode::OK);
        let mut names: Vec<_> = v["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["title"].as_str().unwrap().to_owned())
            .collect();
        names.sort();
        names
    }
    assert_eq!(
        names(&app, &c, &t, "view=today").await,
        vec!["spanning", "today"]
    );
    assert_eq!(
        names(&app, &c, &t, "view=upcoming").await,
        vec!["seventh", "spanning"]
    );
    assert_eq!(
        names(&app, &c, &t, "view=upcoming&status=complete").await,
        Vec::<String>::new()
    );
    assert_eq!(
        names(&app, &c, &t, &format!("from={}&to={}", day(-2), day(-1))).await,
        vec!["overdue", "spanning"]
    );
    assert_eq!(names(&app, &c, &t, "status=complete").await, vec!["done"]);
    assert_eq!(
        names(&app, &c, &t, "board_id=999").await,
        Vec::<String>::new()
    );
    assert_eq!(names(&app, &c, &t, "q=archive").await, Vec::<String>::new());
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("UPDATE sessions SET expires_at=0")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        call(&app, "GET", "/api/tasks", json!({}), &c, &t).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn discovery_metadata_is_unfiltered_and_revocation_scoped() {
    let (_d, url, app, c, t) = fixture().await;
    let mut b = board(&app, &c, &t, "metadata board").await;
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"list_create","title":"todo"}),
    )
    .await;
    let lid = b["lists"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_create","list_id":lid,"title":"assigned"}),
    )
    .await;
    let cid = b["cards"][0]["id"].clone();
    apply(
        &app,
        &c,
        &t,
        &mut b,
        json!({"action":"card_details","card_id":cid,"assignee_id":1,"due_date":null}),
    )
    .await;
    let (_, v, _) = call(
        &app,
        "GET",
        "/api/tasks?q=absent&board_id=999&status=complete",
        json!({}),
        &c,
        &t,
    )
    .await;
    assert_eq!(v["tasks"], json!([]));
    assert_eq!(v["boards"][0]["title"], "metadata board");
    assert_eq!(v["people"], json!([{"id":1,"name":"admin"}]));
    apply(&app,&c,&t,&mut b,json!({"action":"card_update","card_id":cid,"title":"assigned","description":"","archived":true})).await;
    let (_, v, _) = call(&app, "GET", "/api/tasks", json!({}), &c, &t).await;
    assert_eq!(
        v["people"],
        json!([]),
        "archived assignments do not supply choices"
    );
    assert_eq!(
        v["boards"].as_array().unwrap().len(),
        1,
        "empty boards remain choices"
    );
    let pool = sqlx::SqlitePool::connect(&url).await.unwrap();
    sqlx::query("DELETE FROM board_members WHERE user_id=1")
        .execute(&pool)
        .await
        .unwrap();
    let (_, v, _) = call(&app, "GET", "/api/tasks", json!({}), &c, &t).await;
    assert_eq!(v, json!({"tasks":[],"boards":[],"people":[]}));
}
