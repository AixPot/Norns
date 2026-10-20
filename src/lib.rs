mod attachments;
mod auth;
mod boards;
mod db;
mod error;
mod schedule;
mod tasks;
mod users;
pub use auth::init_admin;
use axum::{
    Router, middleware,
    routing::{get, post},
};
#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::SqlitePool,
    pub storage: Option<attachments::Storage>,
    pub origin: String,
    pub secure: bool,
    pub dummy_hash: String,
}
pub async fn app(url: &str, origin: &str, secure: bool) -> Router {
    let static_dir = std::env::var("STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());
    app_with_static(url, origin, secure, &static_dir).await
}
pub async fn app_with_static(url: &str, origin: &str, secure: bool, static_dir: &str) -> Router {
    let state = AppState {
        pool: db::open(url).await.expect("database initialization"),
        storage: attachments::Storage::env(),
        origin: origin.into(),
        secure,
        dummy_hash: auth::hash(auth::token()).await.expect("dummy hash"),
    };
    if state.storage.is_some() {
        let worker = state.clone();
        tokio::spawn(async move {
            loop {
                let _ = attachments::sweep(&worker).await;
                tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            }
        });
    }
    let connect = state
        .storage
        .as_ref()
        .map(|s| format!(" {}", s.connect_origin))
        .unwrap_or_default();
    let csp = format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'{}; media-src 'self'; worker-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        connect
    );
    Router::new()
        .route("/api/login", post(auth::login))
        .route("/api/me", get(auth::me))
        .route("/api/logout", post(auth::logout))
        .route("/api/admin/users", get(users::list).post(users::create))
        .route("/api/admin/users/{id}", axum::routing::patch(users::update))
        .route("/api/tasks", get(tasks::list))
        .route("/api/boards", get(boards::list).post(boards::create))
        .route("/api/boards/{id}", get(boards::get))
        .route("/api/boards/{id}/mutate", post(boards::mutate))
        .route("/api/boards/{id}/cards/{card}", get(boards::get_card))
        .route(
            "/api/boards/{id}/cards/{card}/attachments",
            get(attachments::list).post(attachments::init),
        )
        .route(
            "/api/boards/{id}/cards/{card}/attachments/{upload}/complete",
            post(attachments::complete),
        )
        .route(
            "/api/boards/{id}/cards/{card}/attachments/{upload}",
            axum::routing::delete(attachments::delete),
        )
        .route(
            "/api/boards/{id}/cards/{card}/attachments/{upload}/content",
            get(attachments::read),
        )
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::guard))
        .route(
            "/api/{*path}",
            axum::routing::any(|| async { axum::http::StatusCode::NOT_FOUND }),
        )
        .with_state(state)
        .fallback_service(tower_http::services::ServeDir::new(static_dir))
        .layer(
            tower_http::set_header::SetResponseHeaderLayer::if_not_present(
                axum::http::header::X_CONTENT_TYPE_OPTIONS,
                axum::http::HeaderValue::from_static("nosniff"),
            ),
        )
        .layer(
            tower_http::set_header::SetResponseHeaderLayer::if_not_present(
                axum::http::header::CONTENT_SECURITY_POLICY,
                axum::http::HeaderValue::from_str(&csp).expect("CSP"),
            ),
        )
        .layer(
            tower_http::set_header::SetResponseHeaderLayer::if_not_present(
                axum::http::header::CACHE_CONTROL,
                axum::http::HeaderValue::from_static("no-store"),
            ),
        )
}
