import {readExport} from './export-download.mjs';
import type {ExportSelection} from './types';
export class ApiError extends Error {constructor(public status:number,message:string,public code:string=""){super(message)}}
let exportSession=new AbortController();
let csrf='',generation=0;let unauthorized:(()=>void)|null=null;
export function onUnauthorized(fn:(()=>void)|null){unauthorized=fn}
export function setCsrf(token:string){exportSession.abort();exportSession=new AbortController();csrf=token;++generation}
function request(path:string,method:string,body?:unknown,signal?:AbortSignal){
 return fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(signal?{signal:AbortSignal.any([signal,exportSession.signal])}:{}),...(body===undefined?{}:{body:JSON.stringify(body)})});
}
export async function api<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const token=generation;
 const response=await request(path,method,body,signal);
 if(token!==generation)throw Object.assign(new Error('身份已切换，旧响应已忽略'),{stale:true});
 if(response.status===204)return undefined as T;
 const result=await response.json().catch(()=>({message:'服务器响应异常'}));
 if(token!==generation)throw Object.assign(new Error('身份已切换，旧响应已忽略'),{stale:true});
 if(response.status===401)unauthorized?.();
 if(!response.ok)throw new ApiError(response.status,result.message||'操作失败，请重试',result.code||'');
 return result as T;
}
export async function downloadExport(selection:ExportSelection,expected_snapshot:string,signal:AbortSignal){
 const token=generation,combined=AbortSignal.any([signal,exportSession.signal]);
 const response=await request('/exports/download','POST',{...selection,expected_snapshot},combined);
 try{
  const result=await readExport(response,selection.format,{signal:combined});
  if(token!==generation)throw new DOMException('身份已切换','AbortError');
  return {...result,identitySignal:combined};
 }catch(e){
  if(token!==generation||combined.aborted)throw new DOMException('导出已取消','AbortError');
  const error=e as any;if(error.status===401)unauthorized?.();
  if(error.status)throw new ApiError(error.status,error.message,error.code);
  throw e;
 }
}
