import test from 'node:test';
import assert from 'node:assert/strict';
const path = '../src/draft-recovery.mjs';
const memory = () => { const data=new Map(); return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}; };
const draft = (n=1) => ({scope:{kind:'capture',boardId:10,listId:n},generation:n,revision:3,baseline:{raw:''},fields:{raw:'明天买牛奶',acceptedParse:null},unknownCreateOutcome:false});
test('account-bound roundtrip stores detached minimal input with review-only contract', async()=>{
 const {createDraftRecoveryStore}=await import(path); const storage=memory();
 const a=createDraftRecoveryStore({accountId:1,storage,now:()=>1000}),b=createDraftRecoveryStore({accountId:2,storage,now:()=>1000});
 const input=draft(); assert.equal(a.put(input).ok,true); input.fields.raw='changed';
 assert.equal(a.get(input.scope).record.fields.raw,'明天买牛奶');
 assert.equal(a.get(input.scope).record.requiresScopeAuthorization,true);
 assert.equal(a.get(input.scope).record.requiresLatestBaselineReview,true);
 assert.deepEqual(b.list().records,[]); assert.equal(b.clearAccount().ok,true); assert.equal(a.list().records.length,1);
});
test('strict allowlists bound nested text and reject snapshots, secrets and malformed identities', async()=>{
 const {createDraftRecoveryStore}=await import(path); const storage=memory();const store=createDraftRecoveryStore({accountId:1,storage,now:()=>1000});
 for(const extra of ['csrf','password','session','files','signedURL','exportData','cards']) assert.equal(store.put({...draft(),[extra]:'never persist'}).reason,'invalid-record');
 for(const fields of [{raw:'a'.repeat(161),acceptedParse:null},{raw:'x',acceptedParse:{schedule:{start_date:'2026-02-30',timezone:'Asia/Shanghai'},remainingTitle:'x',spans:[],reason:'date',emptyTitle:false}},{raw:'x',csrf:'secret'},{raw:'x',acceptedParse:{evil:'nested'}}]) assert.equal(store.put({...draft(),fields}).reason,'invalid-record');
 assert.equal(store.put({...draft(),scope:{kind:'capture',boardId:10,listId:1,userId:2}}).reason,'invalid-record');
 assert.equal(createDraftRecoveryStore({accountId:'1',storage}).list().reason,'invalid-account');
 const edit={scope:{kind:'card',boardId:10,cardId:3},revision:3,generation:1,unknownCreateOutcome:false,fields:{title:'Edited',description:'unsent',comment:'pending',checklistTitle:'todo'},baseline:{title:'Original',description:''}};
 assert.equal(store.put(edit).ok,true);assert.deepEqual(store.get(edit.scope).record.baseline,edit.baseline);
 assert.equal(store.put({...edit,fields:{title:'a'.repeat(501)}}).reason,'invalid-record');
 assert.equal(store.put({...edit,fields:{description:'a'.repeat(20001)}}).reason,'invalid-record');
 assert.equal(store.put({...edit,fields:{comment:'a'.repeat(10001)}}).reason,'invalid-record');
 assert.equal(store.put({...edit,fields:{scheduleInput:{enabled:true,start:'x'.repeat(1000)}}}).reason,'invalid-record');
 assert.equal(store.put({...edit,baseline:{...edit.baseline,cards:[]}}).reason,'invalid-record');
 assert.equal(JSON.stringify([...storage.data]).includes('never persist'),false);
});
test('TTL cleanup affects only expired account records and reports corrupt own data', async()=>{
 const {createDraftRecoveryStore}=await import(path);const storage=memory();let clock=1000;const a=createDraftRecoveryStore({accountId:1,storage,now:()=>clock});
 a.put(draft());clock+=100; a.put(draft(2));storage.setItem('unrelated','keep');const other=createDraftRecoveryStore({accountId:2,storage,now:()=>clock});other.put(draft());
 clock=1000+24*60*60*1000;const result=a.list();assert.equal(result.ok,true);assert.equal(result.expiredRemoved,1);assert.equal(result.records.length,1);assert.equal(other.list().records.length,1);assert.equal(storage.getItem('unrelated'),'keep');
 const key=[...storage.data.keys()].find(k=>k.endsWith('.1'));storage.setItem(key,'{bad');assert.equal(a.list().reason,'corrupt-data');assert.equal(storage.getItem(key),null);
 storage.setItem(key,JSON.stringify({version:1,records:[{password:'secret'}]}));assert.equal(a.list().reason,'corrupt-data');assert.equal(storage.getItem('unrelated'),'keep');
});
test('corrupt sibling cleanup preserves valid unsaved records in own account envelope', async()=>{
 const {createDraftRecoveryStore}=await import(path);const storage=memory();const a=createDraftRecoveryStore({accountId:1,storage,now:()=>1000});a.put(draft());const key=[...storage.data.keys()][0],envelope=JSON.parse(storage.getItem(key));envelope.records.push({input:{password:'bad'},savedAt:1000});storage.setItem(key,JSON.stringify(envelope));assert.equal(a.list().reason,'corrupt-data');assert.equal(a.get(draft().scope).record.fields.raw,draft().fields.raw);
});
test('record and UTF-8 byte caps never evict unsaved drafts, failed writes preserve prior bytes', async()=>{
 const {createDraftRecoveryStore}=await import(path);const storage=memory();const a=createDraftRecoveryStore({accountId:1,storage,now:()=>1000});
 for(let i=1;i<=20;i++)assert.equal(a.put(draft(i)).ok,true);const before=JSON.stringify([...storage.data]);assert.equal(a.put(draft(21)).reason,'record-limit');assert.equal(JSON.stringify([...storage.data]),before);
 a.clearAccount();const large=n=>({scope:{kind:'card',boardId:1,cardId:n},revision:0,generation:1,unknownCreateOutcome:false,fields:{description:'汉'.repeat(20000)},baseline:{description:'汉'.repeat(20000)}});
 for(let i=1;i<=4;i++)assert.equal(a.put(large(i)).ok,true);const bytes=JSON.stringify([...storage.data]);assert.equal(a.put(large(5)).reason,'byte-limit');assert.equal(JSON.stringify([...storage.data]),bytes);
 const quota={...storage,setItem(){throw Object.assign(new Error(),{name:'QuotaExceededError'})}};assert.equal(createDraftRecoveryStore({accountId:1,storage:quota,now:()=>1000}).put(large(1)).reason,'quota-exceeded');assert.equal(JSON.stringify([...storage.data]),bytes);
});
test('storage denial and unavailable default never escape into typing', async()=>{
 const {createDraftRecoveryStore}=await import(path);const denied={getItem(){throw Error('denied')},removeItem(){throw Error('denied')}};const a=createDraftRecoveryStore({accountId:1,storage:denied});
 for(const result of [a.put(draft()),a.list(),a.get(draft().scope),a.removeIfGeneration(draft().scope,1),a.clearAccount()])assert.equal(result.reason,'storage-unavailable');
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');try{Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Error('denied')}});assert.equal(createDraftRecoveryStore({accountId:1}).put(draft()).reason,'storage-unavailable');}finally{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage;}
});
test('accepted capture parse and existing schedule drafts roundtrip without full snapshots', async()=>{
 const {createDraftRecoveryStore}=await import(path);const {parseCapture}=await import('../src/capture-time.mjs');const {scheduleDraft}=await import('../src/schedule-draft.mjs');const storage=memory();const a=createDraftRecoveryStore({accountId:1,storage,now:()=>1000});
 const raw='明天买牛奶',capture={...draft(),fields:{raw,acceptedParse:parseCapture(raw,{now:'2026-10-23T00:00:00Z'})}};assert.equal(a.put(capture).ok,true);assert.deepEqual(a.get({listId:1,boardId:10,kind:'capture'}).record.fields,capture.fields);
 const card={scope:{kind:'card',boardId:10,cardId:3},revision:3,generation:1,unknownCreateOutcome:false,fields:{scheduleInput:scheduleDraft(null)},baseline:{scheduleInput:scheduleDraft(null)}};assert.equal(a.put(card).ok,true);
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');try{Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});assert.equal(createDraftRecoveryStore({accountId:1,now:()=>1000}).list().records.length,2);}finally{if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);else delete globalThis.sessionStorage;}
});
test('generation acknowledgement preserves newer typing and unknown creates remain explicit-review-only', async()=>{
 const {createDraftRecoveryStore}=await import(path);const a=createDraftRecoveryStore({accountId:1,storage:memory(),now:()=>1000});const d={...draft(),unknownCreateOutcome:true};assert.equal(a.put(d).ok,true);const r=a.get(d.scope).record;assert.equal(r.unknownCreateOutcome,true);assert.equal(r.autoSubmitAllowed,false);
 assert.equal(a.put({...d,generation:2}).ok,true);assert.equal(a.put(d).reason,'stale-generation');assert.equal(a.removeIfGeneration(d.scope,1).removed,false);assert.equal(a.get(d.scope).record.generation,2);assert.equal(a.removeIfGeneration(d.scope,2).removed,true);assert.equal(a.get(d.scope).record,null);
});

