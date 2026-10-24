<script lang="ts">
 import {untrack as selectionUntrack} from 'svelte';
 import type {SelectionProps} from './types';
 import TaskCapture,{captureLeaveGuard} from './TaskCapture.svelte';
 import type {Schedule} from './types';
 import {projectTaskView} from './task-view.mjs';
 import ViewOptions from './ViewOptions.svelte';
 import type {ViewPreferences} from './types';
 import {onMount} from 'svelte';import {api} from './api';import {createTaskLoader,taskQuery} from './task-discovery.mjs';import {smartFilters} from './navigation.mjs';import {cardSchedule} from './card-schedule.mjs';import type {TaskResult,TaskDiscoveryResponse} from './types';
 let {selecting=false,selected=[],onselect,onvisible,ontemplate,accountId,display,ondisplay,recovery,unknown=false,inboxList,route,inboxId,refresh=0,pendingCards=[],onopen,oncomplete,onquick,onmetadata,onerror}:SelectionProps & {ontemplate?:(restore:()=>void)=>void;accountId:number;display:ViewPreferences;ondisplay:(value:ViewPreferences)=>void;recovery?:any;unknown?:boolean;inboxList:number;route:string;inboxId:number;refresh?:number;pendingCards?:number[];onopen:(task:TaskResult,anchor:HTMLElement)=>void;oncomplete:(task:TaskResult)=>Promise<boolean>;onquick:(title:string,schedule?:Schedule)=>Promise<boolean>;onmetadata:(d:TaskDiscoveryResponse)=>void;onerror:(e:unknown)=>void}=$props();
 let rows=$state<TaskResult[]>([]),completed=$state<TaskResult[]>([]),expanded=$state(false),loading=$state(true),message=$state(''),today=$state(new Date(Date.now()+8*3600000).toISOString().slice(0,10));
 const labels:Record<string,string>={today:'今天',tomorrow:'明天',next7:'最近七天',mine:'指派给我',inbox:'收集箱'};
 const loader=createTaskLoader({read:async(q:string)=>{const data=await api<TaskDiscoveryResponse>('/tasks?'+q);let done:TaskResult[]=[];if(expanded){const params=new URLSearchParams(q);params.set('status','complete');done=(await api<TaskDiscoveryResponse>('/tasks?'+params)).tasks}return {data,done}},apply:({data,done}:{data:TaskDiscoveryResponse;done:TaskResult[]})=>{rows=data.tasks;completed=done;today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);onmetadata(data);loading=false;message=''},onerror:(e:unknown)=>{rows=[];completed=[];loading=false;message=e instanceof Error?e.message:'查询失败';onerror(e)}});
 const projectionOptions=$derived({route,today,...display});
 const projection=$derived(projectTaskView([...rows,...completed],projectionOptions));
 const groups=$derived(projection.groups);
 $effect(()=>{const scope=`smart:${accountId}:${route}`,visible=[...rows,...(expanded?completed:[])].map(t=>({id:t.id,board_id:t.board_id}));selectionUntrack(()=>onvisible?.(scope,visible))});
 const query=$derived(taskQuery(smartFilters(route,inboxId)));
 $effect(()=>{void refresh;void expanded;if(route==='inbox'&&!inboxId)return;loading=true;void loader.load(query)});
 onMount(()=>{const resume=()=>{if(!document.hidden)void loader.load(query)};const timer=setInterval(resume,15000);document.addEventListener('visibilitychange',resume);return()=>{loader.stop();clearInterval(timer);document.removeEventListener('visibilitychange',resume)}});
 let capture=$state<TaskCapture|null>(null);
 export function persistRecovery(){capture?.persistRecovery()}
 export function canLeave(){return capture?.canLeave()??true}
 export function leaveGuard(){return captureLeaveGuard(()=>[capture])}
 export function overlayReady(){return capture?.overlayReady()??true}
 export function hasPending(){return capture?.hasPending()??false}
</script>
<section class="smart-tasks" aria-label={labels[route]}>
 <header class="smart-heading"><h1>{labels[route]}</h1><p class="smart-summary" role="status">{loading?'正在查询…':message||`${rows.length} 个未完成任务`}{route==='inbox'?' · 仅你可见':''}</p><ViewOptions value={display} owner={`${accountId}:smart:${route}`} onchange={ondisplay}/></header>
 <TaskCapture {ontemplate} {recovery} {unknown} scope={inboxId&&inboxList?{kind:'capture',boardId:inboxId,listId:inboxList}:null} bind:this={capture} label="添加到收集箱" placeholder="添加到私人收集箱…" onsave={onquick}/>
 <div class="smart-results">
 {#each groups as group (group.key)}
  {#if group.label}<section class="task-date-group" data-group={group.key} aria-label={group.label}><h2 class:overdue={group.key==='overdue'}>{group.label}<span>{group.tasks.length}</span></h2>{#each group.tasks as task (task.id)}{@render row(task)}{/each}</section>
  {:else}{#each group.tasks as task (task.id)}{@render row(task)}{/each}{/if}
 {/each}
 {#if !rows.length&&!loading&&!message}<p class="empty-note">暂时没有任务。</p>{/if}
 </div>
 <button class="completed-toggle" aria-expanded={expanded} onclick={()=>expanded=!expanded}>{expanded?'收起已完成':'展开已完成'}</button>
 {#if expanded}<p class="completed-note">按任务日期匹配，不代表在这一天完成。</p><div class="smart-completed">{#each projection.completed as task (task.id)}{@render row(task)}{:else}<p class="muted">没有匹配的已完成任务。</p>{/each}</div>{/if}
</section>
{#snippet row(task:TaskResult)}
 {@const date=cardSchedule(task,new Date())}
 {@const end=task.schedule?.end_date||task.schedule?.start_date||task.due_date}
 <div class="smart-row" class:task-done={task.completed} data-task-id={task.id}>
  {#if selecting}<label class="bulk-check"><input type="checkbox" aria-label={`选择 ${task.title}`} checked={selected.some(s=>s.id===task.id)} onchange={()=>onselect?.({id:task.id,board_id:task.board_id})}/><span>选择</span></label>{/if}
  <label class="smart-check"><input type="checkbox" aria-label={`${task.completed?'撤销完成':'完成'} ${task.title}`} checked={task.completed} disabled={pendingCards.includes(task.id)} onchange={async e=>{const el=e.currentTarget;if(!await oncomplete(task))el.checked=task.completed}}/></label>
  <button class="task-result" onclick={e=>onopen(task,e.currentTarget)}>
   <span class="task-words"><strong>{task.title}</strong><span class="task-source">{task.board_id===inboxId?'私人收集箱':task.board_title+' / '+task.list_title}{task.assignee_name?' · '+task.assignee_name:''}</span></span>
   {#if date}<span class="card-schedule" class:overdue={!task.completed&&!!end&&end<today} title={date.title}>{date.label}</span>{/if}
  </button>
 </div>
{/snippet}
