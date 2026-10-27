// Pure orchestration only: App owns reads, the sole writer, barriers and identity.
export function actionFailure(error, context='skip') {
 if(!error?.status || error.status>=500) return {kind:'unknown',message:'结果未知；禁止重试。请只读核对任务与列表，写入屏障保持阻塞。'};
 if(error.code==='successor_touched') return {kind:'stale',message:context==='unskip'?'下一次任务已有修改或处理，不能撤销跳过；不会删除任何数据。':'下一次任务已有修改或处理；保留历史，不会删除任何数据。'};
 if(error.code==='attachment_processing') return {kind:'stale',message:'附件正在上传或核验。请等待完成，或在附件界面取消上传后，重新预览；本对话框不会取消上传。'};
 if(error.status===401) return {kind:'blocked',message:'会话已失效，请重新登录。'};
 if(error.status===404) return {kind:'blocked',message:'资源不存在或无权访问。'};
 if(error.status===409) return {kind:'stale',message:error.code==='invalid_recurrence_chain'?'重复链结构异常；不会移动或删除任何任务。':'版本或预览已变化。请重新预览并再次确认；不会自动换版本重试。'};
 return {kind:'stale',message:error.message||'请求被拒绝，请检查状态并重新预览。'};
}

// Use in the App API adapter for these actions: Axum 422 is not JSON.
export async function readActionResponse(response) {
 const text=await response.text();let body;
 try {body=JSON.parse(text)} catch {body=null}
 if(!response.ok) throw Object.assign(new Error(body?.message||text||'请求失败'),{status:response.status,code:body?.code||''});
 if(!body) throw new Error('响应无法解析，需只读核对');
 return body;
}

export function createPreviewSession({isCurrent}) {
 let phase='idle',confirmed=null,failure=null,sequence=0,disposed=false;
 const valid=token=>!disposed&&token===sequence&&isCurrent();
 return {
 state:()=>phase,preview:()=>confirmed,error:()=>failure,
 dispose(){disposed=true;++sequence},
 invalidate(){if(['reading','sending','unknown','success','blocked'].includes(phase))return false;confirmed=null;failure=null;phase='idle';++sequence;return true},
 async prepare(read){
  if(disposed||!isCurrent()||['reading','sending','unknown','success','blocked'].includes(phase))return false;
  const token=++sequence;phase='reading';confirmed=null;failure=null;
  try {const fresh=await read();if(!valid(token))return false;
   // Freeze a private copy; polling/caller mutation cannot rebase confirmation.
   confirmed=JSON.parse(JSON.stringify(fresh));phase='ready';return true;
  } catch(e) {if(valid(token)){failure=actionFailure(e);phase=failure.kind==='blocked'?'blocked':'stale'}return false}
 },
 async commit(send,build){
  if(disposed||!isCurrent()||phase!=='ready')return false;
  const token=++sequence;phase='sending';failure=null;
  try {await send(build(confirmed));if(!valid(token))return false;phase='success';return true}
  catch(e){if(valid(token)){failure=actionFailure(e);phase=failure.kind;confirmed=null}return false}
 }
 };
}

export function unskipMutation(cardId,revision) {
 return {action:'card_unskip',card_id:cardId,expected_revision:revision};
}

export function skipMutation(preview) {
 return {action:'card_skip',card_id:preview.card_id,expected_revision:preview.revision,preview};
}
