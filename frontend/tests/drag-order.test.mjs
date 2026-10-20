import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cardSlots,resolveMove,listSlots,slotKey} from '../src/drag-order.mjs';
const c=(id,list_id,position,completed=false)=>({id,list_id,position,completed,archived:false});
const board={id:1,revision:4,lists:[{id:1},{id:2},{id:3}],cards:[c(1,1,0,true),c(2,1,1),c(3,1,2),c(4,2,0,true)]};
const move=(b,sourceId,slot,kind='card')=>resolveMove(b,{boardId:b.id,revision:b.revision,kind,sourceId,slot});
test('group tail maps identities to physical order rather than visual index',()=>{
 const slots=cardSlots(board,2,1);assert.equal(slots.length,2);
 assert.deepEqual(move(board,2,slots[1]),{action:'card_move',card_id:2,target_list_id:1,index:2});
 assert.equal(move(board,2,slots[0]),null); // no-op
 assert.equal(cardSlots(board,1,1).length,1);
 assert.equal(move(board,1,cardSlots(board,1,1)[0]).index,2); // sole completed slot still has a physical boundary
});
test('empty and opposite-only destinations preserve completed and give the right boundary',()=>{
 assert.equal(move(board,2,cardSlots(board,2,2)[0]).index,0);
 assert.equal(move(board,1,cardSlots(board,1,3)[0]).index,0);
 const b={...board,cards:[...board.cards,c(5,3,0)]};
 assert.equal(move(b,1,cardSlots(b,1,3)[0]).index,1);
});
test('stale revision, deleted anchor, archived source and foreign list reject',()=>{
 const slot=cardSlots(board,2,1)[0],intent={boardId:1,revision:4,kind:'card',sourceId:2,slot};
 assert.equal(resolveMove({...board,revision:5},intent),null);
 assert.equal(resolveMove({...board,cards:board.cards.filter(c=>c.id!==3)},intent),null);
 assert.equal(resolveMove({...board,cards:board.cards.map(c=>c.id===2?{...c,archived:true}:c)},intent),null);
 assert.deepEqual(cardSlots(board,2,99),[]);
});
test('all exposed slots land at their visible same-group neighbors across interleavings',()=>{
 for(let mask=0;mask<16;mask++){
  const b={...board,cards:Array.from({length:4},(_,i)=>c(i+1,1,i,!!(mask&(1<<i))))};
  for(const moving of b.cards)for(const slot of cardSlots(b,moving.id,1)){
   const action=move(b,moving.id,slot);if(!action)continue;
   const physical=b.cards.filter(c=>c.id!==moving.id);physical.splice(action.index,0,moving);
   const group=physical.filter(c=>c.completed===moving.completed),i=group.indexOf(moving);
   assert.equal(group[i+1]?.id??null,slot.beforeId);assert.equal(group[i-1]?.id??null,slot.afterId);
  }
 }
});
test('list slots exclude source, reject stale identities and avoid no-op writes',()=>{
 const slots=listSlots(board,1);assert.equal(slots.length,3);assert.equal(move(board,1,slots[0],'list'),null);
 assert.deepEqual(move(board,1,slots[2],'list'),{action:'list_move',list_id:1,index:2});
 assert.notEqual(slotKey(slots[0]),slotKey(slots[1]));
});
