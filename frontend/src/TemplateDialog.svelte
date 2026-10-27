<script lang="ts">
 import CreationDate from './CreationDate.svelte';
 import {onMount,onDestroy} from 'svelte';
 import {api,ApiError} from './api';
 import {sourceTemplate,templateReplacement,unknownOutcome} from './templates.mjs';
 import type {Board,Draft,TaskTemplate,TemplateSummary} from './types';
 let {source=null,target=null,onapply,onclose,onunknown,onpending,onknown}:{source?:{board:Board;draft:Draft}|null;target?:{board:Board;listId:number;route?:string}|null;onapply:(t:TaskTemplate,ack:boolean,date:string)=>Promise<string|undefined>;onclose:()=>void;onunknown:()=>void;onpending:()=>void;onknown:()=>void}=$props();
 let summaries=$state<TemplateSummary[]>([]),selected=$state<TaskTemplate|null>(null),name=$state(''),message=$state(''),working=$state(false),loading=$state(true),blocked=$state(false),created=$state(false),ack=$state(false),dirty=$state(false);
 let choice=$state('');
 let panel:HTMLDivElement,alive=true,sequence=0,controller:AbortController|undefined;
 const sourceCard=$derived(source?.board.cards.find(c=>c.id===source.draft.id));
 const sourceItems=$derived(source?.board.checklist.filter(i=>i.card_id===source?.draft.id).sort((a,b)=>a.position-b.position)||[]);
 const destination=$derived(target?.board.lists.find(l=>l.id===target?.listId));
 function begin(){controller?.abort();controller=new AbortController();return {token:++sequence,signal:controller.signal}}
 function current(token:number){return alive&&token===sequence}
 function error(e:unknown,write=false){if((e as any)?.stale||(e as any)?.name==='AbortError')return;if(write&&unknownOutcome(e)){blocked=true;onunknown();message='写入结果未知，已阻止重复发送。请只读核对模板库和目标任务；关闭后也不会自动重放。';return}if(e instanceof ApiError&&e.status===409){blocked=true;message='版本已变化，输入已保留。请明确重新读取并核对，再作新决定；不会自动重试。';return}message=e instanceof Error?e.message:'操作失败，输入已保留'}
 async function list(){const {token,signal}=begin();loading=true;try{const rows=await api<TemplateSummary[]>('/templates','GET',undefined,signal);if(current(token))summaries=rows}catch(e){if(current(token))error(e)}finally{if(current(token))loading=false}}
 async function choose(id:number){if(working)return;if(dirty&&!confirm('放弃当前未保存的模板编辑，读取所选版本？'))return;const {token,signal}=begin();loading=true;try{const t=await api<TaskTemplate>(`/templates/${id}`,'GET',undefined,signal);if(current(token)){selected=t;dirty=false;ack=false;blocked=false;message=''}}catch(e){if(current(token))error(e)}finally{if(current(token))loading=false}}
 async function write(kind:'create'|'update'|'delete'|'apply'){
  if(working||blocked)return;
  if(kind==='delete'&&!confirm('删除这个私人模板？已有任务不会改变。'))return;
  if(kind==='update'&&!confirm('保存并替换此私人模板的名称和全部内容？已有任务不会改变。'))return;
  const {token,signal}=begin();working=true;message='';
  try{
   if(kind==='apply'){if(!selected||!target)return;const notice=await onapply(selected,ack,choice);if(current(token)){message=notice||'已从模板创建新任务；模板本身未改变。';blocked=true}}
   else if(kind==='create'){if(!source||created)return;onpending();await api<TaskTemplate>('/templates','POST',sourceTemplate(source.board,source.draft,name),signal);if(current(token)){onknown();created=true;message='私人模板已保存。';summaries=await api<TemplateSummary[]>('/templates','GET',undefined,signal)}}
   else if(selected){if(kind==='update'){const t=await api<TaskTemplate>(`/templates/${selected.id}`,'PATCH',templateReplacement(selected),signal);if(current(token)){selected=t;dirty=false;message='模板已保存，已有任务未改变。'}}else{await api(`/templates/${selected.id}`,'DELETE',{expected_revision:selected.revision},signal);if(current(token)){selected=null;dirty=false;message='模板已删除，已有任务未改变。'}}if(current(token)){const rows=await api<TemplateSummary[]>('/templates','GET',undefined,signal);if(current(token))summaries=rows}}
  }catch(e){if(current(token)){if(kind==='create'&&!unknownOutcome(e))onknown();if(kind==='create'&&unknownOutcome(e))created=true;error(e,true)}}finally{if(current(token))working=false}
 }
 // Read live modal state synchronously; disposed instances cannot warn for a new owner.
 export function hasPending(){return alive&&(working||dirty||!!(source&&!created&&name.trim()))}
 function close(){if(working){message='写入仍在进行，请等待结果后关闭。';return}if((dirty||source&&!created&&name.trim())&&!confirm('放弃未保存的模板编辑并关闭？'))return;onclose()}
 onDestroy(()=>{alive=false;++sequence;controller?.abort()});
 onMount(()=>{
  const previous=document.activeElement as HTMLElement,shell=document.querySelector<HTMLElement>('.app-shell');if(shell)shell.inert=true;panel.focus();void list();
  const keys=(e:KeyboardEvent)=>{if(e.isComposing||(e.target as HTMLElement)?.matches('[data-composing="true"]'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}if(e.key==='Tab'){const nodes=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')).filter(n=>n.getClientRects().length);if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===panel)){e.preventDefault();nodes.at(-1)?.focus()}else if(!e.shiftKey&&(document.activeElement===nodes.at(-1)||document.activeElement===panel)){e.preventDefault();nodes[0]?.focus()}}};document.addEventListener('keydown',keys,true);
  return()=>{document.removeEventListener('keydown',keys,true);if(shell)shell.inert=!!document.querySelector('.task-panel')&&window.innerWidth<=640;queueMicrotask(()=>{if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true})})};
 });
 function composing(e:CompositionEvent,active:boolean){(e.target as HTMLElement).dataset.composing=String(active)}
</script>
<div class="transfer-shade"><div class="dialog template-dialog" role="dialog" aria-modal="true" aria-labelledby="template-heading" tabindex="-1" bind:this={panel} oncompositionstart={e=>composing(e,true)} oncompositionend={e=>composing(e,false)}>
 <header><h2 id="template-heading">私人模板库</h2><button aria-label="关闭模板库" disabled={working} onclick={close}>✕</button></header>
 <p>模板仅自己可见。只复制标题、描述和有序清单条目；不复制日期、重复、负责人、完成状态、评论或附件。</p>
 {#if message}<p class="alert" role="status">{message}</p>{/if}
 {#if source&&sourceCard}
 <section aria-label="已保存任务预览"><h3>已保存任务预览</h3><strong>{sourceCard.title}</strong><p class="template-body">{sourceCard.description||'无描述'}</p><ol>{#each sourceItems as item}<li>{item.title}</li>{/each}</ol><p class="muted">源版本 {source.board.revision} · 本次保存由服务器读取此已确认版本，不包含未发送输入。</p></section>
 <label>模板名称<input aria-label="模板名称" bind:value={name} disabled={working||created} maxlength="160"/></label><button class="primary" disabled={working||blocked||created||!name.trim()} onclick={()=>write('create')}>确认保存私人模板</button>
 {:else}
 {#if target}<section class="template-target"><h3>创建到：{target.board.title} / {destination?.title}</h3><p>{target.board.inbox_owner_id?'仅自己可见的收集箱':'普通看板：所有当前及未来成员均可能看到复制的内容，即使现在只有一名成员。'}</p></section>{/if}
 <label>选择私人模板<select aria-label="选择私人模板" value={selected?.id||''} disabled={working||loading} onchange={e=>{if(e.currentTarget.value)void choose(Number(e.currentTarget.value))}}><option value="">请选择…</option>{#each summaries as t}<option value={t.id}>{t.name} · v{t.revision}</option>{/each}</select></label>
 {#if loading}<p role="status">正在读取私人模板…</p>{:else if !summaries.length}<p>还没有私人模板。打开已保存任务，在更多操作中保存。</p>{/if}
 {#if selected}
 {#if target}<section aria-label="模板内容预览"><h3>{selected.title}</h3><p class="template-body">{selected.description||'无描述'}</p><ol>{#each selected.checklist as item}<li>{item.title}</li>{/each}</ol><p>模板版本 {selected.revision} · 新任务和条目使用新 ID，全部未完成。</p></section>
 {#if !target.board.inbox_owner_id}<label class="template-ack"><input type="checkbox" aria-label="确认共享模板内容" bind:checked={ack} disabled={working}/>我确认将以上私人内容复制到此普通看板，允许当前及未来成员查看。</label>{/if}
 {#if target.route==='today'||target.route==='tomorrow'||target.route==='next7'}<CreationDate route={target.route} bind:value={choice}/>{/if}<button class="primary" disabled={working||loading||blocked||(!target.board.inbox_owner_id&&!ack)} onclick={()=>write('apply')}>确认从模板创建</button>
 {:else}
 <fieldset disabled={working||loading}><legend>编辑私人副本 · v{selected.revision}</legend>
 <label>名称<input aria-label="编辑模板名称" bind:value={selected.name} oninput={()=>dirty=true}/></label><label>任务标题<input aria-label="模板任务标题" bind:value={selected.title} oninput={()=>dirty=true}/></label><label>描述<textarea aria-label="模板描述" bind:value={selected.description} oninput={()=>dirty=true} rows="4"></textarea></label>
 <ol>{#each selected.checklist as item,i}<li><input aria-label={`模板条目 ${i+1}`} bind:value={item.title} oninput={()=>dirty=true}/><button aria-label={`上移模板条目 ${i+1}`} disabled={i===0} onclick={()=>{if(selected){const items=[...selected.checklist];[items[i-1],items[i]]=[items[i],items[i-1]];selected.checklist=items;dirty=true}}}>↑</button><button aria-label={`删除模板条目 ${i+1}`} onclick={()=>{if(selected){selected.checklist=selected.checklist.filter((_,n)=>n!==i);dirty=true}}}>删除</button></li>{/each}</ol>
 <button disabled={selected.checklist.length>=100} onclick={()=>{if(selected){selected.checklist=[...selected.checklist,{title:'',position:selected.checklist.length}];dirty=true}}}>添加模板条目</button></fieldset>
 <button class="primary" disabled={working||loading||blocked||!dirty} onclick={()=>write('update')}>保存模板修改</button><button disabled={working||loading||blocked} onclick={()=>write('delete')}>删除私人模板</button>
 {/if}
 <button disabled={working} onclick={()=>choose(selected!.id)}>重新读取所选版本并核对</button>
 {/if}
 {/if}
 <footer><button disabled={working} onclick={list}>只读刷新模板列表</button><button disabled={working} onclick={close}>关闭</button></footer>
</div></div>
<style>
 .template-dialog{width:min(620px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;min-width:0;overflow-wrap:anywhere}.template-dialog header,.template-dialog footer{display:flex;justify-content:space-between;align-items:center;gap:12px}.template-dialog input:not([type=checkbox]),.template-dialog textarea,.template-dialog select{width:100%;min-width:0;box-sizing:border-box}.template-dialog fieldset{min-width:0;border:1px solid var(--border);margin:12px 0}.template-dialog li{margin:8px 0;min-width:0}.template-dialog button{white-space:normal;margin:4px 4px 4px 0}.template-dialog p{line-height:1.6}.template-body{white-space:pre-wrap}.template-dialog .template-ack{display:flex;flex-direction:row;align-items:flex-start;gap:8px;margin:16px 0}.template-ack input{width:16px;height:16px;min-height:0;padding:0;margin:2px 0 0;flex:none}.template-dialog footer{margin-top:16px;flex-wrap:wrap}
</style>
