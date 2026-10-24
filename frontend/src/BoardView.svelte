<script lang="ts">
 import {untrack as selectionUntrack} from 'svelte';
 import type {SelectionProps} from './types';
 import TaskCapture,{captureLeaveGuard} from './TaskCapture.svelte';
 import type {Board,Card,Schedule} from './types';
 import {onMount} from 'svelte';
 import {projectBoardView} from './task-view.mjs';
 import ViewOptions from './ViewOptions.svelte';
 import type {ViewPreferences} from './types';
 import {listSlots} from './drag-order.mjs';
 import {attachBoardDrag} from './board-drag.mjs';
 import './board-drag.css';
 import {untrack,tick} from 'svelte';
 import {cardSchedule} from './card-schedule.mjs';
 let scheduleNow=$state(new Date());
 onMount(()=>{
  const hide=()=>persistList();window.addEventListener('pagehide',hide);
  let timer:ReturnType<typeof setTimeout>;
  const refresh=()=>{
   clearTimeout(timer);scheduleNow=new Date();
   const day=86400000,offset=8*3600000;
   timer=setTimeout(refresh,day-((scheduleNow.getTime()+offset)%day)+20);
  };
  const resume=()=>{if(document.visibilityState==='visible')refresh()};
  refresh();document.addEventListener('visibilitychange',resume);
  return ()=>{clearTimeout(listTimer);window.removeEventListener('pagehide',hide);clearTimeout(timer);document.removeEventListener('visibilitychange',resume)};
 });
 let {selecting=false,selected=[],onselect,onvisible,ontemplate,accountId,display,ondisplay,recovery,unknown=false,board,busy,moveOwner,dragDisabled=false,pendingCards=[],onedit,onaction,onmove}: SelectionProps & {ontemplate?:(listId:number,restore:()=>void)=>void;accountId:number;display:ViewPreferences;ondisplay:(value:ViewPreferences)=>void;recovery?:any;unknown?:boolean;board:Board;busy:boolean;moveOwner:string;dragDisabled?:boolean;pendingCards?:number[];onedit:(c:Card,anchor:HTMLElement)=>void;onaction:(d:Record<string,unknown>)=>Promise<boolean>;onmove:(intent:any)=>Promise<boolean>}=$props();
 let root=$state<HTMLDivElement>(),status=$state('');
 let controller:ReturnType<typeof attachBoardDrag>|undefined;
 $effect(()=>{const node=root;if(!node)return;const drag=attachBoardDrag(node,{read:()=>board,owner:()=>moveOwner,disabled:()=>selecting||busy||dragDisabled||showArchive||!!renaming||!!menu,commit:(intent:any)=>intent.kind==='card'&&display.sort!=='manual'?Promise.resolve(false):onmove(intent),announce:(text:string)=>status=text});controller=drag;return ()=>{drag.destroy();controller=undefined}});
 let dragContext='';
 $effect(()=>{const context=`${moveOwner}:${board.id}:${board.revision}:${busy}:${dragDisabled}:${showArchive}:${display.sort}`;if(context!==dragContext){dragContext=context;untrack(()=>controller?.cancel('看板已更新或正在保存，请重新拖动'))}});
 async function moveList(id:number,index:number){const focus=document.activeElement as HTMLElement,slot=listSlots(board,id)[index];if(slot&&await onmove({owner:moveOwner,boardId:board.id,revision:board.revision,kind:'list',sourceId:id,slot})){await tick();if(focus?.isConnected)focus.focus({preventScroll:true})}}
 let newList=$state('');let captures:Record<number,TaskCapture>={};let renaming=$state(0);let listTitle=$state('');let showArchive=$state(false);let menu=$state(0);
 let listRecoveries=$state<Record<number,any>>({}),listRecoveryMessage=$state('');let listGeneration=0,listTimer:ReturnType<typeof setTimeout>|undefined,listBaseline='';
 $effect(()=>{const owner=recovery,id=board.id,ids=board.lists.map(l=>l.id);let active=true;if(owner)for(const listId of ids)void owner.load({kind:'list',boardId:id,listId}).then((value:any)=>{if(active&&value)listRecoveries={...listRecoveries,[listId]:value}});return()=>{active=false}});
 function persistList(){clearTimeout(listTimer);if(!recovery||recovery.closed||!renaming||listTitle===listBaseline)return;const result=recovery.store.put({scope:{kind:'list',boardId:board.id,listId:renaming},generation:listGeneration,revision:board.revision,baseline:{title:listBaseline},fields:{title:listTitle},unknownCreateOutcome:false});listRecoveryMessage=result.ok?'草稿仅保留在此标签页':'本地草稿未能保留，请勿关闭此页'}
 function listEdited(){++listGeneration;clearTimeout(listTimer);listTimer=setTimeout(persistList,180)}
 async function restoreList(id:number){const owner=recovery,original=board.id,value=await owner.load({kind:'list',boardId:original,listId:id});if(!value||owner!==recovery||board.id!==original)return;const remote=value.fresh.lists.find((l:any)=>l.id===id);if(value.record.baseline.title!==remote.title&&!confirm(`服务器列表名称已变为「${remote.title}」，核对后恢复本地输入？`))return;renaming=id;listBaseline=remote.title;listTitle=value.record.fields.title;listGeneration=value.record.generation+1;listRecoveryMessage='已恢复，按确定才会保存';listEdited()}
 function discardList(id:number){const item=listRecoveries[id];if(item)recovery.store.removeIfGeneration(item.record.scope,item.record.generation);delete listRecoveries[id]}
 $effect(()=>{const scope=`board:${accountId}:${board.id}:${showArchive}`,visible=board.cards.filter(c=>c.archived===showArchive).map(c=>({id:c.id,board_id:board.id}));selectionUntrack(()=>onvisible?.(scope,visible))});
 const projection=$derived(projectBoardView(board,display));
 const cards=(id:number)=>projection.columns.find(c=>c.list.id===id)?.tasks||[];
 function blockSortedDrag(event:PointerEvent|TouchEvent){if(display.sort!=='manual'&&(event.target as Element).closest('[data-card-id]'))event.stopPropagation()}
 async function createList(){if(await onaction({action:'list_create',title:newList}))newList='';}
 export function persistRecovery(){persistList();Object.values(captures).forEach(c=>c?.persistRecovery())}
 export function overlayReady(){return Object.values(captures).every(c=>c?.overlayReady()??true)}
 export function hasPending(){return !!newList||!!renaming||Object.values(captures).some(c=>c?.hasPending())}
 export function leaveGuard(){const capture=captureLeaveGuard(()=>Object.values(captures));let approved='';return()=>{if(!capture())return false;const current=JSON.stringify({newList,renaming,listTitle});if((newList||renaming)&&current!==approved){if(!confirm('还有未保存的列表输入，保留本地草稿并切换？'))return false;persistList();approved=current}return true}}
 export function canLeave(){return leaveGuard()()}
 async function createCard(id:number,title:string,schedule?:Schedule){return await onaction({action:'card_create',list_id:id,title,description:'',...(schedule?{schedule}:{})})}
