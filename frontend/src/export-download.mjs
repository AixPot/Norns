export const EXPORT_LIMITS={csv:16*1024*1024,json:16*1024*1024,zip:160*1024*1024};
function aborted(signal){if(signal?.aborted)throw new DOMException('已取消导出','AbortError')}
export async function readExport(response,format,{signal}={}){
 aborted(signal);
 const expected={csv:'text/csv',json:'application/json',zip:'application/zip'}[format];
 const limit=EXPORT_LIMITS[format];if(!limit)throw new Error('不支持的导出格式');
 const length=Number(response.headers.get('Content-Length'));
 let filename='';
 if(response.ok){
  const type=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if(type!==expected){await response.body?.cancel();throw new Error('导出响应类型不匹配，请重新预览')}
  filename=/^attachment; filename="(norns-export-\d{8}T\d{6}Z\.(?:csv|json|zip))"$/.exec(response.headers.get('Content-Disposition')||'')?.[1]||'';
  if(!filename.endsWith('.'+format)){await response.body?.cancel();throw new Error('导出文件名无效')}
  if(!response.headers.has('Content-Length')||!Number.isSafeInteger(length)||length<0||length>limit){await response.body?.cancel();throw new Error('导出文件超过本机接收上限，或长度无效')}
 }
 const reader=response.body?.getReader();if(!reader)throw new Error('导出响应为空');
 const chunks=[];let size=0;
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal?.addEventListener('abort',cancel,{once:true});
 try{
  for(;;){aborted(signal);const {done,value}=await reader.read();aborted(signal);if(done)break;size+=value.byteLength;if(size>(response.ok?limit:64*1024))throw new Error('导出响应超过接收上限');chunks.push(value)}
  if(!response.ok){let data;try{data=JSON.parse(await new Blob(chunks).text())}catch{}throw Object.assign(new Error(data?.message||'导出失败，请重新预览'),{status:response.status,code:data?.code||''})}
  if(size!==length)throw new Error('导出文件长度不完整，请重新预览');
  return {blob:new Blob(chunks,{type:expected}),filename};
 }catch(e){await reader.cancel().catch(()=>{});throw e}finally{signal?.removeEventListener('abort',cancel);reader.releaseLock()}
}
/** @param {any} file @param {any} [options] */
export function saveExport({blob,filename},{signal,isCurrent=()=>true,document:doc=globalThis.document,url=URL,schedule=setTimeout}={}){
 aborted(signal);if(!isCurrent())throw new DOMException('身份或范围已改变','AbortError');
 const objectUrl=url.createObjectURL(blob),anchor=doc.createElement('a');
 try{anchor.href=objectUrl;anchor.download=filename;anchor.hidden=true;doc.body.append(anchor);aborted(signal);if(!isCurrent())throw new DOMException('身份或范围已改变','AbortError');anchor.click()}
 catch(e){url.revokeObjectURL(objectUrl);throw e}
 finally{anchor.remove()}
 // Allow browser download consumption before releasing the bounded Blob.
 schedule(()=>url.revokeObjectURL(objectUrl),30000);
}
