<script lang="ts">
 import {onMount} from 'svelte';
 import {api} from './api';
 import {taskQuery,createTaskLoader,reconcileTaskFilters} from './task-discovery.mjs';
 import {cardSchedule} from './card-schedule.mjs';
 import type {BoardSummary,TaskResult,TaskFilters,TaskDiscoveryResponse} from './types';
 let {filters=$bindable(),boards=$bindable(),onopen,onerror,onfilter,refresh=0}:{filters:TaskFilters;boards:BoardSummary[];onopen:(task:TaskResult,anchor:HTMLElement)=>void;onerror:(e:unknown)=>void;onfilter:(change:()=>void)=>Promise<void>;refresh?:number}=$props();
 let rows=$state<TaskResult[]>([]),loading=$state(false),message=$state('');
 let people=$state<{id:number;name:string}[]>([]);
 const loader=createTaskLoader({read:async(q:string)=>{loading=true;message='';return await api<TaskDiscoveryResponse>(`/tasks?${q}`)},apply:(data:TaskDiscoveryResponse)=>{rows=data.tasks;boards=data.boards;people=data.people;loading=false;const next=reconcileTaskFilters(filters,data);if(next!==filters)filters=next},onerror:(e:unknown)=>{rows=[];loading=false;message=e instanceof Error?e.message:'查询失败';onerror(e)}});
 const query=$derived(taskQuery(filters));
 $effect(()=>{void refresh;void loader.load(query)});
 onMount(()=>{const resume=()=>{if(document.visibilityState==='visible')void loader.load(query)};document.addEventListener('visibilitychange',resume);const timer=setInterval(resume,15000);return()=>{loader.stop();clearInterval(timer);document.removeEventListener('visibilitychange',resume)}});
 const changes=new WeakMap<HTMLInputElement|HTMLSelectElement,number>();
 async function filterInput(element:HTMLInputElement|HTMLSelectElement,key:keyof TaskFilters){const value=element.value,token=(changes.get(element)||0)+1;changes.set(element,token);await onfilter(()=>{filters={...filters,[key]:value}});if(changes.get(element)===token)element.value=filters[key];}
 const modes=[['all','搜索任务'],['mine','我的任务'],['today','今天'],['upcoming','即将到期']];
</script>
<section class="task-discovery">
 <h1>任务</h1>
 <nav class="task-tabs" aria-label="任务视图">{#each modes as [value,label]}<button class:active={filters.view===value} onclick={()=>onfilter(()=>{filters={...filters,view:value}})}>{label}</button>{/each}</nav>
 <p class="muted">仅含你所在看板的未归档任务。{filters.view==='mine'?'我的任务：由你负责。':filters.view==='today'?'今天：北京时间今天与任务起止日期相交，不含已逾期任务。':filters.view==='upcoming'?'即将到期：未完成，截止日期在明天至未来第 7 天（含）；范围任务取结束日。':'可组合筛选标题、描述、负责人、完成状态与日期。'}</p>
 <form class="task-filters" onsubmit={e=>{e.preventDefault();onfilter(()=>{filters={...filters}})}}>
 <label>关键词<input aria-label="任务关键词" placeholder="标题或描述" value={filters.q} oninput={e=>{void filterInput(e.currentTarget,'q')}} maxlength="500"/></label>
 <label>负责人<select aria-label="筛选负责人" value={filters.assignee_id} onchange={e=>{void filterInput(e.currentTarget,'assignee_id')}}><option value="">全部负责人</option>{#each people as person}<option value={String(person.id)}>{person.name}</option>{/each}</select></label>
 <label>完成状态<select aria-label="完成状态" value={filters.status} onchange={e=>{void filterInput(e.currentTarget,'status')}}><option value="all">全部</option><option value="incomplete">未完成</option><option value="complete">已完成</option></select></label>
 <label>看板<select aria-label="筛选看板" value={filters.board_id} onchange={e=>{void filterInput(e.currentTarget,'board_id')}}><option value="">全部看板</option>{#each boards as board}<option value={String(board.id)}>{board.title}</option>{/each}</select></label>
 <label>日期从<input type="date" aria-label="筛选开始日期" value={filters.from} onchange={e=>{void filterInput(e.currentTarget,'from')}}/></label><label>日期至<input type="date" aria-label="筛选结束日期" value={filters.to} onchange={e=>{void filterInput(e.currentTarget,'to')}}/></label>
 <button class="secondary" type="button" onclick={()=>onfilter(()=>{filters={q:'',view:'all',status:'all',assignee_id:'',board_id:'',from:'',to:''}})}>清除筛选</button>
 </form>
 <p class="muted">日期按起止范围相交筛选，含边界；可查逾期任务，无日期任务不匹配日期筛选。</p>
 <p role="status">{loading?'正在查询…':message||`${rows.length} 个任务`}</p>
 <div class="task-results" aria-label="任务结果">{#each rows as task (task.id)}{@const date=cardSchedule(task,new Date())}<button class="task-result" onclick={e=>onopen(task,e.currentTarget)}><strong class:task-done={task.completed}>{task.title}</strong><span class="muted">{task.board_title} / {task.list_title}{task.assignee_name?` · ${task.assignee_name}`:''} · {task.completed?'已完成':'未完成'}</span>{#if date}<span class="card-schedule" title={date.title}>{date.label}</span>{/if}</button>{:else}{#if !loading&&!message}<p class="empty-note">没有匹配的任务，试试调整筛选。</p>{/if}{/each}</div>
</section>
<style>
 .task-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.task-tabs .active{background:var(--accent,#425a46);color:white}.task-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;align-items:end}.task-filters label,.task-filters input,.task-filters select{min-width:0;max-width:100%;width:100%;box-sizing:border-box}.task-results{display:grid;gap:10px;max-width:900px}.task-result{text-align:left;display:flex;flex-direction:column;gap:7px;padding:16px;overflow-wrap:anywhere;min-height:76px}.task-done{text-decoration:line-through}.task-result .muted{font-size:13px}.task-discovery{min-width:0}.task-filters button{min-height:44px}
</style>
