/** Same-origin, same-tab recovery only. Account IDs come from authenticated /me,
 * never usernames. A returned record is NOT authorization: callers *** authorize
 * its exact board/list/card before display, then explicitly restore and review a
 * latest server baseline before any write. There is deliberately no transport.
 */
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const shape=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const text=n=>v=>typeof v==='string'&&v.length<=n;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const id=v=>integer(v)&&v>0;
const bool=v=>typeof v==='boolean';
const oneOf=values=>v=>values.includes(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const time=v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function fieldsValid(v,validators){return shape(v,Object.keys(validators))&&Object.entries(v).every(([k,value])=>validators[k](value));}
const scheduleInput=v=>fieldsValid(v,{enabled:bool,start:text(10),end:text(10),startTime:text(5),endTime:text(5),unit:oneOf(['','day','week','month','year']),interval:v=>id(v)&&v<=1000,mode:oneOf(['calendar','relative']),weekdays:v=>Array.isArray(v)&&v.length<=7&&v.every(n=>integer(n)&&n<=6),ending:oneOf(['','never','until','count']),until:text(10),count:v=>id(v)&&v<=4294967295});
// ScheduleEditor number bindings produce number | undefined (empty), even when
// min/step validation fails. Keep this raw editor contract separate from the
// legacy validated scheduleInput and acceptedParse API schedule. null is ONLY
// the wire encoding for an explicitly present undefined numeric binding.
const editorNumber=v=>v===null||(typeof v==='number'&&Number.isFinite(v));
const scheduleEditorValidators={enabled:bool,start:text(10),end:text(10),startTime:text(5),endTime:text(5),unit:oneOf(['','day','week','month','year']),interval:editorNumber,mode:oneOf(['calendar','relative']),weekdays:v=>Array.isArray(v)&&v.length<=7&&v.every(n=>integer(n)&&n<=6),ending:oneOf(['','never','until','count']),until:text(10),count:editorNumber};
const scheduleEditor=v=>fieldsValid(v,scheduleEditorValidators)&&Object.keys(v).length===Object.keys(scheduleEditorValidators).length;
/** Encode the complete ScheduleEditor value, not scheduleValue(value). Never
 * coerce/clamp invalid input or supply defaults; reject unsupported values. */
export function encodeScheduleEditor(value){
 if(!object(value))throw new TypeError('Invalid schedule editor');
 const encoded={...value,interval:value.interval===undefined?null:value.interval,count:value.count===undefined?null:value.count};
 if(!Object.hasOwn(value,'interval')||!Object.hasOwn(value,'count')||value.interval===null||value.count===null||!scheduleEditor(encoded))throw new TypeError('Invalid schedule editor');
 return {...encoded,weekdays:[...encoded.weekdays]};
}
/** Decode only after exact scope authorization and explicit restore/review.
 * Continue to use scheduleValidation before any server save. */
export function decodeScheduleEditor(value){
 if(!scheduleEditor(value))throw new TypeError('Invalid schedule editor');
 return {...value,interval:value.interval===null?undefined:value.interval,count:value.count===null?undefined:value.count,weekdays:[...value.weekdays]};
}
const schedule=v=>shape(v,['start_date','start_time','timezone'])&&date(v.start_date)&&v.timezone==='Asia/Shanghai'&&(v.start_time===undefined||time(v.start_time));
function parsed(v){return shape(v,['schedule','spans','remainingTitle','reason','emptyTitle'])&&schedule(v.schedule)&&text(160)(v.remainingTitle)&&oneOf(['date','date-time'])(v.reason)&&bool(v.emptyTitle)&&v.emptyTitle===!v.remainingTitle&&Array.isArray(v.spans)&&v.spans.length===1&&v.spans.every(s=>shape(s,['start','end','text'])&&integer(s.start)&&integer(s.end)&&s.end>s.start&&s.end<=160&&text(160)(s.text)&&s.text.length===s.end-s.start);}
const scopeValid=s=>shape(s,['kind','boardId','listId','cardId'])&&id(s.boardId)&&((s.kind==='capture'||s.kind==='list')&&id(s.listId)&&s.cardId===undefined||s.kind==='card'&&id(s.cardId)&&s.listId===undefined);
const scopeKey=s=>`${s.kind}:${s.boardId}:${s.cardId??s.listId}`;
// CardDetail adapter: fields/baseline may carry {newItem,itemTitle,renaming}.
// newItem is the independent create buffer; itemTitle is the rename buffer;
// renaming is exactly the local item ID, or 0 when inactive (not null).
// Re-authorize that target against the latest card checklist before restoration.
// Legacy checklistTitle/checklistItemId are retained only for old v1 records;
// they cannot represent both buffers and must not be used by new UI adapters.
function recordValid(r){
 if(!shape(r,['scope','generation','revision','baseline','fields','unknownCreateOutcome'])||!scopeValid(r.scope)||!integer(r.generation)||!integer(r.revision)||!bool(r.unknownCreateOutcome))return false;
 const validators=r.scope.kind==='capture'?{raw:text(160),acceptedParse:v=>v===null||parsed(v)}:r.scope.kind==='list'?{title:text(100)}:{title:text(500),description:text(20000),comment:text(10000),newItem:text(500),itemTitle:text(500),renaming:integer,checklistTitle:text(500),checklistItemId:v=>v===null||id(v),assignee_id:v=>v===null||id(v),due_date:v=>v===null||v===''||date(v),archived:bool,scheduleInput,scheduleEditor};
 if(!fieldsValid(r.fields,validators)||!Object.keys(r.fields).length||!fieldsValid(r.baseline,validators))return false;
 const p=r.fields.acceptedParse;
 return !p||(typeof r.fields.raw==='string'&&p.spans.every(s=>r.fields.raw.slice(s.start,s.end)===s.text)&&p.remainingTitle===(r.fields.raw.slice(0,p.spans[0].start)+r.fields.raw.slice(p.spans[0].end)).trim());
}
export const RECOVERY_LIMITS=Object.freeze({version:1,ttlMs:86400000,maxRecords:20,maxBytes:524288});
const bytes=value=>new TextEncoder().encode(value).byteLength;
const failure=reason=>({ok:false,reason});
const present=r=>({...r.input,savedAt:r.savedAt,expiresAt:r.savedAt+RECOVERY_LIMITS.ttlMs,requiresScopeAuthorization:true,requiresLatestBaselineReview:true,autoSubmitAllowed:false});

export function createDraftRecoveryStore({accountId,storage,now=Date.now}={}) {
 const validAccount=id(accountId);
 const key=validAccount?`norns.draft-recovery.v1.account.${accountId}`:null;
 function run(fn){
  if(!validAccount)return failure('invalid-account');
  try {
   const s=storage===undefined?globalThis.sessionStorage:storage;
   if(!s)return failure('storage-unavailable');
   const clock=now();if(!integer(clock)||clock>Number.MAX_SAFE_INTEGER-RECOVERY_LIMITS.ttlMs)return failure('invalid-clock');
   return fn(s,clock);
  }catch(e){return failure(e?.name==='QuotaExceededError'?'quota-exceeded':'storage-unavailable');}
 }
 function save(s,records){
  if(!records.length){s.removeItem(key);return;}
  s.setItem(key,JSON.stringify({version:1,records}));
 }
 function load(s,clock){
  const raw=s.getItem(key);if(raw===null)return {ok:true,records:[],expiredRemoved:0};
  let envelope,valid=[],corruptRemoved=0;
  try {
   // Bound parsing and traversal even for a manually corrupted own key.
   if(raw.length>RECOVERY_LIMITS.maxBytes||bytes(key)+bytes(raw)>RECOVERY_LIMITS.maxBytes)throw Error();
   envelope=JSON.parse(raw);
   if(!shape(envelope,['version','records'])||envelope.version!==1||!Array.isArray(envelope.records)||envelope.records.length>20)throw Error();
   const seen=new Set();
   for(const r of envelope.records){
    if(!shape(r,['input','savedAt'])||!integer(r.savedAt)||r.savedAt>clock||!recordValid(r.input)){corruptRemoved++;continue;}
    const scope=scopeKey(r.input.scope);if(seen.has(scope)){corruptRemoved++;continue;}seen.add(scope);valid.push(r);
   }
  }catch{
   s.removeItem(key);return {...failure('corrupt-data'),corruptRemoved:true};
  }
  if(corruptRemoved){save(s,valid);return {...failure('corrupt-data'),corruptRemoved};}
  const records=envelope.records.filter(r=>clock-r.savedAt<RECOVERY_LIMITS.ttlMs);
  const expiredRemoved=envelope.records.length-records.length;
  if(expiredRemoved)save(s,records);
  return {ok:true,records,expiredRemoved};
 }
 function list(){return run((s,clock)=>{const result=load(s,clock);return result.ok?{...result,records:result.records.map(present)}:result;});}
 return {
  put(input){return run((s,clock)=>{
   let valid=false;try{valid=recordValid(input);}catch{}if(!valid)return failure('invalid-record');
   const result=load(s,clock);if(!result.ok)return result;
   const previous=result.records.find(r=>scopeKey(r.input.scope)===scopeKey(input.scope));
   if(previous&&input.generation<previous.input.generation)return failure('stale-generation');
   if(previous&&input.generation===previous.input.generation&&JSON.stringify(input)!==JSON.stringify(previous.input))return failure('generation-conflict');
   const copy=JSON.parse(JSON.stringify(input));
   // An uncertain create cannot become replayable simply because more text was typed.
   if(previous?.input.unknownCreateOutcome)copy.unknownCreateOutcome=true;
   const records=result.records.filter(r=>scopeKey(r.input.scope)!==scopeKey(input.scope));records.push({input:copy,savedAt:clock});
   if(records.length>RECOVERY_LIMITS.maxRecords)return failure('record-limit');
   const serialized=JSON.stringify({version:1,records});const size=bytes(key)+bytes(serialized);
   if(size>RECOVERY_LIMITS.maxBytes)return failure('byte-limit');
   s.setItem(key,serialized);return {ok:true,expiredRemoved:result.expiredRemoved,bytes:size};
  });},
  list,
  get(scope){if(!scopeValid(scope))return failure('invalid-scope');const result=list();return result.ok?{ok:true,expiredRemoved:result.expiredRemoved,record:result.records.find(r=>scopeKey(r.scope)===scopeKey(scope))??null}:result;},
  removeIfGeneration(scope,generation){
   if(!scopeValid(scope)||!integer(generation))return failure('invalid-scope');
   return run((s,clock)=>{const result=load(s,clock);if(!result.ok)return result;
    const remaining=result.records.filter(r=>scopeKey(r.input.scope)!==scopeKey(scope)||r.input.generation!==generation);
    const removed=remaining.length!==result.records.length;if(removed)save(s,remaining);
    return {ok:true,removed,expiredRemoved:result.expiredRemoved};
   });
  },
  clearAccount(){return run(s=>{s.removeItem(key);return {ok:true};});}
 };
}
