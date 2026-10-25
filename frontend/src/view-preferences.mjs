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
 * use v2 account/surface/scope/layout keys for wide/narrow. Both classes inherit
 * valid v1 values until explicitly changed; v1 is never rewritten or removed.
 * Omitted layout retains the legacy v1 API. Storage failures use store-local
 * memory. Omit storage to use localStorage; inject null for memory-only operation.
 * Example: const prefs=createViewPreferences({accountId:me.id});
 * prefs.set({surface:'smart',scope:'today'},{group:'none',sort:'date'});
 * projectTaskView(tasks,{route:'today',today,...prefs.get({surface:'smart',scope:'today'})});
 */
export function createViewPreferences({accountId,storage}={}){
 const memory=new Map();
 const validAccount=Number.isSafeInteger(accountId)&&accountId>0;
 const validLayout=layout=>layout===undefined||layout==='wide'||layout==='narrow';
 const key=(s,layout)=>layout===undefined?`norns.view-preferences.v1.account.${accountId}.${s.surface}.${encodeURIComponent(s.scope)}`:`norns.view-preferences.v2.account.${accountId}.${s.surface}.${encodeURIComponent(s.scope)}.${layout}`;
 const read=(k,version)=>{try{const raw=(storage===undefined?globalThis.localStorage:storage)?.getItem(k);if(raw){const data=JSON.parse(raw);if(shape(data,['version','group','sort'])&&data.version===version&&validValue({group:data.group,sort:data.sort}))return {group:data.group,sort:data.sort}}}catch{}return null};
 return {
  get(scope,layout){
   if(!validAccount||!validScope(scope)||!validLayout(layout))return defaults();
   const k=key(scope,layout);if(memory.has(k))return {...memory.get(k)};
   const value=read(k,layout===undefined?1:2)||(layout!==undefined?read(key(scope),1):null)||defaults();
   memory.set(k,value);return {...value};
  },
  set(scope,value,layout){
   if(!validAccount||!validScope(scope)||!validLayout(layout)||!validValue(value))return false;
   const copy={group:value.group,sort:value.sort},k=key(scope,layout);memory.set(k,copy);
   try{(storage===undefined?globalThis.localStorage:storage)?.setItem(k,JSON.stringify({version:layout===undefined?1:2,...copy}))}catch{}
   return true;
  }
 };
}
