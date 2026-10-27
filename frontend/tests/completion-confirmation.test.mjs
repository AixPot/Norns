import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as motion from '../src/completion-motion.mjs';
const {createCompletionMotion}=motion;
function fixture(options={}){let entries=[],id=0;const jobs=new Map(),events=[];const m=createCompletionMotion({change:x=>entries=x,now:()=>0,setTimer:(fn,ms)=>{jobs.set(++id,{fn,ms});return id},clearTimer:id=>jobs.delete(id),onconfirmed:e=>events.push(e),...options});return {m,jobs,events,entries:()=>entries}}
test('confirmation has a full post-ack stamp interval, independent for consecutive rows',()=>{
 const x=fixture();const a=x.m.begin({id:1,completed:false},true),b=x.m.begin({id:2,completed:false},true);
 assert.equal(a.confirmed,false);assert.equal(x.events.length,0);
 assert.equal(x.m.finish(a,true),true);assert.equal(a.confirmed,true);assert.equal(a.phase,'settling');
 assert.equal(b.phase,'pending');assert.deepEqual(x.events,[a]);assert.equal([...x.jobs.values()][0].ms,360);
 x.m.finish(a,true);assert.equal(x.events.length,1);assert.equal(x.jobs.size,1);
 x.m.finish(b,true);assert.equal(x.jobs.size,2);
});
test('owner/task validation rejects stale acknowledgements and cancel isolates one row',()=>{
 let valid=true;const x=fixture({valid:()=>valid});const a=x.m.begin({id:1},true,{user:1,epoch:2}),b=x.m.begin({id:2},true);
 valid=false;assert.equal(x.m.finish(a,true),false);assert.equal(x.events.length,0);assert.equal(x.entries().length,1);
 valid=true;x.m.cancel(b);assert.equal(x.entries().length,0);assert.equal(x.m.finish(b,true),false);
 const c=x.m.begin({id:3},true);x.m.finish(c,'unknown');assert.equal(x.events.length,0);assert.equal(x.entries().length,0);
 const d=x.m.begin({id:4},false);x.m.finish(d,true);assert.equal(x.events.length,0);
});
test('reduced motion emits durable-slot confirmation before releasing row without a timer',()=>{
 const x=fixture({reduced:()=>true});const a=x.m.begin({id:1},true);x.m.finish(a,true);
 assert.equal(x.events.length,1);assert.equal(x.events[0].confirmed,true);assert.equal(x.jobs.size,0);assert.equal(x.entries().length,0);
});
test('appearance offers real neutral pending text and success-only seal/text for entry renderers',()=>{
 assert.equal(typeof motion.completionAppearance,'function');
 const x=fixture(),a=x.m.begin({id:1,completed:false},true);
 assert.deepEqual(motion.completionAppearance(a),{busy:true,checked:false,seal:false,label:'保存中',phase:'pending'});
 x.m.finish(a,true);assert.deepEqual(motion.completionAppearance(a),{busy:false,checked:true,seal:true,label:'已完成',phase:'settling'});
 assert.deepEqual(motion.completionAppearance(null),{busy:false,checked:undefined,seal:false,label:'',phase:''});
 const b=x.m.begin({id:2,completed:true},false);assert.equal(motion.completionAppearance(b).label,'恢复中');assert.equal(motion.completionAppearance(b).seal,false);
});
