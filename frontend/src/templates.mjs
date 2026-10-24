// The server snapshots persisted content; never send the editor body as a source DTO.
export function sourceTemplate(board,draft,name){
 const card=board.cards.find(c=>c.id===draft.id);
 if(!card||board.revision!==draft.revision||card.title!==draft.title||card.description!==draft.description||!Number.isSafeInteger(card.touch_version))throw new Error('任务尚未确认保存，请先明确保存并核对最新版本');
 return {name,source_board_id:board.id,source_card_id:card.id,expected_revision:board.revision,expected_touch_version:card.touch_version};
}
export function templateReplacement(t){return {expected_revision:t.revision,name:t.name,title:t.title,description:t.description,checklist:t.checklist.map(i=>({title:i.title}))}}
export function templateApply(board,listId,t,ack){if(!board.inbox_owner_id&&!ack)throw new Error('请明确确认共享可见性');return {action:'card_from_template',list_id:listId,template_id:t.id,expected_template_revision:t.revision,ack_shared_content:ack===true}}
export function unknownOutcome(e){return !e?.status||e.status>=500}

// Store only an account-scoped safety marker, never template content. A network
// failure may follow a committed create, including across a same-tab reload.
export function templateUncertainty(accountId,storage){
 if(storage===undefined)try{storage=globalThis.sessionStorage}catch{storage=null}
 const key=`norns:template-uncertainty:v1:${accountId}`;let memory=false;
 return {blocked(){try{return memory||storage?.getItem(key)==='unknown'}catch{return memory}},mark(){memory=true;try{storage?.setItem(key,'unknown')}catch{}},clear(){memory=false;try{storage?.removeItem(key)}catch{}}};
}
