use crate::{
    AppState,
    auth::{Actor, now},
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
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
    skipped: bool,
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
pub(crate) async fn active(tx: &mut Transaction<'_, Sqlite>, a: &Actor) -> Result<()> {
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
    let cards=sqlx::query_as("SELECT c.id,c.list_id,c.title,c.description,c.position,c.archived,c.completed,c.skipped,c.schedule,c.series_id,c.predecessor_id,c.occurrence_no,c.anchor_schedule,c.touch_version,c.assignee_id,c.due_date FROM cards c JOIN lists l ON c.list_id=l.id WHERE l.board_id=? ORDER BY c.position,c.id").bind(id).fetch_all(&mut **tx).await?;
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
pub(crate) fn title_valid(title: &str) -> Result<()> {
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
// Keep strictness local to this new action: deny_unknown_fields on Mutation or
// Action would change legacy actions and is incompatible with the flattened envelope.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardFromTemplate {
    list_id: i64,
    template_id: i64,
    expected_template_revision: i64,
    #[serde(default)]
    ack_shared_content: bool,
    #[serde(default)]
    schedule: Option<crate::schedule::Schedule>,
}

/// Strict newtype keeps legacy flattened mutation actions backwards compatible.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardsBulk {
    selected: Vec<BulkSelected>,
    changes: BulkChanges,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BulkSelected {
    id: i64,
    touch_version: i64,
}
// Empty struct variants enforce deny_unknown_fields; unit variants ignore extras.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum BulkSet<T> {
    Keep {},
    Set { value: T },
}
impl<T> Default for BulkSet<T> {
    fn default() -> Self {
        Self::Keep {}
    }
}
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum BulkSchedule {
    Keep {},
    Set {
        value: Box<crate::schedule::Schedule>,
    },
    Clear {},
}
impl Default for BulkSchedule {
    fn default() -> Self {
        Self::Keep {}
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BulkChanges {
    #[serde(default)]
    target_list: BulkSet<i64>,
    #[serde(default)]
    schedule: BulkSchedule,
    #[serde(default)]
    completed: BulkSet<bool>,
    #[serde(default)]
    archived: BulkSet<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListRemove {
    preview: ListRemovePreview,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardSkip {
    card_id: i64,
    preview: SkipPreview,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardUnskip {
    card_id: i64,
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Action {
    ListRemove(ListRemove),
    CardSkip(CardSkip),
    CardUnskip(CardUnskip),
    CardsBulk(CardsBulk),
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
    CardFromTemplate(CardFromTemplate),
    CardCreate {
        list_id: i64,
        title: String,
        #[serde(default)]
        description: String,
        #[serde(default)]
        schedule: Option<crate::schedule::Schedule>,
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
    headers: HeaderMap,
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
        Action::ListRemove(ListRemove { preview }) => {
            let current =
                prepare_list_remove(&mut tx, id, preview.source_list_id, preview.target_list_id)
                    .await?;
            if current != preview {
                return Err(error::conflict());
            }
            let mut position: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position),-1)+1 FROM cards WHERE list_id=?",
            )
            .bind(preview.target_list_id)
            .fetch_one(&mut *tx)
            .await?;
            for card in &current.cards {
                sqlx::query("UPDATE cards SET list_id=?,position=? WHERE id=?")
                    .bind(current.target_list_id)
                    .bind(position)
                    .bind(card.id)
                    .execute(&mut *tx)
                    .await?;
                position += 1;
            }
            // Never cascade: verify the shell is empty before deleting only the list.
            let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM cards WHERE list_id=?")
                .bind(current.source_list_id)
                .fetch_one(&mut *tx)
                .await?;
            if remaining != 0 {
                return Err(error::conflict());
            }
            sqlx::query("DELETE FROM lists WHERE id=? AND board_id=?")
                .bind(current.source_list_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            let lists: Vec<i64> =
                sqlx::query_scalar("SELECT id FROM lists WHERE board_id=? ORDER BY position,id")
                    .bind(id)
                    .fetch_all(&mut *tx)
                    .await?;
            for (pos, list) in lists.iter().enumerate() {
                sqlx::query("UPDATE lists SET position=? WHERE id=?")
                    .bind(pos as i64)
                    .bind(list)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        Action::CardSkip(CardSkip { card_id, preview }) => {
            let card = require_card(&mut tx, id, card_id).await?;
            let instant = now();
            let current = prepare_skip(&mut tx, id, &card, instant).await?;
            if serde_json::to_value(&current).map_err(|_| error::invalid())?
                != serde_json::to_value(&preview).map_err(|_| error::invalid())?
            {
                return Err(error::conflict());
            }
            transition_card(&mut tx, &card, false, true, instant).await?;
        }
        Action::CardUnskip(CardUnskip { card_id }) => {
            let card = require_card(&mut tx, id, card_id).await?;
            if !card.skipped {
                return Err(error::invalid());
            }
            transition_card(&mut tx, &card, false, false, now()).await?;
        }
        Action::CardsBulk(input) => {
            crate::templates::write_auth(&mut tx, &a, &s, &headers).await?;
            cards_bulk(&mut tx, id, input).await?;
        }
        Action::CardSchedule { card_id, schedule } => {
            let card = require_card(&mut tx, id, card_id).await?;
            if card.completed || card.skipped {
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
                if card.completed || card.skipped {
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
        Action::CardFromTemplate(CardFromTemplate {
            list_id,
            template_id,
            expected_template_revision,
            ack_shared_content,
            schedule,
        }) => {
            crate::templates::write_auth(&mut tx, &a, &s, &headers).await?;
            require_list(&mut tx, id, list_id).await?;
            let template = crate::templates::load(&mut tx, &a, template_id).await?;
            if template.revision != expected_template_revision {
                return Err(error::conflict());
            }
            if !private && !ack_shared_content {
                return Err(error::Error(
                    StatusCode::BAD_REQUEST,
                    "shared_content_ack_required",
                    "请确认模板内容将对目标看板成员可见",
                ));
            }
            let position: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position),-1)+1 FROM cards WHERE list_id=?",
            )
            .bind(list_id)
            .fetch_one(&mut *tx)
            .await?;
            if let Some(s) = &schedule {
                s.validate()?;
            }
            let series = schedule
                .as_ref()
                .filter(|s| s.repeat.is_some())
                .map(|_| uuid::Uuid::new_v4().to_string());
            let card_id = next_card_id(&mut tx).await?;
            sqlx::query(
                "INSERT INTO cards(id,list_id,title,description,position,schedule,due_date,series_id,anchor_schedule,occurrence_no) VALUES(?,?,?,?,?,?,?,?,?,1)",
            )
            .bind(card_id)
            .bind(list_id)
            .bind(template.title)
            .bind(template.description)
            .bind(position)
            .bind(schedule.as_ref().map(sqlx::types::Json))
            .bind(schedule.as_ref().map(|s| &s.start_date))
            .bind(series)
            .bind(schedule.as_ref().map(sqlx::types::Json))
            .execute(&mut *tx)
            .await?;
            for item in template.checklist {
                let item_id: i64 = sqlx::query_scalar("UPDATE checklist_identity SET last_id=last_id+1 WHERE singleton=1 RETURNING last_id").fetch_one(&mut *tx).await?;
                sqlx::query("INSERT INTO checklist_items(id,card_id,title,position,checked) VALUES(?,?,?,?,0)").bind(item_id).bind(card_id).bind(item.title).bind(item.position).execute(&mut *tx).await?;
            }
            // Checklist insert triggers count edits; creation-time inheritance is not processing.
            sqlx::query("UPDATE cards SET touch_version=0 WHERE id=?")
                .bind(card_id)
                .execute(&mut *tx)
                .await?;
        }
        Action::CardCreate {
            list_id,
            title,
            description,
            schedule,
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
            if let Some(s) = &schedule {
                s.validate()?;
            }
            let series = schedule
                .as_ref()
                .filter(|s| s.repeat.is_some())
                .map(|_| uuid::Uuid::new_v4().to_string());
            let new_id = next_card_id(&mut tx).await?;
            sqlx::query(
                "INSERT INTO cards(id,list_id,title,description,position,schedule,due_date,series_id,anchor_schedule,occurrence_no) VALUES(?,?,?,?,?,?,?,?,?,1)",
            )
            .bind(new_id)
            .bind(list_id)
            .bind(title.trim())
            .bind(description)
            .bind(position)
            .bind(schedule.as_ref().map(sqlx::types::Json))
            .bind(schedule.as_ref().map(|s| &s.start_date))
            .bind(series)
            .bind(schedule.as_ref().map(sqlx::types::Json))
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

pub(crate) fn description_valid(s: &str) -> Result<()> {
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
    sqlx::query_as("SELECT c.id,c.list_id,c.title,c.description,c.position,c.archived,c.completed,c.skipped,c.schedule,c.series_id,c.predecessor_id,c.occurrence_no,c.anchor_schedule,c.touch_version,c.assignee_id,c.due_date FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=? AND l.board_id=?").bind(card).bind(board).fetch_optional(&mut **tx).await?.ok_or_else(error::missing)
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
    if card.skipped {
        return Err(error::invalid());
    }
    transition_card(tx, card, completed, false, now()).await
}
async fn transition_card(
    tx: &mut Transaction<'_, Sqlite>,
    card: &Card,
    completed: bool,
    skipped: bool,
    instant: i64,
) -> Result<()> {
    if card.completed == completed && card.skipped == skipped {
        return Ok(());
    }
    let board: i64 = sqlx::query_scalar("SELECT board_id FROM lists WHERE id=?")
        .bind(card.list_id)
        .fetch_one(&mut **tx)
        .await?;
    chain_ids(tx, board, card.id).await?;
    if completed && card.archived {
        return Err(error::Error(
            StatusCode::BAD_REQUEST,
            "archived_completion",
            "请先恢复卡片，再完成此任务",
        ));
    }
    if !completed && !skipped {
        let successor: Option<(i64, i64)> =
            sqlx::query_as("SELECT id,CASE WHEN completed=1 OR skipped=1 OR archived=1 THEN -1 ELSE touch_version END FROM cards WHERE predecessor_id=?")
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
        let local = chrono::DateTime::from_timestamp(instant, 0)
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
    sqlx::query("UPDATE cards SET completed=?,skipped=? WHERE id=?")
        .bind(completed)
        .bind(skipped)
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

async fn cards_bulk(tx: &mut Transaction<'_, Sqlite>, board: i64, input: CardsBulk) -> Result<()> {
    use std::collections::{BTreeSet, HashSet};
    let changes = input.changes;
    if input.selected.is_empty()
        || input.selected.len() > 100
        || (matches!(changes.target_list, BulkSet::Keep {})
            && matches!(changes.schedule, BulkSchedule::Keep {})
            && matches!(changes.completed, BulkSet::Keep {})
            && matches!(changes.archived, BulkSet::Keep {}))
    {
        return Err(error::invalid());
    }
    let mut ids = HashSet::new();
    let mut cards = Vec::with_capacity(input.selected.len());
    for selected in input.selected {
        if selected.id <= 0 || selected.touch_version < 0 || !ids.insert(selected.id) {
            return Err(error::invalid());
        }
        let card = require_card(tx, board, selected.id).await?;
        if card.touch_version != selected.touch_version {
            return Err(error::conflict());
        }
        cards.push(card);
    }
    if let BulkSet::Set { value } = changes.target_list {
        require_list(tx, board, value).await?;
    }
    if let BulkSchedule::Set { value } = &changes.schedule {
        value.validate()?;
        if value.repeat.is_some() {
            return Err(error::invalid());
        }
    }
    // Validate every original before any write or successor withdrawal.
    for card in &cards {
        if card.skipped && !matches!(changes.completed, BulkSet::Keep {}) {
            return Err(error::invalid());
        }
        if !matches!(changes.schedule, BulkSchedule::Keep {})
            && (card.completed
                || card.skipped
                || card.series_id.is_some()
                || card.schedule.as_ref().is_some_and(|s| s.repeat.is_some()))
        {
            return Err(error::Error(
                StatusCode::BAD_REQUEST,
                "bulk_schedule_state",
                "批量日期仅支持未完成的非重复任务",
            ));
        }
        if matches!(changes.completed, BulkSet::Set { value: true }) && card.archived {
            return Err(error::Error(
                StatusCode::BAD_REQUEST,
                "archived_completion",
                "请先恢复卡片，再完成此任务",
            ));
        }
        if matches!(changes.completed, BulkSet::Set { value: false }) && card.completed {
            let child: Option<(i64, i64)> =
                sqlx::query_as("SELECT id,CASE WHEN completed=1 OR skipped=1 OR archived=1 THEN -1 ELSE touch_version END FROM cards WHERE predecessor_id=?")
                    .bind(card.id)
                    .fetch_optional(&mut **tx)
                    .await?;
            if let Some((id, touch)) = child {
                if ids.contains(&id) {
                    return Err(error::Error(
                        StatusCode::CONFLICT,
                        "bulk_successor_selected",
                        "不能同时撤销前后两次任务",
                    ));
                }
                if touch != 0 {
                    return Err(error::Error(
                        StatusCode::CONFLICT,
                        "successor_touched",
                        "下一次任务已有修改，不能撤销完成",
                    ));
                }
                let data: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM comments WHERE card_id=?) OR EXISTS(SELECT 1 FROM attachments WHERE card_id=?) OR EXISTS(SELECT 1 FROM cards WHERE predecessor_id=?)")
                    .bind(id).bind(id).bind(id).fetch_one(&mut **tx).await?;
                if data {
                    return Err(error::conflict());
                }
            }
        }
    }
    let list_positions: Vec<(i64, i64)> =
        sqlx::query_as("SELECT id,position FROM lists WHERE board_id=?")
            .bind(board)
            .fetch_all(&mut **tx)
            .await?;
    cards.sort_by_key(|c| {
        (
            list_positions
                .iter()
                .find(|l| l.0 == c.list_id)
                .map(|l| l.1)
                .unwrap_or(0),
            c.position,
            c.id,
        )
    });
    if let BulkSet::Set { value: target } = changes.target_list {
        let moving: Vec<_> = cards.iter().filter(|c| c.list_id != target).collect();
        if !moving.is_empty() {
            let mut relevant = BTreeSet::new();
            let mut position: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position),-1)+1 FROM cards WHERE list_id=?",
            )
            .bind(target)
            .fetch_one(&mut **tx)
            .await?;
            relevant.insert(target);
            for card in moving {
                relevant.insert(card.list_id);
                sqlx::query("UPDATE cards SET list_id=?,position=? WHERE id=?")
                    .bind(target)
                    .bind(position)
                    .bind(card.id)
                    .execute(&mut **tx)
                    .await?;
                position += 1;
            }
            // Include archived originals; keep every list's physical order stable.
            for list in relevant {
                let ordered: Vec<i64> =
                    sqlx::query_scalar("SELECT id FROM cards WHERE list_id=? ORDER BY position,id")
                        .bind(list)
                        .fetch_all(&mut **tx)
                        .await?;
                for (pos, id) in ordered.into_iter().enumerate() {
                    sqlx::query("UPDATE cards SET position=? WHERE id=? AND position<>?")
                        .bind(pos as i64)
                        .bind(id)
                        .bind(pos as i64)
                        .execute(&mut **tx)
                        .await?;
                }
            }
        }
    }
    for card in &cards {
        if !matches!(changes.schedule, BulkSchedule::Keep {}) {
            let schedule = match &changes.schedule {
                BulkSchedule::Set { value } => Some(value.as_ref()),
                _ => None,
            };
            // Compare canonical JSON, not serialized optional-field spelling.
            let old = card
                .schedule
                .as_ref()
                .map(|v| serde_json::to_value(&v.0))
                .transpose()
                .map_err(|_| error::invalid())?;
            let new = schedule
                .map(serde_json::to_value)
                .transpose()
                .map_err(|_| error::invalid())?;
            if old != new || card.due_date.as_deref() != schedule.map(|s| s.start_date.as_str()) {
                sqlx::query("UPDATE cards SET schedule=?,due_date=? WHERE id=?")
                    .bind(schedule.map(sqlx::types::Json))
                    .bind(schedule.map(|s| &s.start_date))
                    .bind(card.id)
                    .execute(&mut **tx)
                    .await?;
            }
        }
    }
    if let BulkSet::Set { value } = changes.completed {
        for card in &cards {
            // Re-read after move/date writes: successors inherit the final target and schedule.
            let current = require_card(tx, board, card.id).await?;
            complete_card(tx, &current, value).await?;
        }
    }
    if let BulkSet::Set { value } = changes.archived {
        for card in &cards {
            sqlx::query("UPDATE cards SET archived=? WHERE id=? AND archived<>?")
                .bind(value)
                .bind(card.id)
                .bind(value)
                .execute(&mut **tx)
                .await?;
        }
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkipPreview {
    card_id: i64,
    revision: i64,
    touch_version: i64,
    next_schedule: Option<crate::schedule::Schedule>,
}
async fn prepare_skip(
    tx: &mut Transaction<'_, Sqlite>,
    board: i64,
    card: &Card,
    instant: i64,
) -> Result<SkipPreview> {
    if card.completed
        || card.skipped
        || card.archived
        || card.schedule.as_ref().is_none_or(|s| s.repeat.is_none())
    {
        return Err(error::invalid());
    }
    chain_ids(tx, board, card.id).await?;
    let child: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM cards WHERE predecessor_id=?)")
            .bind(card.id)
            .fetch_one(&mut **tx)
            .await?;
    if child {
        return Err(error::conflict());
    }
    let s = card.schedule.as_ref().ok_or_else(error::invalid)?;
    let local = chrono::DateTime::from_timestamp(instant, 0)
        .ok_or_else(error::invalid)?
        .naive_utc()
        + chrono::Duration::hours(8);
    let next_schedule = crate::schedule::next(
        s,
        card.anchor_schedule.as_ref().unwrap_or(s),
        local,
        card.occurrence_no as u32,
    )?;
    let revision = sqlx::query_scalar("SELECT revision FROM boards WHERE id=?")
        .bind(board)
        .fetch_one(&mut **tx)
        .await?;
    Ok(SkipPreview {
        card_id: card.id,
        revision,
        touch_version: card.touch_version,
        next_schedule,
    })
}
pub async fn skip_preview(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((board, card)): Path<(i64, i64)>,
) -> Result<Json<SkipPreview>> {
    let mut tx = s.pool.begin().await?;
    role(&mut tx, &a, board).await?;
    let card = require_card(&mut tx, board, card).await?;
    let result = prepare_skip(&mut tx, board, &card, now()).await?;
    tx.commit().await?;
    Ok(Json(result))
}

fn invalid_chain() -> error::Error {
    error::Error(
        StatusCode::CONFLICT,
        "invalid_recurrence_chain",
        "重复链归属或结构异常；不会移动或删除任何任务",
    )
}
/// Conservative closure includes series collisions; no foreign content leaves this function.
async fn chain_ids(tx: &mut Transaction<'_, Sqlite>, board: i64, card: i64) -> Result<Vec<i64>> {
    let nodes: Vec<(i64,i64,Option<i64>)> = sqlx::query_as("WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT c.id FROM cards c JOIN cards prior ON c.predecessor_id=prior.id OR prior.predecessor_id=c.id OR (c.series_id IS NOT NULL AND c.series_id=prior.series_id) JOIN chain ON chain.id=prior.id) SELECT c.id,l.board_id,c.predecessor_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN chain ON chain.id=c.id ORDER BY c.id").bind(card).fetch_all(&mut **tx).await?;
    let mut connected = std::collections::HashSet::from([card]);
    loop {
        let old = connected.len();
        for (id, _, parent) in &nodes {
            if parent.is_some_and(|v| connected.contains(&v)) {
                connected.insert(*id);
            }
            if connected.contains(id)
                && let Some(parent) = parent
            {
                connected.insert(*parent);
            }
        }
        if old == connected.len() {
            break;
        }
    }
    for (id, owner, _) in &nodes {
        if *owner != board || !connected.contains(id) {
            return Err(invalid_chain());
        }
        let mut ancestors = std::collections::HashSet::new();
        let mut current = Some(*id);
        while let Some(id) = current {
            if !ancestors.insert(id) {
                return Err(invalid_chain());
            }
            current = nodes
                .iter()
                .find(|n| n.0 == id)
                .ok_or_else(invalid_chain)?
                .2;
        }
    }
    Ok(nodes.into_iter().map(|n| n.0).collect())
}
pub async fn history(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((board, card)): Path<(i64, i64)>,
) -> Result<Json<serde_json::Value>> {
    let mut tx = s.pool.begin().await?;
    role(&mut tx, &a, board).await?;
    require_card(&mut tx, board, card).await?;
    let ids = chain_ids(&mut tx, board, card).await?;
    let mut cards = Vec::new();
    for id in ids {
        cards.push(require_card(&mut tx, board, id).await?);
    }
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM boards WHERE id=?")
        .bind(board)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(
        serde_json::json!({"board_id":board,"revision":revision,"cards":cards}),
    ))
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RemovalCard {
    id: i64,
    touch_version: i64,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ListRemovePreview {
    board_id: i64,
    source_list_id: i64,
    target_list_id: i64,
    revision: i64,
    cards: Vec<RemovalCard>,
    task_count: i64,
    incomplete_count: i64,
    completed_count: i64,
    skipped_count: i64,
    archived_count: i64,
    comment_count: i64,
    checklist_count: i64,
    attachment_count: i64,
    pending_upload_count: i64,
    verifying_upload_count: i64,
    attachment_fingerprint: String,
}
async fn prepare_list_remove(
    tx: &mut Transaction<'_, Sqlite>,
    board: i64,
    source: i64,
    target: i64,
) -> Result<ListRemovePreview> {
    require_list(tx, board, source).await?;
    require_list(tx, board, target).await?;
    let protected:bool=sqlx::query_scalar("SELECT inbox_default=1 OR (SELECT inbox_owner_id IS NOT NULL FROM boards WHERE id=board_id) OR (SELECT COUNT(*) FROM lists WHERE board_id=?)<=1 FROM lists WHERE id=?").bind(board).bind(source).fetch_one(&mut **tx).await?;
    if protected || source == target {
        return Err(error::invalid());
    }
    let rows:Vec<(i64,i64,bool,bool,bool)>=sqlx::query_as("SELECT id,touch_version,completed,skipped,archived FROM cards WHERE list_id=? ORDER BY position,id").bind(source).fetch_all(&mut **tx).await?;
    let mut verified = std::collections::HashSet::new();
    let mut cards = Vec::new();
    let (mut completed_count, mut skipped_count, mut archived_count) = (0, 0, 0);
    for (id, touch, completed, skipped, archived) in rows {
        if !verified.contains(&id) {
            verified.extend(chain_ids(tx, board, id).await?);
        }
        completed_count += i64::from(completed);
        skipped_count += i64::from(skipped);
        archived_count += i64::from(archived);
        cards.push(RemovalCard {
            id,
            touch_version: touch,
        });
    }
    let (comment_count,checklist_count,attachment_count,pending_upload_count,verifying_upload_count):(i64,i64,i64,i64,i64)=sqlx::query_as("SELECT (SELECT COUNT(*) FROM comments WHERE card_id IN (SELECT id FROM cards WHERE list_id=?1)),(SELECT COUNT(*) FROM checklist_items WHERE card_id IN (SELECT id FROM cards WHERE list_id=?1)),(SELECT COUNT(*) FROM attachments WHERE card_id IN (SELECT id FROM cards WHERE list_id=?1)),(SELECT COUNT(*) FROM attachments WHERE card_id IN (SELECT id FROM cards WHERE list_id=?1) AND state='pending'),(SELECT COUNT(*) FROM attachments WHERE card_id IN (SELECT id FROM cards WHERE list_id=?1) AND state='verifying')").bind(source).fetch_one(&mut **tx).await?;
    if pending_upload_count > 0 || verifying_upload_count > 0 {
        return Err(error::Error(
            StatusCode::CONFLICT,
            "attachment_processing",
            "附件处理中，请完成后重新预览",
        ));
    }
    // Include target attachment metadata too: background transitions do not bump board revision.
    let metadata:Vec<String>=sqlx::query_scalar("SELECT json_object('id',a.id,'card_id',a.card_id,'filename',a.filename,'size',a.size,'mime',a.mime,'state',a.state,'staging',a.staging,'final_key',a.final_key,'expires_at',a.expires_at,'created_at',a.created_at) FROM attachments a JOIN cards c ON c.id=a.card_id WHERE c.list_id IN (?,?) ORDER BY a.id").bind(source).bind(target).fetch_all(&mut **tx).await?;
    use sha2::{Digest, Sha256};
    let attachment_fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&metadata).map_err(|_| error::invalid())?)
    );
    let revision = sqlx::query_scalar("SELECT revision FROM boards WHERE id=?")
        .bind(board)
        .fetch_one(&mut **tx)
        .await?;
    let task_count = cards.len() as i64;
    Ok(ListRemovePreview {
        board_id: board,
        source_list_id: source,
        target_list_id: target,
        revision,
        cards,
        task_count,
        incomplete_count: task_count - completed_count - skipped_count,
        completed_count,
        skipped_count,
        archived_count,
        comment_count,
        checklist_count,
        attachment_count,
        pending_upload_count,
        verifying_upload_count,
        attachment_fingerprint,
    })
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemovalTarget {
    target_list_id: i64,
}
pub async fn list_remove_preview(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path((board, list)): Path<(i64, i64)>,
    axum::extract::Query(target): axum::extract::Query<RemovalTarget>,
) -> Result<Json<ListRemovePreview>> {
    let mut tx = s.pool.begin().await?;
    role(&mut tx, &a, board).await?;
    let preview = prepare_list_remove(&mut tx, board, list, target.target_list_id).await?;
    tx.commit().await?;
    Ok(Json(preview))
}
