//! Private, detached task content snapshots. Never a board export or a live link.
use crate::{
    AppState,
    auth::Actor,
    boards,
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, Transaction};
const MAX_ITEMS: usize = 100;
const MAX_TEMPLATES: i64 = 100;
#[derive(Serialize, FromRow)]
pub struct Item {
    pub title: String,
    pub position: i64,
}
#[derive(Serialize, FromRow)]
pub struct Template {
    pub id: i64,
    pub name: String,
    pub title: String,
    pub description: String,
    pub revision: i64,
    #[sqlx(skip)]
    pub checklist: Vec<Item>,
}
#[derive(Serialize, FromRow)]
pub struct Summary {
    id: i64,
    name: String,
    revision: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Create {
    name: String,
    source_board_id: i64,
    source_card_id: i64,
    expected_revision: i64,
    expected_touch_version: i64,
}
fn short(value: &str) -> Result<()> {
    if value.len() > 160 {
        return Err(error::invalid());
    }
    boards::title_valid(value)
}
fn content(name: &str, title: &str, description: &str, items: &[Item]) -> Result<()> {
    short(name)?;
    short(title)?;
    boards::description_valid(description)?;
    if items.len() > MAX_ITEMS {
        return Err(error::invalid());
    }
    for item in items {
        boards::title_valid(&item.title)?;
    }
    Ok(())
}
pub(crate) async fn write_auth(
    tx: &mut Transaction<'_, Sqlite>,
    a: &Actor,
    s: &AppState,
    h: &HeaderMap,
) -> Result<()> {
    boards::active(tx, a).await?;
    let current_csrf: String = sqlx::query_scalar("SELECT csrf FROM sessions WHERE token_hash=?")
        .bind(&a.session)
        .fetch_one(&mut **tx)
        .await?;
    if current_csrf != a.csrf {
        return Err(error::forbidden());
    }
    if h.get("origin").and_then(|v| v.to_str().ok()) != Some(s.origin.as_str())
        || h.get("x-csrf-token").and_then(|v| v.to_str().ok()) != Some(a.csrf.as_str())
    {
        return Err(error::forbidden());
    }
    Ok(())
}
pub(crate) async fn load(tx: &mut Transaction<'_, Sqlite>, a: &Actor, id: i64) -> Result<Template> {
    boards::active(tx, a).await?;
    let mut v: Template = sqlx::query_as(
        "SELECT id,name,title,description,revision FROM task_templates WHERE id=? AND owner_id=?",
    )
    .bind(id)
    .bind(a.user.id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(error::missing)?;
    v.checklist=sqlx::query_as("SELECT title,position FROM task_template_items WHERE template_id=? ORDER BY position LIMIT 101").bind(id).fetch_all(&mut **tx).await?;
    content(&v.name, &v.title, &v.description, &v.checklist)?;
    Ok(v)
}
async fn items(tx: &mut Transaction<'_, Sqlite>, id: i64, values: &[Item]) -> Result<()> {
    for (position, item) in values.iter().enumerate() {
        sqlx::query("INSERT INTO task_template_items(template_id,title,position) VALUES(?,?,?)")
            .bind(id)
            .bind(item.title.trim())
            .bind(position as i64)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
pub async fn create(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    headers: HeaderMap,
    Json(input): Json<Create>,
) -> Result<(StatusCode, Json<Template>)> {
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    write_auth(&mut tx, &a, &s, &headers).await?;
    boards::role(&mut tx, &a, input.source_board_id).await?;
    let source: (String,String,i64,i64) = sqlx::query_as("SELECT c.title,c.description,c.touch_version,b.revision FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=? AND b.id=?").bind(input.source_card_id).bind(input.source_board_id).fetch_optional(&mut *tx).await?.ok_or_else(error::missing)?;
    if source.2 != input.expected_touch_version || source.3 != input.expected_revision {
        return Err(error::conflict());
    }
    let checklist: Vec<Item> = sqlx::query_as(
        "SELECT title,position FROM checklist_items WHERE card_id=? ORDER BY position,id LIMIT 101",
    )
    .bind(input.source_card_id)
    .fetch_all(&mut *tx)
    .await?;
    content(&input.name, &source.0, &source.1, &checklist)?;
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM (SELECT id FROM task_templates WHERE owner_id=? LIMIT 101)",
    )
    .bind(a.user.id)
    .fetch_one(&mut *tx)
    .await?;
    if count >= MAX_TEMPLATES {
        return Err(error::Error(
            StatusCode::BAD_REQUEST,
            "template_limit",
            "最多保存100个模板",
        ));
    }
    let id =
        sqlx::query("INSERT INTO task_templates(owner_id,name,title,description) VALUES(?,?,?,?)")
            .bind(a.user.id)
            .bind(input.name.trim())
            .bind(source.0.trim())
            .bind(source.1)
            .execute(&mut *tx)
            .await?
            .last_insert_rowid();
    items(&mut tx, id, &checklist).await?;
    let result = load(&mut tx, &a, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(result)))
}
pub async fn list(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
) -> Result<Json<Vec<Summary>>> {
    let mut tx = s.pool.begin().await?;
    boards::active(&mut tx, &a).await?;
    let result = sqlx::query_as(
        "SELECT id,name,revision FROM task_templates WHERE owner_id=? ORDER BY id LIMIT 100",
    )
    .bind(a.user.id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(result))
}
pub async fn get(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(id): Path<i64>,
) -> Result<Json<Template>> {
    let mut tx = s.pool.begin().await?;
    let result = load(&mut tx, &a, id).await?;
    tx.commit().await?;
    Ok(Json(result))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditItem {
    title: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Edit {
    expected_revision: i64,
    name: String,
    title: String,
    description: String,
    checklist: Vec<EditItem>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Delete {
    expected_revision: i64,
}
pub async fn update(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<Edit>,
) -> Result<Json<Template>> {
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    write_auth(&mut tx, &a, &s, &headers).await?;
    let old = load(&mut tx, &a, id).await?;
    if old.revision != input.expected_revision {
        return Err(error::conflict());
    }
    let checklist: Vec<Item> = input
        .checklist
        .into_iter()
        .enumerate()
        .map(|(i, v)| Item {
            title: v.title,
            position: i as i64,
        })
        .collect();
    content(&input.name, &input.title, &input.description, &checklist)?;
    sqlx::query("UPDATE task_templates SET name=?,title=?,description=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=?").bind(input.name.trim()).bind(input.title.trim()).bind(input.description).bind(id).bind(a.user.id).bind(input.expected_revision).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM task_template_items WHERE template_id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    items(&mut tx, id, &checklist).await?;
    let result = load(&mut tx, &a, id).await?;
    tx.commit().await?;
    Ok(Json(result))
}
pub async fn delete(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(input): Json<Delete>,
) -> Result<StatusCode> {
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    write_auth(&mut tx, &a, &s, &headers).await?;
    let old = load(&mut tx, &a, id).await?;
    if old.revision != input.expected_revision {
        return Err(error::conflict());
    }
    sqlx::query("DELETE FROM task_templates WHERE id=? AND owner_id=? AND revision=?")
        .bind(id)
        .bind(a.user.id)
        .bind(input.expected_revision)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
