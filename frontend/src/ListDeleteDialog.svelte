<script module lang="ts">
 import type {List} from './types';
 export type ListRemovalPreview={board_id:number;source_list_id:number;target_list_id:number;revision:number;cards:{id:number;touch_version:number}[];task_count:number;incomplete_count:number;completed_count:number;skipped_count:number;archived_count:number;comment_count:number;checklist_count:number;attachment_count:number;pending_upload_count:number;verifying_upload_count:number;attachment_fingerprint:string};
 export type ListRemovalRequest={action:'list_remove';expected_revision:number;preview:ListRemovalPreview};
 export type ListDeleteDialogProps={boardId:number;source:List;lists:List[];isCurrent:()=>boolean;onpreview:(target:number)=>Promise<ListRemovalPreview>;oncommit:(body:ListRemovalRequest)=>Promise<void>;onverify:()=>Promise<string>;onclose:()=>void};
</script>
<script lang="ts">
 import {onMount,onDestroy,untrack} from 'svelte';
 import {createPreviewSession} from './occurrence-skip.mjs';
 import {listRemovalMutation,removalTargets} from './list-removal.mjs';
 let {boardId,source,lists,isCurrent,onpreview,oncommit,onverify,onclose}:ListDeleteDialogProps=$props();
 const {current,board,sourceId,sourceTitle,choices}=untrack(()=>({current:isCurrent,board:boardId,sourceId:source.id,sourceTitle:source.title,choices:removalTargets(lists,boardId,source.id) as List[]})),session=createPreviewSession({isCurrent:current});
 let target=$state(''),phase=$state('idle'),preview=$state<ListRemovalPreview|null>(null),message=$state(''),verification=$state(''),checking=$state(false),alive=true;
 let panel:HTMLDivElement;
 const busy=$derived(phase==='reading'||phase==='sending'||checking);
 function sync(){if(!alive||!current())return;phase=session.state();preview=session.preview();message=session.error()?.message||''}
 function select(){session.invalidate();sync()}
 async function prepare(){if(busy||!current()||!choices.some(l=>l.id===Number(target)))return;const selected=Number(target);const work=session.prepare(async()=>{const p=await onpreview(selected);if(p.board_id!==board||p.source_list_id!==sourceId||p.target_list_id!==selected)throw Object.assign(new Error('预览归属不匹配，请重新读取'),{status:409});if(p.pending_upload_count||p.verifying_upload_count)throw Object.assign(new Error('附件处理中'),{status:409,code:'attachment_processing'});return p});sync();await work;sync()}
 async function commit(){if(busy||!current())return;const work=session.commit(oncommit,listRemovalMutation);sync();await work;sync()}
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
<div class="transfer-shade"><div class="dialog list-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="list-delete-heading" tabindex="-1" bind:this={panel}>
 <h2 id="list-delete-heading">安全移除列表</h2><h3>{sourceTitle}</h3>
 <p>所有任务全部保留，只把本列表的全部当前和历史任务移到同一看板的目标列表，再移除空列表壳。所有当前看板成员均可操作，不限管理员。</p>
 <p>默认收集箱列表、私有收集箱和最后一个列表不能移除。保护状态由服务器校验；不会尝试绕过拒绝。</p>
 <p>任务 ID、重复链、正文、日期、清单、评论、附件全部保留。移动增加 touch，旧的完成撤销或撤销跳过可能因此受到保护而被拒绝。</p>
 {#if message}<p role="alert">{message}</p>{/if}
 {#if phase==='unknown'}<p>仅可只读核对。关闭对话框不解除 App 的未知结果写入屏障。</p><button disabled={busy} onclick={verify}>只读核对列表和任务归属</button>{#if verification}<p role="status">{verification}</p>{/if}
 {:else if phase==='success'}<p role="status">列表已移除，全部任务已保留并移入目标列表。</p>
 {:else}
 <label>同板目标列表<select aria-label="同板目标列表" bind:value={target} disabled={busy||phase==='blocked'} onchange={select}><option value="">请选择目标列表（不默认选择）</option>{#each choices as list}<option value={String(list.id)}>{list.title}</option>{/each}</select></label>
 {#if !choices.length}<p>没有可用的同板目标列表；不能移除最后一个列表。</p>{/if}
 <p>附件上传中（pending）或核验中（verifying）时不能移除。请等待完成，或在附件界面取消上传，再重新预览；这里不会取消上传。</p>
 <button disabled={busy||!target||phase==='blocked'} onclick={prepare}>{phase==='reading'?'正在读取…':'读取完整移除预览'}</button>
 {#if preview}<section aria-label="全部任务与附件统计"><h3>移入：{choices.find(l=>l.id===preview?.target_list_id)?.title}</h3>
 <dl><dt>全部任务（含历史与归档）</dt><dd>{preview.task_count}</dd><dt>活动／未完成且未跳过（含归档）</dt><dd>{preview.incomplete_count}</dd><dt>已完成（含归档）</dt><dd>{preview.completed_count}</dd><dt>已跳过（含归档）</dt><dd>{preview.skipped_count}</dd><dt>其中已归档（独立维度，不与以上相加）</dt><dd>{preview.archived_count}</dd><dt>评论</dt><dd>{preview.comment_count}</dd><dt>清单条目</dt><dd>{preview.checklist_count}</dd><dt>全部状态附件记录（含已删除元数据）</dt><dd>{preview.attachment_count}</dd><dt>上传中 pending</dt><dd>{preview.pending_upload_count}</dd><dt>核验中 verifying</dt><dd>{preview.verifying_upload_count}</dd></dl>
 <p>不永久删除任何任务或附件，不跨板迁移，无批量条数上限。确认只使用这份完整预览；任何变化需重新读取并再次确认。</p>
 <button class="primary" disabled={busy||phase!=='ready'} onclick={commit}>{phase==='sending'?'正在提交…':'保留全部任务并移除列表'}</button></section>{/if}{/if}
 <button disabled={busy} onclick={close}>{phase==='success'||phase==='unknown'?'关闭':'取消'}</button>
</div></div>
<style>
 .list-delete-dialog{width:min(620px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;overflow-wrap:anywhere}.list-delete-dialog p{line-height:1.6}.list-delete-dialog button{min-height:44px;white-space:normal;margin:4px 8px 4px 0}.list-delete-dialog select{width:100%;min-height:44px;min-width:0}.list-delete-dialog dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.list-delete-dialog dd{margin:0}
</style>
