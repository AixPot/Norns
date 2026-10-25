<script lang="ts">
 import {completionRows,completionLayout} from "./completion-motion.mjs";
 import {untrack as selectionUntrack} from 'svelte';
 import type {SelectionProps} from './types';
 import {onMount} from 'svelte';
 import ViewOptions from './ViewOptions.svelte';
 import {projectTaskView} from './task-view.mjs';
 import type {ViewPreferences} from './types';
 import {api} from './api';
 import {taskQuery,createTaskLoader,reconcileTaskFilters} from './task-discovery.mjs';
 import {cardSchedule} from './card-schedule.mjs';
 import type {BoardSummary,TaskResult,TaskFilters,TaskDiscoveryResponse} from './types';
 let {completionMotion=[],selecting=false,selected=[],onselect,onvisible,accountId,display,ondisplay,filters=$bindable(),boards=$bindable(),onopen,onerror,onfilter,onmetadata,refresh=0}:SelectionProps & {completionMotion?:any[];accountId:number;display:ViewPreferences;ondisplay:(value:ViewPreferences)=>void;filters:TaskFilters;boards:BoardSummary[];onopen:(task:TaskResult,anchor:HTMLElement)=>void;onmetadata:(data:TaskDiscoveryResponse)=>void;onerror:(e:unknown)=>void;onfilter:(change:()=>void)=>Promise<void>;refresh?:number}=$props();
 let rows=$state<TaskResult[]>([]),loading=$state(false),message=$state('');
 let privateScope=$state<BoardSummary|null>(null);
 let people=$state<{id:number;name:string}[]>([]);
 const loader=createTaskLoader({read:async(q:string)=>{loading=true;message='';return await api<TaskDiscoveryResponse>(`/tasks?${q}`)},apply:(data:TaskDiscoveryResponse)=>{rows=data.tasks;privateScope=data.inbox;boards=data.boards;people=data.people;onmetadata(data);loading=false;const next=reconcileTaskFilters(filters,data);if(next!==filters)filters=next},onerror:(e:unknown)=>{rows=[];loading=false;message=e instanceof Error?e.message:'查询失败';onerror(e)}});
 $effect(()=>{const scope=`search:${accountId}:${taskQuery(filters)}`,visible=rows.map(t=>({id:t.id,board_id:t.board_id}));selectionUntrack(()=>onvisible?.(scope,visible))});
 const query=$derived(taskQuery(filters));
 const projection=$derived(projectTaskView(completionRows(rows,completionMotion),{route:'search',...display}));
 $effect(()=>{void refresh;void loader.load(query)});
 onMount(()=>{const resume=()=>{if(document.visibilityState==='visible')void loader.load(query)};document.addEventListener('visibilitychange',resume);const timer=setInterval(resume,15000);return()=>{loader.stop();clearInterval(timer);document.removeEventListener('visibilitychange',resume)}});
 const changes=new WeakMap<HTMLInputElement|HTMLSelectElement,number>();
 async function filterInput(element:HTMLInputElement|HTMLSelectElement,key:keyof TaskFilters){const value=element.value,token=(changes.get(element)||0)+1;changes.set(element,token);await onfilter(()=>{filters={...filters,[key]:value}});if(changes.get(element)===token)element.value=filters[key];}
 const modes=[['all','搜索任务'],['mine','我的任务'],['today','今天'],['tomorrow','明天'],['next7','最近七天'],['upcoming','即将到期']];
