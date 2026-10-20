use crate::{
    AppState,
    error::{self, Result},
};
use argon2::{
    Argon2, PasswordHasher, PasswordVerifier,
    password_hash::{PasswordHash, SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqlitePool};
use std::{
    net::SocketAddr,
    time::{SystemTime, UNIX_EPOCH},
};
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub is_admin: bool,
    pub active: bool,
}
#[derive(Clone)]
pub struct Actor {
    pub user: User,
    pub session: String,
    pub csrf: String,
}
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_secs() as i64
}
pub fn token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
}
pub async fn hash(password: String) -> Result<String> {
    if password.len() < 12 || password.len() > 256 {
        return Err(error::invalid());
    }
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
    })
    .await
    .map_err(|_| error::invalid())?
    .map_err(|_| error::invalid())
}
pub async fn init_admin(url: &str, name: &str, password: &str) -> std::result::Result<(), String> {
    if !valid_name(name) {
        return Err("invalid username".into());
    }
    let hashed = hash(password.into())
        .await
        .map_err(|_| "password must be 12–256 bytes")?;
    let pool = crate::db::open(url).await.map_err(|e| e.to_string())?;
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| e.to_string())?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if count != 0 {
        return Err("initialization refused: users already exist".into());
    }
    sqlx::query("INSERT INTO users(username,password_hash,is_admin) VALUES(?,?,1)")
        .bind(name)
        .bind(hashed)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    pool.close().await;
    Ok(())
}
pub async fn resolve(pool: &SqlitePool, session: &str) -> Result<Actor> {
    let row:Option<(i64,String,bool,bool,String)>=sqlx::query_as("SELECT u.id,u.username,u.is_admin,u.active,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1").bind(session).bind(now()).fetch_optional(pool).await?;
    let (id, username, is_admin, active, csrf) = row.ok_or_else(error::unauthorized)?;
    Ok(Actor {
        user: User {
            id,
            username,
            is_admin,
            active,
        },
        session: session.into(),
        csrf,
    })
}
pub async fn guard(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response> {
    let write = !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    );
    if write && req.headers().get("origin").and_then(|v| v.to_str().ok()) != Some(&state.origin) {
        return Err(error::forbidden());
    }
    if req.uri().path() == "/api/login" {
        return Ok(next.run(req).await);
    }
    let cookie = req
        .headers()
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let raw = cookie
        .split(';')
        .find_map(|s| s.trim().strip_prefix("norns_session="))
        .ok_or_else(error::unauthorized)?;
    let actor = resolve(&state.pool, &digest(raw)).await?;
    if write
        && req
            .headers()
            .get("x-csrf-token")
            .and_then(|h| h.to_str().ok())
            != Some(&actor.csrf)
    {
        return Err(error::forbidden());
    }
    req.extensions_mut().insert(actor);
    Ok(next.run(req).await)
}
#[derive(Deserialize)]
pub struct Login {
    username: String,
    password: String,
}
pub async fn login(
    State(s): State<AppState>,
    headers: HeaderMap,
    connect: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
    Json(input): Json<Login>,
) -> Result<Response> {
    let _ = headers;
    if input.username.len() > 64 || input.password.len() > 256 {
        return Err(error::unauthorized());
    }
    let ip = connect
        .map(|c| c.0.0.ip().to_string())
        .unwrap_or_else(|| "test".into());
    let keys = [format!("ip:{ip}"), format!("name:{}", input.username)];
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    for key in &keys {
        let row: Option<(i64, i64)> =
            sqlx::query_as("SELECT attempts,reset_at FROM login_limits WHERE key=?")
                .bind(key)
                .fetch_optional(&mut *tx)
                .await?;
        if row.is_some_and(|(n, reset)| n >= 10 && reset > now()) {
            return Err(error::Error(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "登录失败过多，请稍后再试",
            ));
        }
        sqlx::query("INSERT INTO login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END").bind(key).bind(now()+600).bind(now()).bind(now()).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    let row: Option<(i64, String)> =
        sqlx::query_as("SELECT id,password_hash FROM users WHERE username=? AND active=1")
            .bind(&input.username)
            .fetch_optional(&s.pool)
            .await?;
    // Use a valid fixed Argon2 hash for missing users to avoid an immediate cheap rejection.
    let (id, hashed) = row.unwrap_or((0, s.dummy_hash.clone()));
    let compared_hash = hashed.clone();
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hashed).ok().is_some_and(|h| {
            Argon2::default()
                .verify_password(input.password.as_bytes(), &h)
                .is_ok()
        })
    })
    .await
    .map_err(|_| error::unauthorized())?;
    if !valid || id == 0 {
        return Err(error::unauthorized());
    }
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    let user: User = sqlx::query_as(
        "SELECT id,username,is_admin,active FROM users WHERE id=? AND active=1 AND password_hash=?",
    )
    .bind(id)
    .bind(compared_hash)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(error::unauthorized)?;
    let raw = token();
    let csrf = token();
    sqlx::query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)")
        .bind(digest(&raw))
        .bind(id)
        .bind(&csrf)
        .bind(now() + 86400 * 7)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM login_limits WHERE key=?")
        .bind(&keys[1])
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE login_limits SET attempts=MAX(0,attempts-1) WHERE key=?")
        .bind(&keys[0])
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let cookie = format!(
        "norns_session={raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800{}",
        if s.secure { "; Secure" } else { "" }
    );
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({"user":user,"csrf":csrf})),
    )
        .into_response())
}
pub async fn me(axum::Extension(actor): axum::Extension<Actor>) -> Json<serde_json::Value> {
    Json(serde_json::json!({"user":actor.user,"csrf":actor.csrf}))
}
pub async fn logout(
    State(s): State<AppState>,
    axum::Extension(a): axum::Extension<Actor>,
) -> Result<Response> {
    sqlx::query("DELETE FROM sessions WHERE token_hash=?")
        .bind(a.session)
        .execute(&s.pool)
        .await?;
    Ok((
        StatusCode::NO_CONTENT,
        [(
            header::SET_COOKIE,
            "norns_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        )],
    )
        .into_response())
}