test('raw schedule editor roundtrips empty and invalid numeric buffers without normalizing', async()=>{
 const {createDraftRecoveryStore,encodeScheduleEditor,decodeScheduleEditor}=await import(path);
 const {scheduleDraft,scheduleValidation}=await import('../src/schedule-draft.mjs');
 const storage=memory(),store=createDraftRecoveryStore({accountId:1,storage,now:()=>1000});
 const original={...scheduleDraft(null),enabled:true,start:'2026-10-23',unit:'week',weekdays:[0,3],ending:'count',end:'2026-10-22',startTime:'13:00',endTime:'12:00',until:''};
 for(const [i,value] of [undefined,0,1.5].entries()){
  const editor={...original,interval:value,count:value};assert.notEqual(scheduleValidation(editor),'');
  const encoded=encodeScheduleEditor(editor);
  assert.equal(encoded.interval,value===undefined?null:value);assert.equal(encoded.count,value===undefined?null:value);
  const card={scope:{kind:'card',boardId:10,cardId:3},revision:3,generation:i+1,unknownCreateOutcome:false,fields:{scheduleEditor:encoded},baseline:{scheduleEditor:encodeScheduleEditor(scheduleDraft(null))}};
  assert.equal(store.put(card).ok,true);
  const restored=createDraftRecoveryStore({accountId:1,storage,now:()=>1000}).get(card.scope).record;
  assert.deepEqual(decodeScheduleEditor(restored.fields.scheduleEditor),editor);
  assert.deepEqual(decodeScheduleEditor(restored.baseline.scheduleEditor),scheduleDraft(null));
  assert.deepEqual(editor,{...original,interval:value,count:value});
 }
 // The editor representation is complete and bounded, not a relaxed API schedule.
 assert.throws(()=>encodeScheduleEditor({...original,interval:Infinity}),TypeError);
 assert.throws(()=>encodeScheduleEditor({...original,count:'1.5'}),TypeError);
 assert.throws(()=>decodeScheduleEditor({...encodeScheduleEditor(original),csrf:'secret'}),TypeError);
 const invalid={...draft(),fields:{raw:'明天买牛奶',acceptedParse:{schedule:{start_date:'2026-02-30',timezone:'Asia/Shanghai'},remainingTitle:'买牛奶',spans:[{start:0,end:2,text:'明天'}],reason:'date',emptyTitle:false}}};
 assert.equal(store.put(invalid).reason,'invalid-record');
 const card={scope:{kind:'card',boardId:10,cardId:4},revision:0,generation:1,unknownCreateOutcome:false,baseline:{},fields:{scheduleEditor:{interval:null,count:null}}};
 assert.equal(store.put(card).reason,'invalid-record');
});

