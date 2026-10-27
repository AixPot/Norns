import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.env.NORNS_FRONTEND_PACKAGE||new URL('../package.json',import.meta.url));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const root=new URL('..',import.meta.url).pathname;
const server=await createServer({root,server:{middlewareMode:true},appType:'custom'});
try{
 const {render}=await server.ssrLoadModule('svelte/server');
 const {default:BoardView}=await server.ssrLoadModule('/src/BoardView.svelte');
 const card={id:1,title:'ack owned row',description:'',list_id:1,completed:false,skipped:false,archived:false,position:0,schedule:null};
 const board={id:1,title:'board',revision:1,lists:[{id:1,title:'list',position:0}],cards:[card],members:[],checklist:[],comments:[]};
 const props={board,busy:false,accountId:1,display:{group:'default',sort:'manual'},ondisplay(){},moveOwner:'1:1',onedit(){},onaction:async()=>true,onmove:async()=>true};
 const html=entry=>render(BoardView,{props:{...props,completionMotion:[entry],pendingCards:entry.phase==='pending'?[1]:[]}}).body;
 await test('real board pending is neutral; acknowledged row is checked without a receipt',()=>{
  const pending=html({id:1,record:card,target:true,phase:'pending',confirmed:false});
  const checkbox=pending.match(/<input[^>]+aria-label="完成 ack owned row"[^>]*>/)?.[0];
  assert.ok(checkbox);assert.doesNotMatch(checkbox,/\schecked(?:\s|=|>)/);
  assert.doesNotMatch(pending,/class="completion-seal"/);
  const confirmed=html({id:1,record:card,target:true,phase:'settling',confirmed:true});
  assert.doesNotMatch(confirmed,/completion-seal|completion-status|已完成/);
  const checked=confirmed.match(/<input[^>]+aria-label="完成 ack owned row"[^>]*>/)?.[0];
  assert.match(checked,/\schecked(?:\s|=|>)/);assert.match(confirmed,/card-completed/);
  assert.match(pending,/保存中/);
 });
}finally{await server.close()}
