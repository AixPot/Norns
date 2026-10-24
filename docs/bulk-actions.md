# Atomic bulk task actions

Use **选择任务** on a board, smart task view or task search. Selection checkboxes are independent of completion checkboxes. Select at most 100 currently loaded visible tasks; “select all” does not fetch hidden pages. Changing a filter, route or account clears selection. Polls remove vanished rows; grouping/sorting retain IDs. Mixed source boards disable submission rather than splitting into several batches.

**批量修改** flushes the mounted detail autosave owner and reads the authorized board only after IME, invalid/held recovery and unsent auxiliary edits are resolved. Review the exact original IDs, current values, sticky `touch_version` and board revision. Each field defaults to keep, including mixed values. Choose independent list, date, completion and archive operations, then explicitly acknowledge and submit once.

- List: keep or set an existing list in the same board.
- Schedule: keep, clear, or set a complete nonrepeating date/time range in Asia/Shanghai. Only originally open nonrepeating tasks accept date changes; simultaneous undo is not a bypass.
- Completion: keep or Boolean set, subject to recurring successor safety.
- Archive: keep or Boolean set; only selected originals are archived. New recurring successors remain open/unarchived in their final list.
- Archived tasks cannot complete/undo even with simultaneous restore. Use the existing board archive view to restore first.
- Moves append in physical source-list/card order, never the local date projection. There is no bulk undo.

One request uses the existing serialized board writer:

```json
{
  "expected_revision": 12,
  "action": "cards_bulk",
  "selected": [{"id": 81, "touch_version": 3}, {"id": 92, "touch_version": 0}],
  "changes": {
    "target_list": {"op": "set", "value": 7},
    "schedule": {"op": "clear"},
    "completed": {"op": "keep"},
    "archived": {"op": "set", "value": false}
  }
}
```

POST `/api/boards/{id}/mutate` returns the existing full board Snapshot on success. Omitted operations mean keep, explicit null is invalid. All keep is invalid. A board/touch 409 applies nothing; selection remains, and rereading requires another explicit acknowledgement. Semantic 409 (`successor_touched`, `bulk_successor_selected`) is not described as a version conflict. Non-JSON 422 errors produce a safe visible rejection and retain the form.

Unknown transport/server outcomes block further board writes, store only an account-scoped same-tab safety marker, and never retry. Close and use the read-only latest-version reconciliation action, inspect tasks and possible successors, then explicitly recover. Reload does not replay. Storage denial retains only current-document protection. Pending writes and unsaved modal-local form edits trigger a browser beforeunload warning, including date/time buffers hidden by switching the schedule operation back to keep. Fully reverting to the clean defaults or completing an acknowledged successful submission removes the dirty warning. No batch command or payload is persisted for recovery.

Escape on a dirty form asks before discarding; declining retains the exact edits and focus. An in-flight write cannot be dismissed, IME composition does not trigger Escape dismissal, and the backdrop does not close the dialog. Explicit Cancel/Close discards the modal-local form without saving. Accepting a reload warning also loses those unsaved fields: this is loss prevention, not durable form recovery.

Calendar and private inbox history do not gain hidden selection capabilities. The ordinary board archive view supports visible selected restores. This feature is not cross-board transfer, assignment, repeat creation, or durable batch-form recovery.
