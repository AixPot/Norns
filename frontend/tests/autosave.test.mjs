import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/autosave.mjs').catch(()=>({}));
const tick=()=>new Promise(r=>setImmediate(r));
test('autosave serializes in-flight input and flush drains latest revision',async()=>{
 assert.equal(typeof module.createAutosave,'function','autosave controller must exist');
 let value={title:'initial'},resolve; const writes=[];
 const save=module.createAutosave({read:()=>({...value}),revision:2,write:(data,rev)=>{writes.push({data,rev});return new Promise(r=>resolve=r)},delay:10000});
 value.title='first';save.change(); const flushed=save.flush();await tick();
 value.title='latest';save.change(); assert.equal(writes.length,1);resolve(3);await tick();
 assert.deepEqual(writes[1],{data:{title:'latest'},rev:3});resolve(4);
 assert.equal(await flushed,true);assert.equal(save.pending(),false);save.stop();
});

test('auxiliary actions flush text, serialize typing, and carry revision forward',async()=>{
 let value={title:'old'},release;const calls=[];
 const save=module.createAutosave({read:()=>({...value}),revision:1,write:async(d,r)=>{calls.push([d.title,r]);return r+1},delay:10000});
 value.title='before';save.change();
 assert.equal(typeof save.action,'function');
 const action=save.action(async rev=>{calls.push(['action',rev]);await new Promise(r=>release=r);return rev+1});await tick();
 value.title='during';save.change();release();assert.equal(await action,true);
 assert.deepEqual(calls,[['before',1],['action',2],['during',3]]);save.stop();
});

test('failure retains input, blocks flush and retries only explicitly',async()=>{
 let value={title:'old'},fail=true,calls=0;const states=[];
 const save=module.createAutosave({read:()=>({...value}),revision:1,write:async()=>{calls++;if(fail)throw Error('offline');return 2},delay:10000,onstate:s=>states.push(s)});
 value.title='kept';save.change();assert.equal(await save.flush(),false);assert.equal(value.title,'kept');assert.equal(save.pending(),true);
 value.title='more typing';save.change();assert.equal(await save.flush(),false);assert.equal(calls,1);assert.ok(states.includes('error'));
 fail=false;assert.equal(await save.retry(),true);assert.equal(calls,2);assert.equal(save.pending(),false);save.stop();
});
test('conflict does not silently rebase; explicit baseline preserves local changes',async()=>{
 let value={title:'old',description:'old'},conflict=true;const revisions=[];let sent;
 const save=module.createAutosave({read:()=>({...value}),revision:1,write:async(d,r)=>{sent=d;revisions.push(r);if(conflict)throw Object.assign(Error('conflict'),{status:409});return r+1},delay:10000});
 value.description='local';save.change();assert.equal(await save.flush(),false);assert.deepEqual(revisions,[1]);
 value.title='remote';conflict=false;save.rebaseBaseline({title:'remote',description:'remote'},8);
 assert.equal(await save.retry(),true);assert.deepEqual(sent,{title:'remote',description:'local'});assert.deepEqual(revisions,[1,8]);save.stop();
});
test('composition suppresses debounce/blur until final input; stopped owner cannot write',async()=>{
 let value={title:'old'},calls=0;
 const save=module.createAutosave({read:()=>({...value}),revision:1,write:async()=>{calls++;return 2},delay:5});
 save.composition(true);value.title='组合';save.change();await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);assert.equal(await save.flush(),false);
 save.composition(false);assert.equal(await save.flush(),true);assert.equal(calls,1);save.stop();value.title='late';save.change();assert.equal(await save.flush(),false);assert.equal(calls,1);
});

test('partial success carries revision through failure instead of retrying stale CAS',async()=>{
 let value={title:'old'},attempt=0;const revisions=[];
 const save=module.createAutosave({read:()=>({...value}),revision:1,write:async(_d,r)=>{revisions.push(r);if(attempt++===0)throw Object.assign(Error('second write failed'),{revision:2});return 3},delay:10000});
 value.title='new';save.change();assert.equal(await save.flush(),false);assert.equal(await save.retry(),true);assert.deepEqual(revisions,[1,2]);save.stop();
});
test('auxiliary failure retains submitted input for explicit resubmit, queued work is not sent',async()=>{
 let value={title:'old'},calls=0;
 const save=module.createAutosave({read:()=>({...value}),revision:1,write:async()=>2,delay:10000});
 assert.equal(await save.action(async()=>{calls++;throw Error('failed')}),false);
 assert.equal(await save.action(async()=>{calls++;return 3}),false);assert.equal(calls,1);
 await save.retry();assert.equal(await save.action(async()=>{calls++;return 3}),true);assert.equal(calls,2);save.stop();
});
