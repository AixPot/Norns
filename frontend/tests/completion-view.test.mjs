import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayCards,dropIndex} from '../src/completion-view.mjs';
const cards=[{id:3,list_id:1,position:2,completed:false},{id:1,list_id:1,position:0,completed:true},{id:2,list_id:1,position:1,completed:false}];
test('completion partitions display only; undo uses latest persisted position',()=>{
 const original=structuredClone(cards);
 assert.deepEqual(displayCards(cards,1).map(c=>c.id),[2,3,1]);assert.deepEqual(cards,original);
 assert.deepEqual(displayCards(cards.map(c=>c.id===1?{...c,completed:false}:c),1).map(c=>c.id),[1,2,3]);
 assert.deepEqual(displayCards(cards.map(c=>c.id===1?{...c,completed:false,position:4}:c),1).map(c=>c.id),[2,3,1]);
});
test('drop maps target identity to physical order, never visual index',()=>{
 assert.equal(dropIndex(cards,1,3,2),1);assert.equal(dropIndex(cards,1,3,1),0);assert.equal(dropIndex(cards,1,3,null),2);
 assert.deepEqual(displayCards([{id:5,list_id:1,position:0,completed:true},{id:4,list_id:1,position:0,completed:true}],1).map(c=>c.id),[4,5]);
});
