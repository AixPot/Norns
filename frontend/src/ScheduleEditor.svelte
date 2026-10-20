<script lang="ts">
 import type {ScheduleDraft} from './types';
 import {scheduleDraft,scheduleValidation} from './schedule-draft.mjs';
 let {value,completed,onchange,onblur}:{value:ScheduleDraft;completed:boolean;onchange:()=>void;onblur:()=>void}=$props();
 const message=$derived(scheduleValidation(value));
</script>
<section class="task-editor schedule-editor" data-editor="schedule"><h3>日期与重复</h3><p class="muted">Asia/Shanghai · 无通知。留空时间即全天；结束日期可选。</p>
{#if completed}<p role="status">请先撤销完成，再修改日期或重复规则。</p>{/if}
<form onsubmit={e=>{e.preventDefault();onblur()}} oninput={()=>{value.enabled=true;onchange()}} onchange={()=>{value.enabled=true;onchange()}} onfocusout={onblur}><fieldset disabled={completed} style="border:0;padding:0;margin:0;min-width:0;display:flex;flex-direction:column;gap:12px">
 <div class="move-fields"><label>开始日期<input aria-label="开始日期" type="date" required bind:value={value.start}/></label><label>开始时间<input aria-label="开始时间" type="time" bind:value={value.startTime}/></label><label>结束日期<input aria-label="结束日期" type="date" bind:value={value.end}/></label><label>结束时间<input aria-label="结束时间" type="time" bind:value={value.endTime}/></label></div>
 <label>重复<select aria-label="重复" bind:value={value.unit}><option value="">不重复</option><option value="day">每天 / 每 N 天</option><option value="week">每周 / 每 N 周</option><option value="month">每月 / 每 N 月</option><option value="year">每年</option></select></label>
 {#if value.unit}<div class="move-fields"><label>间隔<input aria-label="重复间隔" type="number" min="1" max="1000" required bind:value={value.interval}/></label><label>重复基准<select aria-label="重复基准" bind:value={value.mode}><option value="calendar">按计划日期</option><option value="relative">从完成时起</option></select></label></div>
 {#if value.unit==='week'}<fieldset><legend>每周日期</legend><div class="weekdays">{#each ['一','二','三','四','五','六','日'] as day,i}<label><input type="checkbox" aria-label={`周${day}`} checked={value.weekdays.includes(i)} onchange={e=>{value.weekdays=e.currentTarget.checked?[...value.weekdays,i].sort():value.weekdays.filter(d=>d!==i)}}/>{day}</label>{/each}</div></fieldset>{/if}
 <label>重复结束<select aria-label="重复结束" bind:value={value.ending}><option value="never">永不</option><option value="until">截至日期</option><option value="count">总次数（包含本次）</option></select></label>
 {#if value.ending==='until'}<label>截至日期<input aria-label="重复截至日期" type="date" required bind:value={value.until}/></label>{:else if value.ending==='count'}<label>总次数<input aria-label="重复总次数" type="number" min="1" required bind:value={value.count}/></label>{/if}
 <p class="muted">完成后只创建下一次任务。按计划会跳过已过期日期，跳过的日期不占次数。月末按最后一天，仍保留原始日期锚点。下一次已有操作时，本次完成将不能撤销。</p>{/if}
 <div class="item-actions"><button type="button" onclick={()=>{Object.assign(value,scheduleDraft(null));onchange();onblur()}}>清除日期和重复</button></div></fieldset>
</form>{#if message}<p role="alert">{message} 输入已保留；修正后自动保存，或清除日期和重复。</p>{/if}</section>

<style>
 /* Shrink grid items AND native date/time controls; do not clip their contents. */
 .schedule-editor,.schedule-editor form,.schedule-editor fieldset,.schedule-editor label{min-width:0;max-width:100%;box-sizing:border-box}
 .schedule-editor .move-fields{grid-template-columns:repeat(2,minmax(0,1fr));min-width:0}
 .schedule-editor input,.schedule-editor select{min-width:0;max-width:100%;box-sizing:border-box}
 /* A native date control needs more than half a narrow sheet to remain usable. */
 @media(max-width:640px){.schedule-editor .move-fields{grid-template-columns:minmax(0,1fr)}}
</style>
