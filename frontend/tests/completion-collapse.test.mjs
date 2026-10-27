import test from 'node:test';import assert from 'node:assert/strict';import {createCompletionMotion} from '../src/completion-motion.mjs';
test('B acknowledged row stays legible before collapsing; failures never enter success',()=>{
 let entries=[],jobs=[];const m=createCompletionMotion({change:v=>entries=v,setTimer:(fn,ms)=>{jobs.push({fn,ms});return fn},clearTimer:()=>{}});
 const a=m.begin({id:1,completed:false},true);assert.equal(entries[0].phase,'pending');m.finish(a,true);assert.equal(entries[0].phase,'settling');assert.ok(jobs[0].ms>=800,'success must remain visible');jobs.shift().fn();assert.equal(entries[0].phase,'collapsing');assert.ok(jobs[0].ms>=300);jobs.shift().fn();assert.equal(entries.length,0);
 const b=m.begin({id:2,completed:false},true);m.finish(b,false);assert.equal(entries.length,0);
});
