<script lang="ts">
 import {untrack} from 'svelte';
 import {api} from './api';
 import {createPoller} from './collaboration.mjs';
 import {calendarRange,shiftCalendar,shanghaiToday,projectCalendar,layoutTimed} from './calendar.mjs';
 import type {BoardSummary,TaskResult,TaskDiscoveryResponse} from './types';
 let {date=$bindable(),mode=$bindable(),boardId=$bindable(),boards=$bindable(),onopen,onerror,onfilter,refresh=0}:{date:string;mode:'month'|'week';boardId:string;boards:BoardSummary[];onopen:(task:TaskResult,anchor:HTMLElement)=>void;onerror:(e:unknown)=>void;onfilter:(change:()=>void)=>Promise<void>;refresh?:number}=$props();
 let rows=$state<TaskResult[]>([]),loading=$state(false),message=$state('');
 let displayedQuery='';
 const range=$derived(calendarRange(date,mode));
 const query=$derived(new URLSearchParams({view:'all',status:'all',from:range.from,to:range.to,...(boardId?{board_id:boardId}:{})}).toString());
 type Event={task:TaskResult;start:number;end:number};
 type Day={date:string;allDay:{task:TaskResult}[];timed:Event[]};
 type Placed=Event & {visualEnd:number;lane:number;columns:number};
 const days=$derived(projectCalendar(rows,range) as Day[]);
 const week=$derived(days.map(day=>({...day,laid:layoutTimed(day.timed) as Placed[]})));
 const weekWidth=$derived(48+week.reduce((sum,day)=>sum+Math.max(150,...day.laid.map(item=>item.columns*110)),0));
 const columns=$derived('48px '+week.map(day=>`minmax(${Math.max(150,...day.laid.map(item=>item.columns*110))}px,1fr)`).join(' '));
 const weekdays=['周一','周二','周三','周四','周五','周六','周日'];
 $effect(()=>{
  const q=query;void refresh;
  untrack(()=>{if(q!==displayedQuery)rows=[];displayedQuery=q;message='';loading=true});
  const poll=createPoller({read:()=>api<TaskDiscoveryResponse>(`/tasks?${q}`),apply:(data:TaskDiscoveryResponse)=>{rows=data.tasks;boards=data.boards;loading=false;message='';if(boardId&&!data.boards.some(b=>String(b.id)===boardId))boardId=''},onerror:(e:unknown)=>{rows=[];loading=false;message=e instanceof Error?e.message:'查询失败';onerror(e)},schedule:(fn:()=>void)=>setTimeout(fn,15000)});
  const resume=()=>{void poll.check()};document.addEventListener('visibilitychange',resume);void poll.check();
  return()=>{poll.stop();document.removeEventListener('visibilitychange',resume)};
 });
 function changeBoard(el:HTMLSelectElement){const value=el.value;void onfilter(()=>{boardId=value}).then(()=>{el.value=boardId})}
