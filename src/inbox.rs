use crate::{
    AppState,
    auth::Actor,
    boards,
    error::{self, Result},
};
use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Sqlite, Transaction};

/// Called only inside the account/session BEGIN IMMEDIATE transaction.
pub async fn ensure(tx: &mut Transaction<'_, Sqlite>, owner: i64) -> Result<i64> {
    let board: Option<i64> = sqlx::query_scalar("SELECT id FROM boards WHERE inbox_owner_id=?")
        .bind(owner)
        .fetch_optional(&mut **tx)
        .await?;
    let id = if let Some(id) = board {
        id
    } else {
        let id = sqlx::query("INSERT INTO boards(title,inbox_owner_id) VALUES('收集箱',?)")
            .bind(owner)
            .execute(&mut **tx)
            .await?
            .last_insert_rowid();
        sqlx::query("INSERT INTO board_members(board_id,user_id,role) VALUES(?,?,'admin')")
            .bind(id)
            .bind(owner)
            .execute(&mut **tx)
            .await?;
        sqlx::query(
            "INSERT INTO lists(board_id,title,position,inbox_default) VALUES(?,'收集箱',0,1)",
        )
        .bind(id)
        .execute(&mut **tx)
        .await?;
        id
    };
    let valid:bool=sqlx::query_scalar("SELECT (SELECT COUNT(*) FROM lists WHERE board_id=?)=1 AND EXISTS(SELECT 1 FROM lists WHERE board_id=? AND inbox_default=1) AND (SELECT COUNT(*) FROM board_members WHERE board_id=?)=1 AND EXISTS(SELECT 1 FROM board_members WHERE board_id=? AND user_id=? AND role='admin')").bind(id).bind(id).bind(id).bind(id).bind(owner).fetch_one(&mut **tx).await?;
    if !valid {
        return Err(error::conflict());
    }
    Ok(id)
}
pub async fn get(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
) -> Result<Json<boards::Snapshot>> {
    let mut tx = s.pool.begin().await?;
    let id: i64 = sqlx::query_scalar("SELECT id FROM boards WHERE inbox_owner_id=?")
        .bind(a.user.id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(error::missing)?;
    let result = boards::snapshot(&mut tx, &a, id).await?;
    tx.commit().await?;
    Ok(Json(result))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Target {
    target_board_id: i64,
    target_list_id: i64,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExpectedCard {
    id: i64,
    touch_version: i64,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Preview {
    card_id: i64,
    source_board_id: i64,
    source_list_id: i64,
    source_revision: i64,
    target_board_id: i64,
    target_list_id: i64,
    target_revision: i64,
    cards: Vec<ExpectedCard>,
    task_count: i64,
    archived_count: i64,
    completed_count: i64,
    skipped_count: i64,
    comment_count: i64,
    checklist_count: i64,
    attachment_count: i64,
    attachment_bytes: i64,
}
fn chain_invalid() -> error::Error {
    error::Error(
        StatusCode::CONFLICT,
        "invalid_recurrence_chain",
        "重复链归属或结构异常，不能转移；不会公开或删除任何任务",
    )
}
async fn prepare(
    tx: &mut Transaction<'_, Sqlite>,
    a: &Actor,
    card: i64,
    target: &Target,
) -> Result<Preview> {
    let (source,source_list,source_revision):(i64,i64,i64)=sqlx::query_as("SELECT b.id,l.id,b.revision FROM boards b JOIN lists l ON l.board_id=b.id JOIN cards c ON c.list_id=l.id WHERE c.id=? AND b.inbox_owner_id=? AND l.inbox_default=1").bind(card).bind(a.user.id).fetch_optional(&mut **tx).await?.ok_or_else(error::missing)?;
    boards::role(tx, a, source).await?;
    boards::role(tx, a, target.target_board_id).await?;
    let target_revision:i64=sqlx::query_scalar("SELECT b.revision FROM boards b JOIN lists l ON l.board_id=b.id WHERE b.id=? AND l.id=? AND b.inbox_owner_id IS NULL").bind(target.target_board_id).bind(target.target_list_id).fetch_optional(&mut **tx).await?.ok_or_else(error::missing)?;
    // UNION (not UNION ALL) terminates traversal even for corrupt cycles.
    type ChainNode = (i64, i64, Option<i64>, i64, bool, bool, bool);
    let nodes:Vec<ChainNode>=sqlx::query_as("WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT c.id FROM cards c JOIN cards prior ON c.predecessor_id=prior.id OR prior.predecessor_id=c.id OR (c.series_id IS NOT NULL AND c.series_id=prior.series_id) JOIN chain ON chain.id=prior.id) SELECT c.id,c.list_id,c.predecessor_id,c.touch_version,c.archived,c.completed,c.skipped FROM cards c JOIN chain ON chain.id=c.id ORDER BY c.id").bind(card).fetch_all(&mut **tx).await?;
    let mut cards = Vec::new();
    let (
        mut archived_count,
        mut completed_count,
        mut comment_count,
        mut checklist_count,
        mut attachment_count,
        mut attachment_bytes,
    ) = (0, 0, 0, 0, 0, 0i64);
    // Actual predecessor connectivity must independently agree with the series closure.
    // A colliding series ID may not pull an unrelated task into publication.
    let mut connected = std::collections::HashSet::from([card]);
    loop {
        let old = connected.len();
        for n in &nodes {
            if n.2.is_some_and(|p| connected.contains(&p)) {
                connected.insert(n.0);
            }
            if connected.contains(&n.0)
                && let Some(p) = n.2
            {
                connected.insert(p);
            }
        }
        if connected.len() == old {
            break;
        }
    }
    let mut skipped_count = 0;
    for (id, list, parent, touch, archived, completed, skipped) in &nodes {
        if *list != source_list || parent.is_some_and(|p| !nodes.iter().any(|n| n.0 == p)) {
            return Err(chain_invalid());
        }
        // Reject cycles, missing ancestors and series collisions that join unrelated chains.
        let mut ancestors = std::collections::HashSet::new();
        let mut current = Some(*id);
        while let Some(node) = current {
            if !ancestors.insert(node) {
                return Err(chain_invalid());
            }
            current = nodes.iter().find(|n| n.0 == node).and_then(|n| n.2);
        }
        if !connected.contains(id) {
            return Err(chain_invalid());
        }
        let (comments,items,attachments,bytes):(i64,i64,i64,i64)=sqlx::query_as("SELECT (SELECT COUNT(*) FROM comments WHERE card_id=?),(SELECT COUNT(*) FROM checklist_items WHERE card_id=?),(SELECT COUNT(*) FROM attachments WHERE card_id=?),(SELECT COALESCE(SUM(size),0) FROM attachments WHERE card_id=? AND state!='deleted')").bind(id).bind(id).bind(id).bind(id).fetch_one(&mut **tx).await?;
        comment_count += comments;
        checklist_count += items;
        attachment_count += attachments;
        attachment_bytes = attachment_bytes
            .checked_add(bytes)
            .ok_or_else(error::invalid)?;
        archived_count += i64::from(*archived);
        completed_count += i64::from(*completed);
        skipped_count += i64::from(*skipped);
        cards.push(ExpectedCard {
            id: *id,
            touch_version: *touch,
        });
    }
    Ok(Preview {
        card_id: card,
        source_board_id: source,
        source_list_id: source_list,
        source_revision,
        target_board_id: target.target_board_id,
        target_list_id: target.target_list_id,
        target_revision,
        task_count: cards.len() as i64,
        cards,
        archived_count,
        completed_count,
        skipped_count,
        comment_count,
        checklist_count,
        attachment_count,
        attachment_bytes,
    })
}
pub async fn preview(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(card): Path<i64>,
    Query(target): Query<Target>,
) -> Result<Json<Preview>> {
    let mut tx = s.pool.begin().await?;
    let p = prepare(&mut tx, &a, card, &target).await?;
    tx.commit().await?;
    Ok(Json(p))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transfer {
    ack_visibility: bool,
    preview: Preview,
}
pub async fn transfer(
    State(s): State<AppState>,
    Extension(a): Extension<Actor>,
    Path(card): Path<i64>,
    Json(input): Json<Transfer>,
) -> Result<Json<Value>> {
    if !input.ack_visibility {
        return Err(error::invalid());
    }
    let mut tx = s.pool.begin_with("BEGIN IMMEDIATE").await?;
    let p = prepare(
        &mut tx,
        &a,
        card,
        &Target {
            target_board_id: input.preview.target_board_id,
            target_list_id: input.preview.target_list_id,
        },
    )
    .await?;
    if p != input.preview {
        return Err(error::conflict());
    }
    for node in &p.cards {
        let pending:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE card_id=? AND state IN ('pending','verifying'))").bind(node.id).fetch_one(&mut *tx).await?;
        if pending {
            return Err(error::Error(
                StatusCode::CONFLICT,
                "attachment_processing",
                "附件处理中，请完成后重新确认转移",
            ));
        }
    }
    if p.attachment_bytes > 0 {
        let store = s.storage.as_ref().ok_or(error::Error(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage_unavailable",
            "附件存储未配置，无法验证目标配额",
        ))?;
        let used:i64=sqlx::query_scalar("SELECT COALESCE(SUM(a.size),0) FROM attachments a JOIN cards c ON c.id=a.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=? AND a.state!='deleted'").bind(p.target_board_id).fetch_one(&mut *tx).await?;
        if used
            .checked_add(p.attachment_bytes)
            .is_none_or(|n| n > store.quota)
        {
            return Err(error::Error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "quota",
                "附件配额不足",
            ));
        }
    }
    let mut position: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position),-1)+1 FROM cards WHERE list_id=? AND archived=0",
    )
    .bind(p.target_list_id)
    .fetch_one(&mut *tx)
    .await?;
    let ordered: Vec<(i64, bool)> =
        sqlx::query_as("SELECT id,archived FROM cards WHERE list_id=? ORDER BY position,id")
            .bind(p.source_list_id)
            .fetch_all(&mut *tx)
            .await?;
    let ids: Vec<i64> = p.cards.iter().map(|n| n.id).collect();
    for (id, archived) in ordered.into_iter().filter(|(id, _)| ids.contains(id)) {
        if archived {
            sqlx::query("UPDATE cards SET list_id=? WHERE id=?")
                .bind(p.target_list_id)
                .bind(id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("UPDATE cards SET list_id=?,position=? WHERE id=?")
                .bind(p.target_list_id)
                .bind(position)
                .bind(id)
                .execute(&mut *tx)
                .await?;
            position = position.checked_add(1).ok_or_else(error::invalid)?;
        }
    }
    sqlx::query("UPDATE boards SET revision=revision+1 WHERE id IN (?,?)")
        .bind(p.source_board_id)
        .bind(p.target_board_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"card_ids":ids,"source_board_id":p.source_board_id,"target_board_id":p.target_board_id,"source_revision":p.source_revision+1,"target_revision":p.target_revision+1}),
    ))
}
