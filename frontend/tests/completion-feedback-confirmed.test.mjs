import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCompletionFeedback} from '../src/completion-feedback.mjs';
test('notice validates ownership at show and undo; unknown undo disables replay without success',async()=>{
 let current=null,valid=true;const timers=[];
 const f=createCompletionFeedback({change:x=>current=x,valid:()=>valid,setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimer:()=>{}});
 valid=false;assert.equal(f.show({card:1}),false);assert.equal(current,null);
 valid=true;assert.equal(f.show({card:2}),true);assert.equal(timers[0].ms,10000);
 await f.undo(async()=> 'unknown');assert.equal(current.status,'unknown');assert.equal(current.pending,false);
 await f.undo(async()=>assert.fail('unknown must never replay'));
 f.show({card:3});valid=false;await f.undo(async()=>assert.fail('stale identity must not write'));assert.equal(current,null);
});
test('unclassified thrown undo result is unknown, not an invitation to replay',async()=>{
 let current;const f=createCompletionFeedback({change:x=>current=x,setTimer:()=>1,clearTimer:()=>{}});
 f.show({card:1});await assert.rejects(f.undo(async()=>{throw new Error('connection lost')}),/connection lost/);
 assert.equal(current.status,'unknown');assert.equal(current.pending,false);
 await f.undo(async()=>assert.fail('must read back first'));
});
