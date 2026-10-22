# Inbox and whole-chain transfer API

## Container and discovery

- `GET /api/inbox`: current owner's board snapshot. Same shape as ordinary snapshot, plus `inbox_owner_id`. Exactly one list; existing `/api/boards/{id}/mutate`, card and attachment routes work for the owner.
- Ordinary `/api/boards` and discovery `boards` exclude inboxes. Ordinary board JSON remains unchanged (nullable marker omitted).
- `/api/tasks` returns `{tasks,boards,people,inbox}`. `inbox` is the owner's `{id,title,revision}` summary (nullable for corrupted/missing legacy data); private tasks carry their actual `board_id`/`list_id`. Use this extra scope when opening details/calendar tasks; do not replace ordinary navigation boards with it.
- Inboxes forbid list create/update/move and membership set/remove, independent of frontend. All card/child endpoints enforce owner-only ACL, even for site administrators.
- Card creation remains unassigned and undated by default.

## Dates

`GET /api/tasks?view=today|tomorrow|next7|mine&status=incomplete`.

Shanghai day D, start S, end E (fall back to legacy due date): today `S<=D`, tomorrow `S<=D+1 && E>=D+1`, next7 `S<=D+6 && E>=D`. Undated/archived tasks do not match date views. Mine is explicit assignee only. To expand completed tasks, request the same view with `status=complete`; this is scheduled-date matching, not completion-time statistics. Default `status=all` and legacy `upcoming` are preserved. Calendar continues using inclusive from/to intersection and includes completed tasks.

## Preview / confirmation

`GET /api/inbox/cards/{card}/transfer-preview?target_board_id=B&target_list_id=L`

Returns:

```json
{
  "card_id": 123,
  "source_board_id": 1,
  "source_list_id": 1,
  "source_revision": 5,
  "target_board_id": 2,
  "target_list_id": 3,
  "target_revision": 7,
  "cards": [{"id": 122, "touch_version": 9}, {"id": 123, "touch_version": 0}],
  "task_count": 2,
  "archived_count": 1,
  "completed_count": 1,
  "comment_count": 3,
  "checklist_count": 2,
  "attachment_count": 1,
  "attachment_bytes": 4096
}
```

Example only, not execution data. Cards are sorted by ID. The closure includes predecessor/successor relationships across schedule edits and conservatively equal series IDs; missing/external/cyclic/disconnected anomalies refuse with no foreign metadata. Counts include archived history; attachment_count includes deleted metadata, bytes includes nondeleted states.

`POST /api/inbox/cards/{card}/transfer`

```javascript
JSON.stringify({ack_visibility: true, preview})
```

`preview` is the entire object returned by GET, unchanged—not a string, subset or hand-built summary. Unknown fields are rejected. The server reauthorizes inside BEGIN IMMEDIATE and compares the complete recomputed preview. No preview token persistence or automatic retry protocol is required.

Success: `{card_ids,source_board_id,target_board_id,source_revision,target_revision}`. IDs include archived history. Both revisions increment exactly once. All card IDs/children, recurrence metadata, completion/archive flags and attachment/outbox records survive. Active nodes append in source position/ID order; archived positions remain unchanged. Sticky touch counters increment, so undoing an earlier completion can now safely refuse with existing `successor_touched`; do not reset counters. Newly generated target successors retain ordinary safe undo.

Errors (no transfer side effects): 400 missing/false ack; 404 unknown/unauthorized source/target/list or already moved source; 409 `conflict` stale full preview, `attachment_processing` pending/verifying, `invalid_recurrence_chain` structural anomaly; 413 `quota`; 503 `storage_unavailable` when live attachment quota cannot be validated without storage config. 5xx/unknown transport outcomes must not be blindly retried. Exact readback: GET every returned/preview card ID under destination scope, and verify source scope is 404. This is not idempotent replay.

## Minimum next-stage frontend integration

1. Fetch own inbox separately; default route today explicitly passes incomplete. Keep search/status=all and legacy upcoming behavior.
2. Use existing serialized writer and leave-draft/IME/upload barriers before preview and transfer. Confirm that the **whole repeated chain, including completed/archived history, comments, checklists and attachments, is published to all current and future target members, including re-enabled members**. Preview drift requires fresh confirmation.
3. Do not auto-replay 409/5xx/unknown. Block queue as appropriate; uncertain responses require exact ownership readback.
4. On success invalidate both scopes and discovery; tear down old completion toast/draft/poller/drag intent, increment request epoch and remount detail/attachments with `boardId:cardId` scope. Preserving card ID does not preserve the old attachment base URL.
5. Do not expose generic ordinary-board cross-move or move-back-to-inbox. Ordinary card_move remains same-board only.

## Verification limits

Backend synthetic SQLite, including local synthetic attachment metadata and real quota configuration parsing, is verified. No real B2/S3 object bytes or frontend/browser flows are claimed; those remain the next stage. No production database, .env, credentials or network storage calls are used.
