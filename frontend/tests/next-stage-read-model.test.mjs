import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTaskView,projectBoardView} from '../src/task-view.mjs';
import {groupSmartTasks} from '../src/task-groups.mjs';
import {displayCards} from '../src/completion-view.mjs';
import {bulkSafety} from '../src/task-selection.mjs';
import {projectCalendar} from '../src/calendar.mjs';
import {taskSummary} from '../src/task-summary.mjs';
import {taskQuery} from '../src/task-discovery.mjs';

test('calendar excludes skipped historical occurrences from active occupancy',()=>{
 const day=projectCalendar([{id:1,due_date:'2026-10-26',skipped:true},{id:2,due_date:'2026-10-26',completed:true}],{days:['2026-10-26']})[0];
 assert.deepEqual(day.allDay.map(x=>x.task.id),[2]);
});
const rows=[{id:1,list_id:1,completed:false},{id:2,list_id:1,completed:true},{id:3,list_id:1,completed:false,skipped:true}];
test('skipped is a separate search history group, never active or complete',()=>{
 const p=projectTaskView(rows,{route:'search'});
 assert.deepEqual(p.groups.flatMap(g=>g.tasks).map(t=>t.id),[1]);
 assert.deepEqual(p.completed.map(t=>t.id),[2]);
 assert.deepEqual(p.skipped.map(t=>t.id),[3]);
 assert.match(taskSummary({title:'board',lists:[{id:1,title:'list'}],cards:rows,members:[],checklist:[]},3),/状态：已跳过 · 未归档/);
 assert.equal(new URLSearchParams(taskQuery({status:'complete'})).get('status'),'complete');
 assert.deepEqual(projectBoardView({lists:[{id:1}],cards:rows}).columns[0].tasks.map(t=>t.id),[1,2]);
 assert.deepEqual(displayCards(rows,1).map(t=>t.id),[1,2]);
 assert.deepEqual(groupSmartTasks(rows,'mine','2026-10-26')[0].tasks.map(t=>t.id),[1]);
});
test('bulk cannot complete or schedule skipped originals but may move history',()=>{
 assert.ok(bulkSafety([rows[2]],{completed:{op:'set',value:true}}));
 assert.ok(bulkSafety([rows[2]],{schedule:{op:'clear'}}));
 assert.equal(bulkSafety([rows[2]],{target_list:{op:'set',value:2}}),'');
});
