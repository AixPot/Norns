<script lang="ts">
 import {onMount,untrack} from 'svelte';
 import type {Card} from './types';
 let {title,unskipOnly=false,blocked=false,isCurrent,onread,onunskip,onopen,onverify,onclose}:{title:string;unskipOnly?:boolean;blocked?:boolean;isCurrent:()=>boolean;onread:()=>Promise<{board_id:number;revision:number;cards:Card[]}>;onunskip:(id:number)=>Promise<void>;onopen:(card:Card)=>Promise<void>;onverify:()=>Promise<string>;onclose:()=>void}=$props();
 const current=untrack(()=>isCurrent);
 let rows=$state<Card[]>([]),pending=$state(false),message=$state(''),unknown=$state(false),loaded=$state(false),panel:HTMLDivElement,alive=true;
 async function read(){if(pending||blocked||unknown||!current())return;pending=true;message='';try{const result=await onread();if(alive&&current()){rows=result.cards;loaded=true}}catch(e){if(alive&&current())message=e instanceof Error?e.message:'读取失败'}finally{if(alive&&current())pending=false}}
 async function undo(id:number){if(pending||blocked||unknown||!current())return;pending=true;message='';try{await onunskip(id);if(alive&&current()){message='已撤销跳过';loaded=false}}catch(e){if(alive&&current()){message=e instanceof Error?e.message:'撤销失败';if(!(e as any).status||(e as any).status>=500)unknown=true}}finally{if(alive&&current())pending=false}if(!unknown&&!loaded)await read()}
 async function open(card:Card){if(pending||blocked||unknown)return;pending=true;try{await onopen(card)}catch(e){if(alive&&current())message=e instanceof Error?e.message:'打开失败'}finally{if(alive&&current())pending=false}}
 async function verify(){if(pending)return;pending=true;try{const value=await onverify();if(alive&&current())message=value}catch{if(alive&&current())message='暂时无法核对，保持写入阻塞'}finally{if(alive&&current())pending=false}}
 function close(){if(!pending)onclose()}
 onMount(()=>{
  const previous=document.activeElement as HTMLElement,shell=document.querySelector<HTMLElement>('.app-shell');if(shell)shell.inert=true;panel.focus();
  const keys=(e:KeyboardEvent)=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}if(e.key==='Tab'){const ns=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled)')).filter(n=>n.getClientRects().length);if(e.shiftKey&&(document.activeElement===ns[0]||document.activeElement===panel)){e.preventDefault();ns.at(-1)?.focus()}else if(!e.shiftKey&&(document.activeElement===ns.at(-1)||document.activeElement===panel)){e.preventDefault();ns[0]?.focus()}}};
  document.addEventListener('keydown',keys,true);if(!blocked)void read();
  return()=>{alive=false;document.removeEventListener('keydown',keys,true);if(shell)shell.inert=!!document.querySelector('.task-panel')&&window.innerWidth<=640;queueMicrotask(()=>{if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true})})};
 });
</script>
<div class="transfer-shade"><div class="dialog recurrence-history" role="dialog" aria-modal="true" aria-labelledby="history-heading" tabindex="-1" bind:this={panel}>
 <h2 id="history-heading">{blocked||unknown?'只读核对未知结果':unskipOnly?'撤销跳过':'重复记录'}</h2><h3>{title}</h3>
 {#if blocked||unknown}<p>写入结果未知；关闭或重新打开不会解除锁，也不会自动重发。</p><button disabled={pending} onclick={verify}>只读核对结果</button>
 {:else}<p>只列服务器真实记录，含已归档。下列日期是计划日期，不是完成或跳过时间。</p><button disabled={pending} onclick={read}>重新读取重复记录</button>
 {#each rows as card (card.id)}<article data-history-id={card.id}><strong>#{card.id} · {card.skipped?'已跳过':card.completed?'已完成':'未完成'}{card.archived?' · 已归档':''}</strong><p>{card.schedule?.start_date||card.due_date||'无计划日期'} {card.schedule?.start_time||''}{card.schedule?.end_date?` 至 ${card.schedule.end_date}`:''} {card.schedule?.end_time||''}</p><p>{card.title}</p><button disabled={pending} onclick={()=>open(card)}>打开历史 #{card.id}</button>{#if card.skipped}<button disabled={pending} onclick={()=>undo(card.id)}>撤销跳过 #{card.id}</button>{/if}</article>{:else}{#if loaded}<p>没有重复记录。</p>{/if}{/each}{/if}
 {#if message}<p role="status">{message}</p>{/if}
 <button disabled={pending} onclick={close}>关闭</button>
</div></div>
<style>.recurrence-history{width:min(600px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;overflow-wrap:anywhere}.recurrence-history article{border-top:1px solid var(--border);padding:12px 0}.recurrence-history p{line-height:1.6}.recurrence-history button{min-height:44px;margin:4px 8px 4px 0;white-space:normal}</style>
