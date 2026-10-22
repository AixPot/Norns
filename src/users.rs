use crate::{
    AppState,
    auth::{self, Actor, User},
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
async fn check_admin(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, a: &Actor) -> Result<()> {
    let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.active=1 AND u.is_admin=1 AND s.token_hash=? AND s.expires_at>?)").bind(a.user.id).bind(&a.session).bind(auth::now()).fetch_one(&mut **tx).await?;
    if !ok {
        return Err(error::forbidden());
    }
    Ok(())
}
pub async fn list(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
) -> Result<Json<Vec<User>>> {
    if !a.user.is_admin {
        return Err(error::forbidden());
    }
    Ok(Json(
        sqlx::query_as("SELECT id,username,is_admin,active FROM users ORDER BY id")
            .fetch_all(&s.pool)
            .await?,
    ))
}
#[derive(Deserialize)]
pub struct NewUser {
    username: String,
    password: String,
}
pub async fn create(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Json(input): Json<NewUser>,
) -> Result<(StatusCode, Json<User>)> {
    if !a.user.is_admin {
        return Err(error::forbidden());
    }
    if !auth::valid_name(&input.username) {
        return Err(error::invalid());
    }
    let hash = auth::hash(input.password).await?;
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    check_admin(&mut tx, &a).await?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE username=?)")
        .bind(&input.username)
        .fetch_one(&mut *tx)
        .await?;
    if exists {
        return Err(error::Error(
            StatusCode::CONFLICT,
            "username_exists",
            "用户名已存在",
        ));
    }
    let id = sqlx::query("INSERT INTO users(username,password_hash) VALUES(?,?)")
        .bind(&input.username)
        .bind(hash)
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();
    crate::inbox::ensure(&mut tx, id).await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(User {
            id,
            username: input.username,
            is_admin: false,
            active: true,
        }),
    ))
}
#[derive(Deserialize)]
pub struct UpdateUser {
    password: Option<String>,
    active: Option<bool>,
}
pub async fn update(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(id): Path<i64>,
    Json(input): Json<UpdateUser>,
) -> Result<Json<User>> {
    if !a.user.is_admin {
        return Err(error::forbidden());
    }
    if input.password.is_none() && input.active.is_none() {
        return Err(error::invalid());
    }
    let hash = match input.password {
        Some(p) => Some(auth::hash(p).await?),
        None => None,
    };
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    check_admin(&mut tx, &a).await?;
    let user: User = sqlx::query_as("SELECT id,username,is_admin,active FROM users WHERE id=?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(error::missing)?;
    if user.is_admin && input.active == Some(false) {
        return Err(error::forbidden());
    }
    if input.active == Some(false) {
        let orphan:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM board_members mine JOIN boards b ON b.id=mine.board_id WHERE b.inbox_owner_id IS NULL AND mine.user_id=? AND mine.role='admin' AND NOT EXISTS(SELECT 1 FROM board_members other JOIN users u ON u.id=other.user_id WHERE other.board_id=mine.board_id AND other.role='admin' AND other.user_id<>? AND u.active=1))").bind(id).bind(id).fetch_one(&mut *tx).await?;
        if orphan {
            return Err(error::Error(
                StatusCode::CONFLICT,
                "last_board_admin",
                "该账号仍是看板唯一活跃管理员，请先添加另一位管理员",
            ));
        }
    }
    sqlx::query("UPDATE users SET password_hash=COALESCE(?,password_hash),active=COALESCE(?,active) WHERE id=?").bind(hash).bind(input.active).bind(id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let updated = User {
        active: input.active.unwrap_or(user.active),
        ..user
    };
    tx.commit().await?;
    Ok(Json(updated))
}
