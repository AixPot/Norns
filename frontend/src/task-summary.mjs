// Explicit saved-field projection. Never serialize a board/card DTO or attachment URLs.
export function taskSummary(board,cardId){
 const card=board.cards.find(c=>c.id===cardId);
 if(!card)throw Error('任务已不可用，请重新打开后复制');
 const s=card.schedule||(card.due_date?{start_date:card.due_date}:null);
 const endpoint=(date,time)=>date+(time?' '+time:'');
 const date=s?endpoint(s.start_date,s.start_time)+(s.end_date||s.end_time?' — '+endpoint(s.end_date||s.start_date,s.end_time):'')+(s.timezone?' · '+s.timezone:''):'无';
 const lines=[card.title];
 if(card.description)lines.push('',card.description);
 lines.push('','看板：'+board.title,'列表：'+(board.lists.find(l=>l.id===card.list_id)?.title||'未知列表'),'状态：'+(card.completed?'已完成':'未完成')+' · '+(card.archived?'已归档':'未归档'),'负责人：'+(board.members.find(m=>m.user_id===card.assignee_id)?.username||'未分配'),'日期：'+date);
 if(s?.repeat){
  const r=s.repeat,days=['周一','周二','周三','周四','周五','周六','周日'];
  lines.push('重复：每 '+r.interval+' '+({day:'天',week:'周',month:'月',year:'年'}[r.unit]||r.unit)+' · '+(r.mode==='relative'?'按完成时间':'按日历')+(r.weekdays?.length?' · '+r.weekdays.map(d=>days[d]).join('、'):'')+(r.count?' · 共 '+r.count+' 次':r.until?' · 截至 '+r.until:''));
 }
 const items=board.checklist.filter(i=>i.card_id===cardId).sort((a,b)=>a.position-b.position||a.id-b.id);
 if(items.length)lines.push('','清单：',...items.map(i=>(i.checked?'[x] ':'[ ] ')+i.title));
 return lines.join('\n');
}

/** Clipboard transport is read-only; callers gate UI completion by mounted owner.
 * @param {any} board
 * @param {number} cardId
 * @param {{clipboard?: {writeText:(text:string)=>Promise<void>}|null, isCurrent?:()=>boolean}} options
 */
export async function copyTaskSummary(board,cardId,{clipboard=globalThis.navigator?.clipboard,isCurrent=()=>true}={}){
 const text=taskSummary(board,cardId);
 if(!isCurrent())return false;
 if(!clipboard?.writeText)throw Error('剪贴板不可用，请在 HTTPS 页面使用支持剪贴板的浏览器后重试。');
 try{await clipboard.writeText(text)}catch{if(!isCurrent())return false;throw Error('复制失败，请允许浏览器剪贴板权限后重试；也可手动选择详情文字复制。')}
 return isCurrent();
}
