const defaults=()=>({group:'default',sort:'manual'});
const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const validValue=v=>shape(v,['group','sort'])&&['default','none','date','board'].includes(v.group)&&['manual','date'].includes(v.sort);
const validScope=s=>shape(s,['surface','scope'])&&['smart','search','board'].includes(s.surface)&&typeof s.scope==='string'&&/^[a-zA-Z0-9:_-]{1,128}$/.test(s.scope);
/** Local display settings only; no API, task records or selection state.
 * Create a NEW store after authenticated account change; never reuse the prior
 * account's store. accountId is a positive integer from /me. scope is an opaque
 * stable route/board identifier, NEVER search text, task content or a username.
 * get({surface:'smart'|'search'|'board',scope:'today'|'all'|'123'}) returns a fresh
 * {group:'default'|'none'|'date'|'board',sort:'manual'|'date'}; missing/invalid data
 * defaults. set(scope, completePreferences) returns false for invalid arguments,
 * true for accepted settings (even if persistence is denied). Only exact enums
 * are stored in a v1 account/surface/scope key. Storage failures use store-local
 * memory. Omit storage to use localStorage; inject null for memory-only operation.
 * Example: const prefs=createViewPreferences({accountId:me.id});
 * prefs.set({surface:'smart',scope:'today'},{group:'none',sort:'date'});
 * projectTaskView(tasks,{route:'today',today,...prefs.get({surface:'smart',scope:'today'})});
 */
export function createViewPreferences({accountId,storage}={}){
 const memory=new Map();
 const validAccount=Number.isSafeInteger(accountId)&&accountId>0;
 const key=s=>`norns.view-preferences.v1.account.${accountId}.${s.surface}.${encodeURIComponent(s.scope)}`;
 return {
  get(scope){
   if(!validAccount||!validScope(scope))return defaults();
   const k=key(scope);if(memory.has(k))return {...memory.get(k)};
   let value=defaults();
   try{const raw=(storage===undefined?globalThis.localStorage:storage)?.getItem(k);if(raw){const data=JSON.parse(raw);if(shape(data,['version','group','sort'])&&data.version===1&&validValue({group:data.group,sort:data.sort}))value={group:data.group,sort:data.sort}}}catch{}
   memory.set(k,value);return {...value};
  },
  set(scope,value){
   if(!validAccount||!validScope(scope)||!validValue(value))return false;
   const copy={group:value.group,sort:value.sort},k=key(scope);memory.set(k,copy);
   try{(storage===undefined?globalThis.localStorage:storage)?.setItem(k,JSON.stringify({version:1,...copy}))}catch{}
   return true;
  }
 };
}
