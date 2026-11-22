import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/autosave.mjs').catch(()=>({}));
import {createMutationQueue} from '../src/mutation-queue.mjs';
import {acceptSnapshot} from '../src/collaboration.mjs';
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
test('polled revision does not rebase a dirty draft; 409 retains input until explicit review and retry',async t=>{
 const initial={title:'old',description:'old'},draft={...initial};
 let displayed={id:1,revision:4,fields:initial},server=displayed,state;
 const sent=[];
 const queue=createMutationQueue({revision:()=>displayed.revision,apply:snapshot=>{displayed=acceptSnapshot(displayed,snapshot)}});
 const save=module.createAutosave({read:()=>({...draft}),revision:displayed.revision,delay:10000,onstate:s=>{state=s},write:async(fields,baseline)=>{
  const result=await queue.run(async revision=>{
   sent.push({revision,fields});
   if(revision!==server.revision)throw Object.assign(Error('conflict'),{status:409});
   return server={...server,revision:revision+1,fields};
  },baseline);
  return result.revision;
 }});
 t.after(()=>save.stop());
 draft.description='第二行\n草稿';save.change();
 server={id:1,revision:8,fields:{title:'remote',description:'remote'}};
 displayed=acceptSnapshot(displayed,server);
 assert.equal(displayed.revision,8);
 assert.equal(await save.flush(),false);
 assert.deepEqual(draft,{title:'old',description:'第二行\n草稿'});
 assert.equal(save.revision(),4);assert.equal(state,'conflict');assert.equal(save.pending(),true);
 assert.deepEqual(sent,[{revision:4,fields:draft}]);
 draft.description+='！';save.change();
 assert.equal(await save.flush(),false);assert.equal(sent.length,1);assert.equal(server.fields.description,'remote');
 // The editor adopts the reviewed remote value for the untouched field only.
 await queue.idle();queue.reset();
 draft.title=displayed.fields.title;save.rebaseBaseline(displayed.fields,displayed.revision);
 assert.equal(await save.retry(),true);
 assert.deepEqual(sent[1],{revision:8,fields:{title:'remote',description:'第二行\n草稿！'}});
 assert.deepEqual(server.fields,draft);assert.equal(save.revision(),9);assert.equal(save.pending(),false);
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
