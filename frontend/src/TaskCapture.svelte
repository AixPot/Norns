<script module lang="ts">
 // One leave attempt caches approval by mounted instance; each instance owns
 // its edit generation. Re-read the set at every barrier, including new lists.
 export function captureLeaveGuard(read:()=>({leaveGuard:()=>()=>boolean}|null|undefined)[]){
  const checks=new Map<object,()=>boolean>();
  return ()=>read().every(owner=>{
   if(!owner)return true;
   let check=checks.get(owner);
   if(!check){check=owner.leaveGuard();checks.set(owner,check)}
   return check();
  });
 }
</script>
<script lang="ts">
 import {onMount,tick,untrack} from 'svelte';
 import CreationDate from './CreationDate.svelte';
 import {captureContext} from './capture-context.mjs';
 import {parseCapture} from './capture-time.mjs';
 import type {Schedule} from './types';
 let {route='',recovery,scope,unknown=false,label,placeholder='添加任务…',buttonLabel='添加',compact=false,disabled=false,ontemplate,onsave}:{route?:string;recovery?:any;scope?:any;unknown?:boolean;label:string;placeholder?:string;buttonLabel?:string;compact?:boolean;disabled?:boolean;ontemplate?:(restore:()=>void)=>void;onsave:(title:string,schedule?:Schedule)=>Promise<boolean>}=$props();
 let raw=$state(''),candidate=$state<ReturnType<typeof parseCapture>>(null),accepted=$state(false),pending=$state(false),composing=$state(false),message=$state('');
 let choice=$state(''),dateOpen=$state(false);
 let input:HTMLInputElement;let generation=0;
 let recoverable=$state<any>(null),recoveryNote=$state(''),blocked=$state(false);let timer:ReturnType<typeof setTimeout>|undefined,loaded='',loadedOwner:any=null,storedGeneration:number|undefined;
 export function persistRecovery(uncertain=pending){
  if(uncertain&&!blocked){blocked=true;++generation}
  clearTimeout(timer);if(!recovery||recovery.closed||!scope){if(raw)recoveryNote='正在确认草稿保存位置，本地草稿尚未保留，请勿关闭此页';return}if(!raw){if(!recoverable&&storedGeneration!==undefined)recovery.store.removeIfGeneration(scope,storedGeneration);return;}
  const result=recovery.store.put({scope,generation,revision:recoverable?.fresh.revision||0,baseline:{raw:'',acceptedParse:null},fields:{raw,acceptedParse:accepted?candidate:null,explicitDate:choice},unknownCreateOutcome:blocked});
  if(result.ok)storedGeneration=generation;recoveryNote=result.ok?'草稿仅保留在此标签页，尚未添加':'本地草稿未能保留，请勿关闭此页';
 }
 function queueRecovery(){clearTimeout(timer);timer=setTimeout(()=>persistRecovery(false),180)}
 $effect(()=>{const owner=recovery,target=scope;if(!owner||!target)return;const key=JSON.stringify(target);if(loaded===key&&loadedOwner===owner)return;loaded=key;loadedOwner=owner;let active=true;
  untrack(()=>{const cached=owner.store.get(target).record;blocked=!!cached?.unknownCreateOutcome;generation=Math.max(generation,(cached?.generation??0)+1);
   // The capture stays editable during discovery. Preserve raw/accepted state and
   // flush that buffer when its authenticated exact list scope becomes available.
   if(raw)persistRecovery(false);
  });
  void owner.load(target).then((value:any)=>{if(active&&owner===recovery&&!owner.closed)recoverable=value});return()=>{active=false}});
 async function restoreRecovery(){if(!recoverable)return;const owner=recovery,key=JSON.stringify(scope),version=generation,result=await owner.load(scope);if(owner!==recovery||key!==JSON.stringify(scope)||version!==generation)return;if(!result){recoverable=null;return}if(raw&&!confirm('用草稿替换当前尚未添加的输入？'))return;recoverable=result;const r=result.record;raw=r.fields.raw;choice=r.fields.explicitDate||'';candidate=r.fields.acceptedParse;accepted=!!candidate;generation=Math.max(generation,r.generation)+1;blocked=r.unknownCreateOutcome;recoveryNote=blocked?'核对后再操作；结果未知，不会自动重复添加':'已恢复到输入框，尚未添加';queueRecovery();await tick();input?.focus()}
 function discardRecovery(){if(recoverable)recovery.store.removeIfGeneration(scope,recoverable.record.generation);if(blocked&&raw){recovery.store.removeIfGeneration(scope,generation);raw='';candidate=null;accepted=false;++generation}recoverable=null;blocked=false;recoveryNote=''}
 onMount(()=>{const hide=()=>{if(pending&&!blocked){blocked=true;++generation}persistRecovery()};window.addEventListener('pagehide',hide);return()=>{if(raw)persistRecovery();clearTimeout(timer);window.removeEventListener('pagehide',hide)}});
 function edited(){++generation;accepted=false;message='';const options={now:new Date(),timezone:'Asia/Shanghai'};candidate=composing?null:parseCapture(raw,options);queueRecovery()}
 export function overlayReady(){return !pending&&!composing}
 export function hasPending(){return pending||composing||!!raw.trim()||!!choice}
 export function canLeave(){if(pending||composing){message='请先完成当前录入或等待保存结果，再切换。';return false}return (!raw.trim()&&!choice)||confirm('有尚未添加的输入，放弃并切换？')}
 // A leave attempt approves only the generation the user actually confirmed.
 export function leaveGuard(){
  let approved:number|undefined;
  return ()=>{if(pending||composing)return canLeave();if(approved===generation)return true;if(!canLeave())return false;approved=generation;return true};
 }
 function templates(){if(composing||pending||disabled)return;const start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;ontemplate?.(()=>{if(input?.isConnected){input.focus({preventScroll:true});input.setSelectionRange(start,end,direction||undefined)}})}
 async function save(){
  if(blocked||pending||composing||disabled||!raw.trim()||(accepted&&candidate?.emptyTitle))return;
  const version=generation,text=raw,parsed=accepted?candidate:null,start=input.selectionStart,end=input.selectionEnd,direction=input.selectionDirection;
  const context=captureContext(route,parsed?.schedule,choice,new Date());
  if(context.needsChoice){dateOpen=true;message='请选择任务日期；未创建，标题已保留。';return}
  persistRecovery();pending=true;message='';
  try{
   const ok=await onsave(parsed?parsed.remainingTitle:text,context.schedule);
   if(!ok){blocked=unknown;if(blocked)++generation;persistRecovery(false);const r=recovery?.store.get(scope).record;if(r)recoverable={record:r,fresh:recoverable?.fresh||{revision:0}}}
   if(version!==generation){if(ok){recovery?.store.removeIfGeneration(scope,version);persistRecovery(false)}return;}
   if(ok){clearTimeout(timer);recovery?.store.removeIfGeneration(scope,version);recoverable=null;recoveryNote='';raw='';candidate=null;accepted=false;choice='';dateOpen=false;message=context.notice;++generation;await tick();if(input?.isConnected)input.focus({preventScroll:true})}
   else {message='未确认保存，输入已保留。请核对错误后再操作。';await tick();if(input?.isConnected){input.focus({preventScroll:true});input.setSelectionRange(start,end,direction||undefined)}}
  }catch{blocked=true;persistRecovery();if(version===generation)message='未确认保存，输入已保留。请核对结果，勿重复添加。'}
  finally{pending=false}
 }