test('concurrent checklist create and rename buffers roundtrip independently with target identity', async()=>{
 const {createDraftRecoveryStore}=await import(path);const storage=memory();const store=createDraftRecoveryStore({accountId:1,storage,now:()=>1000});
 // CardDetail keeps these three locals independently, including itemTitle after cancel.
 const fields={newItem:'  未发送的新条目  ',itemTitle:'  正在改名  ',renaming:42};
 const card={scope:{kind:'card',boardId:10,cardId:3},generation:1,revision:3,unknownCreateOutcome:false,fields,baseline:{newItem:'',itemTitle:'原条目',renaming:42}};
 assert.equal(store.put(card).ok,true);
 const reloaded=createDraftRecoveryStore({accountId:1,storage,now:()=>1000});
 assert.deepEqual(reloaded.get(card.scope).record.fields,fields);
 assert.deepEqual(reloaded.get(card.scope).record.baseline,card.baseline);
 assert.equal(store.put({...card,generation:2,fields:{...fields,renaming:0}}).ok,true);
 assert.deepEqual(reloaded.get(card.scope).record.fields,{...fields,renaming:0});
 assert.equal(store.put({...card,generation:3,fields:{...fields,newItem:'x'.repeat(501)}}).reason,'invalid-record');
 assert.equal(store.put({...card,generation:3,fields:{...fields,itemTitle:'x'.repeat(501)}}).reason,'invalid-record');
 assert.equal(store.put({...card,generation:3,fields:{...fields,renaming:-1}}).reason,'invalid-record');
 assert.equal(store.put({...card,generation:3,fields:{...fields,renaming:null}}).reason,'invalid-record');
 assert.equal(store.put({...card,generation:3,fields:{...fields,checklist:[]}}).reason,'invalid-record');
 assert.deepEqual(reloaded.get(card.scope).record.fields,{...fields,renaming:0});
});
