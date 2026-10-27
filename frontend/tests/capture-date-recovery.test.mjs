import test from 'node:test';import assert from 'node:assert/strict';import {createDraftRecoveryStore} from '../src/draft-recovery.mjs';
test('explicit capture date survives same-tab storage reload without automatic default',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const store=createDraftRecoveryStore({accountId:1,storage});const scope={kind:'capture',boardId:2,listId:3};
 assert.equal(store.put({scope,generation:1,revision:0,baseline:{raw:''},fields:{raw:'保留标题',acceptedParse:null,explicitDate:'2026-10-30'},unknownCreateOutcome:false}).ok,true);
 assert.equal(createDraftRecoveryStore({accountId:1,storage}).get(scope).record.fields.explicitDate,'2026-10-30');
});
