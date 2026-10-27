import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCompletionMotion,completionRows} from '../src/completion-motion.mjs';
test('immediate pending is separate from acknowledgement; hold only presentation and clear failures',()=>{
 let now=0,id=0,jobs=new Map(),entries=[];
 const m=createCompletionMotion({change:v=>entries=v,now:()=>now,setTimer:(fn,ms)=>{jobs.set(++id,{fn,at:now+ms});return id},clearTimer:id=>jobs.delete(id)});
 const card={id:1,completed:false,title:'A'};const token=m.begin(card,true);
 assert.equal(entries[0].phase,'pending');assert.equal(completionRows([card],entries)[0].completed,false);
 assert.equal(completionRows([card,{...card,completed:true}],entries).length,1,'overlapping discovery reads must not duplicate held rows');
 now=600;m.finish(token,true);assert.equal(entries[0].phase,'settling');
 assert.equal(completionRows([{...card,completed:true}],entries)[0].completed,false);
 now=1500;[...jobs.values()][0].fn();assert.equal(entries[0].phase,'collapsing');[...jobs.values()].at(-1).fn();assert.equal(entries.length,0);
 const second=m.begin(card,true);m.finish(second,false);assert.equal(entries.length,0);
});
test('clear cancels timers and rejects stale finishes; reduced motion skips hold; projection does not mutate snapshots',()=>{
 let entries=[],jobs=new Set();const m=createCompletionMotion({change:v=>entries=v,setTimer:fn=>{jobs.add(fn);return fn},clearTimer:fn=>jobs.delete(fn)});
 const card={id:1,completed:false,title:'A'},a=m.begin(card,true);m.finish(a,true);assert.equal(jobs.size,1);m.clear();assert.equal(jobs.size,0);m.finish(a,true);assert.equal(entries.length,0);
 const reduced=createCompletionMotion({change:v=>entries=v,reduced:()=>true});const b=reduced.begin(card,true);const projected=completionRows([],entries);assert.equal(projected.length,1);assert.equal(card.completed,false);assert.equal(completionRows([{...card,archived:true}],entries)[0].archived,true);reduced.finish(b,true);assert.equal(entries.length,0);
});
