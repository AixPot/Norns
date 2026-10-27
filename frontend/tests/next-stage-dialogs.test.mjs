import test from 'node:test';
import assert from 'node:assert/strict';
import * as skip from '../src/occurrence-skip.mjs';
import * as removal from '../src/list-removal.mjs';

test('skip forwards the complete frozen preview without rebasing',()=>{
 const p={card_id:7,revision:12,touch_version:3,next_schedule:null};
 assert.equal(typeof skip.skipMutation,'function');
 assert.deepEqual(skip.skipMutation(p),{action:'card_skip',card_id:7,expected_revision:12,preview:p});
});

test('list removal forwards the complete preview, no additional wire fields',()=>{
 const p={board_id:2,source_list_id:3,target_list_id:4,revision:12,cards:[],task_count:0,attachment_fingerprint:'opaque'};
 assert.equal(typeof removal.listRemovalMutation,'function');
 assert.deepEqual(removal.listRemovalMutation(p),{action:'list_remove',expected_revision:12,preview:p});
});


test('unknown and drift classifications use status/code, not server prose',()=>{
 assert.equal(skip.actionFailure({status:409,code:'successor_touched',message:'不能撤销完成'},'unskip').message.includes('不能撤销跳过'),true);
 assert.equal(skip.actionFailure({status:409,code:'conflict'}).kind,'stale');
 assert.equal(skip.actionFailure(new Error('network')).kind,'unknown');
 assert.equal(skip.actionFailure({status:422,message:'plain text'}).message,'plain text');
});

test('plain text 422 is retained by response decoder',async()=>{
 await assert.rejects(()=>skip.readActionResponse(new Response('unknown field foo',{status:422})),e=>e.status===422&&e.message==='unknown field foo');
});

test('controller locks duplicate send and unknown cannot be retried',async()=>{
 let release,calls=0; const pending=new Promise(r=>release=r);
 const c=skip.createPreviewSession({isCurrent:()=>true});
 const p={card_id:7,revision:12,touch_version:3,next_schedule:null};
 assert.equal(await c.prepare(()=>Promise.resolve(p)),true);
 p.revision=90; assert.equal(c.preview().revision,12);
 const first=c.commit(async body=>{calls++; assert.equal(body.expected_revision,12);await pending;throw Error('lost')},skip.skipMutation);
 assert.equal(await c.commit(()=>{calls++},skip.skipMutation),false);
 release();await first;assert.equal(c.state(),'unknown');
 assert.equal(await c.prepare(()=>Promise.resolve(p)),false);assert.equal(calls,1);
});

test('expired identity suppresses callbacks and state updates',async()=>{
 let current=true,release;const pending=new Promise(r=>release=r);
 const c=skip.createPreviewSession({isCurrent:()=>current});
 const work=c.prepare(()=>pending); current=false;release({revision:1});
 assert.equal(await work,false);assert.equal(c.preview(),null);
});

test('list target choices are same-board, source excluded, with no default',()=>{
 assert.deepEqual(removal.removalTargets([{id:1,board_id:2},{id:2,board_id:2},{id:3,board_id:9}],2,1),[{id:2,board_id:2}]);
});


test('independent dialogs compile with labelled modal and render required semantics',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {compile}=await import('svelte/compiler');
 for(const file of ['SkipDialog','ListDeleteDialog']){
  const source=await readFile(new URL('../src/'+file+'.svelte',import.meta.url),'utf8');
  const result=compile(source,{filename:file+'.svelte',generate:'server'});
  assert.equal(result.warnings.length,0);
  assert.ok(result.js.code.length>0);
 }
});


test('unskip sends only the existing card identity and revision',()=>{
 assert.equal(typeof skip.unskipMutation,'function');
 assert.deepEqual(skip.unskipMutation(7,14),{action:'card_unskip',card_id:7,expected_revision:14});
});

test('conflict consumes confirmation and requires an explicit new preview',async()=>{
 const c=skip.createPreviewSession({isCurrent:()=>true});let reads=0,sends=0;
 const read=async()=>({card_id:7,revision:++reads,next_schedule:null});
 await c.prepare(read);
 await c.commit(async()=>{sends++;throw {status:409,code:'conflict'}},skip.skipMutation);
 assert.equal(c.state(),'stale');assert.equal(c.preview(),null);
 assert.equal(await c.commit(()=>{sends++},skip.skipMutation),false);
 assert.equal(reads,1);assert.equal(sends,1);
 await c.prepare(read);assert.equal(c.preview().revision,2);
});

test('cancel/disposal never writes and suppresses a late read',async()=>{
 let release;const pending=new Promise(r=>release=r),c=skip.createPreviewSession({isCurrent:()=>true});
 const work=c.prepare(()=>pending);c.dispose();release({revision:1});await work;
 assert.equal(c.preview(),null);assert.equal(await c.commit(()=>assert.fail('cancel wrote'),skip.skipMutation),false);
});
