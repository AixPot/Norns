import test from 'node:test';
import assert from 'node:assert/strict';
const {createMutationQueue}=await import('../src/mutation-queue.mjs').catch(()=>({}));
const tick=()=>new Promise(r=>setImmediate(r));
test('three admitted intents serialize using the previous confirmed revision',async()=>{
 assert.equal(typeof createMutationQueue,'function');
 let revision=3,release;const sent=[];
 const q=createMutationQueue({revision:()=>revision,apply:r=>revision=r});
 const write=n=>q.run(async rev=>{sent.push([n,rev]);await new Promise(r=>release=r);return rev+1});
 const one=write(1),two=write(2),three=write(3);await tick();assert.deepEqual(sent,[[1,3]]);
 release();await one;await tick();assert.deepEqual(sent,[[1,3],[2,4]]);
 release();await two;await tick();assert.deepEqual(sent,[[1,3],[2,4],[3,5]]);
 release();await three;await q.idle();assert.equal(revision,6);
});
for(const status of [403,409,undefined])test(`failure ${status||'unknown'} stops and explicitly rejects unsent intents without replay`,async()=>{
 let calls=0,release;const q=createMutationQueue({revision:()=>1,apply:()=>{}});
 const one=q.run(async()=>{calls++;await new Promise(r=>release=r);throw Object.assign(Error('blocked'),{status})});
 const two=q.run(async()=>{calls++;return 2});const rejected=Promise.allSettled([one,two]);
 await tick();release();const results=await rejected;assert.deepEqual(results.map(r=>r.status),['rejected','rejected']);assert.equal(calls,1);
 await assert.rejects(q.run(async()=>{calls++;return 2}));assert.equal(calls,1);await q.idle();
});
test('known semantic rejection does not poison later safe writes',async()=>{
 let revision=1;const q=createMutationQueue({revision:()=>revision,apply:r=>revision=r});
 await assert.rejects(q.run(async()=>{throw Object.assign(Error('touched'),{status:400,code:'successor_touched'})}));
 assert.equal(await q.run(async r=>r+1),2);assert.equal(revision,2);
});

test('idle includes work admitted while a prior write is settling',async()=>{
 let release,revision=1;const q=createMutationQueue({revision:()=>revision,apply:r=>revision=r});
 const first=q.run(async r=>{await new Promise(r=>release=r);return r+1});
 let left=false;const leave=q.idle().then(()=>left=true);await tick();
 const second=q.run(async r=>{await new Promise(r=>release=r);return r+1});
 release();await first;await tick();assert.equal(left,false);release();await second;await leave;assert.equal(left,true);
});

test("a new idle round starts at the displayed polled snapshot, not the previous writer acknowledgement",async()=>{
 let acknowledged=4;const sent=[];
 const q=createMutationQueue({revision:()=>acknowledged,apply:r=>acknowledged=r});
 await q.run(async r=>{sent.push(r);return r+1});await q.idle();
 const displayedPollRevision=6;
 await q.run(async r=>{sent.push(r);assert.equal(r,6);return r+1},displayedPollRevision);
 await q.idle();assert.deepEqual(sent,[4,6]);assert.equal(acknowledged,7);
});

test('external poll during an active round cannot rebase already accepted work',async()=>{
 let acknowledged=4,server=4,release;const sent=[];
 const q=createMutationQueue({revision:()=>acknowledged,apply:r=>acknowledged=r});
 const one=q.run(async r=>{sent.push(r);server=r+1;await new Promise(done=>release=done);return r+1},4);
 await tick();server=6; // collaborator commits after first write but before its response
 const two=q.run(async r=>{sent.push(r);if(r!==server)throw Object.assign(Error('conflict'),{status:409});return ++server},6);
 const outcomes=Promise.allSettled([one,two]);release();
 assert.deepEqual((await outcomes).map(r=>r.status),['fulfilled','rejected']);
 await q.idle();assert.deepEqual(sent,[4,5]);
 await assert.rejects(q.run(async()=>++server,6));assert.equal(server,6);
});

test('a detached dirty draft retains its baseline even after a newer idle poll',async()=>{
 let acknowledged=4,server=6,dirtyDraftRevision=4;const sent=[];
 const q=createMutationQueue({revision:()=>acknowledged,apply:r=>acknowledged=r});
 await assert.rejects(q.run(async r=>{sent.push(r);if(r!==server)throw Object.assign(Error('conflict'),{status:409});return ++server},dirtyDraftRevision),{status:409});
 await q.idle();assert.deepEqual(sent,[4]);assert.equal(dirtyDraftRevision,4);assert.equal(server,6);
});
