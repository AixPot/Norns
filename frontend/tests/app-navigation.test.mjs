import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Exercise the actual App queue function, not a duplicated helper implementation.
const source=fs.readFileSync(new URL('../src/App.svelte',import.meta.url),'utf8');
const fn=source.slice(source.indexOf(' function completeTask('),source.indexOf(' async function showInboxArchive('));
function harness(){
 let release,arrive;const held=new Promise(r=>arrive=r),gate=new Promise(r=>release=r);const posts=[];
 const context=vm.createContext({Promise, user:{id:1},identity:{ticket:()=>1,accept:t=>t===1},completionEpoch:1,requestEpoch:0,uncertainScope:0,error:'',pendingCards:[],taskSerial:Promise.resolve(),transferOpen:false,boards:[{id:1},{id:2}],inbox:null,taskRefresh:0,board:null,writer:null,
 completionOwner:id=>({board:id,epoch:context.completionEpoch}),ownsCompletion:o=>o.epoch===context.completionEpoch,
 motion:{begin:()=>({}),finish:()=>{}},leaveDraft:async()=>true,
 api:async path=>{if(path==='/boards/1'){arrive();await gate}return {id:Number(path.split('/').at(-1)),cards:[{id:Number(path.split('/').at(-1)),completed:false}]};},
 mutate:async data=>{posts.push(data);return 'success'},fail:e=>{throw e}});
 vm.runInContext(ts.transpile(fn,{target:ts.ScriptTarget.ES2022}),context);
 return {context,held,release,posts,click:id=>context.completeTask({id,board_id:id,completed:false})};
}
test('App cancels queued smart completion after navigation during first read',async()=>{
 const h=harness(),a=h.click(1);await h.held;const b=h.click(2);h.context.completionEpoch++;h.context.requestEpoch++;h.release();
 assert.equal(await a,false);assert.equal(await b,false);assert.deepEqual(h.posts,[]);assert.equal(h.context.board,null);assert.equal(h.context.pendingCards.length,0);
});
test('App keeps same-view cross-board completion queue legal',async()=>{
 const h=harness(),a=h.click(1);await h.held;const b=h.click(2);h.release();assert.equal(await a,true);assert.equal(await b,true);assert.deepEqual(h.posts.map(p=>p.card_id),[1,2]);
});
