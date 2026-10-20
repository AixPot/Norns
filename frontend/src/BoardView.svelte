<script lang="ts">
 import type {Board,Card} from './types';
 import {onMount} from 'svelte';
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
 let {board,busy,onedit,onaction}: {board:Board;busy:boolean;onedit:(c:Card,anchor:HTMLElement)=>void;onaction:(d:Record<string,unknown>)=>Promise<boolean>}=$props();
 let newList=$state('');let newCards=$state<Record<number,string>>({});let renaming=$state(0);let listTitle=$state('');let dragging=$state(0);let showArchive=$state(false);let menu=$state(0);
 const cards=(id:number)=>board.cards.filter(c=>c.list_id===id&&!c.archived).sort((a,b)=>a.position-b.position);
 async function createList(){if(await onaction({action:'list_create',title:newList}))newList='';}
 async function createCard(id:number){if(await onaction({action:'card_create',list_id:id,title:newCards[id]}))newCards[id]='';}
 function drop(e:DragEvent,list:number,index:number){e.preventDefault();if(dragging)void onaction({action:'card_move',card_id:dragging,target_list_id:list,index});dragging=0;}
</script>
<div class="board-toolbar"><span class="muted">{board.lists.length} 个列表 · {board.cards.filter(c=>!c.archived).length} 张卡片</span><button class="text-button" onclick={()=>showArchive=!showArchive}>{showArchive?'返回看板':'已归档'}</button></div>
{#if showArchive}<section class="archive"><h2>已归档卡片</h2><p class="muted">打开卡片，在更多操作中选择恢复即可。</p>{#each board.cards.filter(c=>c.archived) as card}<button class="archived-card" onclick={e=>onedit(card,(e.currentTarget.closest('.card')||e.currentTarget) as HTMLElement)}>{card.title}<span>打开 →</span></button>{:else}<p>还没有归档的卡片。</p>{/each}</section>
{:else}
<div class="board-scroll" aria-label="看板列表">
 {#each board.lists as list (list.id)}
  <section class="column">
   <header class="column-head">{#if renaming===list.id}<form onsubmit={async e=>{e.preventDefault();if(await onaction({action:'list_update',list_id:list.id,title:listTitle}))renaming=0}}><input aria-label="列表名称" bind:value={listTitle} required/><button disabled={busy}>确定</button></form>{:else}<h2>{list.title}<span>{cards(list.id).length}</span></h2><button class="icon" aria-label={`重命名${list.title}`} onclick={()=>{renaming=list.id;listTitle=list.title}}>✎</button>{/if}</header>
   <div class="list-actions"><button class="text-button" aria-label={`列表操作 ${list.title}`} aria-expanded={menu===list.id} onclick={()=>menu=menu===list.id?0:list.id}>更多</button>{#if menu===list.id}<button disabled={busy} onclick={async()=>{if(confirm('归档此列表中所有已完成的任务？')&&await onaction({action:'list_archive_completed',list_id:list.id}))menu=0}}>归档已完成任务</button>{/if}</div>
   <div class="card-stack">
   {#each cards(list.id) as card,i (card.id)}
    {@const schedule=cardSchedule(card,scheduleNow)}
    <div class:drop-active={dragging!==0} class="dropzone" role="presentation" ondragover={e=>e.preventDefault()} ondrop={e=>drop(e,list.id,cards(list.id).filter(c=>c.id!==dragging).findIndex(c=>c.id===card.id))}></div>
    <div class="card" draggable={!busy} role="group" aria-label={card.title} ondragstart={e=>{dragging=card.id;e.dataTransfer?.setData('text/plain',String(card.id))}} ondragend={()=>dragging=0}>
     <button class="card-content" class:completed={card.completed} onclick={e=>onedit(card,(e.currentTarget.closest('.card')||e.currentTarget) as HTMLElement)}><strong>{card.title}</strong>{#if schedule}<span class="card-schedule" title={schedule.title} aria-label={schedule.title}>{schedule.label}</span>{/if}</button>
     <label class="card-completion"><input type="checkbox" aria-label={`${card.completed?'撤销完成':'完成'} ${card.title}`} checked={card.completed} disabled={busy} onchange={async e=>{const input=e.currentTarget;if(!await onaction({action:'card_complete',card_id:card.id,completed:input.checked}))input.checked=card.completed}}/></label>
    </div>
   {/each}
   <div class="dropzone end" role="presentation" ondragover={e=>e.preventDefault()} ondrop={e=>drop(e,list.id,cards(list.id).filter(c=>c.id!==dragging).length)}>{#if dragging}放到列表末尾{/if}</div>
   </div>
   <form class="add-card" onsubmit={e=>{e.preventDefault();void createCard(list.id)}}><input aria-label={`在${list.title}添加卡片`} placeholder="添加一张卡片…" maxlength="160" required bind:value={newCards[list.id]}/><button aria-label={`添加到${list.title}`} disabled={busy}>＋</button></form>
  </section>
 {/each}
 <form class="add-list" onsubmit={e=>{e.preventDefault();void createList()}}><span class="eyebrow">整理你的工作</span><label>新列表<input aria-label="新列表" placeholder="例如：进行中" bind:value={newList} required maxlength="100"/></label><button class="secondary" disabled={busy}>＋ 添加列表</button></form>
</div>
{/if}
