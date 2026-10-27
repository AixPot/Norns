<script lang="ts">
 import {captureContext} from './capture-context.mjs';
 let {route='',value=$bindable(''),onchange=()=>{}}:{route?:string;value?:string;onchange?:()=>void}=$props();
 let dates=$state<string[]>([]);
 function refresh(){dates=captureContext(route,undefined,'',new Date()).dates}
 $effect(()=>{void route;refresh()});
</script>
<div class="creation-date">
 {#if route==='next7'}<label>七天内日期<select aria-label="七天内日期" value={dates.includes(value)?value:''} onfocus={refresh} onchange={e=>{value=e.currentTarget.value;onchange()}}><option value="">请选择日期…</option>{#each dates as date}<option value={date}>{date}</option>{/each}</select></label>{/if}
 <label>{route==='next7'?'或指定其他日期':'指定日期（可选）'}<input type="date" aria-label="任务日期" bind:value oninput={onchange}/></label>
 {#if value}<button type="button" class="secondary" onclick={()=>{value='';onchange()}}>取消日期</button>{/if}
 <span>{route==='today'?'未指定时按提交时北京时间今天':route==='tomorrow'?'未指定时按提交时北京时间明天':route==='next7'?'请选择日期后再添加；取消不会创建':'北京时间'}</span>
</div>
<style>.creation-date{display:flex;align-items:end;gap:8px;flex-wrap:wrap;margin:8px 0;font-size:12px;color:var(--secondary)}.creation-date label{display:flex;flex-direction:column;gap:4px;min-width:0}.creation-date input,.creation-date select{min-height:44px;max-width:100%;min-width:0}.creation-date span{flex-basis:100%}.creation-date button{min-height:44px}</style>
