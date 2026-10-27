<script lang="ts">
 import {onMount,onDestroy,tick} from 'svelte';
 import {api,ApiError,downloadExport} from './api';
 import {saveExport} from './export-download.mjs';
 import type {Board,BoardSummary,ExportSelection,ExportPreview} from './types';
 let {initialBoardId,onclose}:{initialBoardId:number;onclose:()=>void}=$props();
 let scopes=$state<BoardSummary[]>([]),inboxId=$state(0),selected=$state<number[]>([]),format=$state<ExportSelection['format']>('csv'),completed=$state(true),archived=$state(false),preview=$state<ExportPreview|null>(null),working=$state(false),loading=$state(true),message=$state('');
 let summary=$state<HTMLElement>();
 let panel:HTMLDivElement,alive=true,seq=0,controller:AbortController|undefined;
 function invalidate(){++seq;controller?.abort();controller=undefined;working=false;preview=null;message=''}
 function selection():ExportSelection{return {board_ids:[...selected],include_completed:completed,include_archived:archived,format}}
 function changeScope(id:number,checked:boolean){selected=checked?[...selected,id]:selected.filter(x=>x!==id);invalidate()}
 function cancel(){invalidate();message='导出已取消，未保存文件。'}
 function handle(e:unknown){
  if((e as any)?.name==='AbortError'||(e as any)?.stale)return;
  preview=null;
  if(e instanceof ApiError&&[403,404].includes(e.status)){scopes=scopes.filter(b=>!selected.includes(b.id));selected=[];message='所选范围已不可用。请关闭后重新打开并选择可访问的范围。';return}
  message=e instanceof ApiError&&e.status===409?'所选数据或附件已变化 / 原件不可用。请重新获取预览，核对后再明确下载。':e instanceof Error?e.message:'网络连接失败，请重新预览';
 }
 async function prepare(){
  invalidate();const token=seq,scope=selection(),c=new AbortController();controller=c;working=true;
  try{const result=await api<ExportPreview>('/exports/preview','POST',scope,c.signal);if(alive&&token===seq&&!c.signal.aborted){preview=result;await tick();if(alive&&token===seq)summary?.scrollIntoView({block:'nearest'})}}
  catch(e){if(alive&&token===seq)handle(e)}finally{if(alive&&token===seq)working=false}
 }
 async function download(){
  if(!preview||working)return;
  const token=++seq,scope=selection(),snapshot=preview.expected_snapshot,c=new AbortController();controller=c;working=true;message='';
  try{const file=await downloadExport(scope,snapshot,c.signal);if(!alive||token!==seq||c.signal.aborted)return;saveExport(file,{signal:file.identitySignal,isCurrent:()=>alive&&token===seq});message='已交给浏览器下载，请检查下载列表。'}
  catch(e){if(alive&&token===seq)handle(e)}finally{if(alive&&token===seq)working=false}
 }
 onDestroy(()=>{alive=false;invalidate()});
 onMount(()=>{
  const previous=document.activeElement as HTMLElement,shell=document.querySelector<HTMLElement>('.app-shell');if(shell)shell.inert=true;panel.focus();
  const keys=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();onclose()}if(e.key==='Tab'){const nodes=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)'));if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===panel)){e.preventDefault();nodes.at(-1)?.focus()}else if(!e.shiftKey&&(document.activeElement===nodes.at(-1)||document.activeElement===panel)){e.preventDefault();nodes[0]?.focus()}}};document.addEventListener('keydown',keys);
  const token=++seq,c=new AbortController();controller=c;
  void Promise.all([api<BoardSummary[]>('/boards','GET',undefined,c.signal),api<Board>('/inbox','GET',undefined,c.signal)]).then(([boards,inbox])=>{if(!alive||token!==seq)return;inboxId=inbox.id;scopes=[{id:inbox.id,title:'收集箱（仅自己）',revision:inbox.revision},...boards];selected=[scopes.some(b=>b.id===initialBoardId)?initialBoardId:inbox.id]}).catch(e=>{if(alive&&token===seq)handle(e)}).finally(()=>{if(alive&&token===seq)loading=false});
  return()=>{if(shell)shell.inert=!!document.querySelector('.task-panel')&&window.innerWidth<=640;document.removeEventListener('keydown',keys);queueMicrotask(()=>{if(document.querySelector('.task-panel'))return;if(previous?.isConnected&&previous!==document.body&&!panel.contains(previous))previous.focus();else{const entry=Array.from(document.querySelectorAll<HTMLElement>('[aria-label="更多操作"]')).find(el=>el.getClientRects().length);(entry||document.querySelector<HTMLElement>('[aria-label="打开导航"]'))?.focus()}})};
 });
