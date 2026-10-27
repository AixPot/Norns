export function removalTargets(lists,boardId,sourceId) {
 return lists.filter(list=>list.board_id===boardId&&list.id!==sourceId);
}

export function listRemovalMutation(preview) {
 return {action:'list_remove',expected_revision:preview.revision,preview};
}
