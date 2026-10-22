import test from 'node:test';
import assert from 'node:assert/strict';

// Import inside the test so missing implementation is reported as a feature failure.
test('today separates expired intervals from active tasks without changing server membership',async()=>{
 const {groupSmartTasks}=await import('../src/task-groups.mjs');
 const tasks=[{id:1,schedule:{start_date:'2026-10-19',end_date:'2026-10-21'}},{id:2,schedule:{start_date:'2026-10-20',end_date:'2026-10-24'}},{id:3,due_date:'2026-10-22'}];
 const before=structuredClone(tasks);
 const groups=groupSmartTasks(tasks,'today','2026-10-22');
 assert.deepEqual(groups.map(g=>[g.key,g.tasks.map(t=>t.id)]),[['overdue',[1]],['2026-10-22',[2,3]]]);
 assert.deepEqual(tasks,before);
 assert.equal(groups[0].label,'已逾期');assert.equal(groups[1].label,'今天');
});

test('next7 places each actual task once on its first visible date, including spanning and repeated records',async()=>{
 const {groupSmartTasks}=await import('../src/task-groups.mjs');
 const tasks=[{id:4,schedule:{start_date:'2026-10-25'}},{id:1,schedule:{start_date:'2026-10-20',end_date:'2026-10-24',repeat:{unit:'day'}}},{id:2,due_date:'2026-10-23'},{id:3,schedule:{start_date:'2026-10-28'}},{id:5,schedule:null,due_date:null}];
 const groups=groupSmartTasks(tasks,'next7','2026-10-22');
 assert.deepEqual(groups.map(g=>[g.key,g.tasks.map(t=>t.id)]),[['2026-10-22',[1]],['2026-10-23',[2]],['2026-10-25',[4]],['2026-10-28',[3]],['undated',[5]]]);
 assert.equal(groups.flatMap(g=>g.tasks).length,tasks.length);
 assert.match(groups[0].label,/今天/);assert.match(groups[1].label,/明天/);assert.match(groups[2].label,/10月25日/);
});

test('single-day and non-date routes preserve server order and undated membership',async()=>{
 const {groupSmartTasks}=await import('../src/task-groups.mjs');
 const tasks=[{id:9,schedule:null},{id:2,due_date:'2026-10-23'}];
 for(const route of ['inbox','mine','tomorrow'])assert.deepEqual(groupSmartTasks(tasks,route,'2026-10-22'),[{key:'all',label:'',tasks}]);
 assert.deepEqual(groupSmartTasks([],'next7','2026-10-22'),[]);
});
