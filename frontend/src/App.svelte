<script lang="ts">
 import BrandMark from './BrandMark.svelte';
 import Wordmark from './Wordmark.svelte';
 import AppearancePicker from './AppearancePicker.svelte';
 import {onMount,onDestroy,untrack} from 'svelte';
 import {api,ApiError,setCsrf,onUnauthorized} from './api';
 import type {User,Board,BoardSummary,Card,Draft,TaskResult,TaskFilters,TaskDiscoveryResponse,TransferPreview} from './types';
 import {createPoller,acceptSnapshot} from './collaboration.mjs';
 import CompletionToast from './CompletionToast.svelte';
 import {createCompletionFeedback} from './completion-feedback.mjs';
 import {createMutationQueue} from './mutation-queue.mjs';
 import {resolveMove} from './drag-order.mjs';
 import {createAutosave} from './autosave.mjs';
 import {scheduleDraft,scheduleValidation,scheduleValue} from './schedule-draft.mjs';
 import SmartTasks from './SmartTasks.svelte';
 import NavigationDrawer from './NavigationDrawer.svelte';
 import TransferDialog from './TransferDialog.svelte';
 import {createTheme} from './theme.mjs';
 import {createIdentityGate,initialRoute} from './navigation.mjs';
 import {createTransferCommand} from './transfer.mjs';
 import TaskDiscovery from './TaskDiscovery.svelte';
 import CalendarView from './CalendarView.svelte';
 import {shanghaiToday} from './calendar.mjs';
 let calendarDate=$state(shanghaiToday()),calendarMode=$state<'month'|'week'>('month'),calendarBoard=$state('');
 import BoardView from './BoardView.svelte';import CardDetail from './CardDetail.svelte';import Users from './Users.svelte';
 let user=$state<User|null>(null);let ready=$state(false);let username=$state('');let password=$state('');let boards=$state<BoardSummary[]>([]);let board=$state<Board|null>(null);let boardTitle=$state('');let draft=$state<Draft|null>(null);let error=$state('');let busy=$state(false);let view=$state<'boards'|'users'|'tasks'|'calendar'|'smart'>('smart');let membersOpen=$state(false);let memberName=$state('');let memberRole=$state('member');let notice=$state('');
 let taskFilters=$state<TaskFilters>({q:'',view:'all',status:'all',assignee_id:'',board_id:'',from:'',to:''});let taskRefresh=$state(0);
 let smartRoute=$state(initialRoute()),inbox=$state<BoardSummary|null>(null),drawer=$state(false),creatingBoard=$state(false),themePreference=$state('system'),themePalette=$state('blue');
 let theme:ReturnType<typeof createTheme>|null=null;
 const identity=createIdentityGate();let boardsSequence=0,inboxSequence=0;
 let smartRef=$state<SmartTasks|null>(null);
 let inboxArchive=$state(false),inboxHistory=$state<Board|null>(null);
 let transferCard=$state(0),transferOpen=$state(false),transferCommand:ReturnType<typeof createTransferCommand>|null=null;
 let epoch=0;let requestEpoch=$state(0);
 let pendingCards=$state<number[]>([]);let uncertainScope=$state(0);
 type CompletionNotice={card:number;board:number;user:number;epoch:number;title:string;pending:boolean};
 let completion=$state<CompletionNotice|null>(null);
 const feedback=createCompletionFeedback({change:(item:CompletionNotice|null)=>completion=item});
 onDestroy(()=>feedback.clear());
 $effect(()=>{
  if(completion){
   const c=board?.cards.find(c=>c.id===completion!.card);
   if(!user||completion.user!==user.id||completion.board!==board?.id||completion.epoch!==requestEpoch||view==='users'||!c||c.archived||!c.completed)feedback.clear();
  }
 });
 async function undoCompletion(){
  await feedback.undo(async(item:CompletionNotice)=>{
   if(item.user!==user?.id||item.board!==board?.id||item.epoch!==requestEpoch){feedback.clear();return true}
   const c=board.cards.find(c=>c.id===item.card);
   if(!c||c.archived||!c.completed){feedback.clear();return true}
   try{
    if(draft?.id===item.card)return await detailAction({action:'card_complete',completed:false});
    return await boardAction({action:'card_complete',card_id:item.card,completed:false});
   }catch(e){fail(e);return false}
  });
 }

 let writer:ReturnType<typeof createMutationQueue>|null=null,writerBoard=0,writerRevision=0;
 function channel(){
  if(!board)throw new Error('看板已关闭');
  if(!writer||writerBoard!==board.id){
   writerBoard=board.id;writerRevision=board.revision;
   writer=createMutationQueue({revision:()=>writerRevision,apply:(fresh:Board)=>{writerRevision=fresh.revision},onstate:(active:boolean)=>busy=active});
  }
  return writer;
 }
 // New idle board intents start at the displayed snapshot. Detached drafts pass
 // their own baseline; the queue ignores this hint for already-active rounds.
 async function writeBoard(data:Record<string,unknown>,startingRevision=board?.revision,guard?:(revision:number)=>void):Promise<Board>{
  if(!board||!user)throw new Error('看板已关闭');
  if(uncertainScope)throw new Error('先只读核对上次操作结果并明确恢复，未再次发送');
  const id=board.id,uid=user.id,token=requestEpoch;
  return channel().run(async(revision:number)=>{
   if(token!==requestEpoch||board?.id!==id||user?.id!==uid)throw new Error('任务已切换，操作未发送');
   guard?.(revision);
   if(data.action==='card_complete'&&data.completed===false){
    const c=board.cards.find(c=>c.id===Number(data.card_id));
    if(!c||c.archived||!c.completed)throw Object.assign(new Error('任务状态已改变，请刷新核对；未再次操作。'),{status:400,code:'invalid'});
   }
   const fresh=await api<Board>(`/boards/${id}/mutate`,'POST',{expected_revision:revision,...data});
   if(token!==requestEpoch||board?.id!==id||user?.id!==uid)throw new Error('操作结果待核对，请刷新看板');
   board=acceptSnapshot(board,fresh);if(fresh.inbox_owner_id&&inboxArchive)inboxHistory=board;boards=boards.map(b=>b.id===fresh.id?{id:fresh.id,title:fresh.title,revision:fresh.revision}:b);
   if(data.action==='card_complete'&&data.completed===true){const c=fresh.cards.find(c=>c.id===Number(data.card_id));if(c?.completed&&!c.archived)feedback.show({card:c.id,board:id,user:uid,epoch:token,title:c.title})}
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
  if(detailRef&&!(strict?detailRef.transferReady():detailRef.canLeave(false)))return false;
  const original=draft,controller=autosave;
  if(!await controller?.flush())return false;
  if(draft!==original)return !draft;
  // The panel remains editable during flush: confirm current auxiliary work only now.
  if(detailRef&&!(strict?detailRef.transferReady():detailRef.canLeave()))return false;
  controller?.stop();autosave=null;rebaseDraft=null;draft=null;review=null;return true;
 }
 async function navigate(run:()=>void|Promise<void>){if(smartRef&&!smartRef.canLeave())return;if(await leaveDraft())await run()}
 function changed(immediate=false){autosave?.change(immediate)}
 function composition(active:boolean){autosave?.composition(active)}
 async function retrySave(){await writer?.idle();if(uncertainScope){await reviewConflict();return}writer?.reset();await autosave?.retry()}
 async function reviewConflict(){
  if(!board||!draft)return;
  const original=draft,token=requestEpoch,id=board.id;
  try{const fresh=await api<Board>(`/boards/${id}`);if(draft!==original||token!==requestEpoch)return;review=fresh}
  catch(e){if(draft===original)saveError=e instanceof Error?e.message:'读取当前版本失败'}
 }
 async function confirmRebase(){
  if(!review||!draft||!board)return;
  await writer?.idle();if(uncertainScope===board.id)uncertainScope=0;writer=null;rebaseDraft?.(review);board=acceptSnapshot(board,review);review=null;await autosave?.retry();
 }

 const pollKey=$derived(user&&board&&(view==='boards'||view==='tasks'||view==='calendar'||view==='smart')?`${user.id}:${board.id}`:'');
 $effect(()=>{
  const key=pollKey;const id=untrack(()=>board?.id);const uid=untrack(()=>user?.id);const active=!!key;
  if(!id||!uid||!active)return;
  const token=++epoch;
  const poll=createPoller({read:()=>api<Board>(`/boards/${id}`),apply:(fresh:Board)=>{if(token===epoch&&board?.id===id&&!busy){board=acceptSnapshot(board,fresh)}},onerror:(e:unknown)=>{if(token===epoch)fail(e)}});
  const resume=()=>{void poll.check()};document.addEventListener('visibilitychange',resume);void poll.check();
  return ()=>{++epoch;poll.stop();document.removeEventListener('visibilitychange',resume)};
 });
 function clearSession(){
  identity.switch(null);++boardsSequence;++inboxSequence;++epoch;++requestEpoch;feedback.clear();autosave?.stop();autosave=null;rebaseDraft=null;writer=null;user=null;board=null;draft=null;boards=[];inbox=null;inboxHistory=null;inboxArchive=false;pendingCards=[];drawer=false;transferOpen=false;transferCommand=null;uncertainScope=0;setCsrf('');theme?.identity(null);
 }
 function fail(e:unknown){
  if((e as any)?.stale)return;
  if(e instanceof ApiError&&[401,403,404].includes(e.status))feedback.clear();
  error=e instanceof Error?e.message:'网络连接失败，请重试';
  if(e instanceof ApiError&&e.status===401)clearSession();
  if(e instanceof ApiError&&[403,404].includes(e.status)){++epoch;++requestEpoch;autosave?.stop();autosave=null;rebaseDraft=null;writer=null;board=null;draft=null;void loadBoards()}
 }
 async function loadBoards(){const ticket=identity.ticket(),seq=++boardsSequence;try{const data=await api<BoardSummary[]>('/boards');if(identity.accept(ticket)&&seq===boardsSequence)boards=data}catch(e){if(identity.accept(ticket)&&seq===boardsSequence)fail(e)}}
 async function loadInbox(){const ticket=identity.ticket(),seq=++inboxSequence;try{const data=await api<Board>('/inbox');if(identity.accept(ticket)&&seq===inboxSequence)inbox={id:data.id,title:data.title,revision:data.revision}}catch(e){if(identity.accept(ticket)&&seq===inboxSequence)fail(e)}}
 function authenticated(me:{user:User;csrf:string}){identity.switch(me.user.id);setCsrf(me.csrf);theme?.identity(me.user.id);user=me.user;smartRoute=initialRoute();view='smart';inboxArchive=false;inboxHistory=null;board=null;boards=[];inbox=null;taskFilters={q:'',view:'all',status:'all',assignee_id:'',board_id:'',from:'',to:''}}
 onMount(()=>{
  onUnauthorized(clearSession);
  let storage:Storage|undefined;try{storage=localStorage}catch{}
  theme=createTheme({storage,media:matchMedia('(prefers-color-scheme: dark)'),apply:(value:string,preference:string,palette:string)=>{themePreference=preference;themePalette=palette;document.documentElement.dataset.palette=palette;const favicon=document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');if(favicon)favicon.href=`/brand/favicon-${palette}-${value}.svg`;document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim())}});
  const external=(e:StorageEvent)=>theme?.external(e.key,e.newValue);window.addEventListener('storage',external);
  void (async()=>{try{const me=await api<{user:User;csrf:string}>('/me');authenticated(me);await Promise.all([loadBoards(),loadInbox()])}catch(e){if(!(e instanceof ApiError&&e.status===401))fail(e)}finally{ready=true;requestAnimationFrame(()=>requestAnimationFrame(()=>document.documentElement.classList.add('theme-ready')))}})();
  return()=>{onUnauthorized(null);theme?.stop();document.documentElement.classList.remove('theme-ready');window.removeEventListener('storage',external)};
 });
 async function login(){busy=true;error='';try{const result=await api<{user:User;csrf:string}>('/login','POST',{username,password});authenticated(result);password='';await Promise.all([loadBoards(),loadInbox()])}catch(e){fail(e)}finally{busy=false}}
 async function logout(){busy=true;try{await api('/logout','POST',{});clearSession()}catch(e){fail(e)}finally{busy=false}}
 function metadata(data:TaskDiscoveryResponse){
  ++boardsSequence;++inboxSequence;boards=data.boards;inbox=data.inbox;
  if(board&&!data.boards.some(b=>b.id===board!.id)&&data.inbox?.id!==board.id){++epoch;++requestEpoch;feedback.clear();autosave?.stop();autosave=null;rebaseDraft=null;draft=null;board=null;writer=null}
 }
 async function routeTo(route:string){await navigate(()=>{feedback.clear();++requestEpoch;board=null;writer=null;drawer=false;membersOpen=false;inboxArchive=false;inboxHistory=null;error='';if(['today','tomorrow','next7','mine','inbox'].includes(route)){view='smart';smartRoute=route}else view=route as typeof view;++taskRefresh})}
 async function showDrawer(){if(await leaveDraft()){drawer=true;feedback.clear()}}
 async function recoverWriter(){if(!uncertainScope)return;try{const fresh=await api<Board>(`/boards/${uncertainScope}`);if(confirm(`已读取看板「${fresh.title}」最新版本 ${fresh.revision}。请先核对任务；恢复不会自动重复操作。确认恢复？`)){writer=null;board=fresh;uncertainScope=0;error='';++taskRefresh}}catch(e){fail(e)}}
 async function quickInbox(title:string){
  if(uncertainScope){error='结果未知，请先只读核对并明确恢复';return false}
  if(!title.trim()||!user||transferOpen)return false;
  if(!await leaveDraft())return false;await writer?.idle();
  const uid=user.id,token=++requestEpoch;feedback.clear();
  try{const fresh=await api<Board>('/inbox');if(user?.id!==uid||token!==requestEpoch)return false;board=fresh;writer=null;const ok=await mutate({action:'card_create',list_id:fresh.lists[0].id,title});if(ok==='success'){inbox={id:board.id,title:board.title,revision:board.revision};++taskRefresh;return true}return false}catch(e){fail(e);return false}
 }
 let taskSerial=Promise.resolve();
 function completeTask(task:TaskResult):Promise<boolean>{
  if(uncertainScope){error='结果未知，请先只读核对并明确恢复';return Promise.resolve(false)}
  if(pendingCards.includes(task.id))return Promise.resolve(false);pendingCards=[...pendingCards,task.id];
  const uid=user?.id,ticket=identity.ticket();const work=taskSerial.then(async()=>{
   if(!identity.accept(ticket)||!uid||user?.id!==uid||transferOpen||!await leaveDraft())return false;
   await writer?.idle();const token=++requestEpoch;
   try{const fresh=await api<Board>(`/boards/${task.board_id}`);if(token!==requestEpoch||uid!==user?.id)return false;
    if(!boards.some(b=>b.id===task.board_id)&&inbox?.id!==task.board_id)return false;
    const card=fresh.cards.find(c=>c.id===task.id&&!c.archived);if(!card||card.completed!==task.completed){++taskRefresh;return false}
    feedback.clear();board=fresh;writer=null;return await mutate({action:'card_complete',card_id:task.id,completed:!task.completed})==='success';
   }catch(e){if(token===requestEpoch)fail(e);return false}
  }).finally(()=>{pendingCards=pendingCards.filter(id=>id!==task.id)});taskSerial=work.then(()=>{},()=>{});return work;
 }
 async function showInboxArchive(){if(!await leaveDraft()||!user)return;const token=++requestEpoch,uid=user.id;try{const fresh=await api<Board>('/inbox');if(token!==requestEpoch||uid!==user?.id)return;feedback.clear();board=fresh;inboxHistory=fresh;writer=null;inboxArchive=true}catch(e){fail(e)}}
 async function startTransfer(){
  if(uncertainScope||transferOpen||!board?.inbox_owner_id||!draft||!user||!detailRef?.transferReady())return;
  const original=draft,controller=autosave,card=draft.id,scope=board.id,uid=user.id,token=requestEpoch;
  const owns=()=>scope===board?.id&&uid===user?.id&&token===requestEpoch&&!uncertainScope;
  if(!await controller?.flush())return;
  await writer?.idle();
  if(!owns()||draft!==original||autosave!==controller||!detailRef?.transferReady())return;
  if(!await leaveDraft(true)||!owns())return;feedback.clear();transferCard=card;
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
 async function openBoard(id:number){feedback.clear();drawer=false;const token=++requestEpoch,uid=user?.id;error='';notice='';try{const fresh=await api<Board>(`/boards/${id}`);if(token!==requestEpoch||uid!==user?.id)return;board=fresh;writer=null;view='boards';membersOpen=false}catch(e){if(token===requestEpoch)fail(e)}}
 async function createBoard(){busy=true;error='';try{const uid=user?.id,fresh=await api<Board>('/boards','POST',{title:boardTitle});if(uid!==user?.id)return;board=fresh;view='boards';writer=null;++requestEpoch;boardTitle='';creatingBoard=false;drawer=false;await loadBoards()}catch(e){fail(e)}finally{busy=false}}
 async function openTask(task:TaskResult,element:HTMLElement){
  if(!await leaveDraft()||!user)return;
  const token=++requestEpoch,uid=user.id;
  try{const fresh=await api<Board>(`/boards/${task.board_id}`);if(token!==requestEpoch||user?.id!==uid||(view!=='tasks'&&view!=='calendar'&&view!=='smart'))return;
   const card=fresh.cards.find(c=>c.id===task.id&&!c.archived);if(!card)throw new Error('任务已不可用');if(!boards.some(b=>b.id===task.board_id)&&inbox?.id!==task.board_id)return;board=fresh;writer=null;await edit(card,element);
  }catch(e){if(token===requestEpoch)fail(e)}
 }
 async function closeDetail(){if(await leaveDraft()&&(view==='tasks'||view==='calendar'||view==='smart')){++requestEpoch;board=null;++taskRefresh}}
 async function taskFilter(change:()=>void){if(await leaveDraft()){++requestEpoch;board=null;change();++taskRefresh}}
 type MutationResult='success'|'failed';
 async function mutate(data:Record<string,unknown>):Promise<MutationResult>{
  if(!board||!user)return 'failed';
  error='';notice='';
  try{
   await writeBoard(data);notice='已保存';
   return 'success';
  }catch(e){fail(e);return 'failed'}
 }
 // Reserve each completion before awaiting draft barriers; other cards can enqueue.
 async function boardAction(data:Record<string,unknown>):Promise<boolean>{
  const owner=board?.id,uid=user?.id,token=requestEpoch;
  const card=data.action==='card_complete'?Number(data.card_id):0;
  if(card&&pendingCards.includes(card))return false;
  if(card)pendingCards=[...pendingCards,card];
  try{if(draft&&!await leaveDraft())return false;if(board?.id!==owner||user?.id!==uid||requestEpoch!==token)return false;return await mutate(data)==='success'}
  finally{if(card)pendingCards=pendingCards.filter(id=>id!==card)}
 }

 async function boardMove(intent:any):Promise<boolean>{
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
  async function writeAction(data:Record<string,unknown>){
   if(!owns())throw new Error('任务已切换，保存已停止');
   try{
    const fresh=await writeBoard(data,original.revision);
    if(!owns())throw new Error('任务已切换，保存响应已忽略');
    original.revision=fresh.revision;return fresh.revision;
   }catch(e){if(owns()&&e instanceof ApiError&&[401,403,404].includes(e.status))fail(e);throw e}
  }

  autosave=createAutosave({read:()=>fields(original),revision:original.revision,onstate:(state:string,e:Error|null)=>{if(owns()){saveState=state;saveError=e?.message||''}},write:async(data:ReturnType<typeof fields>,revision:number)=>{
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
   original.schedule=remote.schedule;original.due_date=remote.due_date;original.completed=remote.completed;acknowledged=latest;original.revision=fresh.revision;autosave?.rebaseBaseline(latest,fresh.revision);
  };
  saveState='saved';
 }
 async function detailAction(data:Record<string,unknown>):Promise<boolean>{
  const id=draft?.id,completionAction=data.action==='card_complete';
  if(completionAction&&id&&pendingCards.includes(id))return false;
  if(completionAction&&id)pendingCards=[...pendingCards,id];
  try{return await runDetailAction(data)}finally{if(completionAction&&id)pendingCards=pendingCards.filter(c=>c!==id)}
 }
 async function runDetailAction(data:Record<string,unknown>):Promise<boolean>{
  if(!draft||!board||!autosave)return false;
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
    const fresh=await writeBoard(payload,revision,moveIntent?(sentRevision:number)=>{if(sentRevision!==moveIntent.revision||!resolveMove(board,moveIntent))throw Object.assign(new Error('看板已更新，请重新选择移动位置'),{status:400,code:'invalid'})}:undefined);
    if(draft!==original||requestEpoch!==token)throw new Error('任务已切换');
    board=acceptSnapshot(board,fresh);original.revision=fresh.revision;
    const card=fresh.cards.find(c=>c.id===original.id);if(card){original.list_id=card.list_id;original.position=card.position;original.completed=card.completed;original.schedule=card.schedule;original.due_date=card.due_date}
    return fresh.revision;
   }catch(e){if(e instanceof ApiError&&['successor_touched','archived_completion','completed_schedule','invalid','invalid_schedule'].includes(e.code)){semanticError=e;return revision}if(e instanceof ApiError&&[401,403,404].includes(e.status))fail(e);throw e}
  });
  if(semanticError)throw semanticError;
  return accepted;
 }
</script>
<svelte:window onbeforeunload={e=>{if(writer?.pending()||autosave?.pending()||detailRef?.hasPending()){e.preventDefault();e.returnValue=''}}}/>
{#if !ready}<main class="login-shell"><p>正在连接 Norns…</p></main>
{:else if !user}
<main class="login-shell"><section class="login-card"><a class="brand" href="/"><BrandMark/><Wordmark/></a><div class="login-copy"><span class="eyebrow">让工作井然有序</span><h1>专注下一步。</h1><p>把想法变成卡片，让进展清晰可见。</p></div>{#if error}<div class="alert" role="alert">{error}</div>{/if}<form onsubmit={e=>{e.preventDefault();void login()}}><label>用户名<input aria-label="用户名" bind:value={username} autocomplete="username" required/></label><label>密码<input aria-label="密码" type="password" bind:value={password} autocomplete="current-password" required/></label><button class="primary full" disabled={busy}>{busy?'正在登录…':'登录 Norns'}</button></form><div class="login-themes">{@render themeControls()}</div><p class="login-note">账号由管理员创建 · 仅成员可访问看板 · <a href="https://github.com/AixPot/Norns" target="_blank" rel="noopener noreferrer">源代码</a></p></section></main>
{:else}
<div class="app-shell three-pane-shell">
 <aside class="function-rail" aria-label="功能栏">{@render functions()}</aside>
 <aside class="three-pane-nav" aria-label="任务与清单导航">{@render navigation()}</aside>
 <header class="mobile-navigation"><button aria-label="打开导航" onclick={showDrawer}>☰</button><strong class="mobile-brand"><BrandMark size={26}/><Wordmark height={22}/></strong><span>{user.username}</span></header>
<main class="workspace">{#if uncertainScope}<div class="alert" role="status">写入结果未知，未自动重放。请先核对服务器状态。<button onclick={recoverWriter}>只读核对最新版本并明确恢复</button></div>{/if}{#if error}<div class="alert" role="alert">{error}</div>{/if}
{#if view==='users'}<Users onerror={fail}/>
{:else if view==='smart'}{#if smartRoute==='inbox'}<div class="inbox-history-control"><button onclick={()=>inboxArchive?routeTo('inbox'):showInboxArchive()}>{inboxArchive?'返回收集箱':'已归档'}</button></div>{/if}{#if inboxArchive&&inboxHistory}<section class="inbox-history"><h1>收集箱 · 已归档</h1><p class="muted">仅你可见。打开后可恢复，也可确认整链转入普通看板。</p>{#each inboxHistory.cards.filter(c=>c.archived) as c}<button class="archived-card" onclick={async e=>{const element=e.currentTarget;if(!await leaveDraft())return;board=inboxHistory;writer=null;await edit(c,element)}}>{c.title}<span>打开 →</span></button>{:else}<p class="empty-note">还没有归档的任务。</p>{/each}</section>{:else}{#key `${user.id}:${smartRoute}`}<SmartTasks bind:this={smartRef} route={smartRoute} inboxId={inbox?.id||0} refresh={taskRefresh} {pendingCards} onopen={openTask} oncomplete={completeTask} onquick={quickInbox} onmetadata={metadata} onerror={fail}/>{/key}{/if}
{:else if view==='calendar'}<CalendarView bind:date={calendarDate} bind:mode={calendarMode} bind:boardId={calendarBoard} {boards} onmetadata={metadata} onopen={openTask} onerror={fail} onfilter={taskFilter} refresh={taskRefresh}/>
{:else if view==='tasks'}<TaskDiscovery bind:filters={taskFilters} {boards} onmetadata={metadata} onopen={openTask} onerror={fail} onfilter={taskFilter} refresh={taskRefresh}/>
{:else if !board}<section><h1>选择清单</h1><p class="muted">从左侧选择看板，或添加一个新的清单。</p></section>
{:else}<div class="board-heading"><div><button class="back" onclick={()=>routeTo('today')}>← 今天</button><h1>{board.title}</h1></div><div class="board-controls">{#if busy||notice}<span class="save-status" role="status">{busy?'保存中…':notice}</span>{/if}<button class="secondary" disabled={busy} onclick={()=>navigate(()=>openBoard(board!.id))}>刷新看板</button><button class="secondary" onclick={()=>membersOpen=!membersOpen}>成员 ({board.members.length})</button></div></div>
{#if membersOpen}<section class="members"><h2>看板成员</h2>{#each board.members as member}<div class="member-row"><div><strong>{member.username}</strong><span class="muted">{member.role==='admin'?'看板管理员':'成员'}{!member.active?' · 已停用':''}</span></div>{#if board.role==='admin'&&member.user_id!==user.id}<button disabled={busy} onclick={()=>boardAction({action:'member_remove',user_id:member.user_id})}>移除</button>{/if}</div>{/each}{#if board.role==='admin'}<form onsubmit={async e=>{e.preventDefault();if(await boardAction({action:'member_set',username:memberName,role:memberRole}))memberName=''}}><label>成员用户名<input aria-label="成员用户名" bind:value={memberName} required/></label><label>角色<select aria-label="成员角色" bind:value={memberRole}><option value="member">成员</option><option value="admin">看板管理员</option></select></label><button class="primary" disabled={busy}>添加或提权</button></form><p class="muted">不支持管理员降级或自行退出。至少保留一位看板管理员。</p>{/if}</section>{/if}
<BoardView {board} {busy} moveOwner={`${user.id}:${requestEpoch}`} dragDisabled={!!draft} {pendingCards} onedit={edit} onaction={boardAction} onmove={boardMove}/>
{/if}
</main></div>
{/if}
{#if draft&&board}{#key `${board.id}:${draft.id}`}<CardDetail ontransfer={startTransfer} feedback={completionFeedback} bind:this={detailRef} {draft} {board} {busy} {anchor} {saveState} {saveError} {review} userId={user!.id} onaction={detailAction} onclose={()=>{void closeDetail()}} onchange={changed} onblur={async()=>await autosave?.flush()??false} oncomposition={composition} onretry={retrySave} onreview={reviewConflict} onrebase={confirmRebase} oncancelreview={()=>review=null}/>{/key}{/if}

{#snippet completionFeedback()}{#if completion}<CompletionToast item={completion} onundo={()=>{void undoCompletion()}} onclose={()=>feedback.clear()}/>{/if}{/snippet}
{#if !draft}{@render completionFeedback()}{/if}

{#snippet icon(path:string)}<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={path}/></svg>{/snippet}
{#snippet functions()}
 <button class="rail-logo" aria-label="Norns 今天" onclick={()=>routeTo('today')}><BrandMark size={32}/></button>
 <button aria-label="任务" title="任务" class:active={view==='smart'||view==='boards'} onclick={()=>routeTo('today')}>{@render icon('M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01')}<span>任务</span></button>
 <button aria-label="日历" title="日历" class:active={view==='calendar'} onclick={()=>routeTo('calendar')}>{@render icon('M4 5h16v16H4zM4 10h16M8 3v4M16 3v4')}<span>日历</span></button>
 <button aria-label="搜索" title="搜索" class:active={view==='tasks'} onclick={()=>routeTo('tasks')}>{@render icon('M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0')}<span>搜索</span></button>
 <div class="rail-bottom"><span class="rail-account" title={user?.username}>{user?.username.slice(0,2)}</span>{@render themeControls()}{#if user?.is_admin}<button aria-label="账号管理" title="账号管理" onclick={()=>routeTo('users')}>{@render icon('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17 8h5M19.5 5.5v5')}</button>{/if}<button aria-label="退出" title="退出" disabled={busy} onclick={()=>navigate(logout)}>{@render icon('M9 3H4v18h5M12 12h10m-4-4 4 4-4 4')}</button></div>
{/snippet}
{#snippet navigation()}
 <div class="nav-brand"><Wordmark/></div><nav class="smart-navigation" aria-label="智能视图">{#each [['today','今天'],['tomorrow','明天'],['next7','最近七天'],['mine','指派给我'],['inbox','收集箱']] as [route,label]}<button class:active={view==='smart'&&smartRoute===route} onclick={()=>routeTo(route)}><span>{label}</span></button>{/each}</nav>
 <div class="lists-heading"><span>清单</span><button aria-label="添加清单" title="添加清单" onclick={()=>navigate(()=>{creatingBoard=!creatingBoard})}>＋</button></div>
 {#if creatingBoard}<form class="sidebar-create" onsubmit={e=>{e.preventDefault();void navigate(createBoard)}}><label>看板名称<input aria-label="看板名称" placeholder="清单名称" bind:value={boardTitle} required maxlength="100"/></label><button class="primary" disabled={busy}>创建看板</button></form>{/if}
 <nav class="board-navigation" aria-label="清单">{#each boards as b}<button class:active={view==='boards'&&board?.id===b.id} onclick={()=>navigate(()=>openBoard(b.id))}><span class="board-symbol" aria-hidden="true">▤</span><span>{b.title}</span></button>{:else}<p class="muted">暂无看板，可添加或请管理员邀请。</p>{/each}</nav>
{/snippet}
{#if drawer&&user}<NavigationDrawer onclose={()=>drawer=false}><div class="drawer-functions">{@render functions()}</div><div class="drawer-navigation">{@render navigation()}</div></NavigationDrawer>{/if}
{#if transferOpen&&user}<TransferDialog {boards} onload={id=>api<Board>(`/boards/${id}`)} onpreview={transferPreview} oncommit={finishTransfer} onverify={()=>transferCommand!.verify()} onrecover={recoverTransfer} onclose={()=>{transferOpen=false;transferCommand=null}}/>{/if}

{#snippet themeControls()}
 <AppearancePicker palette={themePalette} mode={themePreference} onpalette={value=>theme?.setPalette(value)} onmode={value=>theme?.set(value)}/>
{/snippet}
