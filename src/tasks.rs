use crate::{
    AppState,
    auth::{Actor, now},
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite};

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filters {
    q: Option<String>,
    assignee_id: Option<i64>,
    status: Option<String>,
    from: Option<String>,
    to: Option<String>,
    view: Option<String>,
    board_id: Option<i64>,
}
#[derive(Serialize, FromRow)]
pub struct Task {
    id: i64,
    title: String,
    description: String,
    completed: bool,
    assignee_id: Option<i64>,
    assignee_name: Option<String>,
    due_date: Option<String>,
    schedule: Option<sqlx::types::Json<crate::schedule::Schedule>>,
    board_id: i64,
    board_title: String,
    list_id: i64,
    list_title: String,
    position: i64,
    list_position: i64,
}

#[derive(Serialize, FromRow)]
pub struct FilterBoard {
    id: i64,
    title: String,
    revision: i64,
}
#[derive(Serialize, FromRow)]
pub struct FilterPerson {
    id: i64,
    name: String,
}
#[derive(Serialize)]
pub struct Discovery {
    tasks: Vec<Task>,
    boards: Vec<FilterBoard>,
    people: Vec<FilterPerson>,
    inbox: Option<FilterBoard>,
}

pub async fn list(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Query(f): Query<Filters>,
) -> Result<Json<Discovery>> {
    let status = f.status.as_deref().unwrap_or("all");
    let view = f.view.as_deref().unwrap_or("all");
    if !["all", "complete", "incomplete"].contains(&status)
        || !["all", "mine", "today", "tomorrow", "next7", "upcoming"].contains(&view)
        || f.q.as_ref().is_some_and(|q| q.len() > 500)
    {
        return Err(error::invalid());
    }
    for d in [&f.from, &f.to].into_iter().flatten() {
        crate::schedule::date(d)?;
    }
    if f.from
        .as_ref()
        .zip(f.to.as_ref())
        .is_some_and(|(from, to)| from > to)
    {
        return Err(error::invalid());
    }
    let mut tx = s.pool.begin().await?;
    let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.id=? AND u.active=1 AND s.expires_at>?)").bind(&a.session).bind(a.user.id).bind(now()).fetch_one(&mut *tx).await?;
    if !active {
        return Err(error::unauthorized());
    }
    let start = "COALESCE(json_extract(c.schedule,'$.start_date'),c.due_date)";
    let end = "COALESCE(json_extract(c.schedule,'$.end_date'),json_extract(c.schedule,'$.start_date'),c.due_date)";
    let mut q = QueryBuilder::<Sqlite>::new(
        "SELECT c.id,c.title,c.description,c.completed,c.assignee_id,u.username AS assignee_name,c.due_date,c.schedule,b.id AS board_id,b.title AS board_title,l.id AS list_id,l.title AS list_title,c.position,l.position AS list_position FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id JOIN board_members m ON m.board_id=b.id LEFT JOIN users u ON u.id=c.assignee_id WHERE c.archived=0 AND m.user_id=",
    );
    q.push_bind(a.user.id);
    q.push(" AND (b.inbox_owner_id IS NULL OR b.inbox_owner_id=m.user_id)");
    if let Some(id) = f.board_id {
        q.push(" AND b.id=").push_bind(id);
    }
    if let Some(text) = f.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        q.push(" AND (instr(lower(c.title),lower(")
            .push_bind(text)
            .push("))>0 OR instr(lower(c.description),lower(")
            .push_bind(text)
            .push("))>0)");
    }
    if let Some(id) = f.assignee_id {
        q.push(" AND c.assignee_id=").push_bind(id);
    }
    if status != "all" {
        q.push(" AND c.completed=").push_bind(status == "complete");
    }
    if view == "mine" {
        q.push(" AND c.assignee_id=").push_bind(a.user.id);
    }
    if view == "today" {
        q.push(format!(" AND {start}<=date('now','+8 hours')"));
    }
    if view == "tomorrow" {
        q.push(format!(" AND {start}<=date('now','+8 hours','+1 days') AND {end}>=date('now','+8 hours','+1 days')"));
    }
    if view == "next7" {
        q.push(format!(
            " AND {start}<=date('now','+8 hours','+6 days') AND {end}>=date('now','+8 hours')"
        ));
    }
    if view == "upcoming" {
        q.push(format!(" AND c.completed=0 AND {end}>date('now','+8 hours') AND {end}<=date('now','+8 hours','+7 days')"));
    }
    if let Some(from) = f.from {
        q.push(format!(" AND {end}>=")).push_bind(from);
    }
    if let Some(to) = f.to {
        q.push(format!(" AND {start}<=")).push_bind(to);
    }
    q.push(format!(
        " ORDER BY {end} IS NULL,{end},b.id,l.position,c.position,c.id"
    ));
    let tasks = q.build_query_as().fetch_all(&mut *tx).await?;
    // Metadata uses the same authorized read snapshot, never the narrowed result set.
    let boards = sqlx::query_as("SELECT b.id,b.title,b.revision FROM boards b JOIN board_members m ON m.board_id=b.id WHERE m.user_id=? AND b.inbox_owner_id IS NULL ORDER BY b.id")
        .bind(a.user.id).fetch_all(&mut *tx).await?;
    let inbox = sqlx::query_as("SELECT id,title,revision FROM boards WHERE inbox_owner_id=?")
        .bind(a.user.id)
        .fetch_optional(&mut *tx)
        .await?;
    let people = sqlx::query_as("SELECT DISTINCT u.id,u.username AS name FROM cards c JOIN lists l ON l.id=c.list_id JOIN board_members m ON m.board_id=l.board_id JOIN boards b ON b.id=l.board_id JOIN users u ON u.id=c.assignee_id WHERE c.archived=0 AND m.user_id=? AND (b.inbox_owner_id IS NULL OR b.inbox_owner_id=m.user_id) ORDER BY u.id")
        .bind(a.user.id).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(Discovery {
        tasks,
        boards,
        people,
        inbox,
    }))
}
