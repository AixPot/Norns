import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPoller,acceptSnapshot} from '../src/collaboration.mjs';
test('snapshot rejects obsolete revisions without touching draft ownership',()=>{
 const draft={description:'local',comment:'typing',checklist:'typing',revision:2};
 const current={id:1,revision:4};
 assert.equal(acceptSnapshot(current,{id:1,revision:3}),current);
 assert.equal(acceptSnapshot(current,{id:2,revision:9}),current);
 assert.deepEqual(acceptSnapshot(current,{id:1,revision:5}),{id:1,revision:5});
 assert.equal(draft.revision,2);
});
test('poll requests serialize, pause hidden, resume immediately, discard stopped response',async()=>{
 let visible=true,scheduled,resolve,calls=0;const received=[];
 const poll=createPoller({read:()=>{calls++;return new Promise(r=>resolve=r)},apply:v=>received.push(v),visible:()=>visible,schedule:fn=>{scheduled=fn;return 1},cancel:()=>{scheduled=null}});
 poll.check();poll.check();assert.equal(calls,1);resolve(1);await new Promise(r=>setImmediate(r));assert.deepEqual(received,[1]);
 visible=false;poll.check();assert.equal(calls,1);visible=true;poll.check();assert.equal(calls,2);poll.stop();resolve(2);await new Promise(r=>setImmediate(r));assert.deepEqual(received,[1]);assert.equal(scheduled,null);
});
