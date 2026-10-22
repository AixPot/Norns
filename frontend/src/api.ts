export class ApiError extends Error {constructor(public status:number,message:string,public code:string=""){super(message)}}
let csrf='',generation=0;let unauthorized:(()=>void)|null=null;
export function onUnauthorized(fn:(()=>void)|null){unauthorized=fn}
export function setCsrf(token:string){csrf=token;++generation}
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const token=generation;
 const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(token!==generation)throw Object.assign(new Error('身份已切换，旧响应已忽略'),{stale:true});
 if(response.status===204)return undefined as T;
 const result=await response.json().catch(()=>({message:'服务器响应异常'}));
 if(token!==generation)throw Object.assign(new Error('身份已切换，旧响应已忽略'),{stale:true});
 if(response.status===401)unauthorized?.();
 if(!response.ok)throw new ApiError(response.status,result.message||'操作失败，请重试',result.code||'');
 return result as T;
}
