export const MAX_SELECTION=100;
const identity=row=>({id:row.id,board_id:row.board_id});
export function toggleSelection(selected,row){return selected.some(s=>s.id===row.id)?selected.filter(s=>s.id!==row.id):selected.length<MAX_SELECTION?[...selected,identity(row)]:selected}
export function selectVisible(selected,rows){let next=selected;for(const row of rows)if(!next.some(s=>s.id===row.id))next=toggleSelection(next,row);return next}
export function pruneSelection(selected,visible){return selected.filter(s=>visible.some(r=>r.id===s.id&&r.board_id===s.board_id))}

import {scheduleDraft,scheduleValidation} from './schedule-draft.mjs';
export function prepareBulk(board,selected){
 if(!selected.length||selected.length>100||new Set(selected.map(s=>s.id)).size!==selected.length)throw new Error('请选择 1–100 个不同任务');
 if(selected.some(s=>s.board_id!==board.id))throw new Error('只能对同一来源看板执行原子批量操作；请取消其他看板的选择');
 const originals=selected.map(s=>{const c=board.cards.find(c=>c.id===s.id);if(!c)throw new Error('所选任务已不可用，请刷新选择');return structuredClone(c)});
 return {boardId:board.id,expected_revision:board.revision,selected:originals.map(c=>({id:c.id,touch_version:c.touch_version})),originals};
}
export function bulkChanges(board,input){
 const changes={};
 for(const key of ['target_list','schedule','completed','archived']){
  const op=input[key]===undefined?{op:'keep'}:input[key];
  if(!op||!['keep','set',...(key==='schedule'?['clear']:[])].includes(op.op))throw new Error('无效的批量操作');
  if(op.op==='set'){
   if(key==='target_list'&&!board.lists.some(l=>l.id===op.value))throw new Error('目标列表必须属于同一看板');
   if(['completed','archived'].includes(key)&&typeof op.value!=='boolean')throw new Error('无效的状态');
   if(key==='schedule'){
    const s=op.value;if(!s||!s.start_date||s.repeat||s.timezone!=='Asia/Shanghai')throw new Error('日期必须完整且不含重复');
    const error=scheduleValidation(scheduleDraft(s));if(error)throw new Error(error);
    for(const key of ['start_time','end_time'])if(s[key]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(s[key]))throw new Error('日期时间格式无效');
   }
  }
  changes[key]=structuredClone(op);
 }
 if(Object.values(changes).every(o=>o.op==='keep'))throw new Error('请选择至少一项修改；保持不变不会清除混合值');
 return changes;
}
export function bulkSafety(cards,changes){
 if(changes.schedule&&changes.schedule.op!=='keep'&&cards.some(c=>c.completed||c.series_id||c.schedule?.repeat))return '日期仅可修改未完成且非重复的原任务；同时撤销完成也不能绕过限制。';
 if(changes.completed?.op==='set'){
  if(cards.some(c=>c.archived))return '归档任务不能完成或撤销完成；同时恢复归档也不能绕过限制。请先单独恢复。';
  if(!changes.completed.value&&cards.some(c=>c.completed&&cards.some(s=>s.predecessor_id===c.id)))return '原任务及其后继不能同时选择并撤销完成；请取消后继选择。';
 }
 return '';
}
// Only a safety marker, not a persisted command: reload cannot replay a batch.
export function bulkUncertainty(accountId,storage){
 if(storage===undefined)try{storage=globalThis.sessionStorage}catch{storage=null}
 const key=`norns:bulk-uncertainty:v1:${accountId}`;let memory=0;
 return {board(){try{return memory||Number(storage?.getItem(key))||0}catch{return memory}},mark(id){memory=id;try{storage?.setItem(key,String(id))}catch{}},clear(){memory=0;try{storage?.removeItem(key)}catch{}}};
}