</script>
<div class="board-toolbar"><span class="muted">{board.lists.length} 个列表 · {board.cards.filter(c=>!c.archived).length} 张卡片</span><ViewOptions value={display} ongroup={false} owner={`${accountId}:board:${board.id}`} onchange={ondisplay}/><button class="text-button" onclick={()=>{if(canLeave())showArchive=!showArchive}}>{showArchive?'返回看板':'已归档'}</button></div>
{#if display.sort!=='manual'&&!showArchive}<p class="view-order-note">按日期显示时不能拖动卡片或修改位置；切回手动顺序可恢复。列表移动仍会修改共享顺序。</p>{/if}
{#if showArchive}<section class="archive"><h2>已归档卡片</h2><p class="muted">打开卡片，在更多操作中选择恢复即可。</p>{#each board.cards.filter(c=>c.archived) as card}<div class="bulk-result-row">{#if selecting}<label class="bulk-check"><input type="checkbox" aria-label={`选择 ${card.title}`} checked={selected.some(s=>s.id===card.id)} onchange={()=>onselect?.({id:card.id,board_id:board.id})}/><span>选择</span></label>{/if}<button class="archived-card" onclick={e=>onedit(card,(e.currentTarget.closest('.card')||e.currentTarget) as HTMLElement)}>{card.title}<span>打开 →</span></button></div>{:else}<p>还没有归档的卡片。</p>{/each}</section>
{:else}
<div bind:this={root} onpointerdowncapture={blockSortedDrag} ontouchstartcapture={blockSortedDrag} class="board-scroll" aria-label="看板列表">
 {#each projection.columns as column,li (column.list.id)}
  {@const list=column.list}
  <section class="column" data-list-id={list.id}>
   <header class="column-head" data-list-drag>{#if renaming===list.id}<form onsubmit={async e=>{e.preventDefault();const generation=listGeneration;if(await onaction({action:'list_update',list_id:list.id,title:listTitle})&&generation===listGeneration){recovery?.store.removeIfGeneration({kind:'list',boardId:board.id,listId:list.id},generation);renaming=0;delete listRecoveries[list.id]}}}><input aria-label="列表名称" bind:value={listTitle} oninput={listEdited} required/><button disabled={busy}>确定</button></form>{:else}<h2>{list.title}<span>{cards(list.id).length}</span></h2><button class="icon" aria-label={`重命名${list.title}`} onclick={()=>{renaming=list.id;listTitle=list.title;listBaseline=list.title;listGeneration=(recovery?.store.get({kind:'list',boardId:board.id,listId:list.id}).record?.generation??0)+1}}>✎</button>{/if}</header>
   {#if listRecoveries[list.id]}<div class="draft-recovery"><button onclick={()=>restoreList(list.id)}>恢复列表草稿</button><button onclick={()=>discardList(list.id)}>丢弃列表草稿</button></div>{/if}{#if renaming===list.id&&listRecoveryMessage}<p role="status">{listRecoveryMessage}</p>{/if}
   <div class="list-actions"><button class="text-button" aria-label={`列表操作 ${list.title}`} aria-expanded={menu===list.id} onclick={()=>menu=menu===list.id?0:list.id}>更多</button>{#if menu===list.id}<button disabled={busy||li===0} onclick={()=>moveList(list.id,li-1)}>向左移动</button><button disabled={busy||li===board.lists.length-1} onclick={()=>moveList(list.id,li+1)}>向右移动</button><label>列表位置<select aria-label={`移动列表 ${list.title}`} value={li} disabled={busy} onchange={e=>moveList(list.id,Number(e.currentTarget.value))}>{#each board.lists as option,i}<option value={i}>第 {i+1} 位</option>{/each}</select></label><button disabled={busy} onclick={async()=>{if(confirm('归档此列表中所有已完成的任务？')&&await onaction({action:'list_archive_completed',list_id:list.id}))menu=0}}>归档已完成任务</button>{/if}</div>
   <div class="card-stack">
   {#each cards(list.id) as card (card.id)}
    {@const schedule=cardSchedule(card,scheduleNow)}
    <div class="card" data-card-id={card.id} class:card-completed={card.completed} role="group" aria-label={card.title}>
     {#if selecting}<label class="bulk-check"><input type="checkbox" aria-label={`选择 ${card.title}`} checked={selected.some(s=>s.id===card.id)} onchange={()=>onselect?.({id:card.id,board_id:board.id})}/><span>选择</span></label>{/if}
     <button class="card-content" class:completed={card.completed} onclick={e=>onedit(card,(e.currentTarget.closest('.card')||e.currentTarget) as HTMLElement)}><strong>{card.title}</strong>{#if schedule}<span class="card-schedule" title={schedule.title} aria-label={schedule.title}>{schedule.label}</span>{/if}</button>
     <label class="card-completion"><input type="checkbox" aria-label={`${card.completed?'撤销完成':'完成'} ${card.title}`} checked={card.completed} disabled={pendingCards.includes(card.id)} onchange={async e=>{const input=e.currentTarget;if(!await onaction({action:'card_complete',card_id:card.id,completed:input.checked}))input.checked=card.completed}}/></label>
    </div>
   {/each}
   </div>
   <TaskCapture ontemplate={ontemplate?(restore)=>ontemplate?.(list.id,restore):undefined} {recovery} {unknown} scope={{kind:'capture',boardId:board.id,listId:list.id}} bind:this={captures[list.id]} label={`在${list.title}添加卡片`} placeholder="添加一张卡片…" buttonLabel={`添加到${list.title}`} compact disabled={busy} onsave={(title,schedule)=>createCard(list.id,title,schedule)}/>
  </section>
 {/each}
 <form class="add-list" onsubmit={e=>{e.preventDefault();void createList()}}><span class="eyebrow">整理你的工作</span><label>新列表<input aria-label="新列表" placeholder="例如：进行中" bind:value={newList} required maxlength="100"/></label><button class="secondary" disabled={busy}>＋ 添加列表</button></form>
</div>
{/if}

<p class="sr-only" role="status" aria-live="polite">{status}</p>
<style>
 .card-completed{background:var(--surface-muted);border-color:var(--border);box-shadow:none;transition:background .18s,border-color .18s}
 .card-completed .card-content.completed{color:var(--secondary)!important}
 .card-completed .card-completion{background:var(--border);border-radius:8px}
 @media(prefers-reduced-motion:reduce){.card-completed{transition:none}}
</style>
