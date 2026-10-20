export class ApiError extends Error {constructor(public status:number,message:string,public code:string=""){super(message)}}
let csrf='';
export function setCsrf(token:string){csrf=token}
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(response.status===204)return undefined as T;
 const result=await response.json().catch(()=>({message:'服务器响应异常'}));
 if(!response.ok)throw new ApiError(response.status,result.message||'操作失败，请重试',result.code||'');
 return result as T;
}
