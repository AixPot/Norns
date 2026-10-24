import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSmartTasks} from '../src/task-groups.mjs';
const today='2026-10-22';
const ids=tasks=>tasks.map(t=>t.id);
test('default smart grouping equals current Today and next7 with no generated occurrences',async()=>{
 const {projectTaskView}=await import('../src/task-view.mjs');
 const tasks=[{id:1,board_id:1,list_id:1,position:0,schedule:{start_date:'2026-10-19',end_date:'2026-10-21'}},{id:2,board_id:1,list_id:1,position:1,schedule:{start_date:'2026-10-20',end_date:'2026-10-24',repeat:{unit:'day'}}},{id:3,board_id:1,list_id:1,position:2,due_date:'2026-10-23'},{id:4,board_id:1,list_id:1,position:3}];
 const before=structuredClone(tasks);
 for(const route of ['today','next7','mine','search']){
  const view=projectTaskView(tasks,{route,today});
  assert.deepEqual(view.groups,groupSmartTasks(tasks,route,today));
  assert.deepEqual(view.completed,[]);
  assert.equal(view.groups.flatMap(g=>g.tasks).length,tasks.length);
 }
 assert.deepEqual(tasks,before);
});

test('manual uses board/list/card positions then IDs, completion stays below all groups',async()=>{
 const {projectTaskView}=await import('../src/task-view.mjs');
 const tasks=[{id:6,board_id:2,board_position:1,list_id:2,list_position:0,position:0},{id:9,board_id:1,board_position:0,list_id:2,list_position:1,position:0},{id:4,board_id:1,board_position:0,list_id:1,list_position:0,position:1},{id:3,board_id:1,board_position:0,list_id:1,list_position:0,position:1},{id:1,board_id:1,board_position:0,list_id:1,list_position:0,position:0,completed:true}];
 Object.freeze(tasks);tasks.forEach(Object.freeze);
 const v=projectTaskView(tasks,{group:'none'});
 assert.deepEqual(ids(v.groups[0].tasks),[3,4,9,6]);assert.deepEqual(ids(v.completed),[1]);
 assert.notEqual(v.groups[0].tasks,tasks);assert.equal(v.groups[0].tasks[0],tasks[3]);
});
test('date sorts effective start before due, undated last, ties physical',async()=>{
 const {projectTaskView}=await import('../src/task-view.mjs');
 const tasks=[{id:9,board_id:1,list_id:1,position:3},{id:5,board_id:1,list_id:1,position:2,due_date:'2026-10-24',schedule:{start_date:'2026-10-23'}},{id:3,board_id:1,list_id:1,position:1,due_date:'2026-10-23'},{id:1,board_id:1,list_id:1,position:0,due_date:'2026-10-22',completed:true}];
 const before=structuredClone(tasks),v=projectTaskView(tasks,{group:'none',sort:'date'});
 assert.deepEqual(ids(v.groups[0].tasks),[3,5,9]);assert.deepEqual(ids(v.completed),[1]);assert.deepEqual(tasks,before);
});
test('explicit date and board grouping keep exact records once and deterministic group order',async()=>{
 const {projectTaskView}=await import('../src/task-view.mjs');
 const tasks=[{id:3,board_id:2,board_title:'B',due_date:null},{id:2,board_id:1,board_title:'A',schedule:{start_date:'2026-10-20',end_date:'2026-10-25',repeat:{unit:'day'}}},{id:1,board_id:1,board_title:'A',due_date:'2026-10-22'},{id:4,board_id:2,completed:true}];
 const before=structuredClone(tasks);
 const date=projectTaskView(tasks,{group:'date',today,route:'next7'});
 assert.deepEqual(date.groups.map(g=>[g.key,ids(g.tasks)]),[['2026-10-22',[1,2]],['undated',[3]]]);
 assert.deepEqual(ids(date.groups.flatMap(g=>g.tasks)),[1,2,3]);
 assert.equal(date.groups[0].tasks[1],tasks[1]);
 assert.deepEqual(ids(date.completed),[4]);
 for(const route of ['today','tomorrow','mine','search','upcoming']){
  const ordinary=projectTaskView(tasks,{group:'date',today,route});
  assert.deepEqual(ordinary.groups.map(g=>[g.key,ids(g.tasks)]),[['2026-10-20',[2]],['2026-10-22',[1]],['undated',[3]]]);
 }
 assert.deepEqual(tasks,before);
 const board=projectTaskView(tasks,{group:'board',today});
 assert.deepEqual(board.groups.map(g=>[g.key,g.label,ids(g.tasks)]),[['board:1','A',[1,2]],['board:2','B',[3]]]);
 assert.deepEqual(ids(board.completed),[4]);
});
test('board projection preserves real columns including empty, filters archived and completes at each bottom',async()=>{
 const {projectBoardView}=await import('../src/task-view.mjs');
 const board={lists:[{id:9,title:'Empty',position:2},{id:2,title:'Second',position:1},{id:1,title:'First',position:0}],cards:[{id:5,list_id:1,position:0,completed:true,due_date:'2026-10-20'},{id:3,list_id:1,position:2,due_date:'2026-10-23'},{id:2,list_id:1,position:1,due_date:'2026-10-24'},{id:4,list_id:2,position:0},{id:7,list_id:1,position:0,archived:true}]};
 const before=structuredClone(board);const view=projectBoardView(board,{sort:'date'});
 assert.deepEqual(view.columns.map(c=>[c.list.id,ids(c.tasks)]),[[1,[3,2,5]],[2,[4]],[9,[]]]);
 assert.equal(view.columns[0].list,board.lists[2]);assert.deepEqual(board,before);
 assert.deepEqual(ids(projectBoardView(board).columns[0].tasks),[2,3,5]);
});
test('missing position metadata falls back deterministically to board/list/card IDs',async()=>{
 const {projectTaskView}=await import('../src/task-view.mjs');
 const tasks=[{id:3,board_id:2,list_id:1},{id:2,board_id:1,list_id:2},{id:4,board_id:1,list_id:1},{id:1,board_id:1,list_id:1}];
 assert.deepEqual(ids(projectTaskView(tasks,{group:'none'}).groups[0].tasks),[1,4,2,3]);
});
