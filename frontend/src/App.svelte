<script lang="ts">
 import {onMount,untrack} from 'svelte';
 import {api,ApiError,setCsrf} from './api';
 import type {User,Board,BoardSummary,Card,Draft,TaskResult,TaskFilters} from './types';
 import {createPoller,acceptSnapshot} from './collaboration.mjs';
 import {createAutosave} from './autosave.mjs';
 import {scheduleDraft,scheduleValidation,scheduleValue} from './schedule-draft.mjs';
 import TaskDiscovery from './TaskDiscovery.svelte';
 import BoardView from './BoardView.svelte';import CardDetail from './CardDetail.svelte';import Users from './Users.svelte';
 let user=$state<User|null>(null);let ready=$state(false);let username=$state('');let password=$state('');let boards=$state<BoardSummary[]>([]);let board=$state<Board|null>(null);let boardTitle=$state('');let draft=$state<Draft|null>(null);let error=$state('');let busy=$state(false);let view=$state<'boards'|'users'|'tasks'>('boards');let membersOpen=$state(false);let memberName=$state('');let memberRole=$state('member');let notice=$state('');
 let taskFilters=$state<TaskFilters>({q:'',view:'all',status:'all',assignee_id:'',board_id:'',from:'',to:''});let taskRefresh=$state(0);
 let epoch=0;let requestEpoch=0;
 let anchor=$state<HTMLElement|null>(null),detailRef=$state<CardDetail|null>(null);
 let saveState=$state('saved'),saveError=$state(''),review=$state<Board|null>(null);
 let autosave:ReturnType<typeof createAutosave>|null=null;
 let rebaseDraft:((fresh:Board)=>void)|null=null;
 const fields=(d:Draft)=>({title:d.title,description:d.description,archived:d.archived,assignee_id:d.assignee_id,scheduleInput:JSON.parse(JSON.stringify(d.scheduleInput))});
 async function leaveDraft(){
  if(!draft)return true;
  if(detailRef&&!detailRef.canLeave(false))return false;
  const original=draft,controller=autosave;
  if(!await controller?.flush())return false;
  if(draft!==original)return !draft;
  // The panel remains editable during flush: confirm current auxiliary work only now.
  if(detailRef&&!detailRef.canLeave())return false;
  controller?.stop();autosave=null;rebaseDraft=null;draft=null;review=null;return true;
 }
 async function navigate(run:()=>void|Promise<void>){if(await leaveDraft())await run()}
 function changed(immediate=false){autosave?.change(immediate)}
 function composition(active:boolean){autosave?.composition(active)}
 async function retrySave(){await autosave?.retry()}
 async function reviewConflict(){
  if(!board||!draft)return;
  const original=draft,token=requestEpoch,id=board.id;
  try{const fresh=await api<Board>(`/boards/${id}`);if(draft!==original||token!==requestEpoch)return;review=fresh}
  catch(e){if(draft===original)saveError=e instanceof Error?e.message:'读取当前版本失败'}
 }
 async function confirmRebase(){
  if(!review||!draft||!board)return;
  rebaseDraft?.(review);board=acceptSnapshot(board,review);review=null;await autosave?.retry();
 }

 const pollKey=$derived(user&&board&&(view==='boards'||view==='tasks')?`${user.id}:${board.id}`:'');
 $effect(()=>{
  const key=pollKey;const id=untrack(()=>board?.id);const uid=untrack(()=>user?.id);const active=!!key;
  if(!id||!uid||!active)return;
  const token=++epoch;
  const poll=createPoller({read:()=>api<Board>(`/boards/${id}`),apply:(fresh:Board)=>{if(token===epoch&&board?.id===id&&!busy){board=acceptSnapshot(board,fresh)}},onerror:(e:unknown)=>{if(token===epoch)fail(e)}});
  const resume=()=>{void poll.check()};document.addEventListener('visibilitychange',resume);void poll.check();
  return ()=>{++epoch;poll.stop();document.removeEventListener('visibilitychange',resume)};
 });
 function fail(e:unknown){const message=e instanceof Error?e.message:'网络连接失败，请重试';error=message;if(e instanceof ApiError&&e.status===401){autosave?.stop();autosave=null;rebaseDraft=null;user=null;board=null;draft=null;boards=[];setCsrf('')}if(e instanceof ApiError&&e.status===404){autosave?.stop();autosave=null;rebaseDraft=null;board=null;draft=null;void loadBoards()}}
 async function loadBoards(){try{boards=await api<BoardSummary[]>('/boards')}catch(e){fail(e)}}
 onMount(async()=>{try{const me=await api<{user:User;csrf:string}>('/me');user=me.user;setCsrf(me.csrf);await loadBoards()}catch(e){if(!(e instanceof ApiError&&e.status===401))fail(e)}finally{ready=true}});
 async function login(){busy=true;error='';try{const result=await api<{user:User;csrf:string}>('/login','POST',{username,password});user=result.user;setCsrf(result.csrf);password='';await loadBoards()}catch(e){fail(e)}finally{busy=false}}
 async function logout(){++epoch;++requestEpoch;busy=true;try{await api('/logout','POST',{});user=null;board=null;boards=[];draft=null;setCsrf('')}catch(e){fail(e)}finally{busy=false}}
 async function openBoard(id:number){const token=++requestEpoch;error='';notice='';try{const fresh=await api<Board>(`/boards/${id}`);if(token!==requestEpoch)return;board=fresh;view='boards';membersOpen=false}catch(e){if(token===requestEpoch)fail(e)}}
 async function createBoard(){busy=true;error='';try{board=await api<Board>('/boards','POST',{title:boardTitle});boardTitle='';await loadBoards()}catch(e){fail(e)}finally{busy=false}}
 async function openTask(task:TaskResult,element:HTMLElement){
  if(!await leaveDraft()||!user)return;
  const token=++requestEpoch,uid=user.id;
  try{const fresh=await api<Board>(`/boards/${task.board_id}`);if(token!==requestEpoch||user?.id!==uid||view!=='tasks')return;
   const card=fresh.cards.find(c=>c.id===task.id);if(!card)throw new Error('任务已不可用');board=fresh;await edit(card,element);
  }catch(e){if(token===requestEpoch)fail(e)}
 }
 async function closeDetail(){if(await leaveDraft()&&view==='tasks'){board=null;++taskRefresh}}
 async function taskFilter(change:()=>void){if(await leaveDraft()){++requestEpoch;board=null;change();++taskRefresh}}
 type MutationResult='success'|'failed'|'stale';
 async function mutate(data:Record<string,unknown>,revision=board?.revision):Promise<MutationResult>{
  if(!board||!user||busy)return 'failed';
  const id=board.id,uid=user.id,token=requestEpoch,originalView=view;
  const current=()=>token===requestEpoch&&board?.id===id&&user?.id===uid&&view===originalView;
  busy=true;error='';notice='';
  try{
   const fresh=await api<Board>(`/boards/${id}/mutate`,'POST',{expected_revision:revision,...data});
   if(!current())return 'stale';
   board=acceptSnapshot(board,fresh);notice='已保存';
   const summaries=await api<BoardSummary[]>('/boards');
   if(!current())return 'stale';
   boards=summaries;return 'success';
  }catch(e){if(!current())return 'stale';fail(e);return 'failed'}finally{busy=false}
 }
 // Boolean component callbacks act only on an accepted success, never truthy result strings.
 async function boardAction(data:Record<string,unknown>):Promise<boolean>{if(!await leaveDraft())return false;return await mutate(data)==='success'}

 async function edit(card:Card,element:HTMLElement){
  if(draft?.id===card.id)return;
  if(!await leaveDraft()||!board||!user)return;
  const current=board.cards.find(c=>c.id===card.id);if(!current)return;
  draft={...current,revision:board.revision,scheduleInput:scheduleDraft(current.schedule)};anchor=element;saveError='';error='';review=null;
  const original=draft,id=board.id,uid=user.id,token=requestEpoch;
  const owns=()=>draft===original&&board?.id===id&&user?.id===uid&&token===requestEpoch;
  let acknowledged=fields(original);
  async function writeAction(data:Record<string,unknown>,revision:number){
   if(!owns())throw new Error('任务已切换，保存已停止');
   busy=true;
   try{
    const fresh=await api<Board>(`/boards/${id}/mutate`,'POST',{expected_revision:revision,...data});
    if(!owns())throw new Error('任务已切换，保存响应已忽略');
    board=acceptSnapshot(board,fresh);original.revision=fresh.revision;return fresh.revision;
   }catch(e){if(owns()&&e instanceof ApiError&&(e.status===401||e.status===404))fail(e);throw e}
   finally{busy=false}
  }
  autosave=createAutosave({read:()=>fields(original),revision:original.revision,onstate:(state:string,e:Error|null)=>{if(owns()){saveState=state;saveError=e?.message||''}},write:async(data:ReturnType<typeof fields>,revision:number)=>{
   try{
    const validation=scheduleValidation(data.scheduleInput);
    if(validation)throw Object.assign(new Error(validation),{validation:true});
    if(data.title!==acknowledged.title||data.description!==acknowledged.description||data.archived!==acknowledged.archived){
     revision=await writeAction({action:'card_update',card_id:original.id,title:data.title,description:data.description,archived:data.archived},revision);
     acknowledged={...acknowledged,title:data.title,description:data.description,archived:data.archived};
    }
    if(data.assignee_id!==acknowledged.assignee_id){
     revision=await writeAction({action:'card_details',card_id:original.id,assignee_id:data.assignee_id,due_date:original.due_date},revision);
     acknowledged={...acknowledged,assignee_id:data.assignee_id};
    }
    if(JSON.stringify(data.scheduleInput)!==JSON.stringify(acknowledged.scheduleInput)){
     const schedule=scheduleValue(data.scheduleInput);
     revision=await writeAction({action:'card_schedule',card_id:original.id,schedule},revision);
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
  if(!draft||!board||!autosave)return false;
  const original=draft,id=board.id,token=requestEpoch;
  let semanticError:Error|null=null;
  const accepted=await autosave.action(async(revision:number)=>{
   if(draft!==original||requestEpoch!==token)throw new Error('任务已切换');
   busy=true;
   try{
    const fresh=await api<Board>(`/boards/${id}/mutate`,'POST',{expected_revision:revision,...data,card_id:original.id});
    if(draft!==original||requestEpoch!==token)throw new Error('任务已切换');
    board=acceptSnapshot(board,fresh);original.revision=fresh.revision;
    const card=fresh.cards.find(c=>c.id===original.id);if(card){original.list_id=card.list_id;original.position=card.position;original.completed=card.completed;original.schedule=card.schedule;original.due_date=card.due_date}
    return fresh.revision;
   }catch(e){if(e instanceof ApiError&&['successor_touched','archived_completion','completed_schedule','invalid','invalid_schedule'].includes(e.code)){semanticError=e;return revision}if(e instanceof ApiError&&(e.status===401||e.status===404))fail(e);throw e}finally{busy=false}
  });
  if(semanticError)throw semanticError;
  return accepted;
 }
</script>
<svelte:window onbeforeunload={e=>{if(autosave?.pending()||detailRef?.hasPending()){e.preventDefault();e.returnValue=''}}}/>
{#if !ready}<main class="login-shell"><p>正在连接 Norns…</p></main>
{:else if !user}
<main class="login-shell"><section class="login-card"><a class="brand" href="/">Norns<span class="brand-mark"></span></a><div class="login-copy"><span class="eyebrow">让工作井然有序</span><h1>专注下一步。</h1><p>把想法变成卡片，让进展清晰可见。</p></div>{#if error}<div class="alert" role="alert">{error}</div>{/if}<form onsubmit={e=>{e.preventDefault();void login()}}><label>用户名<input aria-label="用户名" bind:value={username} autocomplete="username" required/></label><label>密码<input aria-label="密码" type="password" bind:value={password} autocomplete="current-password" required/></label><button class="primary full" disabled={busy}>{busy?'正在登录…':'登录 Norns'}</button></form><p class="login-note">账号由管理员创建 · 仅成员可访问看板 · <a href="https://github.com/AixPot/Norns" target="_blank" rel="noopener noreferrer">源代码</a></p></section></main>
{:else}
<div class="app-shell"><header class="topbar"><button class="brand" onclick={()=>navigate(()=>{++requestEpoch;board=null;view='boards';error=''})}>Norns<span class="brand-mark"></span></button><div class="account"><button class:active={view==='tasks'} onclick={()=>navigate(()=>{++requestEpoch;board=null;view='tasks';error='';++taskRefresh})}>任务</button><a href="https://github.com/AixPot/Norns" target="_blank" rel="noopener noreferrer">源代码</a><span>{user.username}</span>{#if user.is_admin}<button class:active={view==='users'} onclick={()=>navigate(()=>{++requestEpoch;view=view==='users'?'boards':'users';error=''})}>账号管理</button>{/if}<button onclick={()=>navigate(logout)} disabled={busy}>退出</button></div></header>
<main class="workspace">{#if error}<div class="alert" role="alert">{error}</div>{/if}
{#if view==='users'}<Users onerror={fail}/>
{:else if view==='tasks'}<TaskDiscovery bind:filters={taskFilters} bind:boards onopen={openTask} onerror={fail} onfilter={taskFilter} refresh={taskRefresh}/>
{:else if !board}<section class="overview"><span class="eyebrow">你的工作空间</span><h1>我的看板</h1><p class="muted">从一张卡片开始，逐步推进每一件事。</p><div class="board-grid">{#each boards as b}<button class="board-tile" onclick={()=>openBoard(b.id)}><span class="tile-symbol">▤</span><h2>{b.title}</h2><span class="muted">打开看板 →</span></button>{/each}<form class="new-board" onsubmit={e=>{e.preventDefault();void createBoard()}}><label>创建看板<input aria-label="看板名称" placeholder="给新的计划起个名字" bind:value={boardTitle} required maxlength="100"/></label><button class="primary" disabled={busy}>创建看板</button></form></div>{#if !boards.length}<p class="empty-note">还没有看板。创建一个，或请看板管理员将你加入。</p>{/if}</section>
{:else}<div class="board-heading"><div><button class="back" onclick={()=>navigate(()=>{++requestEpoch;board=null;error=''})}>← 我的看板</button><h1>{board.title}</h1></div><div class="board-controls"><span class="save-status" role="status">{busy?'保存中…':notice||`版本 ${board.revision}`}</span><button class="secondary" disabled={busy} onclick={()=>navigate(()=>openBoard(board!.id))}>刷新看板</button><button class="secondary" onclick={()=>membersOpen=!membersOpen}>成员 ({board.members.length})</button></div></div>
{#if membersOpen}<section class="members"><h2>看板成员</h2>{#each board.members as member}<div class="member-row"><div><strong>{member.username}</strong><span class="muted">{member.role==='admin'?'看板管理员':'成员'}{!member.active?' · 已停用':''}</span></div>{#if board.role==='admin'&&member.user_id!==user.id}<button disabled={busy} onclick={()=>boardAction({action:'member_remove',user_id:member.user_id})}>移除</button>{/if}</div>{/each}{#if board.role==='admin'}<form onsubmit={async e=>{e.preventDefault();if(await boardAction({action:'member_set',username:memberName,role:memberRole}))memberName=''}}><label>成员用户名<input aria-label="成员用户名" bind:value={memberName} required/></label><label>角色<select aria-label="成员角色" bind:value={memberRole}><option value="member">成员</option><option value="admin">看板管理员</option></select></label><button class="primary" disabled={busy}>添加或提权</button></form><p class="muted">不支持管理员降级或自行退出。至少保留一位看板管理员。</p>{/if}</section>{/if}
<BoardView {board} {busy} onedit={edit} onaction={boardAction}/>
{/if}
</main></div>
{/if}
{#if draft&&board}{#key draft.id}<CardDetail bind:this={detailRef} {draft} {board} {busy} {anchor} {saveState} {saveError} {review} userId={user!.id} onaction={detailAction} onclose={()=>{void closeDetail()}} onchange={changed} onblur={async()=>await autosave?.flush()??false} oncomposition={composition} onretry={retrySave} onreview={reviewConflict} onrebase={confirmRebase} oncancelreview={()=>review=null}/>{/key}{/if}
