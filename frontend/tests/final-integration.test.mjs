import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/App.svelte',import.meta.url),'utf8');
function appFunction(name,end){const start=source.indexOf(` async function ${name}(`);assert.notEqual(start,-1,`${name} must be wired into App`);return source.slice(start,source.indexOf(end,start))}
test('App preview dialog cannot acquire overlay after sibling opens during flush',async()=>{
 const fn=appFunction('openOccurrenceDialog',' async function nextPreview(');
 let release;const gate=new Promise(r=>release=r);let available=true;
 const original={id:7};const context=vm.createContext({user:{id:1},board:{id:2,cards:[{id:7,skipped:false}]},draft:original,requestEpoch:1,recoveryHold:false,uncertainScope:0,overlayReady:()=>available,detailRef:{transferReady:()=>true,snapshotFocus:()=>()=>{}},autosave:{flush:()=>gate},writer:null,identity:{ticket:()=>1,accept:()=>true},nextModal:null,nextSerial:0,nextReturn:null,error:'',structuredClone,Promise});
 vm.runInContext(ts.transpile(fn,{target:ts.ScriptTarget.ES2022}),context);
 const opening=context.openOccurrenceDialog('skip');available=false;release(true);await opening;assert.equal(context.nextModal,null);
});
test('App dialog commit propagates writer rejection and never reports local success',async()=>{
 const fn=appFunction('commitNext',' async function verifyNext('),ticket={kind:'skip',boardId:2,subjectId:7};let writes=0;
 const context=vm.createContext({ownsNext:t=>t===ticket,uncertainScope:0,writeBoard:async()=>{writes++;throw Object.assign(new Error('drift'),{status:409})},ApiError:class extends Error{},unknownOutcome:()=>false,nextUnknown:null,rebaseDraft:null,board:{id:2},selected:[],clearSelection(){},Promise});
 vm.runInContext(ts.transpile(fn,{target:ts.ScriptTarget.ES2022}),context);
 await assert.rejects(context.commitNext(ticket,{expected_revision:3,action:'card_skip',preview:{}}),/drift/);assert.equal(writes,1);assert.equal(context.nextUnknown,null);
});

test('App acknowledged removal preserves current detail identity but rebases real list scope',async()=>{
 const fn=appFunction('commitNext',' async function verifyNext('),ticket={kind:'remove',boardId:2,subjectId:10},original={id:7,list_id:10,position:0};
 const fresh={id:2,cards:[{id:7,list_id:20,position:9}],revision:8};
 const context=vm.createContext({ownsNext:t=>t===ticket,uncertainScope:0,writeBoard:async()=>fresh,ApiError:class extends Error{},unknownOutcome:()=>false,nextUnknown:null,rebaseDraft:()=>{},draft:original,board:fresh,selected:[],clearSelection(){},Promise});
 vm.runInContext(ts.transpile(fn,{target:ts.ScriptTarget.ES2022}),context);await context.commitNext(ticket,{expected_revision:7,action:'list_remove',preview:{}});
 assert.equal(context.draft,original);assert.equal(original.list_id,20);assert.equal(original.position,9);
});

test('App refuses removal while mounted capture or list editor still has input',async()=>{
 const fn=appFunction('openListRemoval',' async function readHistory(');
 const context=vm.createContext({user:{id:1},board:{id:2,lists:[{id:10},{id:20}],cards:[]},draft:null,overlayReady:()=>true,recoveryHold:false,identity:{ticket:()=>1,accept:()=>true},requestEpoch:1,autosave:null,writer:null,boardRef:{overlayReady:()=>true,hasPending:()=>true},detailRef:null,nextReturn:null,nextModal:null,nextTicket:()=>({kind:'remove'}),error:'',Promise});
 vm.runInContext(ts.transpile(fn,{target:ts.ScriptTarget.ES2022}),context);await context.openListRemoval(10);assert.equal(context.nextModal,null);
});

test('App historical opening rechecks identity after awaited editor departure',async()=>{
 const fn=appFunction('openHistorical','\n</script>');let release;const gate=new Promise(r=>release=r),ticket={uid:1,auth:1};let edits=0;
 const oldBoard={id:2,cards:[{id:7}]},context=vm.createContext({ownsNext:()=>true,api:async()=>oldBoard,user:{id:1},identity:{accept:()=>context.user.id===1},closeNext:async()=>{},leaveDraft:()=>gate,board:null,writer:null,edit:async()=>edits++,anchor:{},document:{body:{}},Promise});
 vm.runInContext(ts.transpile(fn,{target:ts.ScriptTarget.ES2022}),context);const opening=context.openHistorical(ticket,{id:7});await new Promise(r=>setImmediate(r));context.user={id:2};release(true);await opening;assert.equal(edits,0);assert.equal(context.board,null);
});