</script>
<section class="task-discovery">
 <header class="smart-heading"><h1>任务</h1><ViewOptions value={display} owner={`${accountId}:search:all`} onchange={ondisplay}/></header>
 <nav class="task-tabs" aria-label="任务视图">{#each modes as [value,label]}<button class:active={filters.view===value} onclick={()=>onfilter(()=>{filters={...filters,view:value}})}>{label}</button>{/each}</nav>
 <p class="muted">仅含你所在看板的未归档任务。{filters.view==='mine'?'我的任务：由你负责。':filters.view==='today'?'今天：北京时间今天进行中与已逾期任务。':filters.view==='upcoming'?'即将到期：未完成，截止日期在明天至未来第 7 天（含）；范围任务取结束日。':'可组合筛选标题、描述、负责人、完成状态与日期。'}</p>
 <form class="task-filters" onsubmit={e=>{e.preventDefault();onfilter(()=>{filters={...filters}})}}>
 <label>关键词<input aria-label="任务关键词" placeholder="标题或描述" value={filters.q} oninput={e=>{void filterInput(e.currentTarget,'q')}} maxlength="500"/></label>
 <label>负责人<select aria-label="筛选负责人" value={filters.assignee_id} onchange={e=>{void filterInput(e.currentTarget,'assignee_id')}}><option value="">全部负责人</option>{#each people as person}<option value={String(person.id)}>{person.name}</option>{/each}</select></label>
 <label>完成状态<select aria-label="完成状态" value={filters.status} onchange={e=>{void filterInput(e.currentTarget,'status')}}><option value="all">全部</option><option value="incomplete">未完成</option><option value="complete">已完成</option></select></label>
 <label>看板<select aria-label="筛选看板" value={filters.board_id} onchange={e=>{void filterInput(e.currentTarget,'board_id')}}><option value="">全部看板</option>{#if privateScope}<option value={String(privateScope.id)}>私人收集箱</option>{/if}{#each boards as board}<option value={String(board.id)}>{board.title}</option>{/each}</select></label>
 <label>日期从<input type="date" aria-label="筛选开始日期" value={filters.from} onchange={e=>{void filterInput(e.currentTarget,'from')}}/></label><label>日期至<input type="date" aria-label="筛选结束日期" value={filters.to} onchange={e=>{void filterInput(e.currentTarget,'to')}}/></label>
 <button class="secondary" type="button" onclick={()=>onfilter(()=>{filters={q:'',view:'all',status:'all',assignee_id:'',board_id:'',from:'',to:''}})}>清除筛选</button>
 </form>
 <p class="muted">日期按起止范围相交筛选，含边界；可查逾期任务，无日期任务不匹配日期筛选。</p>
 <p role="status">{loading?'正在查询…':message||`${rows.length} 个任务`}</p>
 <div use:completionLayout class="task-results" aria-label="任务结果">
 {#each projection.groups as group (group.key)}<section data-group={group.key} class="task-date-group">{#if group.label}<h2>{group.label}<span>{group.tasks.length}</span></h2>{/if}{#each group.tasks as task (task.id)}{@render row(task)}{/each}</section>{/each}
 {#if projection.completed.length}<section class="smart-completed" aria-label="已完成任务"><h2>已完成 <span>{projection.completed.length}</span></h2>{#each projection.completed as task (task.id)}{@render row(task)}{/each}</section>{/if}
 {#if !rows.length&&!loading&&!message}<p class="empty-note">没有匹配的任务，试试调整筛选。</p>{/if}</div>

</section>
{#snippet row(task:TaskResult)}{@const date=cardSchedule(task,new Date())}<div class="bulk-result-row" data-completion-id={task.id} data-completion-phase={completionMotion.find(e=>e.id===task.id)?.phase||''}>{#if selecting}<label class="bulk-check"><input type="checkbox" aria-label={`选择 ${task.title}`} checked={selected.some(s=>s.id===task.id)} onchange={()=>onselect?.({id:task.id,board_id:task.board_id})}/><span>选择</span></label>{/if}<button class="task-result" data-task-id={task.id} onclick={e=>onopen(task,e.currentTarget)}><strong class:task-done={task.completed}>{task.title}</strong><span class="muted">{task.board_title} / {task.list_title}{task.assignee_name?` · ${task.assignee_name}`:''} · {task.completed?'已完成':'未完成'}</span>{#if date}<span class="card-schedule" title={date.title}>{date.label}</span>{/if}</button></div>{/snippet}

<style>
 .task-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.task-tabs .active{background:var(--accent);color:var(--on-accent)}.task-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;align-items:end}.task-filters label,.task-filters input,.task-filters select{min-width:0;max-width:100%;width:100%;box-sizing:border-box}.task-results{display:grid;gap:10px;max-width:900px}.task-result{text-align:left;display:flex;flex-direction:column;gap:7px;padding:16px;overflow-wrap:anywhere;min-height:76px}.task-done{text-decoration:line-through}.task-result .muted{font-size:13px}.task-discovery{min-width:0}.task-filters button{min-height:44px}
</style>