</script>
<form class:quick-inbox={!compact} class:add-card={compact} class="task-capture" onsubmit={e=>{e.preventDefault();void save()}}>
 {#if recoverable}<div class="draft-recovery" role="status"><span>{blocked?'核对后再操作':'有此标签页保留的草稿'}</span><button type="button" onclick={restoreRecovery}>恢复草稿</button><button type="button" onclick={discardRecovery}>丢弃草稿</button></div>{/if}
 <div class="capture-entry"><input bind:this={input!} aria-label={label} {placeholder} bind:value={raw} oninput={edited} oncompositionstart={()=>{++generation;composing=true;accepted=false;candidate=null}} oncompositionend={()=>{composing=false;edited()}} onkeydown={e=>{if(e.key==='Enter'&&(composing||e.isComposing||e.keyCode===229))e.preventDefault()}} required maxlength="160"/><button class="capture-secondary" aria-label={buttonLabel} aria-busy={pending} title={pending?'正在添加任务':blocked?'请先核对上次添加结果':disabled?'当前操作暂不可用':!raw.trim()?'先输入任务名称':accepted&&candidate?.emptyTitle?'请补充任务名称':undefined} disabled={blocked||disabled||pending||!raw.trim()||(accepted&&candidate?.emptyTitle)}><span aria-hidden="true">＋</span><span>{pending?'添加中…':'添加'}</span></button>{#if ontemplate}<button class="capture-secondary" type="button" aria-label="从私人模板创建" disabled={composing||pending||disabled} onclick={templates}><span aria-hidden="true">▧</span><span>模板</span></button>{/if}</div>
 {#if route==='today'||route==='tomorrow'||route==='next7'}<button type="button" class="capture-date-toggle" aria-expanded={dateOpen||route==='next7'} onclick={()=>dateOpen=!dateOpen}><span aria-hidden="true">▦</span> 日期{choice?' · '+choice:''}</button>
 {#if dateOpen||route==='next7'}<CreationDate {route} bind:value={choice} onchange={()=>{++generation;message='';queueRecovery()}}/>{/if}
 {:else if choice}<div class="capture-preview capture-restored-date"><span class="capture-date">已恢复日期：{choice}（北京时间）{accepted&&candidate?' · 当前采用识别日期；取消识别后使用此日期':''}</span><button type="button" onclick={()=>{choice='';++generation;message='';queueRecovery();input.focus()}}>取消恢复日期</button></div>{/if}
 {#if candidate}<div class="capture-preview" class:accepted aria-label="识别的日期"><span class="capture-date">{candidate.schedule.start_date}{candidate.schedule.start_time?' '+candidate.schedule.start_time:''} · 上海时间</span>{#if !accepted}<button type="button" onclick={()=>{++generation;accepted=true;queueRecovery();input.focus()}}>采用日期</button>{:else}<span class="capture-adopted">已采用</span>{/if}<button type="button" onclick={()=>{++generation;candidate=null;accepted=false;queueRecovery();input.focus()}}>取消日期</button>{#if accepted}<span class="capture-title">{candidate.emptyTitle?'请补充任务标题':'任务：'+candidate.remainingTitle}</span>{/if}</div>{/if}
 {#if recoveryNote}<p class="capture-message" role="status">{recoveryNote}</p>{/if}
 {#if message}<p class="capture-message" role="status">{message}</p>{/if}
</form>
<style>
 .capture-entry>.capture-secondary{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:6px 9px;min-height:44px;background:var(--surface-muted);border:1px solid var(--border);border-radius:8px;color:var(--secondary);box-shadow:none;font-size:13px}.capture-entry>.capture-secondary span:first-child{font-size:18px}.capture-date-toggle{margin-top:6px;background:transparent;border:0;box-shadow:none;padding:3px 8px;font-size:12px;min-height:36px}
 .capture-entry>.capture-secondary:disabled{cursor:default}.capture-entry>.capture-secondary[aria-busy=true]{cursor:wait}.capture-entry>.capture-secondary:not(:disabled):hover{background:var(--border);color:var(--text)}
 .task-capture{display:block;min-width:0}.capture-entry{display:flex;gap:8px;min-width:0}.capture-entry input{flex:1;min-width:0;width:0}.capture-entry>button{flex:none}.capture-preview{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-top:8px;font-size:13px;color:var(--secondary)}.capture-date{font-variant-numeric:tabular-nums}.capture-preview button{font-size:13px;min-height:36px;padding:4px 8px;background:transparent;color:var(--accent-text);border:1px solid var(--border);border-radius:8px}.capture-adopted{color:var(--accent-text)}.capture-title{flex-basis:100%;overflow-wrap:anywhere;color:var(--text)}.capture-message{margin:8px 0 0;font-size:13px;color:var(--secondary)}
 @media(max-width:800px){.capture-preview button{min-height:44px}}
</style>
