// Slots carry neighbor identities, never partitioned display indices.
const sorted=items=>[...items].sort((a,b)=>a.position-b.position||a.id-b.id);
export const slotKey=slot=>slot?`${slot.listId??'lists'}:${slot.completed??''}:${slot.afterId??''}:${slot.beforeId??''}`:'';
const slots=(items,extra)=>Array.from({length:items.length+1},(_,i)=>({...extra,beforeId:items[i]?.id??null,afterId:items[i-1]?.id??null}));
export function cardSlots(board,movingId,listId){
 const moving=board.cards.find(c=>c.id===movingId&&!c.archived);
 if(!moving||!board.lists.some(l=>l.id===listId))return [];
 return slots(sorted(board.cards.filter(c=>c.list_id===listId&&!c.archived&&c.id!==movingId&&c.completed===moving.completed)),{listId,completed:moving.completed});
}
export function listSlots(board,movingId){
 if(!board.lists.some(l=>l.id===movingId))return [];
 return slots(board.lists.filter(l=>l.id!==movingId),{});
}
export function resolveMove(board,intent){
 if(!board||board.id!==intent.boardId||board.revision!==intent.revision||!intent.slot)return null;
 const {kind,sourceId,slot}=intent;
 const valid=(kind==='list'?listSlots(board,sourceId):cardSlots(board,sourceId,slot.listId)).find(s=>slotKey(s)===slotKey(slot));
 if(!valid)return null;
 if(kind==='list'){
  const others=board.lists.filter(l=>l.id!==sourceId),index=slot.beforeId===null?others.length:others.findIndex(l=>l.id===slot.beforeId);
  if(index<0||board.lists[index]?.id===sourceId)return null;
  return {action:'list_move',list_id:sourceId,index};
 }
 const moving=board.cards.find(c=>c.id===sourceId),physical=sorted(board.cards.filter(c=>c.list_id===slot.listId&&!c.archived&&c.id!==sourceId));
 const index=slot.beforeId!==null?physical.findIndex(c=>c.id===slot.beforeId):slot.afterId!==null?physical.findIndex(c=>c.id===slot.afterId)+1:moving.completed?physical.length:0;
 if(index<0)return null;
 const result=[...physical];result.splice(index,0,moving);
 if(moving.list_id===slot.listId&&result.every((c,i)=>c.id===sorted(board.cards.filter(c=>c.list_id===slot.listId&&!c.archived))[i]?.id))return null;
 return {action:'card_move',card_id:sourceId,target_list_id:slot.listId,index};
}
