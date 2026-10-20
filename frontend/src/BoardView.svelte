<script lang="ts">
 import type {Board,Card} from './types';
 import {onMount} from 'svelte';
 import {displayCards} from './completion-view.mjs';
 import {listSlots} from './drag-order.mjs';
 import {attachBoardDrag} from './board-drag.mjs';
 import './board-drag.css';
 import {untrack,tick} from 'svelte';
 import {cardSchedule} from './card-schedule.mjs';
 let scheduleNow=$state(new Date());
 onMount(()=>{
  let timer:ReturnType<typeof setTimeout>;
  const refresh=()=>{
   clearTimeout(timer);scheduleNow=new Date();
   const day=86400000,offset=8*3600000;
   timer=setTimeout(refresh,day-((scheduleNow.getTime()+offset)%day)+20);
  };
  const resume=()=>{if(document.visibilityState==='visible')refresh()};
  refresh();document.addEventListener('visibilitychange',resume);
  return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',resume)};
 });
 let {board,busy,moveOwner,dragDisabled=false,pendingCards=[],onedit,onaction,onmove}: {board:Board;busy:boolean;moveOwner:string;dragDisabled?:boolean;pendingCards?:number[];onedit:(c:Card,anchor:HTMLElement)=>void;onaction:(d:Record<string,unknown>)=>Promise<boolean>;onmove:(intent:any)=>Promise<boolean>}=$props();
 let root=$state<HTMLDivElement>(),status=$state('');
 let controller:ReturnType<typeof attachBoardDrag>|undefined;
 $effect(()=>{const node=root;if(!node)return;const drag=attachBoardDrag(node,{read:()=>board,owner:()=>moveOwner,disabled:()=>busy||dragDisabled||showArchive||!!renaming||!!menu,commit:onmove,announce:(text:string)=>status=text});controller=drag;return ()=>{drag.destroy();controller=undefined}});
 let dragContext='';
 $effect(()=>{const context=`${moveOwner}:${board.id}:${board.revision}:${busy}:${dragDisabled}:${showArchive}`;if(context!==dragContext){dragContext=context;untrack(()=>controller?.cancel('看板已更新或正在保存，请重新拖动'))}});
 async function moveList(id:number,index:number){const focus=document.activeElement as HTMLElement,slot=listSlots(board,id)[index];if(slot&&await onmove({owner:moveOwner,boardId:board.id,revision:board.revision,kind:'list',sourceId:id,slot})){await tick();if(focus?.isConnected)focus.focus({preventScroll:true})}}
 let newList=$state('');let newCards=$state<Record<number,string>>({});let renaming=$state(0);let listTitle=$state('');let showArchive=$state(false);let menu=$state(0);
 const cards=(id:number)=>displayCards(board.cards,id);
 async function createList(){if(await onaction({action:'list_create',title:newList}))newList='';}
 async function createCard(id:number){if(await onaction({action:'card_create',list_id:id,title:newCards[id]}))newCards[id]='';}
</script>
<div class="board-toolbar"><span class="muted">{board.lists.length} 个列表 · {board.cards.filter(c=>!c.archived).length} 张卡片</span><button class="text-button" onclick={()=>showArchive=!showArchive}>{showArchive?'返回看板':'已归档'}</button></div>
{#if showArchive}<section class="archive"><h2>已归档卡片</h2><p class="muted">打开卡片，在更多操作中选择恢复即可。</p>{#each board.cards.filter(c=>c.archived) as card}<button class="archived-card" onclick={e=>onedit(card,(e.currentTarget.closest('.card')||e.currentTarget) as HTMLElement)}>{card.title}<span>打开 →</span></button>{:else}<p>还没有归档的卡片。</p>{/each}</section>
{:else}
<div bind:this={root} class="board-scroll" aria-label="看板列表">
 {#each board.lists as list,li (list.id)}
  <section class="column" data-list-id={list.id}>
   <header class="column-head" data-list-drag>{#if renaming===list.id}<form onsubmit={async e=>{e.preventDefault();if(await onaction({action:'list_update',list_id:list.id,title:listTitle}))renaming=0}}><input aria-label="列表名称" bind:value={listTitle} required/><button disabled={busy}>确定</button></form>{:else}<h2>{list.title}<span>{cards(list.id).length}</span></h2><button class="icon" aria-label={`重命名${list.title}`} onclick={()=>{renaming=list.id;listTitle=list.title}}>✎</button>{/if}</header>
   <div class="list-actions"><button class="text-button" aria-label={`列表操作 ${list.title}`} aria-expanded={menu===list.id} onclick={()=>menu=menu===list.id?0:list.id}>更多</button>{#if menu===list.id}<button disabled={busy||li===0} onclick={()=>moveList(list.id,li-1)}>向左移动</button><button disabled={busy||li===board.lists.length-1} onclick={()=>moveList(list.id,li+1)}>向右移动</button><label>列表位置<select aria-label={`移动列表 ${list.title}`} value={li} disabled={busy} onchange={e=>moveList(list.id,Number(e.currentTarget.value))}>{#each board.lists as option,i}<option value={i}>第 {i+1} 位</option>{/each}</select></label><button disabled={busy} onclick={async()=>{if(confirm('归档此列表中所有已完成的任务？')&&await onaction({action:'list_archive_completed',list_id:list.id}))menu=0}}>归档已完成任务</button>{/if}</div>
   <div class="card-stack">
   {#each cards(list.id) as card (card.id)}
    {@const schedule=cardSchedule(card,scheduleNow)}
    <div class="card" data-card-id={card.id} class:card-completed={card.completed} role="group" aria-label={card.title}>
     <button class="card-content" class:completed={card.completed} onclick={e=>onedit(card,(e.currentTarget.closest('.card')||e.currentTarget) as HTMLElement)}><strong>{card.title}</strong>{#if schedule}<span class="card-schedule" title={schedule.title} aria-label={schedule.title}>{schedule.label}</span>{/if}</button>
     <label class="card-completion"><input type="checkbox" aria-label={`${card.completed?'撤销完成':'完成'} ${card.title}`} checked={card.completed} disabled={pendingCards.includes(card.id)} onchange={async e=>{const input=e.currentTarget;if(!await onaction({action:'card_complete',card_id:card.id,completed:input.checked}))input.checked=card.completed}}/></label>
    </div>
   {/each}
   </div>
   <form class="add-card" onsubmit={e=>{e.preventDefault();void createCard(list.id)}}><input aria-label={`在${list.title}添加卡片`} placeholder="添加一张卡片…" maxlength="160" required bind:value={newCards[list.id]}/><button aria-label={`添加到${list.title}`} disabled={busy}>＋</button></form>
  </section>
 {/each}
 <form class="add-list" onsubmit={e=>{e.preventDefault();void createList()}}><span class="eyebrow">整理你的工作</span><label>新列表<input aria-label="新列表" placeholder="例如：进行中" bind:value={newList} required maxlength="100"/></label><button class="secondary" disabled={busy}>＋ 添加列表</button></form>
</div>
{/if}

<p class="sr-only" role="status" aria-live="polite">{status}</p>
<style>
 .card-completed{background:#edf2ee;border-color:#d0dbd2;box-shadow:none;transition:background .18s,border-color .18s}
 .card-completed .card-content.completed{color:#52665b!important}
 .card-completed .card-completion{background:#e3ece5;border-radius:8px}
 @media(prefers-reduced-motion:reduce){.card-completed{transition:none}}
</style>
