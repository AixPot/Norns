<script module lang="ts">
 import type {Schedule} from './types';
 export type SkipPreview={card_id:number;revision:number;touch_version:number;next_schedule:Schedule|null};
 export type SkipRequest={action:'card_skip';card_id:number;expected_revision:number;preview:SkipPreview};
 export type SkipDialogProps={cardId:number;title:string;mode:'calendar'|'relative';isCurrent:()=>boolean;onpreview:()=>Promise<SkipPreview>;oncommit:(body:SkipRequest)=>Promise<void>;onverify:()=>Promise<string>;onclose:()=>void};
</script>
<script lang="ts">
 import {onMount,onDestroy,untrack} from 'svelte';
 import {createPreviewSession,skipMutation} from './occurrence-skip.mjs';
 let {cardId,title,mode,isCurrent,onpreview,oncommit,onverify,onclose}:SkipDialogProps=$props();
 // Props describe one frozen identity/subject. App must key/remount on subject change.
 const {current,subject}=untrack(()=>({current:isCurrent,subject:cardId})),session=createPreviewSession({isCurrent:current});
 let phase=$state('idle'),preview=$state<SkipPreview|null>(null),message=$state(''),verification=$state(''),checking=$state(false),alive=true;
 let panel:HTMLDivElement;
 const busy=$derived(phase==='reading'||phase==='sending'||checking);
 function sync(){if(!alive||!current())return;phase=session.state();preview=session.preview();message=session.error()?.message||''}
 async function prepare(){if(busy||!current())return;const work=session.prepare(async()=>{const p=await onpreview();if(p.card_id!==subject)throw Object.assign(new Error('预览任务不匹配，请关闭后重新打开'),{status:409});return p});sync();await work;sync()}
 async function commit(){if(busy||!current())return;const work=session.commit(oncommit,skipMutation);sync();await work;sync()}
 async function verify(){if(busy||!current())return;checking=true;try{const text=await onverify();if(alive&&current())verification=text}catch{if(alive&&current())verification='暂时无法核对；保持写入阻塞，不会重试。'}finally{if(alive&&current())checking=false}}
 function close(){if(!alive||!current())return;if(busy){message='请求仍在进行，请等待结果。';return}onclose()}
 export function hasPending(){return alive&&(busy||phase==='unknown')}
 onDestroy(()=>{alive=false;session.dispose()});
 onMount(()=>{
  const previous=document.activeElement as HTMLElement,shell=document.querySelector<HTMLElement>('.app-shell');if(shell)shell.inert=true;panel.focus();
  const keys=(e:KeyboardEvent)=>{if(e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}if(e.key==='Tab'){const nodes=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')).filter(n=>n.getClientRects().length);if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===panel)){e.preventDefault();nodes.at(-1)?.focus()}else if(!e.shiftKey&&(document.activeElement===nodes.at(-1)||document.activeElement===panel)){e.preventDefault();nodes[0]?.focus()}}};
  document.addEventListener('keydown',keys,true);return()=>{document.removeEventListener('keydown',keys,true);if(shell)shell.inert=!!document.querySelector('.task-panel')&&window.innerWidth<=640;queueMicrotask(()=>{if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true})})};
 });
</script>
<div class="transfer-shade"><div class="dialog skip-dialog" role="dialog" aria-modal="true" aria-labelledby="skip-heading" tabindex="-1" bind:this={panel}>
 <h2 id="skip-heading">跳过当前重复实例</h2><h3>{title}</h3>
 <p>只跳过这一次，不是完成；仍占一次生成名额。原任务、清单、评论与附件全部保留。</p>
 <p>{mode==='calendar'?'按日历原锚点取未来周期，过期周期不补建。':'相对重复从实际跳过时刻起算，预览可能随时间失效。'}</p>
 {#if message}<p role="alert">{message}</p>{/if}
 {#if phase==='unknown'}<p>仅可只读核对。关闭对话框不解除 App 的未知结果写入屏障。</p><button disabled={busy} onclick={verify}>只读核对跳过结果</button>{#if verification}<p role="status">{verification}</p>{/if}
 {:else if phase==='success'}<p role="status">已跳过。不是完成，不计入完成数量。</p>
 {:else}
 <button disabled={busy||phase==='blocked'} onclick={prepare}>{phase==='reading'?'正在读取…':'重新读取跳过预览'}</button>
 {#if preview}<section aria-label="跳过预览">
  {#if preview.next_schedule}<h3>下一次任务</h3><p>{preview.next_schedule.start_date} {preview.next_schedule.start_time||''}{preview.next_schedule.end_date?` 至 ${preview.next_schedule.end_date}`:''} {preview.next_schedule.end_time||''} · {preview.next_schedule.timezone}</p>
  {:else}<p>已到末次或结束条件：本次跳过后没有后继任务。</p>{/if}
  <p>后继清单重置未勾选，不复制评论和附件。只提交当前显示的完整预览；版本或时间漂移需重新预览确认。</p>
  <button class="primary" disabled={busy||phase!=='ready'} onclick={commit}>{phase==='sending'?'正在提交…':'确认跳过这一次'}</button>
 </section>{/if}{/if}
 <button disabled={busy} onclick={close}>{phase==='success'||phase==='unknown'?'关闭':'取消'}</button>
</div></div>
<style>
 .skip-dialog{width:min(560px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;overflow-wrap:anywhere}.skip-dialog p{line-height:1.6}.skip-dialog button{min-height:44px;white-space:normal;margin:4px 8px 4px 0}
</style>