</script>
<section class="calendar-view" aria-label="跨看板日历">
 <div class="calendar-heading"><h1>日历</h1><label>看板<select aria-label="日历看板" value={boardId} onchange={e=>changeBoard(e.currentTarget)}><option value="">全部看板</option>{#each boards as b}<option value={String(b.id)}>{b.title}</option>{/each}</select></label></div>
 <div class="calendar-controls"><div class="calendar-navigation"><button aria-label={mode==='month'?'上一月':'上一周'} onclick={()=>onfilter(()=>date=shiftCalendar(date,mode,-1))}>←</button><button onclick={()=>onfilter(()=>date=shanghaiToday())}>今天</button><button aria-label={mode==='month'?'下一月':'下一周'} onclick={()=>onfilter(()=>date=shiftCalendar(date,mode,1))}>→</button></div><h2 aria-live="polite">{mode==='month'?`${date.slice(0,4)}年 ${Number(date.slice(5,7))}月`:`${range.from} — ${range.to}`}</h2><div class="calendar-modes" aria-label="日历视图"><button aria-pressed={mode==='month'} onclick={()=>onfilter(()=>mode='month')}>月</button><button aria-pressed={mode==='week'} onclick={()=>onfilter(()=>mode='week')}>周</button></div></div>
 <p class="calendar-hint">Asia/Shanghai · 周一开始 · 未归档任务，含已完成 · 跨日含起止日 · 仅实际重复实例，无日期不显示</p>
 <p class="calendar-hint">窄屏可在日历内左右滑动查看其余日期；周视图可上下滚动查看时间。</p>
 <p class="calendar-status" role="status">{loading?'正在查询…':message||`${rows.length} 个任务`}</p>
 {#if mode==='month'}
 <!-- Scroll regions are keyboard focusable so arrow keys can pan without a mouse. -->
 <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
 <div class="month-scroll" tabindex="0" role="region" aria-label="月历网格"><div class="month-grid">
 {#each weekdays as label}<div class="month-weekday">{label}</div>{/each}
 {#each days as day (day.date)}<section class="month-day" class:outside={day.date.slice(0,7)!==date.slice(0,7)} class:today={day.date===shanghaiToday()} aria-label={day.date} data-date={day.date}><h3><time datetime={day.date}>{day.date.endsWith('-01')?`${Number(day.date.slice(5,7))}/`:''}{Number(day.date.slice(8))}</time></h3>{#each [...day.allDay,...day.timed] as item (item.task.id)}<button class="calendar-task" class:completed={item.task.completed} onclick={e=>onopen(item.task,e.currentTarget)}>{item.task.title}</button>{/each}</section>{/each}
 </div></div>
 {:else}
 <p class="calendar-hint">无时间在全天区；单端点按该时刻展示 30 分钟，跨日缺失端点按日界展示；仅视觉布局，不改任务时间。</p>
 <!-- Scroll regions are keyboard focusable so arrow keys can pan without a mouse. -->
 <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
 <div class="week-scroll" tabindex="0" role="region" aria-label="周时间日历"><div class="week-grid" style:grid-template-columns={columns} style:min-width={`${weekWidth}px`}>
 <div class="week-corner">时间</div>{#each week as day,i}<div class="week-date" class:today={day.date===shanghaiToday()}><span>{weekdays[i]}</span><time datetime={day.date}>{day.date.slice(5).replace('-','/')}</time></div>{/each}
 <div class="all-day-label">全天</div>{#each week as day}<div class="all-day" data-date={day.date}>{#each day.allDay as item (item.task.id)}<button class="calendar-task" class:completed={item.task.completed} onclick={e=>onopen(item.task,e.currentTarget)}>{item.task.title}</button>{/each}</div>{/each}
 <div class="time-axis">{#each Array(24) as _,hour}<span style:top={`${hour*72}px`}>{String(hour).padStart(2,'0')}:00</span>{/each}</div>
 {#each week as day}<div class="time-day" data-date={day.date}>{#each day.laid as item (item.task.id)}<button class="calendar-task timed" class:completed={item.task.completed} style:top={`${item.start*1.2}px`} style:height={`${(item.visualEnd-item.start)*1.2}px`} style:left={`calc(${item.lane/item.columns*100}% + 2px)`} style:width={`calc(${100/item.columns}% - 4px)`} onclick={e=>onopen(item.task,e.currentTarget)}>{item.task.title}</button>{/each}</div>{/each}
 </div></div>
 {/if}
</section>
<style>
 .calendar-view{min-width:0}.calendar-heading{display:flex;justify-content:space-between;align-items:center;gap:16px}.calendar-heading label{width:220px;max-width:55%}.calendar-controls{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0 10px}.calendar-navigation,.calendar-modes{display:flex;gap:5px}.calendar-controls button{min-width:44px;min-height:44px}.calendar-controls h2{font-size:18px}.calendar-modes [aria-pressed=true]{background:#24654c;color:white}.calendar-hint{font-size:12px;color:#576e61;margin:8px 0}.calendar-status{min-height:28px;font-size:13px;color:#576e61}.month-scroll,.week-scroll{border:1px solid #dce4df;border-radius:10px;overflow:auto;background:white}.month-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));min-width:560px}.month-weekday{text-align:center;padding:10px;background:#edf3ef;font-size:12px}.month-day{border-top:1px solid #e3e9e5;border-right:1px solid #e3e9e5;min-height:125px;padding:5px;min-width:0}.month-day h3{font-size:12px;padding:4px;color:#526b5d}.outside{background:#f7f9f7}.today h3,.week-date.today{color:#14613f;background:#e8f3eb}.calendar-task{display:block;width:100%;text-align:left;white-space:normal;overflow-wrap:anywhere;font-size:12px;font-weight:550;padding:6px;border:1px solid #bed4c5;background:#e9f3ed;border-radius:5px;margin:4px 0;line-height:1.4;min-height:36px;color:#234c36}.calendar-task:hover{background:#dcece1;border-color:#759e85}.calendar-task.completed{background:#f2f5f2;color:#647769;border-color:#dce5df}.week-scroll{max-height:72vh;isolation:isolate;position:relative}.week-grid{display:grid;width:100%}.week-corner,.week-date{position:sticky;top:0;z-index:3;background:#edf3ef;border-bottom:1px solid #dce4df;padding:9px;text-align:center;min-height:60px}.week-date{display:flex;flex-direction:column;font-size:12px}.week-corner{left:0;z-index:4;font-size:11px;padding:12px 3px}.all-day-label,.time-axis{position:sticky;left:0;z-index:2;background:#f7f9f7;font-size:10px;color:#526b5d}.all-day-label{padding:10px 5px}.all-day{min-width:0;border-right:1px solid #e3e9e5;border-bottom:1px solid #dce4df;padding:4px;min-height:48px}.time-axis{height:1728px;border-right:1px solid #dce4df}.time-axis span{position:absolute;left:4px}.time-day{min-width:0;position:relative;height:1728px;border-right:1px solid #dce4df;background:repeating-linear-gradient(to bottom,transparent 0,transparent 71px,#e8ede9 71px,#e8ede9 72px)}.calendar-task.timed{display:flex;align-items:flex-start;justify-content:flex-start;position:absolute;margin:0;overflow:auto;min-height:0;padding:3px 5px}
 @media(max-width:640px){.calendar-heading h1{font-size:26px}.calendar-controls h2{order:3;width:100%;font-size:16px}.calendar-controls{gap:8px}.month-grid{min-width:560px}.month-day{padding:3px;min-height:110px}.calendar-task{font-size:12px}.calendar-hint{line-height:1.6}}
</style>
