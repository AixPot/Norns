<script lang="ts">
 import {onMount} from 'svelte';
 import type {ViewPreferences} from './types';
 let {value,ongroup=true,owner,onchange}:{value:ViewPreferences;ongroup?:boolean;owner:string;onchange:(value:ViewPreferences)=>void}=$props();
 let narrow=$state(false);
 onMount(()=>{const media=matchMedia('(max-width:800px)'),update=()=>{narrow=media.matches;open=false};update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)});
 let open=$state(false),root=$state<HTMLDivElement>();
 $effect(()=>{void owner;open=false});
 function choose(key:'group'|'sort',event:Event){const control=event.currentTarget as HTMLSelectElement;onchange({...value,[key]:control.value})}
</script>
<svelte:window onkeydown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();open=false;root?.querySelector('button')?.focus()}}} onpointerdown={e=>{if(open&&!root?.contains(e.target as Node))open=false}}/>
<div class="view-options" bind:this={root}>
 <button class="text-button" aria-expanded={open} aria-controls="display-options" onclick={()=>open=!open}>显示设置<svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>
 {#if open}<div id="display-options" class="view-options-popover" role="region" aria-label="显示选项">
 {#if ongroup}<label>分组<select aria-label="显示分组" value={value.group} onchange={e=>choose('group',e)}><option value="default">默认</option><option value="none">不分组</option><option value="date">按日期</option><option value="board">按看板</option></select></label>{/if}
 <label>排序<select aria-label="显示排序" value={value.sort} onchange={e=>choose('sort',e)}><option value="manual">手动顺序</option><option value="date">按日期</option></select></label>
 <p>当前：{narrow?'手机／窄屏':'桌面／宽屏'}，两种宽度分别记忆。仅在此浏览器对当前账号生效，不改变共享顺序。</p>
 </div>{/if}
</div>
