use crate::{
    AppState,
    auth::{Actor, now},
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, Transaction};
#[derive(Serialize, FromRow)]
pub struct Board {
    id: i64,
    title: String,
    revision: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    inbox_owner_id: Option<i64>,
}
#[derive(Serialize, FromRow)]
pub struct List {
    id: i64,
    board_id: i64,
    title: String,
    position: i64,
}
#[derive(Serialize, FromRow)]
pub struct Card {
    id: i64,
    list_id: i64,
    title: String,
    description: String,
    position: i64,
    archived: bool,
    completed: bool,
    schedule: Option<sqlx::types::Json<crate::schedule::Schedule>>,
    series_id: Option<String>,
    predecessor_id: Option<i64>,
    occurrence_no: i64,
    anchor_schedule: Option<sqlx::types::Json<crate::schedule::Schedule>>,
    touch_version: i64,
    assignee_id: Option<i64>,
    due_date: Option<String>,
}
#[derive(Serialize, FromRow)]
pub struct Comment {
    id: i64,
    card_id: i64,
    author_id: i64,
    author: String,
    body: String,
    created_at: i64,
}
#[derive(Serialize, FromRow)]
pub struct ChecklistItem {
    id: i64,
    card_id: i64,
    title: String,
    checked: bool,
    position: i64,
}
#[derive(Serialize, FromRow)]
pub struct Member {
    user_id: i64,
    username: String,
    role: String,
    active: bool,
}
#[derive(Serialize)]
pub struct Snapshot {
    #[serde(flatten)]
    board: Board,
    role: String,
    lists: Vec<List>,
    cards: Vec<Card>,
    members: Vec<Member>,
    checklist: Vec<ChecklistItem>,
    comments: Vec<Comment>,
}
async fn active(tx: &mut Transaction<'_, Sqlite>, a: &Actor) -> Result<()> {
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.id=? AND u.active=1 AND s.expires_at>?)").bind(&a.session).bind(a.user.id).bind(now()).fetch_one(&mut **tx).await?;
    if !exists {
        return Err(error::unauthorized());
    }
    Ok(())
}
pub(crate) async fn role(tx: &mut Transaction<'_, Sqlite>, a: &Actor, id: i64) -> Result<String> {
    active(tx, a).await?;
    sqlx::query_scalar("SELECT m.role FROM board_members m JOIN boards b ON b.id=m.board_id WHERE m.board_id=? AND m.user_id=? AND (b.inbox_owner_id IS NULL OR b.inbox_owner_id=m.user_id)")
        .bind(id)
        .bind(a.user.id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(error::missing)
}
pub(crate) async fn snapshot(
    tx: &mut Transaction<'_, Sqlite>,
    a: &Actor,
    id: i64,
) -> Result<Snapshot> {
    let role = role(tx, a, id).await?;
    let board = sqlx::query_as("SELECT id,title,revision,inbox_owner_id FROM boards WHERE id=?")
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    let lists = sqlx::query_as(
        "SELECT id,board_id,title,position FROM lists WHERE board_id=? ORDER BY position,id",
    )
    .bind(id)
    .fetch_all(&mut **tx)
    .await?;
    let cards=sqlx::query_as("SELECT c.id,c.list_id,c.title,c.description,c.position,c.archived,c.completed,c.schedule,c.series_id,c.predecessor_id,c.occurrence_no,c.anchor_schedule,c.touch_version,c.assignee_id,c.due_date FROM cards c JOIN lists l ON c.list_id=l.id WHERE l.board_id=? ORDER BY c.position,c.id").bind(id).fetch_all(&mut **tx).await?;
    let members=sqlx::query_as("SELECT m.user_id,u.username,m.role,u.active FROM board_members m JOIN users u ON u.id=m.user_id WHERE m.board_id=? ORDER BY m.user_id").bind(id).fetch_all(&mut **tx).await?;
    let checklist=sqlx::query_as("SELECT i.id,i.card_id,i.title,i.checked,i.position FROM checklist_items i JOIN cards c ON c.id=i.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=? ORDER BY i.card_id,i.position,i.id").bind(id).fetch_all(&mut **tx).await?;
    let comments=sqlx::query_as("SELECT n.id,n.card_id,n.author_id,u.username AS author,n.body,n.created_at FROM comments n JOIN users u ON u.id=n.author_id JOIN cards c ON c.id=n.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=? ORDER BY n.created_at,n.id").bind(id).fetch_all(&mut **tx).await?;
    Ok(Snapshot {
        board,
        role,
        lists,
        cards,
        members,
        checklist,
        comments,
    })
}
pub async fn list(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
) -> Result<Json<Vec<Board>>> {
    Ok(Json(sqlx::query_as("SELECT b.id,b.title,b.revision,b.inbox_owner_id FROM boards b JOIN board_members m ON m.board_id=b.id WHERE m.user_id=? AND b.inbox_owner_id IS NULL ORDER BY b.id").bind(a.user.id).fetch_all(&s.pool).await?))
}
#[derive(Deserialize)]
pub struct Title {
    title: String,
}
fn title_valid(title: &str) -> Result<()> {
    if title.trim().is_empty() || title.len() > 500 {
        Err(error::invalid())
    } else {
        Ok(())
    }
}
pub async fn create(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Json(input): Json<Title>,
) -> Result<(StatusCode, Json<Snapshot>)> {
    title_valid(&input.title)?;
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    active(&mut tx, &a).await?;
    let id = sqlx::query("INSERT INTO boards(title) VALUES(?)")
        .bind(input.title.trim())
        .execute(&mut *tx)
        .await?
        .last_insert_rowid();
    sqlx::query("INSERT INTO board_members(board_id,user_id,role) VALUES(?,?,'admin')")
        .bind(id)
        .bind(a.user.id)
        .execute(&mut *tx)
        .await?;
    let result = snapshot(&mut tx, &a, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(result)))
}
pub async fn get(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(id): Path<i64>,
) -> Result<Json<Snapshot>> {
    let mut tx = s.pool.begin().await?;
    let result = snapshot(&mut tx, &a, id).await?;
    tx.commit().await?;
    Ok(Json(result))
}
#[derive(Deserialize)]
pub struct Mutation {
    expected_revision: i64,
    #[serde(flatten)]
    action: Action,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Action {
    CardSchedule {
        card_id: i64,
        schedule: Option<crate::schedule::Schedule>,
    },
    CardComplete {
        card_id: i64,
        completed: bool,
    },
    ListArchiveCompleted {
        list_id: i64,
    },
    CommentCreate {
        card_id: i64,
        body: String,
    },
    CommentDelete {
        card_id: i64,
        comment_id: i64,
    },
    CardDetails {
        card_id: i64,
        assignee_id: Option<i64>,
        due_date: Option<String>,
    },
    ChecklistCreate {
        card_id: i64,
        title: String,
    },
    ChecklistUpdate {
        card_id: i64,
        item_id: i64,
        title: String,
        checked: bool,
    },
    ChecklistDelete {
        card_id: i64,
        item_id: i64,
    },
    ChecklistMove {
        card_id: i64,
        item_id: i64,
        index: usize,
    },
    MemberSet {
        username: String,
        role: String,
    },
    MemberRemove {
        user_id: i64,
    },
    ListCreate {
        title: String,
    },
    ListUpdate {
        list_id: i64,
        title: String,
    },
    ListMove {
        list_id: i64,
        index: usize,
    },
    CardCreate {
        list_id: i64,
        title: String,
        #[serde(default)]
        description: String,
    },
    CardUpdate {
        card_id: i64,
        title: String,
        description: String,
        archived: bool,
    },
    CardMove {
        card_id: i64,
        target_list_id: i64,
        index: usize,
    },
}
pub async fn mutate(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(id): Path<i64>,
    Json(input): Json<Mutation>,
) -> Result<Json<Snapshot>> {
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    let r = role(&mut tx, &a, id).await?;
    let rev: i64 = sqlx::query_scalar("SELECT revision FROM boards WHERE id=?")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if rev != input.expected_revision {
        return Err(error::conflict());
    }
    let private: bool =
        sqlx::query_scalar("SELECT inbox_owner_id IS NOT NULL FROM boards WHERE id=?")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if private
        && matches!(
            &input.action,
            Action::ListCreate { .. }
                | Action::ListUpdate { .. }
                | Action::ListMove { .. }
                | Action::MemberSet { .. }
                | Action::MemberRemove { .. }
        )
    {
        return Err(error::forbidden());
    }
    match input.action {
        Action::CardSchedule { card_id, schedule } => {
            let card = require_card(&mut tx, id, card_id).await?;
            if card.completed {
                return Err(error::Error(
                    StatusCode::BAD_REQUEST,
                    "completed_schedule",
                    "请先撤销完成，再修改日期或重复规则",
                ));
            }
            if let Some(s) = &schedule {
                s.validate()?;
            }
            let series = schedule
                .as_ref()
                .filter(|s| s.repeat.is_some())
                .map(|_| uuid::Uuid::new_v4().to_string());
            sqlx::query(
                "UPDATE cards SET series_id=?,anchor_schedule=?,occurrence_no=1 WHERE id=?",
            )
            .bind(series)
            .bind(schedule.as_ref().map(sqlx::types::Json))
            .bind(card_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE cards SET schedule=?,due_date=? WHERE id=?")
                .bind(schedule.as_ref().map(sqlx::types::Json))
                .bind(schedule.as_ref().map(|s| s.start_date.clone()))
                .bind(card_id)
                .execute(&mut *tx)
                .await?;
        }
        Action::CardComplete { card_id, completed } => {
            let card = require_card(&mut tx, id, card_id).await?;
            complete_card(&mut tx, &card, completed).await?;
        }
        Action::ListArchiveCompleted { list_id } => {
            require_list(&mut tx, id, list_id).await?;
            sqlx::query(
                "UPDATE cards SET archived=1 WHERE list_id=? AND completed=1 AND archived=0",
            )
            .bind(list_id)
            .execute(&mut *tx)
            .await?;
        }
        Action::CommentCreate { card_id, body } => {
            require_card(&mut tx, id, card_id).await?;
            if body.trim().is_empty() || body.len() > 20000 {
                return Err(error::invalid());
            }
            sqlx::query("INSERT INTO comments(card_id,author_id,body,created_at) VALUES(?,?,?,?)")
                .bind(card_id)
                .bind(a.user.id)
                .bind(body.trim())
                .bind(now())
                .execute(&mut *tx)
                .await?;
        }
        Action::CommentDelete {
            card_id,
            comment_id,
        } => {
            require_card(&mut tx, id, card_id).await?;
            let author: i64 =
                sqlx::query_scalar("SELECT author_id FROM comments WHERE id=? AND card_id=?")
                    .bind(comment_id)
                    .bind(card_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(error::missing)?;
            if author != a.user.id && r != "admin" {
                return Err(error::forbidden());
            }
            sqlx::query("DELETE FROM comments WHERE id=?")
                .bind(comment_id)
                .execute(&mut *tx)
                .await?;
        }
        Action::CardDetails {
            card_id,
            assignee_id,
            due_date,
        } => {
            require_card(&mut tx, id, card_id).await?;
            if let Some(uid) = assignee_id {
                let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM board_members m JOIN users u ON u.id=m.user_id WHERE m.board_id=? AND m.user_id=? AND u.active=1)").bind(id).bind(uid).fetch_one(&mut *tx).await?;
                if !valid {
                    return Err(error::invalid());
                }
            }
            if let Some(date) = &due_date
                && !date_valid(date)
            {
                return Err(error::invalid());
            }
            let card = require_card(&mut tx, id, card_id).await?;
            // Old clients changing due_date intentionally replace a rich schedule; assignee-only saves preserve it.
            if card.due_date != due_date {
                if card.completed {
                    return Err(error::invalid());
                }
                sqlx::query("UPDATE cards SET series_id=NULL,anchor_schedule=NULL,occurrence_no=1 WHERE id=?").bind(card_id).execute(&mut *tx).await?;
                sqlx::query("UPDATE cards SET schedule=? WHERE id=?")
                    .bind(
                        due_date
                            .as_ref()
                            .map(|d| sqlx::types::Json(crate::schedule::Schedule::day(d.clone()))),
                    )
                    .bind(card_id)
                    .execute(&mut *tx)
                    .await?;
            }
            sqlx::query("UPDATE cards SET assignee_id=?,due_date=? WHERE id=?")
                .bind(assignee_id)
                .bind(due_date)
                .bind(card_id)
                .execute(&mut *tx)
                .await?;
        }
        Action::ChecklistCreate { card_id, title } => {
            require_card(&mut tx, id, card_id).await?;
            title_valid(&title)?;
            let position: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM checklist_items WHERE card_id=?")
                    .bind(card_id)
                    .fetch_one(&mut *tx)
                    .await?;
            sqlx::query("INSERT INTO checklist_items(card_id,title,position) VALUES(?,?,?)")
                .bind(card_id)
                .bind(title.trim())
                .bind(position)
                .execute(&mut *tx)
                .await?;
        }
        Action::ChecklistUpdate {
            card_id,
            item_id,
            title,
            checked,
        } => {
            require_card(&mut tx, id, card_id).await?;
            require_item(&mut tx, card_id, item_id).await?;
            title_valid(&title)?;
            sqlx::query("UPDATE checklist_items SET title=?,checked=? WHERE id=?")
                .bind(title.trim())
                .bind(checked)
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
        }
        Action::ChecklistDelete { card_id, item_id } => {
            require_card(&mut tx, id, card_id).await?;
            require_item(&mut tx, card_id, item_id).await?;
            sqlx::query("DELETE FROM checklist_items WHERE id=?")
                .bind(item_id)
                .execute(&mut *tx)
                .await?;
            reorder_items(&mut tx, card_id, None).await?;
        }
        Action::ChecklistMove {
            card_id,
            item_id,
            index,
        } => {
            require_card(&mut tx, id, card_id).await?;
            require_item(&mut tx, card_id, item_id).await?;
            let mut ids: Vec<i64> = sqlx::query_scalar(
                "SELECT id FROM checklist_items WHERE card_id=? AND id<>? ORDER BY position,id",
            )
            .bind(card_id)
            .bind(item_id)
            .fetch_all(&mut *tx)
            .await?;
            if index > ids.len() {
                return Err(error::invalid());
            }
            ids.insert(index, item_id);
            reorder_items(&mut tx, card_id, Some(ids)).await?;
        }
        Action::ListCreate { title } => {
            title_valid(&title)?;
            let position: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lists WHERE board_id=?")
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query("INSERT INTO lists(board_id,title,position) VALUES(?,?,?)")
                .bind(id)
                .bind(title.trim())
                .bind(position)
                .execute(&mut *tx)
                .await?;
        }
        Action::ListUpdate { list_id, title } => {
            title_valid(&title)?;
            require_list(&mut tx, id, list_id).await?;
            sqlx::query("UPDATE lists SET title=? WHERE id=?")
                .bind(title.trim())
                .bind(list_id)
                .execute(&mut *tx)
                .await?;
        }
        Action::CardCreate {
            list_id,
            title,
            description,
        } => {
            title_valid(&title)?;
            description_valid(&description)?;
            require_list(&mut tx, id, list_id).await?;
            let position: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position),-1)+1 FROM cards WHERE list_id=?",
            )
            .bind(list_id)
            .fetch_one(&mut *tx)
            .await?;
            let new_id = next_card_id(&mut tx).await?;
            sqlx::query(
                "INSERT INTO cards(id,list_id,title,description,position) VALUES(?,?,?,?,?)",
            )
            .bind(new_id)
            .bind(list_id)
            .bind(title.trim())
            .bind(description)
            .bind(position)
            .execute(&mut *tx)
            .await?;
        }
        Action::CardUpdate {
            card_id,
            title,
            description,
            archived,
        } => {
            title_valid(&title)?;
            description_valid(&description)?;
            require_card(&mut tx, id, card_id).await?;
            sqlx::query("UPDATE cards SET title=?,description=?,archived=? WHERE id=?")
                .bind(title.trim())
                .bind(description)
                .bind(archived)
                .bind(card_id)
                .execute(&mut *tx)
                .await?;
        }
        Action::ListMove { list_id, index } => {
            require_list(&mut tx, id, list_id).await?;
            let mut ids: Vec<i64> = sqlx::query_scalar(
                "SELECT id FROM lists WHERE board_id=? AND id<>? ORDER BY position,id",
            )
            .bind(id)
            .bind(list_id)
            .fetch_all(&mut *tx)
            .await?;
            if index > ids.len() {
                return Err(error::invalid());
            }
            ids.insert(index, list_id);
            for (position, list) in ids.into_iter().enumerate() {
                sqlx::query("UPDATE lists SET position=? WHERE board_id=? AND id=?")
                    .bind(position as i64)
                    .bind(id)
                    .bind(list)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        Action::CardMove {
            card_id,
            target_list_id,
            index,
        } => {
            let card = require_card(&mut tx, id, card_id).await?;
            require_list(&mut tx, id, target_list_id).await?;
            if card.archived {
                return Err(error::invalid());
            }
            let mut target:Vec<i64>=sqlx::query_scalar("SELECT id FROM cards WHERE list_id=? AND archived=0 AND id<>? ORDER BY position,id").bind(target_list_id).bind(card_id).fetch_all(&mut *tx).await?;
            if index > target.len() {
                return Err(error::invalid());
            }
            target.insert(index, card_id);
            sqlx::query("UPDATE cards SET list_id=? WHERE id=?")
                .bind(target_list_id)
                .bind(card_id)
                .execute(&mut *tx)
                .await?;
            if card.list_id != target_list_id {
                reorder(&mut tx, card.list_id, None).await?;
            }
            reorder(&mut tx, target_list_id, Some(target)).await?;
        }
        Action::MemberSet { username, role } => {
            if r != "admin" {
                return Err(error::forbidden());
            }
            if role != "admin" && role != "member" {
                return Err(error::invalid());
            }
            let uid: i64 = sqlx::query_scalar("SELECT id FROM users WHERE username=? AND active=1")
                .bind(username)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(error::missing)?;
            let old: Option<String> =
                sqlx::query_scalar("SELECT role FROM board_members WHERE board_id=? AND user_id=?")
                    .bind(id)
                    .bind(uid)
                    .fetch_optional(&mut *tx)
                    .await?;
            if old.as_deref() == Some("admin") && role != "admin" {
                return Err(error::forbidden());
            }
            sqlx::query("INSERT INTO board_members(board_id,user_id,role) VALUES(?,?,?) ON CONFLICT(board_id,user_id) DO UPDATE SET role=excluded.role").bind(id).bind(uid).bind(role).execute(&mut *tx).await?;
        }
        Action::MemberRemove { user_id } => {
            if r != "admin" {
                return Err(error::forbidden());
            }
            let old: String =
                sqlx::query_scalar("SELECT role FROM board_members WHERE board_id=? AND user_id=?")
                    .bind(id)
                    .bind(user_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or_else(error::missing)?;
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM board_members m JOIN users u ON u.id=m.user_id WHERE m.board_id=? AND m.role='admin' AND u.active=1 AND m.user_id<>?",
            )
            .bind(id)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
            if old == "admin" && count == 0 {
                return Err(error::conflict());
            }
            sqlx::query("UPDATE cards SET assignee_id=NULL WHERE assignee_id=? AND list_id IN (SELECT id FROM lists WHERE board_id=?)").bind(user_id).bind(id).execute(&mut *tx).await?;
            sqlx::query("DELETE FROM board_members WHERE board_id=? AND user_id=?")
                .bind(id)
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    sqlx::query("UPDATE boards SET revision=revision+1 WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    // Core scope forbids removing self, even when another admin remains; rollback the transaction.
    let remains: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM board_members WHERE board_id=? AND user_id=?)",
    )
    .bind(id)
    .bind(a.user.id)
    .fetch_one(&mut *tx)
    .await?;
    if !remains {
        return Err(error::forbidden());
    }
    let result = snapshot(&mut tx, &a, id).await?;
    tx.commit().await?;
    Ok(Json(result))
}

fn description_valid(s: &str) -> Result<()> {
    if s.len() > 20000 {
        Err(error::invalid())
    } else {
        Ok(())
    }
}
async fn require_list(tx: &mut Transaction<'_, Sqlite>, board: i64, list: i64) -> Result<()> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lists WHERE id=? AND board_id=?)")
            .bind(list)
            .bind(board)
            .fetch_one(&mut **tx)
            .await?;
    if !exists {
        return Err(error::missing());
    }
    Ok(())
}
async fn require_card(tx: &mut Transaction<'_, Sqlite>, board: i64, card: i64) -> Result<Card> {
    sqlx::query_as("SELECT c.id,c.list_id,c.title,c.description,c.position,c.archived,c.completed,c.schedule,c.series_id,c.predecessor_id,c.occurrence_no,c.anchor_schedule,c.touch_version,c.assignee_id,c.due_date FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=? AND l.board_id=?").bind(card).bind(board).fetch_optional(&mut **tx).await?.ok_or_else(error::missing)
}
async fn reorder(tx: &mut Transaction<'_, Sqlite>, list: i64, ids: Option<Vec<i64>>) -> Result<()> {
    let ids = match ids {
        Some(ids) => ids,
        None => {
            sqlx::query_scalar(
                "SELECT id FROM cards WHERE list_id=? AND archived=0 ORDER BY position,id",
            )
            .bind(list)
            .fetch_all(&mut **tx)
            .await?
        }
    };
    for (position, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE cards SET position=? WHERE id=?")
            .bind(position as i64)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}
pub async fn get_card(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((board, card)): Path<(i64, i64)>,
) -> Result<Json<Card>> {
    let mut tx = s.pool.begin().await?;
    role(&mut tx, &a, board).await?;
    let result = require_card(&mut tx, board, card).await?;
    tx.commit().await?;
    Ok(Json(result))
}

async fn require_item(tx: &mut Transaction<'_, Sqlite>, card: i64, item: i64) -> Result<()> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM checklist_items WHERE id=? AND card_id=?)")
            .bind(item)
            .bind(card)
            .fetch_one(&mut **tx)
            .await?;
    if !exists {
        return Err(error::missing());
    }
    Ok(())
}
async fn reorder_items(
    tx: &mut Transaction<'_, Sqlite>,
    card: i64,
    ids: Option<Vec<i64>>,
) -> Result<()> {
    let ids = match ids {
        Some(ids) => ids,
        None => {
            sqlx::query_scalar(
                "SELECT id FROM checklist_items WHERE card_id=? ORDER BY position,id",
            )
            .bind(card)
            .fetch_all(&mut **tx)
            .await?
        }
    };
    for (position, id) in ids.iter().enumerate() {
        sqlx::query("UPDATE checklist_items SET position=? WHERE id=?")
            .bind(position as i64)
            .bind(id)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

fn date_valid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
    {
        return false;
    }
    let y: u32 = s[0..4].parse().unwrap_or(0);
    let m: usize = s[5..7].parse().unwrap_or(0);
    let d: u32 = s[8..10].parse().unwrap_or(0);
    if y == 0 || !(1..=12).contains(&m) {
        return false;
    }
    let leap = y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400));
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    d >= 1 && d <= days[m - 1]
}

async fn complete_card(
    tx: &mut Transaction<'_, Sqlite>,
    card: &Card,
    completed: bool,
) -> Result<()> {
    if card.completed == completed {
        return Ok(());
    }
    if completed && card.archived {
        return Err(error::Error(
            StatusCode::BAD_REQUEST,
            "archived_completion",
            "请先恢复卡片，再完成此任务",
        ));
    }
    if !completed {
        let successor: Option<(i64, i64)> =
            sqlx::query_as("SELECT id,touch_version FROM cards WHERE predecessor_id=?")
                .bind(card.id)
                .fetch_optional(&mut **tx)
                .await?;
        if let Some((id, touched)) = successor {
            if touched != 0 {
                return Err(error::Error(
                    StatusCode::CONFLICT,
                    "successor_touched",
                    "下一次任务已有修改或处理，不能撤销本次完成。请保留本次完成，并在下一次任务中继续处理；不会删除任何数据。",
                ));
            }
            // Extra structural guards protect future callers even if touch tracking is changed.
            let data:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM comments WHERE card_id=?) OR EXISTS(SELECT 1 FROM attachments WHERE card_id=?) OR EXISTS(SELECT 1 FROM cards WHERE predecessor_id=?)").bind(id).bind(id).bind(id).fetch_one(&mut **tx).await?;
            if data {
                return Err(error::conflict());
            }
            sqlx::query("DELETE FROM cards WHERE id=?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
    } else if let Some(schedule) = &card.schedule {
        let local = chrono::DateTime::from_timestamp(now(), 0)
            .ok_or_else(error::invalid)?
            .naive_utc()
            + chrono::Duration::hours(8);
        let anchor = card.anchor_schedule.as_ref().unwrap_or(schedule);
        if let Some(next) =
            crate::schedule::next(schedule, anchor, local, card.occurrence_no as u32)?
        {
            let position: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position),-1)+1 FROM cards WHERE list_id=?",
            )
            .bind(card.list_id)
            .fetch_one(&mut **tx)
            .await?;
            let series = card
                .series_id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            sqlx::query("UPDATE cards SET series_id=?,anchor_schedule=? WHERE id=?")
                .bind(&series)
                .bind(anchor)
                .bind(card.id)
                .execute(&mut **tx)
                .await?;
            let new_id = next_card_id(tx).await?;
            let id=sqlx::query("INSERT INTO cards(id,list_id,title,description,position,assignee_id,due_date,schedule,series_id,predecessor_id,occurrence_no,anchor_schedule) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(new_id).bind(card.list_id).bind(&card.title).bind(&card.description).bind(position).bind(card.assignee_id).bind(&next.start_date).bind(sqlx::types::Json(&next)).bind(series).bind(card.id).bind(card.occurrence_no+1).bind(anchor).execute(&mut **tx).await?.last_insert_rowid();
            sqlx::query("INSERT INTO checklist_items(card_id,title,checked,position) SELECT ?,title,0,position FROM checklist_items WHERE card_id=? ORDER BY position,id").bind(id).bind(card.id).execute(&mut **tx).await?;
            // Creation-time inheritance is not user processing. No subsequent path resets this counter.
            sqlx::query("UPDATE cards SET touch_version=0 WHERE id=?")
                .bind(id)
                .execute(&mut **tx)
                .await?;
        }
    }
    sqlx::query("UPDATE cards SET completed=? WHERE id=?")
        .bind(completed)
        .bind(card.id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn next_card_id(tx: &mut Transaction<'_, Sqlite>) -> Result<i64> {
    Ok(sqlx::query_scalar(
        "UPDATE card_identity SET last_id=last_id+1 WHERE singleton=1 RETURNING last_id",
    )
    .fetch_one(&mut **tx)
    .await?)
}
