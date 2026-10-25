import test from 'node:test';
import assert from 'node:assert/strict';
const defaults={group:'default',sort:'manual'};
function storage(){const values=new Map(),reads=[];return {values,reads,getItem(k){reads.push(k);return values.get(k)??null},setItem(k,v){values.set(k,v)}}}
const scope={surface:'smart',scope:'today'};
test('versioned preferences persist enums only and isolate account/surface/scope',async()=>{
 const {createViewPreferences}=await import('../src/view-preferences.mjs');
 const s=storage(),a=createViewPreferences({accountId:1,storage:s});
 assert.deepEqual(a.get(scope),defaults);
 assert.equal(a.set(scope,{group:'date',sort:'date'}),true);
 assert.deepEqual(createViewPreferences({accountId:1,storage:s}).get(scope),{group:'date',sort:'date'});
 const b=createViewPreferences({accountId:2,storage:s});assert.deepEqual(b.get(scope),defaults);
 assert.deepEqual(a.get({surface:'search',scope:'today'}),defaults);assert.deepEqual(a.get({...scope,scope:'next7'}),defaults);
 assert.ok(s.reads.at(-3).includes('account.2.'));
 const [key,value]=[...s.values][0];assert.match(key,/v1.account.1/);assert.deepEqual(JSON.parse(value),{version:1,group:'date',sort:'date'});
});

test('rejects task content, selection and non-enums without persisting them',async()=>{
 const {createViewPreferences}=await import('../src/view-preferences.mjs');
 const s=storage(),p=createViewPreferences({accountId:1,storage:s});
 for(const v of [{group:'oops',sort:'manual'},{group:'none',sort:'due'},{group:'none',sort:'date',selected:[1]},{group:'none',sort:'date',title:'secret'},null,{}])assert.equal(p.set(scope,v),false);
 assert.equal(s.values.size,0);assert.deepEqual(p.get(scope),defaults);
});
test('denied reads/writes retain memory only and returned settings cannot mutate it',async()=>{
 const {createViewPreferences}=await import('../src/view-preferences.mjs');
 const denied={getItem(){throw Error('denied')},setItem(){throw Error('quota')}};
 const p=createViewPreferences({accountId:1,storage:denied});assert.deepEqual(p.get(scope),defaults);
 assert.equal(p.set(scope,{group:'board',sort:'date'}),true);
 const value=p.get(scope);value.group='none';assert.deepEqual(p.get(scope),{group:'board',sort:'date'});
 assert.deepEqual(createViewPreferences({accountId:2,storage:denied}).get(scope),defaults);
 assert.deepEqual(createViewPreferences({accountId:1,storage:null}).get(scope),defaults);
});
test('invalid JSON, schema, version and enum fall back to defaults',async()=>{
 const {createViewPreferences}=await import('../src/view-preferences.mjs');
 for(const raw of ['{','null','[]','{"version":2,"group":"none","sort":"date"}','{"version":1,"group":"x","sort":"date"}','{"version":1,"group":"none","sort":"date","selected":[1]}']){
  const s={getItem(){return raw},setItem(){}};
  assert.deepEqual(createViewPreferences({accountId:1,storage:s}).get(scope),defaults);
 }
});
test('invalid accounts/scopes never touch storage or share fallback settings',async()=>{
 const {createViewPreferences}=await import('../src/view-preferences.mjs');
 let calls=0;const s={getItem(){calls++;return null},setItem(){calls++}};
 for(const accountId of [undefined,null,0,-1,'1']){
  const p=createViewPreferences({accountId,storage:s});assert.deepEqual(p.get(scope),defaults);assert.equal(p.set(scope,{group:'date',sort:'date'}),false);
 }
 const p=createViewPreferences({accountId:1,storage:s});
 for(const bad of [null,{}, {...scope,surface:'task'}, {...scope,scope:''},{...scope,scope:'title secret'},{...scope,selected:[1]}]){
  assert.deepEqual(p.get(bad),defaults);assert.equal(p.set(bad,{group:'none',sort:'manual'}),false);
 }
 assert.equal(calls,0);
});

test('unavailable browser storage getter safely falls back to account-local memory',async()=>{
 const {createViewPreferences}=await import('../src/view-preferences.mjs');
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('SecurityError')}});
 try{
  const p=createViewPreferences({accountId:7});assert.deepEqual(p.get(scope),defaults);
  assert.equal(p.set(scope,{group:'none',sort:'date'}),true);assert.deepEqual(p.get(scope),{group:'none',sort:'date'});
  assert.deepEqual(createViewPreferences({accountId:8}).get(scope),defaults);
 }finally{if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage}
});

test('wide and narrow preferences independently inherit v1 until explicitly changed',async()=>{
 const {createViewPreferences}=await import('../src/view-preferences.mjs');
 const s=storage(),legacy='norns.view-preferences.v1.account.1.smart.today';
 s.values.set(legacy,JSON.stringify({version:1,group:'board',sort:'date'}));
 const p=createViewPreferences({accountId:1,storage:s});
 assert.deepEqual(p.get(scope,'wide'),{group:'board',sort:'date'});
 assert.deepEqual(p.get(scope,'narrow'),{group:'board',sort:'date'});
 p.set(scope,{group:'none',sort:'manual'},'narrow');
 assert.deepEqual(p.get(scope,'wide'),{group:'board',sort:'date'});
 const reload=createViewPreferences({accountId:1,storage:s});
 assert.deepEqual(reload.get(scope,'narrow'),{group:'none',sort:'manual'});
 assert.deepEqual(reload.get(scope,'wide'),{group:'board',sort:'date'});
 assert.deepEqual(createViewPreferences({accountId:2,storage:s}).get(scope,'narrow'),defaults);
 assert.equal(s.values.get(legacy),JSON.stringify({version:1,group:'board',sort:'date'}));
 assert.deepEqual(JSON.parse(s.values.get('norns.view-preferences.v2.account.1.smart.today.narrow')),{version:2,group:'none',sort:'manual'});
 const denied=createViewPreferences({accountId:1,storage:null});denied.set(scope,{group:'date',sort:'date'},'narrow');assert.deepEqual(denied.get(scope,'wide'),defaults);
});
