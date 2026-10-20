import test from 'node:test';
import assert from 'node:assert/strict';
import {taskQuery,createTaskLoader} from '../src/task-discovery.mjs';
test('combines explicit filters without losing literal keywords',()=>{
 const q=new URLSearchParams(taskQuery({q:'100%_ 中文',view:'mine',status:'incomplete',assignee_id:'3',board_id:'2',from:'2028-02-28',to:'2028-03-01'}));
 assert.equal(q.get('q'),'100%_ 中文'); assert.equal(q.get('view'),'mine');assert.equal(q.get('status'),'incomplete');assert.equal(q.get('assignee_id'),'3');assert.equal(q.get('board_id'),'2');assert.equal(q.get('from'),'2028-02-28'); assert.equal(q.get('to'),'2028-03-01');
 assert.equal(taskQuery({view:'all',status:'all',q:'',from:'',to:'',assignee_id:'',board_id:''}),'view=all&status=all');
});
test('superseded query and stopped component cannot publish results or failures',async()=>{
 let pending=[],values=[],errors=[];
 const loader=createTaskLoader({read:q=>new Promise((resolve,reject)=>pending.push({q,resolve,reject})),apply:v=>values.push(v),onerror:e=>errors.push(e)});
 const a=loader.load('a'),b=loader.load('b');pending[1].resolve('fresh');await b;pending[0].resolve('old');await a;assert.deepEqual(values,['fresh']);
 const c=loader.load('c');loader.stop();pending[2].reject(new Error('late'));await c;assert.deepEqual(errors,[]);
});