</script>
<div class="transfer-shade"><div class="dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" tabindex="-1" bind:this={panel}>
 <header><h2 id="export-title">导出所选数据</h2><button aria-label="关闭导出" onclick={onclose}>✕</button></header>
 <p>只导出明确勾选的清单，不继承搜索、日历或智能视图筛选。聚合视图默认仅选自己的收集箱，不会默认导出全部。</p>
 {#if message}<div class="alert" role="status">{message}</div>{/if}
 {#if loading}<p role="status">正在读取可访问范围…</p>{:else}
 <fieldset><legend>选择范围（最多 20 个）</legend><div class="export-scopes">{#each scopes as b}<label class="checkbox"><input type="checkbox" aria-label={b.title} checked={selected.includes(b.id)} onchange={e=>changeScope(b.id,e.currentTarget.checked)} disabled={!selected.includes(b.id)&&selected.length>=20}/><span>{b.id===inboxId?'🔒 ':''}{b.title}</span></label>{/each}</div></fieldset>
 <fieldset><legend>任务状态（独立选项）</legend><label class="checkbox"><input type="checkbox" aria-label="包含已完成任务" bind:checked={completed} onchange={invalidate}/>包含已完成任务</label><label class="checkbox"><input type="checkbox" aria-label="包含已归档任务" bind:checked={archived} onchange={invalidate}/>包含已归档任务</label><p class="muted">已跳过任务不属于已完成，按归档选项纳入；导出保留 skipped 状态。</p></fieldset>
 <label>文件格式<select aria-label="导出格式" bind:value={format} onchange={invalidate}><option value="csv">CSV · 任务表</option><option value="json">JSON · 所选完整应用数据</option><option value="zip">ZIP · 应用数据及可用附件原件</option></select></label>
 {#if format==='zip'}<p class="export-memory-note">浏览器需先在内存接收完整文件（最多 160 MiB），移动设备请选小范围。</p>{/if}
 <details><summary>文件内容、限制与注意事项</summary>
 {#if format==='zip'}<p>ZIP 包含 data.json、tasks.csv、manifest.json 和就绪附件原件；待上传、校验中、已删除记录只保留元数据并列明排除。预览不读取原件，下载时原件缺失会使整个导出失败。</p><p class="muted">上限：5,000 个任务、20,000 条附属记录、200 个原件；原件合计 128 MiB、单个最多 64 MiB（也受服务端设置限制），包最多 160 MiB。浏览器需先在内存接收完整文件，移动设备请选小范围。校验和只证明本包字节，不证明上传以来未被改写。</p>{:else}<p>CSV 仅任务表；JSON 包含所选任务、清单、评论、附件元数据及相关用户。两者均不包含附件原件。单个文件上限 16 MiB、5,000 个任务、20,000 条附属记录。</p>{/if}
 <p class="muted">不包含私人模板库或当前设备的分组、排序等本地显示偏好。这是所选应用数据，不是灾难恢复备份或可直接导入的格式。超限不会截断，请缩小范围；下载后请妥善保管。</p></details>
 <button disabled={working||!selected.length} onclick={prepare}>获取最新导出预览</button>
 {#if preview}<section bind:this={summary} class="export-summary" aria-label="导出预览" aria-live="polite"><h3>所选 {selected.length} 个范围</h3><p>{preview.task_count} 个任务 · {preview.checklist_count} 条清单条目 · {preview.comment_count} 条评论</p><p>{preview.attachment_count} 条附件元数据 · 元数据 {preview.metadata_bytes.toLocaleString()} 字节</p>{#if format==='zip'}<p>{preview.ready_original_count} 个就绪原件 · {preview.ready_original_bytes?.toLocaleString()} 字节 · 排除 {preview.excluded_attachment_count} 个非就绪原件</p><p>元数据大小不包含原件及 ZIP 目录 / 清单开销。</p>{/if}<button class="primary" disabled={working} onclick={download}>确认下载 {format.toUpperCase()}</button></section>{/if}
 {/if}
 <footer>{#if working}<span role="status">正在{preview?'接收文件':'获取预览'}…</span><button onclick={cancel}>取消当前导出</button>{/if}<button onclick={onclose}>关闭</button></footer>
</div></div>
<style>
 .export-dialog{width:min(620px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow-y:auto;box-sizing:border-box;min-width:0;overflow-wrap:anywhere}
 details{margin:12px 0}details summary{cursor:pointer;color:var(--secondary)}.export-memory-note{font-size:13px}header,footer{display:flex;align-items:center;justify-content:space-between;gap:12px}header h2{margin:0}fieldset{min-width:0;margin:12px 0;border:1px solid var(--border);border-radius:8px;padding:12px}.export-scopes{max-height:160px;overflow-y:auto}.export-dialog .checkbox{display:flex;align-items:center;gap:8px;margin:8px 0}.checkbox input{flex:0 0 auto;width:auto}.checkbox span{min-width:0}.export-dialog select{width:100%;min-width:0}.export-summary{margin:16px 0;padding:12px;border:1px solid var(--border);border-radius:8px}footer{margin-top:16px;flex-wrap:wrap}.export-dialog button{white-space:normal}p{line-height:1.6}
</style>
