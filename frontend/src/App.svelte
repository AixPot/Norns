<script lang="ts">
 import {completionClearanceOwner} from './completion-clearance.mjs';
 import SkipDialog from './SkipDialog.svelte';
 import ListDeleteDialog from './ListDeleteDialog.svelte';
 import RecurrenceHistory from './RecurrenceHistory.svelte';
 import {actionFailure} from './occurrence-skip.mjs';
 import PwaStatus from './PwaStatus.svelte';
 import PwaInstall from './PwaInstall.svelte';
 import {createCompletionMotion} from "./completion-motion.mjs";
 import "./completion-motion.css";
 let completionMotion=$state.raw<any[]>([]);
 const motion=createCompletionMotion({change:(entries:any[])=>completionMotion=entries,reduced:()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  valid:(entry:any=undefined)=>ownsCompletion(entry.owner)&&!!entry.ack?.completed&&!entry.ack?.archived&&!entry.ack?.skipped&&(board?.id!==entry.owner.board||board!.cards.some(c=>c.id===entry.id&&c.completed&&!c.archived&&!c.skipped)),
  onconfirmed:(entry:any=undefined)=>feedback.show({...entry.owner,card:entry.id,title:entry.ack.title})});
 onDestroy(()=>motion.clear());
 import {createDraftRecoveryStore,encodeScheduleEditor,decodeScheduleEditor} from './draft-recovery.mjs';
 import BulkActions from './BulkActions.svelte';
 import {toggleSelection,selectVisible,pruneSelection,prepareBulk,bulkChanges,bulkSafety,bulkUncertainty} from './task-selection.mjs';
 import type {SelectedTask,BulkChanges} from './types';
 let selecting=$state(false),selected=$state<SelectedTask[]>([]),visibleTasks=$state<SelectedTask[]>([]),selectionScope=$state(''),bulkOpen=$state(false),bulkPreparing=$state(false),bulkSource=$state<Board|null>(null),bulkPreview=$state<any>(null),bulkRef=$state<BulkActions>();
 let bulkSafetyStore:ReturnType<typeof bulkUncertainty>|null=null,bulkReturn:(()=>void)|undefined;
 const mixedSelection=$derived(new Set(selected.map(s=>s.board_id)).size>1);
 function clearSelection(){selected=[];selecting=false}
 function selectionVisible(scope:string,rows:SelectedTask[]){if(scope!==selectionScope){selected=[];selectionScope=scope}visibleTasks=rows;selected=pruneSelection(selected,rows)}
 function selectTask(task:SelectedTask){if(!bulkOpen&&!bulkPreparing)selected=toggleSelection(selected,task)}
 async function prepareSelection(){
  if(!selected.length||mixedSelection||bulkPreparing||uncertainScope||!overlayReady())return;
  if(draft&&(board?.id!==selected[0].board_id||recoveryHold||!detailRef?.transferReady())){error='请先明确保存恢复草稿、完成输入并核对所有未保存内容，再批量修改。';return}
  const uid=user?.id,token=requestEpoch,ids=JSON.stringify(selected),original=draft,owner=autosave;
  const owns=()=>uid===user?.id&&token===requestEpoch&&ids===JSON.stringify(selected)&&overlayReady();
  bulkPreparing=true;
  try{
   if(original&&!await owner?.flush())return;
   if(!owns()||draft!==original||original&&!detailRef?.transferReady())return;
   await writer?.idle();
   if(!owns()||draft!==original||original&&!detailRef?.transferReady())return;
   const fresh=await api<Board>(`/boards/${selected[0].board_id}`);
   if(!owns()||draft!==original||original&&!detailRef?.transferReady())return;
   const preview=prepareBulk(fresh,$state.snapshot(selected));
   bulkReturn=detailRef?.snapshotFocus();board=fresh;writer=null;bulkSource=fresh;bulkPreview=preview;bulkOpen=true;
  }catch(e){if(uid===user?.id&&token===requestEpoch)fail(e)}finally{if(uid===user?.id)bulkPreparing=false}
 }
 async function refreshBulk(){
  if(!bulkOpen||!bulkPreview||uncertainScope)throw new Error('请关闭后先只读核对未知结果');
  const uid=user?.id,token=requestEpoch,previous=bulkPreview;
  const fresh=await api<Board>(`/boards/${previous.boardId}`);
  if(!bulkOpen||uid!==user?.id||token!==requestEpoch||bulkPreview!==previous)throw new Error('批量操作已切换');
  const preview=prepareBulk(fresh,previous.selected.map((s:any)=>({id:s.id,board_id:previous.boardId})));
  board=fresh;writer=null;bulkSource=fresh;bulkPreview=preview;return fresh;
 }
 async function submitBulk(changes:BulkChanges){
  if(!bulkOpen||!bulkSource||!bulkPreview||uncertainScope)throw new Error('批量操作已停止，请核对结果');
  const uid=user?.id,token=requestEpoch,preview=bulkPreview;
  const checked=bulkChanges(bulkSource,changes),restriction=bulkSafety(preview.originals,checked);if(restriction)throw new ApiError(400,restriction,'invalid');
  const guard=(revision:number)=>{if(bulkPreview!==preview||!bulkOpen||board?.id!==preview.boardId||board?.revision!==preview.expected_revision||revision!==preview.expected_revision)throw new ApiError(409,'所选看板版本已变化，请重新读取并明确确认','conflict')};
  // Persist only a safety marker before transport; neither payload nor retry is stored.
  bulkSafetyStore?.mark(preview.boardId);
  try{
   await writeBoard({action:'cards_bulk',selected:preview.selected,changes:checked},preview.expected_revision,guard);
   if(uid!==user?.id||token!==requestEpoch)return;
   bulkSafetyStore?.clear();selected=[];
   // The mounted editing owner remains; align acknowledged state only after exact success.
   if(board&&draft)rebaseDraft?.(board);
   notice=`已更新 ${preview.selected.length} 个所选任务（无批量撤销）`;
  }catch(e){if(uid===user?.id&&token===requestEpoch&&(e as any).status&&(e as any).status<500)bulkSafetyStore?.clear();throw e}
 }
 async function closeBulk(){if(bulkRef?.hasPending())return;bulkOpen=false;bulkSource=null;bulkPreview=null;await tick();bulkReturn?.();bulkReturn=undefined;detailRef?.resumeFocus()}
 import BrandMark from './BrandMark.svelte';
 import Wordmark from './Wordmark.svelte';
 import AppearancePicker from './AppearancePicker.svelte';
 import {onMount,onDestroy,untrack,tick} from 'svelte';
 import {api,ApiError,setCsrf,onUnauthorized} from './api';
 import type {Schedule,User,Board,BoardSummary,Card,Draft,TaskResult,TaskFilters,TaskDiscoveryResponse,TransferPreview} from './types';
 import {createPoller,acceptSnapshot} from './collaboration.mjs';
 import CompletionToast from './CompletionToast.svelte';
 import {createCompletionFeedback} from './completion-feedback.mjs';
 import {createMutationQueue} from './mutation-queue.mjs';
 import {resolveMove} from './drag-order.mjs';
 import {createAutosave} from './autosave.mjs';
 import {scheduleDraft,scheduleValidation,scheduleValue} from './schedule-draft.mjs';
 import SmartTasks from './SmartTasks.svelte';
 import {createViewPreferences} from './view-preferences.mjs';
 import type {ViewPreferences} from './types';
 let displayLayout=$state<'wide'|'narrow'>(typeof window!=='undefined'&&window.matchMedia('(max-width:800px)').matches?'narrow':'wide');
 let displayVersion=$state(0);let displayStore=$state<ReturnType<typeof createViewPreferences>|null>(null);
 function displayScope(surface:string,scope:string){return {surface,scope}}
 function displayValue(surface:string,scope:string):ViewPreferences{void displayVersion;return displayStore?.get(displayScope(surface,scope),displayLayout)||{group:'default',sort:'manual'}}
 function displayChange(uid:number,surface:string,scope:string,value:ViewPreferences){if(user?.id!==uid)return;if(displayStore?.set(displayScope(surface,scope),value,displayLayout))displayVersion++}
 import {captureLeaveGuard} from './TaskCapture.svelte';
 import NavigationDrawer from './NavigationDrawer.svelte';
 import TransferDialog from './TransferDialog.svelte';
 import ExportDialog from './ExportDialog.svelte';
 import {captureContext} from './capture-context.mjs';
 import TemplateDialog from './TemplateDialog.svelte';
 import {sourceTemplate,templateApply,templateUncertainty,unknownOutcome} from './templates.mjs';
 import type {TaskTemplate} from './types';
 let templateOpen=$state(false),templateSource=$state<{board:Board;draft:Draft}|null>(null),templateTarget=$state<{board:Board;listId:number;route?:string}|null>(null),templateUnknown=$state(false);
 let templateRef:TemplateDialog|undefined=$state();
 let templateSafety:ReturnType<typeof templateUncertainty>|null=null;
 function clearTemplateUnknown(){templateSafety?.clear();templateUnknown=false}
 function markTemplateUnknown(){templateSafety?.mark();templateUnknown=true}
 let templateReturn:(()=>void)|undefined;
 function overlayReady(){return !nextModal&&!bulkOpen&&!exportOpen&&!templateOpen&&!transferOpen&&(smartRef?.overlayReady()??true)&&(boardRef?.overlayReady()??true)}
 function showTemplates(){if(!overlayReady()||!detailRef?.overlayReady()&&draft)return;drawer=false;moreOpen=false;templateSource=null;templateTarget=null;templateOpen=true}
 async function saveTemplate(){
  if(!overlayReady()||templateUnknown||uncertainScope||recoveryHold||!draft||!board||!detailRef?.transferReady()){error='请先明确保存恢复的修改、完成输入并核对所有未保存内容。';return}
  const original=draft,owner=autosave,uid=user?.id,token=requestEpoch;
  if(!await owner?.flush())return;
  await writer?.idle();
  // A sibling may acquire the modal slot while the source flush/queue is awaited.
  if(!overlayReady()||draft!==original||uid!==user?.id||token!==requestEpoch||recoveryHold||!board||!detailRef?.transferReady())return;
  try{sourceTemplate(board,original,'预览');templateReturn=detailRef.snapshotFocus();templateSource={board:structuredClone($state.snapshot(board)),draft:structuredClone($state.snapshot(original))};templateTarget=null;templateOpen=true}catch(e){fail(e)}
 }
 async function useTemplate(boardId:number,listId:number,restore:()=>void){
  if(!overlayReady()||templateUnknown||uncertainScope)return;
  const uid=user?.id,token=requestEpoch;
  if(draft&&!await leaveDraft(true))return;
  try{const fresh=await api<Board>(`/boards/${boardId}`);if(uid!==user?.id||token!==requestEpoch||!fresh.lists.some(l=>l.id===listId)||!overlayReady())return;board=fresh;writer=null;templateReturn=restore;templateSource=null;templateTarget={board:fresh,listId,route:view==='smart'?smartRoute:''};templateOpen=true}catch(e){fail(e)}
 }
 async function applyTemplate(t:TaskTemplate,ack:boolean,date:string){
  if(!templateTarget||templateUnknown||uncertainScope)throw new Error('请先只读核对未知结果');
  const target=templateTarget;
  if(board?.id!==target.board.id||board.revision!==target.board.revision)throw new ApiError(409,'目标版本已变化，请关闭后重新选择目标并核对');
  const context=captureContext(target.route,undefined,date,new Date());if(context.needsChoice)throw new ApiError(400,'请选择任务日期；未创建');
  const payload={...templateApply(target.board,target.listId,t,ack),...(context.schedule?{schedule:context.schedule}:{})};markTemplateUnknown();
  try{await writeBoard(payload,target.board.revision,(revision:number)=>{if(revision!==target.board.revision)throw new ApiError(409,'目标版本已变化，请重新核对')});clearTemplateUnknown();++taskRefresh;return context.notice}catch(e){if(!unknownOutcome(e))clearTemplateUnknown();throw e}
 }
 async function reconcileTemplates(){const uid=user?.id;try{await api('/templates');if(uid===user?.id&&confirm('已只读刷新模板列表。请打开模板库核对名称和内容，并核对目标清单任务；不会自动重复保存或创建。确认解除本次阻止？')){templateSafety?.clear();templateUnknown=false}}catch(e){fail(e)}}
 async function closeTemplates(){templateOpen=false;templateSource=null;templateTarget=null;await tick();templateReturn?.();templateReturn=undefined;detailRef?.resumeFocus()}

 let exportOpen=$state(false),moreOpen=$state(false);
 import {createTheme} from './theme.mjs';
 import {createIdentityGate,initialRoute} from './navigation.mjs';
 import {createTransferCommand} from './transfer.mjs';
 import TaskDiscovery from './TaskDiscovery.svelte';
 import CalendarView from './CalendarView.svelte';
 import {shanghaiToday} from './calendar.mjs';
 let calendarDate=$state(shanghaiToday()),calendarMode=$state<'month'|'week'>('month'),calendarBoard=$state('');
 import BoardView from './BoardView.svelte';import CardDetail from './CardDetail.svelte';import Users from './Users.svelte';
 let user=$state<User|null>(null);let ready=$state(false);let username=$state('');let password=$state('');let boards=$state<BoardSummary[]>([]);let board=$state<Board|null>(null);let boardTitle=$state('');let draft=$state<Draft|null>(null);let error=$state('');let busy=$state(false);let view=$state<'boards'|'users'|'tasks'|'calendar'|'smart'>('smart');let membersOpen=$state(false);let memberName=$state('');let memberRole=$state('member');let notice=$state('');
 const boardDisplay=$derived(displayValue('board',String(board?.id||0)));
 let taskFilters=$state<TaskFilters>({q:'',view:'all',status:'all',assignee_id:'',board_id:'',from:'',to:''});let taskRefresh=$state(0);
 let smartRoute=$state(initialRoute()),inbox=$state<BoardSummary|null>(null),drawer=$state(false),creatingBoard=$state(false),themePreference=$state('system'),themePalette=$state('blue');
 const exportScope=$derived(view==='boards'?board?.id||0:0);
 $effect(()=>{void exportScope;void view;void smartRoute;void user?.id;exportOpen=false;templateOpen=false;templateSource=null;templateTarget=null;moreOpen=false});
 let recovery=$state<any>(null),inboxList=$state(0);
 function recoveryFor(uid:number){
  const store=(createDraftRecoveryStore as any)({accountId:uid});
  return {store,closed:false,async load(scope:any){
   const result=store.get(scope);if(!result.ok||!result.record)return null;
   const record=result.record;
   try{const fresh=await api<Board>(`/boards/${scope.boardId}`);
    if(user?.id!==uid||this.closed)return null;
    const valid=scope.kind==='card'?fresh.cards.some(c=>c.id===scope.cardId)&&(!record.fields.renaming||fresh.checklist.some(i=>i.card_id===scope.cardId&&i.id===record.fields.renaming)):fresh.lists.some(l=>l.id===scope.listId);
    if(!valid){store.removeIfGeneration(scope,record.generation);return null}
    return {record,fresh};
   }catch(e){if(e instanceof ApiError&&[403,404].includes(e.status))store.removeIfGeneration(scope,record.generation);return null}
  }};
 }
 let detailRecovery=$state<any>(null),recoveryHold=$state(false),recoveryReview=$state(false),recoveryMessage=$state('');
 let detailGeneration=0,detailStoredGeneration:number|undefined,detailBaseline:any=null,detailAux:any={comment:'',newItem:'',itemTitle:'',renaming:0},detailTimer:ReturnType<typeof setTimeout>|undefined;
 function detailFields(){return draft?{title:draft.title,description:draft.description,archived:draft.archived,assignee_id:draft.assignee_id,scheduleEditor:encodeScheduleEditor({...draft.scheduleInput,interval:draft.scheduleInput.interval,count:draft.scheduleInput.count}),...detailAux}:null}
 function persistDetail(){
  clearTimeout(detailTimer);if(!draft||!board||!recovery||!detailBaseline)return;
  try{const value=detailFields();if(!recoveryHold&&JSON.stringify(value)===JSON.stringify(detailBaseline)){if(detailStoredGeneration!==undefined)recovery.store.removeIfGeneration({kind:'card',boardId:board.id,cardId:draft.id},detailStoredGeneration);return;}
   const result=recovery.store.put({scope:{kind:'card',boardId:board.id,cardId:draft.id},generation:detailGeneration,revision:draft.revision,baseline:detailBaseline,fields:value,unknownCreateOutcome:!!detailRecovery?.record.unknownCreateOutcome||!!uncertainScope});
   if(result.ok)detailStoredGeneration=detailGeneration;recoveryMessage=result.ok?'草稿仅保留在此标签页，未代表服务器已保存':'本地草稿未能保留，请勿关闭此页';
  }catch(e){recoveryMessage='本地草稿未能保留，请勿关闭此页'}
 }
 function detailEdited(){++detailGeneration;clearTimeout(detailTimer);detailTimer=setTimeout(persistDetail,180)}
 function auxiliary(value:any){detailAux=value;detailEdited()}
 async function restoreDetail(){
  if(!detailRecovery||!recovery||!draft||!board)return;
  if(writer?.pending()||saveState==='saving')return;
  if(!recoveryHold&&JSON.stringify(detailFields())!==JSON.stringify(detailBaseline)&&!confirm('当前也有未保存输入，用保留的草稿替换？'))return;
  const original=draft,version=detailGeneration,owner=recovery,result=await owner.load(detailRecovery.record.scope);
  if(owner!==recovery||draft!==original||version!==detailGeneration)return;
  if(!result){detailRecovery=null;return}
  const {record,fresh}=result,remote=fresh.cards.find((c:Card)=>c.id===original.id);
  const latest={title:remote.title,description:remote.description,archived:remote.archived,assignee_id:remote.assignee_id,scheduleEditor:encodeScheduleEditor(scheduleDraft(remote.schedule)),comment:'',newItem:'',itemTitle:'',renaming:0};
  if(Object.keys(latest).some(key=>JSON.stringify(record.baseline[key])!==JSON.stringify(latest[key as keyof typeof latest]))&&(!recoveryReview||detailRecovery.fresh.revision!==fresh.revision)){detailRecovery=result;recoveryReview=true;return}
  autosave?.stop();autosave=null;board=fresh;writer=null;
  // Reuse the sole existing autosave owner with a fresh server baseline, then hold all writes.
  draft=null;await edit(remote,anchor||document.body);
  if(recovery!==owner||!(draft as Draft|null)||(draft as Draft|null)?.id!==remote.id)return;
  recoveryHold=true;const f=record.fields;Object.assign(draft as unknown as Draft,{title:f.title,description:f.description,archived:f.archived,assignee_id:f.assignee_id,scheduleInput:decodeScheduleEditor(f.scheduleEditor)});
  await tick();detailRef?.restoreAux({comment:f.comment||'',newItem:f.newItem||'',itemTitle:f.itemTitle||'',renaming:f.renaming||0});
  detailAux={comment:f.comment||'',newItem:f.newItem||'',itemTitle:f.itemTitle||'',renaming:f.renaming||0};detailGeneration=record.generation+1;detailRecovery=result;recoveryHold=true;recoveryReview=false;saveState='pending';persistDetail();
 }
 async function discardDetail(){if(recoveryHold&&draft&&board){const id=draft.id,scope={kind:'card',boardId:board.id,cardId:id},generation=detailGeneration,owner=recovery;const result=await owner.load(scope);if(!result||owner!==recovery)return;owner.store.removeIfGeneration(scope,generation);autosave?.stop();autosave=null;recoveryHold=false;draft=null;board=result.fresh;await edit(result.fresh.cards.find((c:Card)=>c.id===id),anchor||document.body);return}if(detailRecovery)recovery?.store.removeIfGeneration(detailRecovery.record.scope,detailRecovery.record.generation);detailRecovery=null;recoveryReview=false}
 async function confirmRecoverySave(){if(detailRecovery?.record.unknownCreateOutcome){recoveryMessage='核对后再操作；结果未知的评论或清单不会自动重放。';return}recoveryHold=false;detailRecovery=null;autosave?.change(true)}
 let theme:ReturnType<typeof createTheme>|null=null;
 const identity=createIdentityGate();let boardsSequence=0,inboxSequence=0,inboxMetadataSequence=0;
 let smartRef=$state<SmartTasks|null>(null),boardRef=$state<BoardView|null>(null);
 let inboxArchive=$state(false),inboxHistory=$state<Board|null>(null);
 let transferCard=$state(0),transferOpen=$state(false),transferCommand:ReturnType<typeof createTransferCommand>|null=null;
 let epoch=0;let requestEpoch=$state(0);
 let pendingCards=$state<number[]>([]);let uncertainScope=$state(0);
 // Navigation/account presentation owner, deliberately independent of per-task requestEpoch.
 let completionEpoch=0;
 function completionOwner(id:number){return {board:id,user:user?.id,epoch:completionEpoch,ticket:identity.ticket()}}
 function ownsCompletion(owner:any){return !!owner&&owner.user===user?.id&&owner.epoch===completionEpoch&&identity.accept(owner.ticket)&&view!=='users'&&(boards.some(b=>b.id===owner.board)||inbox?.id===owner.board)}
 function validNotice(item:any=undefined){if(!ownsCompletion(item))return false;if(board?.id!==item.board)return true;const c=board!.cards.find(c=>c.id===item.card);return !!c&&c.completed&&!c.archived&&!c.skipped}
 function clearCompletion(){++completionEpoch;motion.clear();feedback.clear()}
 type CompletionNotice={card:number;board:number;user:number;epoch:number;ticket:any;title:string;pending:boolean;status?:'confirmed'|'unknown'};
 let completion=$state<CompletionNotice|null>(null);
 const feedback=createCompletionFeedback({change:(item:CompletionNotice|null)=>completion=item,valid:validNotice});
 onDestroy(()=>feedback.clear());
 $effect(()=>{const scope=`${user?.id}:${view}:${smartRoute}:${inboxArchive}`;void scope;untrack(clearCompletion)});
 $effect(()=>{
  if(completion&&!validNotice(completion))feedback.clear();
  for(const entry of completionMotion){if(!ownsCompletion(entry.owner)||board?.id===entry.owner.board&&!board!.cards.some(c=>c.id===entry.id&&!c.archived&&!c.skipped))motion.cancel(entry)}
 });
 async function undoCompletion(){
  const ticket=identity.ticket();
  try{await feedback.undo(async(item:CompletionNotice)=>{
   if(!validNotice(item)){feedback.clear();return true}
   for(const entry of completionMotion.filter(e=>e.id===item.card))motion.cancel(entry);
   await taskSerial;await writer?.idle();
   if(!validNotice(item))return false;
   if(board?.id!==item.board){
    if(!await leaveDraft())return false;
    const fresh=await api<Board>(`/boards/${item.board}`);
    if(!ownsCompletion(item))return false;
    board=fresh;writer=null;
   }
   const c=board!.cards.find(c=>c.id===item.card);
   if(!c||c.archived||c.skipped||!c.completed){feedback.clear();return true}
   try{
    if(draft?.id===item.card)return await detailAction({action:'card_complete',completed:false})|| (uncertainScope?'unknown':false);
    return await boardAction({action:'card_complete',card_id:item.card,completed:false})|| (uncertainScope?'unknown':false);
   }catch(e){if(identity.accept(ticket))fail(e);return unknownOutcome(e)?'unknown':false}
  })}catch(e){if(identity.accept(ticket))fail(e)}
 }

 let writer:ReturnType<typeof createMutationQueue>|null=null,writerBoard=0,writerRevision=0;
 function channel(){
  if(!board)throw new Error('看板已关闭');
  if(!writer||writerBoard!==board.id){
   writerBoard=board.id;writerRevision=board.revision;
   const uid=user?.id,token=requestEpoch;
   writer=createMutationQueue({revision:()=>writerRevision,apply:(fresh:Board)=>{writerRevision=fresh.revision},onstate:(active:boolean)=>{if(uid===user?.id&&token===requestEpoch)busy=active}});
  }
  return writer;
 }
 // Only this exact acknowledged mutation may finish its visual; finally only cancels pending.
 // New idle board intents start at the displayed snapshot. Detached drafts pass
 // their own baseline; the queue ignores this hint for already-active rounds.
 async function writeBoard(data:Record<string,unknown>,startingRevision=board?.revision,guard?:(revision:number)=>void,visual?:any,acknowledge?:()=>boolean):Promise<Board>{
  if(!board||!user)throw new Error('看板已关闭');
  if(uncertainScope)throw new Error('先只读核对上次操作结果并明确恢复，未再次发送');
  const id=board.id,uid=user.id,token=requestEpoch;
  return channel().run(async(revision:number)=>{
   if(token!==requestEpoch||board?.id!==id||user?.id!==uid)throw new Error('任务已切换，操作未发送');
   guard?.(revision);
   if(['card_complete','card_schedule'].includes(String(data.action))&&board.cards.some(c=>c.id===Number(data.card_id)&&c.skipped))throw new ApiError(400,'已跳过任务不能完成或修改日期，请先撤销跳过','invalid');
   if(data.action==='card_complete'&&data.completed===false){
    const c=board.cards.find(c=>c.id===Number(data.card_id));
    if(!c||c.archived||!c.completed)throw Object.assign(new Error('任务状态已改变，请刷新核对；未再次操作。'),{status:400,code:'invalid'});
   }
   const fresh=await api<Board>(`/boards/${id}/mutate`,'POST',{expected_revision:revision,...data});
   if(token!==requestEpoch||board?.id!==id||user?.id!==uid)throw new Error('操作结果待核对，请刷新看板');
   if(acknowledge&&!acknowledge())throw Object.assign(new Error('操作已结束，旧响应未应用'),{stale:true});
   board=acceptSnapshot(board,fresh);if(fresh.inbox_owner_id&&inboxArchive)inboxHistory=board;boards=boards.map(b=>b.id===fresh.id?{id:fresh.id,title:fresh.title,revision:fresh.revision}:b);
   if(visual&&data.action==='card_complete'&&data.completed===true){const c=fresh.cards.find(c=>c.id===Number(data.card_id));if(c?.completed&&!c.archived&&!c.skipped){visual.ack=c;motion.finish(visual,true)}}
   if(view==='calendar'||view==='smart'||view==='tasks')++taskRefresh;
   return fresh;
  },startingRevision).catch((e:unknown)=>{if(token===requestEpoch&&uid===user?.id&&(!(e as any).status||(e as any).status>=500))uncertainScope=id;throw e});
 }
 let anchor=$state<HTMLElement|null>(null),detailRef=$state<CardDetail|null>(null);
 let saveState=$state('saved'),saveError=$state(''),review=$state<Board|null>(null);
 let autosave:ReturnType<typeof createAutosave>|null=null;
 let rebaseDraft:((fresh:Board)=>void)|null=null;
 const fields=(d:Draft)=>({title:d.title,description:d.description,archived:d.archived,assignee_id:d.assignee_id,scheduleInput:JSON.parse(JSON.stringify(d.scheduleInput))});
 async function leaveDraft(strict=false){
  await writer?.idle();
  if(!draft)return true;
  if(recoveryHold){recoveryMessage='恢复的草稿尚未确认保存，请先保存或保留此页。';return false}
  if(detailRef&&!(strict?detailRef.transferReady():detailRef.canLeave(false)))return false;
  const original=draft,controller=autosave;
  if(!await controller?.flush())return false;
  if(draft!==original)return !draft;
  // The panel remains editable during flush: confirm current auxiliary work only now.
  if(detailRef&&!(strict?detailRef.transferReady():detailRef.canLeave()))return false;
  controller?.stop();autosave=null;rebaseDraft=null;draft=null;review=null;return true;
 }
 async function navigate(run:(ready:()=>boolean)=>void|Promise<void>){
  if(nextModal)return;
  const capture=captureLeaveGuard(()=>[smartRef,boardRef]),uid=user?.id,token=requestEpoch;
  const ready=()=>uid===user?.id&&capture();
  if(!ready())return;
  if(await leaveDraft()&&token===requestEpoch&&ready()){clearCompletion();await run(ready)}
 }
 function changed(immediate=false){detailEdited();if(!recoveryHold)autosave?.change(immediate)}
 function composition(active:boolean){if(active)detailEdited();if(!recoveryHold)autosave?.composition(active)}
 async function retrySave(){if(recoveryHold)return;await writer?.idle();if(uncertainScope){await reviewConflict();return}writer?.reset();await autosave?.retry()}
 async function reviewConflict(){
  if(!board||!draft)return;
  const original=draft,token=requestEpoch,id=board.id;
  try{const fresh=await api<Board>(`/boards/${id}`);if(draft!==original||token!==requestEpoch)return;review=fresh}
  catch(e){if(draft===original)saveError=e instanceof Error?e.message:'读取当前版本失败'}
 }
 async function confirmRebase(){
  if(recoveryHold)return;
  if(!review||!draft||!board)return;
  await writer?.idle();if(uncertainScope===board.id)uncertainScope=0;writer=null;rebaseDraft?.(review);board=acceptSnapshot(board,review);review=null;await autosave?.retry();
 }

 const pollKey=$derived(user&&board&&(view==='boards'||view==='tasks'||view==='calendar'||view==='smart')?`${user.id}:${board.id}`:'');
 $effect(()=>{
  const key=pollKey;const id=untrack(()=>board?.id);const uid=untrack(()=>user?.id);const active=!!key;
  if(!id||!uid||!active)return;
  const token=++epoch;
  const poll=createPoller({read:()=>api<Board>(`/boards/${id}`),apply:(fresh:Board)=>{if(token===epoch&&board?.id===id&&!busy&&!nextModal){board=acceptSnapshot(board,fresh)}},onerror:(e:unknown)=>{if(token===epoch)fail(e)}});
  const resume=()=>{void poll.check()};document.addEventListener('visibilitychange',resume);void poll.check();
  return ()=>{++epoch;poll.stop();document.removeEventListener('visibilitychange',resume)};
 });
 function clearSession(){
  nextModal=null;nextReturn=undefined;nextUnknown=null;
  busy=false;clearSelection();bulkOpen=false;bulkPreparing=false;bulkSource=null;bulkPreview=null;bulkReturn=undefined;bulkSafetyStore=null;
  exportOpen=false;moreOpen=false;
  detailRef?.persistPending();persistDetail();smartRef?.persistRecovery();boardRef?.persistRecovery();clearTimeout(detailTimer);if(recovery)recovery.closed=true;recovery=null;detailRecovery=null;recoveryHold=false;inboxList=0;
  clearCompletion();identity.switch(null);++boardsSequence;++inboxSequence;++inboxMetadataSequence;++epoch;++requestEpoch;feedback.clear();autosave?.stop();autosave=null;rebaseDraft=null;writer=null;displayStore=null;displayVersion++;user=null;board=null;draft=null;boards=[];inbox=null;inboxHistory=null;inboxArchive=false;pendingCards=[];drawer=false;transferOpen=false;transferCommand=null;uncertainScope=0;setCsrf('');theme?.identity(null);templateOpen=false;templateSource=null;templateTarget=null;templateUnknown=false;templateReturn=undefined;
 }
 function fail(e:unknown){
  if((e as any)?.stale)return;
  if(e instanceof ApiError&&[401,403,404].includes(e.status)){clearCompletion()}
  error=e instanceof Error?e.message:'网络连接失败，请重试';
  if(e instanceof ApiError&&e.status===401)clearSession();
  if(e instanceof ApiError&&[403,404].includes(e.status)){clearSelection();if(board&&recovery)for(const record of recovery.store.list().records||[])if(record.scope.boardId===board.id)recovery.store.removeIfGeneration(record.scope,record.generation);++epoch;++requestEpoch;autosave?.stop();autosave=null;rebaseDraft=null;writer=null;board=null;draft=null;void loadBoards()}
 }
 async function loadBoards(){const ticket=identity.ticket(),seq=++boardsSequence;try{const data=await api<BoardSummary[]>('/boards');if(identity.accept(ticket)&&seq===boardsSequence)boards=data}catch(e){if(identity.accept(ticket)&&seq===boardsSequence)fail(e)}}
 // Scope discovery owns its request independently of task-summary updates.
 async function loadInbox(){const ticket=identity.ticket(),seq=++inboxSequence,summary=inboxMetadataSequence;try{const data=await api<Board>('/inbox');if(identity.accept(ticket)&&seq===inboxSequence){if(summary===inboxMetadataSequence)inbox={id:data.id,title:data.title,revision:data.revision};if(inbox?.id===data.id)inboxList=data.lists[0]?.id||0}}catch(e){if(identity.accept(ticket)&&seq===inboxSequence)fail(e)}}
 function authenticated(me:{user:User;csrf:string}){clearCompletion();pendingCards=[];clearSelection();bulkSafetyStore=bulkUncertainty(me.user.id);uncertainScope=bulkSafetyStore.board();inboxList=0;++inboxSequence;++inboxMetadataSequence;identity.switch(me.user.id);setCsrf(me.csrf);theme?.identity(me.user.id);user=me.user;templateSafety=templateUncertainty(me.user.id);templateUnknown=templateSafety.blocked();displayStore=createViewPreferences({accountId:me.user.id});displayVersion++;recovery=recoveryFor(me.user.id);{const owner=recovery;for(const record of owner.store.list().records||[])void owner.load(record.scope)}smartRoute=initialRoute();view='smart';inboxArchive=false;inboxHistory=null;board=null;boards=[];inbox=null;taskFilters={q:'',view:'all',status:'all',assignee_id:'',board_id:'',from:'',to:''}}
 onMount(()=>{
  const layoutMedia=matchMedia('(max-width:800px)'),layoutChanged=()=>{displayLayout=layoutMedia.matches?'narrow':'wide'};layoutChanged();layoutMedia.addEventListener('change',layoutChanged);
  onUnauthorized(clearSession);
  let storage:Storage|undefined;try{storage=localStorage}catch{}
  theme=createTheme({storage,media:matchMedia('(prefers-color-scheme: dark)'),apply:(value:string,preference:string,palette:string)=>{themePreference=preference;themePalette=palette;document.documentElement.dataset.palette=palette;const favicon=document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');if(favicon)favicon.href=`/brand/favicon-${palette}-${value}.svg`;document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim())}});
  const external=(e:StorageEvent)=>theme?.external(e.key,e.newValue);window.addEventListener('storage',external);
  void (async()=>{try{const me=await api<{user:User;csrf:string}>('/me');authenticated(me);await Promise.all([loadBoards(),loadInbox()])}catch(e){if(!(e instanceof ApiError&&e.status===401))fail(e)}finally{ready=true;requestAnimationFrame(()=>requestAnimationFrame(()=>document.documentElement.classList.add('theme-ready')))}})();
  return()=>{layoutMedia.removeEventListener('change',layoutChanged);onUnauthorized(null);theme?.stop();document.documentElement.classList.remove('theme-ready');window.removeEventListener('storage',external)};
 });
 async function login(){busy=true;error='';try{const result=await api<{user:User;csrf:string}>('/login','POST',{username,password});authenticated(result);password='';await Promise.all([loadBoards(),loadInbox()])}catch(e){fail(e)}finally{busy=false}}
 async function logout(){const owner=recovery;detailRef?.persistPending();persistDetail();smartRef?.persistRecovery();boardRef?.persistRecovery();if((draft||smartRef?.hasPending()||boardRef?.hasPending()||owner?.store.list().records?.length)&&!confirm('退出将清除此账号在当前标签页的本地草稿，继续？'))return;busy=true;try{await api('/logout','POST',{});clearSession();await tick();owner?.store.clearAccount()}catch(e){fail(e)}finally{busy=false}}
 function metadata(data:TaskDiscoveryResponse){
  ++boardsSequence;++inboxMetadataSequence;boards=data.boards;if(inbox?.id!==data.inbox?.id)inboxList=0;inbox=data.inbox;
  if(board&&!data.boards.some(b=>b.id===board!.id)&&data.inbox?.id!==board.id){++epoch;++requestEpoch;clearCompletion();autosave?.stop();autosave=null;rebaseDraft=null;draft=null;board=null;writer=null}
 }
 async function routeTo(route:string){await navigate(()=>{clearSelection();feedback.clear();++requestEpoch;board=null;writer=null;drawer=false;membersOpen=false;inboxArchive=false;inboxHistory=null;error='';if(['today','tomorrow','next7','mine','inbox'].includes(route)){view='smart';smartRoute=route}else view=route as typeof view;++taskRefresh})}
 async function showDrawer(){if(await leaveDraft()){drawer=true;clearCompletion()}}
 async function recoverWriter(){if(!uncertainScope)return;const uid=user?.id,token=requestEpoch,id=uncertainScope;try{const fresh=await api<Board>(`/boards/${id}`);if(uid!==user?.id||token!==requestEpoch||uncertainScope!==id)return;if(confirm(`已读取看板「${fresh.title}」最新版本 ${fresh.revision}。请先核对任务及可能生成的后继；恢复不会自动重复操作。确认恢复？`)){writer=null;board=fresh;uncertainScope=0;bulkSafetyStore?.clear();error='';++taskRefresh}}catch(e){if(uid===user?.id&&token===requestEpoch)fail(e)}}
 async function quickInbox(title:string,schedule?:Schedule){
  if(uncertainScope){error='结果未知，请先只读核对并明确恢复';return false}
  if(!title.trim()||!user||transferOpen)return false;
  if(!await leaveDraft())return false;await writer?.idle();
  const uid=user.id,token=++requestEpoch;
  try{const fresh=await api<Board>('/inbox');if(user?.id!==uid||token!==requestEpoch)return false;board=fresh;writer=null;const ok=await mutate({action:'card_create',list_id:fresh.lists[0].id,title,description:'',...(schedule?{schedule}:{})});if(ok==='success'){inbox={id:board.id,title:board.title,revision:board.revision};++taskRefresh;return true}return false}catch(e){fail(e);return false}
 }
 let taskSerial=Promise.resolve();
 function completeTask(task:TaskResult):Promise<boolean>{
  if(uncertainScope){error='结果未知，请先只读核对并明确恢复';return Promise.resolve(false)}
  if(task.skipped||pendingCards.includes(task.id))return Promise.resolve(false);pendingCards=[...pendingCards,task.id];
  // Capture the navigation owner at the gesture, not when this queued work starts.
  // Per-task requestEpoch still advances normally for legal same-view cross-board work.
  const owner=completionOwner(task.board_id),visual=motion.begin(task,!task.completed,owner);let success=false;
  const uid=user?.id,ticket=identity.ticket(),owns=()=>ownsCompletion(owner)&&!transferOpen&&!uncertainScope;
  const work=taskSerial.then(async()=>{
   if(!owns()||!uid||!await leaveDraft()||!owns())return false;
   await writer?.idle();if(!owns())return false;const token=++requestEpoch;
   try{const fresh=await api<Board>(`/boards/${task.board_id}`);if(!owns()||token!==requestEpoch||uid!==user?.id)return false;
    if(!boards.some(b=>b.id===task.board_id)&&inbox?.id!==task.board_id)return false;
    const card=fresh.cards.find(c=>c.id===task.id&&!c.archived);if(!card||card.skipped||card.completed!==task.completed){++taskRefresh;return false}
    board=fresh;writer=null;success=await mutate({action:'card_complete',card_id:task.id,completed:!task.completed},visual)==='success';return success;
   }catch(e){if(token===requestEpoch&&identity.accept(ticket))fail(e);return false}
  }).finally(()=>{motion.finish(visual,false);if(identity.accept(ticket))pendingCards=pendingCards.filter(id=>id!==task.id)});taskSerial=work.then(()=>{},()=>{});return work;
 }
 async function showInboxArchive(){await navigate(async ready=>{if(!user)return;const token=++requestEpoch,uid=user.id;try{const fresh=await api<Board>('/inbox');if(token!==requestEpoch||uid!==user?.id||!ready())return;feedback.clear();board=fresh;inboxHistory=fresh;writer=null;inboxArchive=true}catch(e){fail(e)}})}
 async function startTransfer(){
  if(uncertainScope||transferOpen||!board?.inbox_owner_id||!draft||!user||!detailRef?.transferReady())return;
  const original=draft,controller=autosave,card=draft.id,scope=board.id,uid=user.id,token=requestEpoch;
  const owns=()=>scope===board?.id&&uid===user?.id&&token===requestEpoch&&!uncertainScope;
  if(!await controller?.flush())return;
  await writer?.idle();
  if(!overlayReady()||!owns()||draft!==original||autosave!==controller||!detailRef?.transferReady())return;
  if(!await leaveDraft(true)||!owns()||!overlayReady())return;feedback.clear();transferCard=card;
  const queue=channel();
  transferCommand=createTransferCommand({queue,preview:async(id:number,b:number,l:number)=>api<TransferPreview>(`/inbox/cards/${id}/transfer-preview?target_board_id=${b}&target_list_id=${l}`),send:async(body:unknown)=>api(`/inbox/cards/${card}/transfer`,'POST',body),snapshot:async(id:number)=>api<Board>(`/boards/${id}`),readCard:async(id:number,c:number)=>{try{await api(`/boards/${id}/cards/${c}`);return {status:200}}catch(e){if(e instanceof ApiError)return {status:e.status};throw e}}});transferOpen=true;
 }
 async function transferPreview(b:number,l:number){return await transferCommand!.prepare(transferCard,b,l) as TransferPreview}
 async function finishTransfer(){
  const uid=user?.id,source=await transferCommand!.commit();if(uid!==user?.id)return;
  board=source;await afterTransfer();
 }
 async function afterTransfer(){
  transferOpen=false;transferCommand=null;feedback.clear();++epoch;++requestEpoch;autosave?.stop();autosave=null;draft=null;review=null;writer=null;board=null;++taskRefresh;await Promise.all([loadBoards(),loadInbox()]);
 }
 async function recoverTransfer(result:string){
  // Recovery is an explicit user acknowledgement after exact readback, never replay.
  if(!['source','moved'].includes(result))return;await afterTransfer();
 }
 async function openBoard(id:number,ready:()=>boolean=()=>true){clearSelection();feedback.clear();drawer=false;const token=++requestEpoch,uid=user?.id;error='';notice='';try{const fresh=await api<Board>(`/boards/${id}`);if(token!==requestEpoch||uid!==user?.id||!ready())return;board=fresh;writer=null;view='boards';membersOpen=false}catch(e){if(token===requestEpoch)fail(e)}}
 async function createBoard(ready:()=>boolean=()=>true){busy=true;error='';try{const uid=user?.id,token=++requestEpoch,fresh=await api<Board>('/boards','POST',{title:boardTitle});if(token!==requestEpoch||uid!==user?.id||!ready())return;board=fresh;view='boards';writer=null;++requestEpoch;boardTitle='';creatingBoard=false;drawer=false;await loadBoards()}catch(e){fail(e)}finally{busy=false}}
 async function openTask(task:TaskResult,element:HTMLElement){
  if(!await leaveDraft()||!user)return;
  clearCompletion();const token=++requestEpoch,uid=user.id;
  try{const fresh=await api<Board>(`/boards/${task.board_id}`);if(token!==requestEpoch||user?.id!==uid||(view!=='tasks'&&view!=='calendar'&&view!=='smart'))return;
   const card=fresh.cards.find(c=>c.id===task.id&&!c.archived);if(!card)throw new Error('任务已不可用');if(!boards.some(b=>b.id===task.board_id)&&inbox?.id!==task.board_id)return;board=fresh;writer=null;await edit(card,element);
  }catch(e){if(token===requestEpoch)fail(e)}
 }
 async function closeDetail(){if(nextModal)return;if(await leaveDraft()&&(view==='tasks'||view==='calendar'||view==='smart')){clearCompletion();++requestEpoch;board=null;++taskRefresh}}
 async function taskFilter(change:()=>void){if(await leaveDraft()){clearCompletion();clearSelection();++requestEpoch;board=null;change();++taskRefresh}}
 type MutationResult='success'|'failed';
 async function mutate(data:Record<string,unknown>,visual?:any):Promise<MutationResult>{
  if(!board||!user)return 'failed';
  error='';notice='';const ticket=identity.ticket(),token=requestEpoch;
  try{
   await writeBoard(data,board.revision,undefined,visual);if(!identity.accept(ticket)||token!==requestEpoch)return 'failed';if(data.action!=='card_complete')notice='已保存';
   return 'success';
  }catch(e){if(identity.accept(ticket)&&token===requestEpoch)fail(e);return 'failed'}
 }
 // Reserve each completion before awaiting draft barriers; other cards can enqueue.
 async function boardAction(data:Record<string,unknown>):Promise<boolean>{
  const owner=board?.id,uid=user?.id,token=requestEpoch;
  const card=data.action==='card_complete'?Number(data.card_id):0;
  if(card&&pendingCards.includes(card))return false;
  if(card)pendingCards=[...pendingCards,card];
  const record=board?.cards.find(c=>c.id===card),visual=record&&!record.skipped?motion.begin(record,!!data.completed,completionOwner(board!.id)):null;let success=false;
  try{if(draft&&!await leaveDraft())return false;if(board?.id!==owner||user?.id!==uid||requestEpoch!==token)return false;success=await mutate(data,visual)==='success';return success}
  finally{if(visual)motion.finish(visual,false);if(card&&uid===user?.id&&token===requestEpoch)pendingCards=pendingCards.filter(id=>id!==card)}
 }

 async function boardMove(intent:any):Promise<boolean>{
  if(intent.kind==='card'&&boardDisplay.sort!=='manual')return false;
  if(!board||!user||busy||draft||writer?.pending()||intent.owner!==`${user.id}:${requestEpoch}`)return false;
  const data=resolveMove(board,intent);if(!data)return false;
  error='';notice='';
  try{
   await writeBoard(data,intent.revision,(revision:number)=>{if(revision!==intent.revision||!board||!resolveMove(board,intent))throw Object.assign(new Error('看板已更新，请重新拖动'),{status:400,code:'invalid'})});
   notice='已保存';return true;
  }catch(e){fail(e);return false}
 }

 async function edit(card:Card,element:HTMLElement){
  if(draft?.id===card.id)return;
  if(!await leaveDraft()||!board||!user)return;
  const current=board.cards.find(c=>c.id===card.id);if(!current)return;
  draft={...current,revision:board.revision,scheduleInput:scheduleDraft(current.schedule)};anchor=element;saveError='';error='';review=null;
  channel();
  const original=draft,id=board.id,uid=user.id,token=requestEpoch;
  const owns=()=>draft===original&&board?.id===id&&user?.id===uid&&token===requestEpoch;
  let acknowledged=fields(original);
  detailStoredGeneration=undefined;detailAux={comment:'',newItem:'',itemTitle:'',renaming:0};detailBaseline=detailFields();detailRecovery=null;recoveryHold=false;recoveryReview=false;recoveryMessage='';
  const recoveryOwner=recovery,scope={kind:'card',boardId:id,cardId:original.id};
  const cached=recoveryOwner?.store.get(scope).record;detailGeneration=(cached?.generation??0)+1;
  void recoveryOwner?.load(scope).then((result:any)=>{if(owns()&&recovery===recoveryOwner&&!recoveryHold)detailRecovery=result});
  async function writeAction(data:Record<string,unknown>){
   if(!owns())throw new Error('任务已切换，保存已停止');
   try{
    const fresh=await writeBoard(data,original.revision);
    if(!owns())throw new Error('任务已切换，保存响应已忽略');
    original.revision=fresh.revision;return fresh.revision;
   }catch(e){if(owns()&&e instanceof ApiError&&[401,403,404].includes(e.status))fail(e);throw e}
  }

  autosave=createAutosave({read:()=>fields(original),revision:original.revision,onstate:(state:string,e:Error|null)=>{if(owns()){saveState=state;saveError=e?.message||'';if(state==='saved'&&!recoveryHold&&detailBaseline){const value=detailFields();if(value&&!value.comment&&!value.newItem&&!value.renaming&&!value.itemTitle){recovery?.store.removeIfGeneration({kind:'card',boardId:id,cardId:original.id},detailStoredGeneration??detailGeneration);detailBaseline=value;recoveryMessage=''}else if(value){detailBaseline={...value,comment:'',newItem:'',itemTitle:'',renaming:0};detailEdited()}}}},write:async(data:ReturnType<typeof fields>,revision:number)=>{
   try{
    const validation=scheduleValidation(data.scheduleInput);
    if(validation)throw Object.assign(new Error(validation),{validation:true});
    if(data.title!==acknowledged.title||data.description!==acknowledged.description||data.archived!==acknowledged.archived){
     revision=await writeAction({action:'card_update',card_id:original.id,title:data.title,description:data.description,archived:data.archived});
     acknowledged={...acknowledged,title:data.title,description:data.description,archived:data.archived};
    }
    if(data.assignee_id!==acknowledged.assignee_id){
     revision=await writeAction({action:'card_details',card_id:original.id,assignee_id:data.assignee_id,due_date:original.due_date});
     acknowledged={...acknowledged,assignee_id:data.assignee_id};
    }
    if(JSON.stringify(data.scheduleInput)!==JSON.stringify(acknowledged.scheduleInput)){
     const schedule=scheduleValue(data.scheduleInput);
     revision=await writeAction({action:'card_schedule',card_id:original.id,schedule});
     original.schedule=schedule;original.due_date=schedule?.start_date||null;
     acknowledged={...acknowledged,scheduleInput:data.scheduleInput};
    }
    return revision;
   }catch(e){throw Object.assign(e instanceof Error?e:new Error('保存失败'),{revision})}
  }});
  rebaseDraft=(fresh:Board)=>{
   if(!owns())return;const remote=fresh.cards.find(c=>c.id===original.id);if(!remote)return;
   const local=fields(original),latest=fields({...remote,revision:fresh.revision,scheduleInput:scheduleDraft(remote.schedule)});
   for(const key of Object.keys(latest) as (keyof typeof latest)[]){if(JSON.stringify(local[key])===JSON.stringify(acknowledged[key]))Object.assign(original,{[key]:latest[key]})}
   original.schedule=remote.schedule;original.due_date=remote.due_date;original.completed=remote.completed;original.skipped=remote.skipped;acknowledged=latest;original.revision=fresh.revision;autosave?.rebaseBaseline(latest,fresh.revision);
  };
  saveState='saved';
 }
 async function detailAction(data:Record<string,unknown>):Promise<boolean>{
  if(data.action==='card_move'&&view==='boards'&&boardDisplay.sort!=='manual')return false;
  const id=draft?.id,ticket=identity.ticket(),completionAction=data.action==='card_complete';
  if(completionAction&&id&&pendingCards.includes(id))return false;
  if(completionAction&&id)pendingCards=[...pendingCards,id];
  const visual=completionAction&&draft&&!draft.skipped&&board?motion.begin({...draft,board_id:board.id,board_title:board.title,list_title:board.lists.find(l=>l.id===draft?.list_id)?.title||''},!!data.completed,completionOwner(board.id)):null;let success=false;
  try{success=await runDetailAction(data,visual);return success}finally{if(visual)motion.finish(visual,false);if(completionAction&&id&&identity.accept(ticket))pendingCards=pendingCards.filter(c=>c!==id)}
 }
 async function runDetailAction(data:Record<string,unknown>,visual?:any):Promise<boolean>{
  if(!draft||!board||!autosave||recoveryHold)return false;
  const original=draft,id=board.id,token=requestEpoch;
  let semanticError:Error|null=null;
  const accepted=await autosave.action(async(revision:number)=>{
   if(draft!==original||requestEpoch!==token)throw new Error('任务已切换');
   try{
    let payload:Record<string,unknown>={...data,card_id:original.id};
    let moveIntent:any=null;
    if(data.action==='card_move'&&data.move_slot){
     moveIntent={boardId:id,revision:data.move_revision,kind:'card',sourceId:original.id,slot:data.move_slot};
     if(board?.revision!==data.move_revision)throw Object.assign(new Error('看板已更新，请重新选择移动位置'),{status:400,code:'invalid'});
     const resolved=resolveMove(board,moveIntent);if(!resolved)return revision;payload=resolved;
    }
    const fresh=await writeBoard(payload,revision,moveIntent?(sentRevision:number)=>{if(sentRevision!==moveIntent.revision||!resolveMove(board,moveIntent))throw Object.assign(new Error('看板已更新，请重新选择移动位置'),{status:400,code:'invalid'})}:undefined,visual);
    if(draft!==original||requestEpoch!==token)throw new Error('任务已切换');
    board=acceptSnapshot(board,fresh);original.revision=fresh.revision;
    const card=fresh.cards.find(c=>c.id===original.id);if(card){original.list_id=card.list_id;original.position=card.position;original.completed=card.completed;original.skipped=card.skipped;original.schedule=card.schedule;original.due_date=card.due_date}
    return fresh.revision;
   }catch(e){if(e instanceof ApiError&&['successor_touched','archived_completion','completed_schedule','invalid','invalid_schedule'].includes(e.code)){semanticError=e;return revision}if(e instanceof ApiError&&[401,403,404].includes(e.status))fail(e);throw e}
  });
  if(semanticError)throw semanticError;
  return accepted;
 }

 type NextTicket={kind:'skip'|'remove'|'history'|'unskip';boardId:number;subjectId:number;uid:number;auth:any;epoch:number;serial:number;source?:any;lists:any[];card?:Card};
 let nextModal=$state.raw<NextTicket|null>(null),nextSerial=0,nextReturn:(()=>void)|undefined;
 let nextUnknown:any=null;
 function ownsNext(t:NextTicket){return nextModal===t&&user?.id===t.uid&&identity.accept(t.auth)&&requestEpoch===t.epoch&&board?.id===t.boardId}
 function nextTicket(kind:NextTicket['kind'],subjectId:number):NextTicket{return {kind,subjectId,boardId:board!.id,uid:user!.id,auth:identity.ticket(),epoch:requestEpoch,serial:++nextSerial,lists:structuredClone($state.snapshot(board!.lists)),source:structuredClone($state.snapshot(board!.lists.find(l=>l.id===subjectId)||null)),card:structuredClone($state.snapshot(board!.cards.find(c=>c.id===subjectId)))}}
 async function openOccurrenceDialog(kind:'skip'|'history'|'unskip'){
  if(!user||!board||!draft||!overlayReady()||recoveryHold||!detailRef?.transferReady())return;
  const original=draft,uid=user.id,auth=identity.ticket(),epoch=requestEpoch,owner=autosave;
  if(!await owner?.flush())return;
  await writer?.idle();
  // The slot is acquired synchronously only AFTER every awaited editor barrier.
  if(!overlayReady()||draft!==original||uid!==user?.id||!identity.accept(auth)||epoch!==requestEpoch||recoveryHold||!detailRef?.transferReady())return;
  nextReturn=detailRef.snapshotFocus();nextModal=nextTicket(kind,original.id);
 }
 async function nextPreview(t:NextTicket,target?:number):Promise<any>{
  if(!ownsNext(t))throw new ApiError(409,'操作范围已变化，请关闭后重新打开','conflict');
  if(uncertainScope)throw new ApiError(409,'上次写入结果未知；请关闭后只读核对并明确恢复，不能重新预览或发送','conflict');
  await writer?.idle();
  if(!ownsNext(t)||recoveryHold||draft&&!detailRef?.transferReady())throw new ApiError(409,'编辑状态已变化，请关闭后核对','conflict');
  const fresh=await api<Board>(`/boards/${t.boardId}`);
  if(!ownsNext(t))throw new ApiError(409,'操作已切换','conflict');
  const preview=await api<any>(t.kind==='remove'?`/boards/${t.boardId}/lists/${t.subjectId}/remove-preview?target_list_id=${target}`:`/boards/${t.boardId}/cards/${t.subjectId}/skip-preview`);
  if(!ownsNext(t))throw new ApiError(409,'操作已切换','conflict');
  // Only an explicit preview refresh changes the displayed CAS baseline.
  board=fresh;writer=null;rebaseDraft?.(fresh);return preview;
 }
 async function commitNext(t:NextTicket,body:any){
  if(!ownsNext(t)||uncertainScope)throw new ApiError(409,'结果需先核对；操作未发送','conflict');
  try{
   const fresh=await writeBoard(body,body.expected_revision,(revision:number)=>{if(!ownsNext(t)||revision!==body.expected_revision)throw new ApiError(409,'版本已变化，请明确重新预览','conflict')},undefined,()=>ownsNext(t));
   if(!ownsNext(t))throw Object.assign(new Error('身份已变化，响应未应用'),{stale:true});
   rebaseDraft?.(fresh);
   if(draft){const card=fresh.cards.find(c=>c.id===draft!.id);if(card){draft.list_id=card.list_id;draft.position=card.position}}
   if(t.kind==='remove')clearSelection();
  }catch(e){if(ownsNext(t)&&unknownOutcome(e))nextUnknown={ticket:t,body:structuredClone(body)};throw e}
 }
 async function verifyNext(t:NextTicket){
  if(!ownsNext(t))throw new Error('身份已变化');
  const fresh=await api<Board>(`/boards/${t.boardId}`);
  if(!ownsNext(t))throw new Error('身份已变化');
  const body=nextUnknown?.ticket.boardId===t.boardId?nextUnknown.body:null;
  if(body?.action==='list_remove'){
   const p=body.preview,ids=p.cards.map((c:any)=>c.id),actual=fresh.cards.filter(c=>ids.includes(c.id));
   return `版本 ${fresh.revision}：源列表${fresh.lists.some(l=>l.id===p.source_list_id)?'仍存在':'已消失'}；${actual.filter(c=>c.list_id===p.target_list_id).length}/${ids.length} 个原任务在目标列表。仅只读核对，未重发；关闭后明确恢复。`;
  }
  const subject=body?.card_id||t.subjectId,card=fresh.cards.find(c=>c.id===subject);
  return `版本 ${fresh.revision} · 原任务 #${subject}：${!card?'不存在或已移走':card.skipped?'已跳过':card.completed?'已完成':'未完成'}；直接后继：${fresh.cards.filter(c=>c.predecessor_id===subject).map(c=>'#'+c.id).join('、')||'无'}。仅只读核对，未重发；关闭后明确恢复。`;
 }
 async function closeNext(){const t=nextModal;nextModal=null;await tick();if(t&&user?.id===t.uid&&identity.accept(t.auth)){nextReturn?.();detailRef?.resumeFocus()}nextReturn=undefined}
 async function openListRemoval(id:number){
  if(!user||!board||board.inbox_owner_id||board.lists.length<2||!overlayReady()||recoveryHold)return;
  const uid=user.id,auth=identity.ticket(),epoch=requestEpoch,scope=board.id,original=draft,owner=autosave;
  if(draft&&!detailRef?.transferReady())return;
  if(original&&!await owner?.flush())return;
  await writer?.idle();
  if(!overlayReady()||uid!==user?.id||!identity.accept(auth)||epoch!==requestEpoch||scope!==board?.id||draft!==original||recoveryHold||draft&&!detailRef?.transferReady())return;
  if(!(boardRef?.overlayReady()??true)||boardRef?.hasPending()){error='请先保存或清空列表与快速录入草稿，再移除列表。';return;}
  nextReturn=detailRef?.snapshotFocus();nextModal=nextTicket('remove',id);
 }
 async function readHistory(t:NextTicket){
  if(!ownsNext(t))throw new Error('操作已切换');
  const result=await api<{board_id:number;revision:number;cards:Card[]}>(`/boards/${t.boardId}/cards/${t.subjectId}/history`);
  if(!ownsNext(t)||result.board_id!==t.boardId)throw new Error('身份或看板已变化，旧历史未应用');return result;
 }
 async function unskipNext(t:NextTicket,id=t.subjectId){
  if(!ownsNext(t)||uncertainScope)throw new Error('先只读核对未知结果并明确恢复');
  const fresh=await api<Board>(`/boards/${t.boardId}`);
  if(!ownsNext(t))throw new Error('操作已切换');
  board=fresh;writer=null;
  try{await commitNext(t,{action:'card_unskip',card_id:id,expected_revision:fresh.revision})}catch(e){if((e as any).code==='successor_touched')throw new ApiError(409,actionFailure(e,'unskip').message,'successor_touched');throw e}
 }
 async function openHistorical(t:NextTicket,card:Card){
  if(!ownsNext(t))return;
  const fresh=await api<Board>(`/boards/${t.boardId}`);
  if(!ownsNext(t))return;
  const real=fresh.cards.find(c=>c.id===card.id);if(!real)throw new Error('历史任务已不可用');
  await closeNext();if(user?.id!==t.uid||!identity.accept(t.auth))return;
  if(!await leaveDraft(true)||user?.id!==t.uid||!identity.accept(t.auth)||requestEpoch!==t.epoch)return;board=fresh;writer=null;await edit(real,anchor||document.body);
 }

</script>
<svelte:window onpagehide={()=>{detailRef?.persistPending();persistDetail();smartRef?.persistRecovery();boardRef?.persistRecovery()}} onbeforeunload={e=>{if(nextModal||uncertainScope||bulkPreparing||bulkOpen&&bulkRef?.hasUnsaved()||templateOpen&&templateRef?.hasPending()||writer?.pending()||autosave?.pending()||detailRef?.hasPending()||smartRef?.hasPending()||boardRef?.hasPending()){e.preventDefault();e.returnValue=''}}}/>
<PwaStatus/>
{#if !ready}<main class="login-shell"><p>正在连接 Norns…</p></main>
{:else if !user}
<main class="login-shell"><section class="login-card"><a class="brand" href="/"><BrandMark/><Wordmark/></a><div class="login-copy"><span class="eyebrow">让工作井然有序</span><h1>专注下一步。</h1><p>把想法变成卡片，让进展清晰可见。</p></div>{#if error}<div class="alert" role="alert">{error}</div>{/if}<form onsubmit={e=>{e.preventDefault();void login()}}><label>用户名<input aria-label="用户名" bind:value={username} autocomplete="username" required/></label><label>密码<input aria-label="密码" type="password" bind:value={password} autocomplete="current-password" required/></label><button class="primary full" disabled={busy}>{busy?'正在登录…':'登录 Norns'}</button></form><div class="login-themes">{@render themeControls()}</div><p class="login-note">账号由管理员创建 · 仅成员可访问看板 · <a href="https://github.com/AixPot/Norns" target="_blank" rel="noopener noreferrer">源代码</a></p></section></main>
{:else}
<div class="app-shell three-pane-shell">
 <aside class="function-rail" aria-label="功能栏">{@render functions()}</aside>
 <aside class="three-pane-nav" aria-label="任务与清单导航">{@render navigation()}</aside>
 <header class="mobile-navigation"><button aria-label="打开导航" onclick={showDrawer}>☰</button><strong class="mobile-brand"><BrandMark size={26}/><Wordmark height={22}/></strong><span>{user.username}</span></header>
<main use:completionClearanceOwner class="workspace">{#if templateUnknown}<div class="alert" role="status">私人模板写入结果未知，已阻止重复发送。<button onclick={reconcileTemplates}>只读核对模板并明确恢复</button></div>{/if}{#if uncertainScope}<div class="alert" role="status">写入结果未知，未自动重放。请先核对服务器状态。<button onclick={recoverWriter}>只读核对最新版本并明确恢复</button></div>{/if}{#if error}<div class="alert" role="alert">{error}</div>{/if}
{#if view==='boards'&&board||view==='tasks'||view==='smart'&&!inboxArchive}<div class="selection-toolbar">
 {#if !selecting}<button class="secondary" onclick={()=>selecting=true}>选择任务</button>{:else}<span role="status">已选 {selected.length} / 100</span><button onclick={()=>selected=selectVisible(selected,visibleTasks)}>全选当前已加载任务</button><button onclick={()=>selected=[]}>清空选择</button><button class="primary" disabled={!selected.length||mixedSelection||bulkPreparing||!!uncertainScope} onclick={prepareSelection}>批量修改 ({selected.length})</button><button onclick={clearSelection}>退出选择</button>{/if}
 {#if mixedSelection}<p role="status">只能对同一来源看板执行原子批量操作；请取消其他看板的选择，不会拆分提交。</p>{/if}
 {#if selecting}<small>选择框与完成框独立；最多 100 个，仅选择当前已加载可见任务。</small>{/if}</div>{/if}
{#if view==='users'}<Users onerror={fail}/>
{:else if view==='smart'}{#if smartRoute==='inbox'}<div class="inbox-history-control"><button onclick={()=>inboxArchive?routeTo('inbox'):showInboxArchive()}>{inboxArchive?'返回收集箱':'已归档'}</button></div>{/if}{#if inboxArchive&&inboxHistory}<section class="inbox-history"><h1>收集箱 · 已归档</h1><p class="muted">仅你可见。打开后可恢复，也可确认整链转入普通看板。</p>{#each inboxHistory.cards.filter(c=>c.archived) as c}<button class="archived-card" onclick={async e=>{const element=e.currentTarget;if(!await leaveDraft())return;board=inboxHistory;writer=null;await edit(c,element)}}>{c.title}{c.skipped?' · 已跳过':''}<span>打开 →</span></button>{:else}<p class="empty-note">还没有归档的任务。</p>{/each}</section>{:else}{#key `${user.id}:${smartRoute}`}<SmartTasks {completionMotion} {selecting} {selected} onselect={selectTask} onvisible={selectionVisible} ontemplate={(restore)=>useTemplate(inbox?.id||0,inboxList,restore)} accountId={user.id} display={displayValue('smart',smartRoute)} ondisplay={((uid,scope)=>(value:ViewPreferences)=>displayChange(uid,'smart',scope,value))(user.id,smartRoute)} bind:this={smartRef} {recovery} unknown={!!uncertainScope} inboxList={inboxList} route={smartRoute} inboxId={inbox?.id||0} refresh={taskRefresh} {pendingCards} onopen={openTask} oncomplete={completeTask} onquick={quickInbox} onmetadata={metadata} onerror={fail}/>{/key}{/if}
{:else if view==='calendar'}<CalendarView bind:date={calendarDate} bind:mode={calendarMode} bind:boardId={calendarBoard} {boards} onmetadata={metadata} onopen={openTask} onerror={fail} onfilter={taskFilter} refresh={taskRefresh}/>
{:else if view==='tasks'}<TaskDiscovery {completionMotion} {selecting} {selected} onselect={selectTask} onvisible={selectionVisible} accountId={user.id} display={displayValue('search','all')} ondisplay={((uid)=>(value:ViewPreferences)=>displayChange(uid,'search','all',value))(user.id)} bind:filters={taskFilters} {boards} onmetadata={metadata} onopen={openTask} onerror={fail} onfilter={taskFilter} refresh={taskRefresh}/>
{:else if !board}<section><h1>选择清单</h1><p class="muted">从左侧选择看板，或添加一个新的清单。</p></section>
{:else}<div class="board-heading"><div><button class="back" onclick={()=>routeTo('today')}>← 今天</button><h1>{board.title}</h1></div><div class="board-controls">{#if busy||notice}<span class="save-status" role="status">{busy?'保存中…':notice}</span>{/if}<button class="secondary" disabled={busy} onclick={()=>navigate(ready=>openBoard(board!.id,ready))}>刷新看板</button><button class="secondary" onclick={()=>membersOpen=!membersOpen}>成员 ({board.members.length})</button></div></div>
{#if membersOpen}<section class="members"><h2>看板成员</h2>{#each board.members as member}<div class="member-row"><div><strong>{member.username}</strong><span class="muted">{member.role==='admin'?'看板管理员':'成员'}{!member.active?' · 已停用':''}</span></div>{#if board.role==='admin'&&member.user_id!==user.id}<button disabled={busy} onclick={()=>boardAction({action:'member_remove',user_id:member.user_id})}>移除</button>{/if}</div>{/each}{#if board.role==='admin'}<form onsubmit={async e=>{e.preventDefault();if(await boardAction({action:'member_set',username:memberName,role:memberRole}))memberName=''}}><label>成员用户名<input aria-label="成员用户名" bind:value={memberName} required/></label><label>角色<select aria-label="成员角色" bind:value={memberRole}><option value="member">成员</option><option value="admin">看板管理员</option></select></label><button class="primary" disabled={busy}>添加或提权</button></form><p class="muted">不支持管理员降级或自行退出。至少保留一位看板管理员。</p>{/if}</section>{/if}
<BoardView onremove={openListRemoval} {completionMotion} {selecting} {selected} onselect={selectTask} onvisible={selectionVisible} ontemplate={(listId,restore)=>useTemplate(board!.id,listId,restore)} accountId={user.id} display={boardDisplay} ondisplay={((uid,id)=>(value:ViewPreferences)=>displayChange(uid,'board',String(id),value))(user.id,board.id)} bind:this={boardRef} {recovery} unknown={!!uncertainScope} {board} {busy} moveOwner={`${user.id}:${requestEpoch}`} dragDisabled={!!draft} {pendingCards} onedit={edit} onaction={boardAction} onmove={boardMove}/>
{/if}
</main></div>
{/if}
{#if draft&&board}{#key `${board.id}:${draft.id}`}<CardDetail completionEntry={completionMotion.find(e=>e.id===draft?.id)} completionPhase={completionMotion.find(e=>e.id===draft?.id)?.phase||''} positionDisabled={view==='boards'&&boardDisplay.sort!=='manual'} suspended={!!nextModal||bulkOpen||exportOpen||templateOpen} onskip={()=>openOccurrenceDialog('skip')} onhistory={()=>openOccurrenceDialog('history')} onunskip={()=>openOccurrenceDialog('unskip')} onsavetemplate={saveTemplate} onuncertain={()=>{if(board){uncertainScope=board.id;detailEdited()}}} {detailRecovery} {recoveryHold} {recoveryReview} {recoveryMessage} onrestore={restoreDetail} ondiscard={discardDetail} onconfirmsave={confirmRecoverySave} onauxiliary={auxiliary} ontransfer={startTransfer} feedback={completionFeedback} bind:this={detailRef} {draft} {board} {busy} {anchor} {saveState} {saveError} {review} userId={user!.id} onaction={detailAction} onclose={()=>{void closeDetail()}} onchange={changed} onblur={async()=>recoveryHold?false:await autosave?.flush()??false} oncomposition={composition} onretry={retrySave} onreview={reviewConflict} onrebase={confirmRebase} oncancelreview={()=>review=null}/>{/key}{/if}

{#snippet completionFeedback()}{#if completion}<CompletionToast item={completion} onundo={()=>{void undoCompletion()}} onclose={()=>feedback.clear()}/>{/if}{/snippet}
{#if !draft}{@render completionFeedback()}{/if}

{#snippet icon(path:string)}<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={path}/></svg>{/snippet}
{#snippet functions()}
 <button class="rail-logo" aria-label="Norns 今天" onclick={()=>routeTo('today')}><BrandMark size={32}/></button>
 <button aria-label="任务" title="任务" class:active={view==='smart'||view==='boards'} onclick={()=>routeTo('today')}>{@render icon('M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01')}<span>任务</span></button>
 <button aria-label="日历" title="日历" class:active={view==='calendar'} onclick={()=>routeTo('calendar')}>{@render icon('M4 5h16v16H4zM4 10h16M8 3v4M16 3v4')}<span>日历</span></button>
 <button aria-label="搜索" title="搜索" class:active={view==='tasks'} onclick={()=>routeTo('tasks')}>{@render icon('M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0')}<span>搜索</span></button>
 <div class="rail-bottom"><span class="rail-account" title={user?.username}>{user?.username.slice(0,2)}</span>{@render themeControls()}{#if user?.is_admin}<button aria-label="账号管理" title="账号管理" onclick={()=>routeTo('users')}>{@render icon('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17 8h5M19.5 5.5v5')}</button>{/if}<button aria-label="退出" title="退出" disabled={busy} onclick={logout}>{@render icon('M9 3H4v18h5M12 12h10m-4-4 4 4-4 4')}</button></div>
{/snippet}
{#snippet navigation()}
 <div class="nav-brand"><Wordmark/></div><nav class="smart-navigation" aria-label="智能视图">{#each [['today','今天'],['tomorrow','明天'],['next7','最近七天'],['mine','指派给我'],['inbox','收集箱']] as [route,label]}<button class:active={view==='smart'&&smartRoute===route} onclick={()=>routeTo(route)}><span>{label}</span></button>{/each}</nav>
 <div class="lists-heading"><span>清单</span><div class="global-actions"><button aria-label="更多操作" aria-expanded={moreOpen} onclick={()=>moreOpen=!moreOpen}>⋯</button>{#if moreOpen}<div class="global-menu"><button onclick={()=>{if(!overlayReady()||draft&&!detailRef?.overlayReady())return;moreOpen=false;drawer=false;exportOpen=true}}>导出数据</button><button onclick={showTemplates}>私人模板库</button><PwaInstall/></div>{/if}</div><button aria-label="添加清单" title="添加清单" onclick={()=>navigate(()=>{creatingBoard=!creatingBoard})}>＋</button></div>
 {#if creatingBoard}<form class="sidebar-create" onsubmit={e=>{e.preventDefault();void navigate(createBoard)}}><label>看板名称<input aria-label="看板名称" placeholder="清单名称" bind:value={boardTitle} required maxlength="100"/></label><button class="primary" disabled={busy}>创建看板</button></form>{/if}
 <nav class="board-navigation" aria-label="清单">{#each boards as b}<button class:active={view==='boards'&&board?.id===b.id} onclick={()=>navigate(ready=>openBoard(b.id,ready))}><span class="board-symbol" aria-hidden="true">▤</span><span>{b.title}</span></button>{:else}<p class="muted">暂无看板，可添加或请管理员邀请。</p>{/each}</nav>
{/snippet}
{#if drawer&&user}<NavigationDrawer onclose={()=>drawer=false}><div class="drawer-functions">{@render functions()}</div><div class="drawer-navigation">{@render navigation()}</div></NavigationDrawer>{/if}
{#if transferOpen&&user}<TransferDialog {boards} onload={id=>api<Board>(`/boards/${id}`)} onpreview={transferPreview} oncommit={finishTransfer} onverify={()=>transferCommand!.verify()} onrecover={recoverTransfer} onclose={()=>{transferOpen=false;transferCommand=null}}/>{/if}

{#if templateOpen&&user}{#key user.id}<TemplateDialog bind:this={templateRef} source={templateSource} target={templateTarget} onapply={applyTemplate} onpending={markTemplateUnknown} onknown={clearTemplateUnknown} onunknown={markTemplateUnknown} onclose={closeTemplates}/>{/key}{/if}
{#if exportOpen&&user}{#key `${user.id}:${exportScope}`}<ExportDialog initialBoardId={exportScope} onclose={async()=>{exportOpen=false;await tick();detailRef?.resumeFocus()}}/>{/key}{/if}

<style>
 .global-menu{position:absolute;right:0;top:100%;z-index:5;width:145px;background:var(--surface-raised);box-shadow:0 4px 16px var(--shadow-color)}.global-menu button{width:100%;white-space:normal}
 .global-actions{position:relative;margin-left:auto;display:flex;gap:6px;align-items:center}.global-actions>button:first-child{font-size:24px;line-height:1;min-width:36px}.global-actions>button:last-child:not(:first-child){position:absolute;right:0;top:100%;z-index:5;width:112px;background:var(--surface-raised);box-shadow:0 4px 16px var(--shadow-color)}
</style>

{#snippet themeControls()}
 <AppearancePicker palette={themePalette} mode={themePreference} onpalette={value=>theme?.setPalette(value)} onmode={value=>theme?.set(value)}/>
{/snippet}

{#if bulkOpen&&user&&bulkSource&&bulkPreview}{#key user.id}<BulkActions bind:this={bulkRef} source={bulkSource} originals={bulkPreview.originals} onrefresh={refreshBulk} onsubmit={submitBulk} onclose={closeBulk}/>{/key}{/if}
{#if nextModal&&user}{#key nextModal.serial}
 {@const t=nextModal}
 {#if uncertainScope}<RecurrenceHistory title={t.card?.title||t.source?.title||'未知写入'} blocked={true} isCurrent={()=>ownsNext(t)} onread={()=>readHistory(t)} onunskip={id=>unskipNext(t,id)} onopen={card=>openHistorical(t,card)} onverify={()=>verifyNext(t)} onclose={closeNext}/>
 {:else if t.kind==='skip'}<SkipDialog cardId={t.subjectId} title={t.card?.title||''} mode={t.card?.schedule?.repeat?.mode==='relative'?'relative':'calendar'} isCurrent={()=>ownsNext(t)} onpreview={()=>nextPreview(t)} oncommit={body=>commitNext(t,body)} onverify={()=>verifyNext(t)} onclose={closeNext}/>
 {:else if t.kind==='remove'}<ListDeleteDialog boardId={t.boardId} source={t.source} lists={t.lists} isCurrent={()=>ownsNext(t)} onpreview={target=>nextPreview(t,target)} oncommit={body=>commitNext(t,body)} onverify={()=>verifyNext(t)} onclose={closeNext}/>
 {:else}<RecurrenceHistory title={t.card?.title||''} unskipOnly={t.kind==='unskip'} blocked={!!uncertainScope} isCurrent={()=>ownsNext(t)} onread={()=>readHistory(t)} onunskip={id=>unskipNext(t,id)} onopen={card=>openHistorical(t,card)} onverify={()=>verifyNext(t)} onclose={closeNext}/>{/if}
{/key}{/if}
