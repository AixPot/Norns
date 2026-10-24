import test from 'node:test';
import assert from 'node:assert/strict';
import {toggleSelection,selectVisible,pruneSelection} from '../src/task-selection.mjs';
test('stable identity selection is distinct from completion and bounded to 100 visible loaded rows',()=>{
 const rows=Array.from({length:103},(_,i)=>({id:i+1,board_id:7,completed:false}));
 let selected=toggleSelection([],rows[2]); selected=toggleSelection(selected,rows[0]);
 assert.deepEqual(selected,[{id:3,board_id:7},{id:1,board_id:7}]);
 assert.deepEqual(pruneSelection(selected,[rows[0],rows[2]].reverse()),selected);
 assert.deepEqual(pruneSelection(selected,[rows[0]]),[{id:1,board_id:7}]);
 assert.equal(selectVisible([],rows).length,100);
 assert.equal(rows[0].completed,false);
 assert.deepEqual(toggleSelection(selected,rows[2]),[{id:1,board_id:7}]);
});

import {prepareBulk,bulkChanges,bulkSafety} from '../src/task-selection.mjs';
const board={id:7,revision:12,lists:[{id:8}],cards:[{id:3,touch_version:4,completed:false,archived:false,series_id:null,schedule:null,list_id:8},{id:1,touch_version:0,completed:false,archived:false,series_id:null,schedule:null,list_id:8}]};
test('prepare freezes exact originals, touch CAS and revision; mixed boards never split',()=>{
 const s=[{id:3,board_id:7},{id:1,board_id:7}],p=prepareBulk(board,s);
 assert.deepEqual(p.selected,[{id:3,touch_version:4},{id:1,touch_version:0}]);assert.equal(p.expected_revision,12);
 board.cards[0].touch_version=9;assert.equal(p.originals[0].touch_version,4);
 assert.throws(()=>prepareBulk(board,[...s,{id:6,board_id:9}]),/同一/);
 assert.throws(()=>prepareBulk(board,[{id:999,board_id:7}]),/不可用/);
});
test('independent keep/set/clear patch; invalid null and schedule rejected',()=>{
 const d={target_list:{op:'keep'},schedule:{op:'clear'},completed:{op:'set',value:true},archived:{op:'keep'}};
 assert.deepEqual(bulkChanges(board,d),d);assert.equal(bulkChanges(board,{schedule:{op:'clear'}}).completed.op,'keep');
 assert.throws(()=>bulkChanges(board,{}),/选择/);assert.throws(()=>bulkChanges(board,{schedule:null}),/无效/);
 assert.throws(()=>bulkChanges(board,{schedule:{op:'set',value:{start_date:'2027-02-30',timezone:'Asia/Shanghai'}}}),/日期/);
 assert.throws(()=>bulkChanges(board,{target_list:{op:'set',value:999}}),/列表/);
});
test('preview explains restrictions but never pretends to prove safe recurring undo',()=>{
 const repeating={...board.cards[0],series_id:'s',schedule:{start_date:'2027-01-01',repeat:{unit:'day'}}};
 assert.match(bulkSafety([repeating],{schedule:{op:'clear'}}),/重复/);
 assert.match(bulkSafety([{...repeating,archived:true}],{completed:{op:'set',value:true},archived:{op:'set',value:false}}),/归档/);
 assert.match(bulkSafety([{id:1,completed:true},{id:2,predecessor_id:1}],{completed:{op:'set',value:false}}),/后继/);
});

import {bulkUncertainty} from '../src/task-selection.mjs';
test('unknown marker is account scoped and persists across controller reload without payload',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const a=bulkUncertainty(1,storage);a.mark(7);assert.equal(bulkUncertainty(1,storage).board(),7);assert.equal(bulkUncertainty(2,storage).board(),0);
 a.clear();assert.equal(bulkUncertainty(1,storage).board(),0);assert.equal(map.size,0);
});
