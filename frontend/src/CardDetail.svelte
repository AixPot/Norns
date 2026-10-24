<script lang="ts">
 import type {Snippet} from 'svelte';
 import {cardSlots,slotKey} from './drag-order.mjs';
 import {onMount,untrack,tick} from 'svelte';
 import './task-panel.css';
 import ScheduleEditor from './ScheduleEditor.svelte';
 import Attachments from './Attachments.svelte';
 import {positionPanel} from './panel-position.mjs';
 import type {Board,Draft,Card} from './types';
 type Props={positionDisabled?:boolean;suspended?:boolean;detailRecovery?:any;recoveryHold?:boolean;recoveryReview?:boolean;recoveryMessage?:string;onrestore:()=>void;ondiscard:()=>void;onconfirmsave:()=>void;onauxiliary:(value:any)=>void;onuncertain:()=>void;onsavetemplate?:()=>Promise<void>;ontransfer?:()=>Promise<void>;feedback?:Snippet;draft:Draft;board:Board;busy:boolean;anchor:HTMLElement|null;saveState:string;saveError:string;review:Board|null;userId:number;onclose:()=>void;onchange:(immediate?:boolean)=>void;onblur:()=>Promise<boolean>;oncomposition:(active:boolean)=>void;onretry:()=>void;onreview:()=>void;onrebase:()=>void;oncancelreview:()=>void;onaction:(data:Record<string,unknown>)=>Promise<boolean>};
 let {positionDisabled=false,suspended=false,detailRecovery,recoveryHold=false,recoveryReview=false,recoveryMessage='',onrestore,ondiscard,onconfirmsave,onauxiliary,onuncertain,ontransfer,onsavetemplate,feedback,draft,board,busy,anchor,saveState,saveError,review,userId,onclose,onchange,onblur,oncomposition,onretry,onreview,onrebase,oncancelreview,onaction}:Props=$props();
 let panel:HTMLDivElement,body:HTMLDivElement;let auxiliaryComposition=$state(false);let lastEditor:HTMLElement|undefined;
 let returnSelection:{node:HTMLInputElement|HTMLTextAreaElement;start:number|null;end:number|null;direction:string|null}|undefined;
 export function snapshotFocus(){const node=lastEditor as HTMLInputElement|HTMLTextAreaElement;if(node?.matches('input,textarea'))returnSelection={node,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection};return resumeFocus}
 export function resumeFocus(){if(lastEditor?.isConnected){lastEditor.focus({preventScroll:true});if(returnSelection?.node===lastEditor){try{returnSelection.node.setSelectionRange(returnSelection.start,returnSelection.end,returnSelection.direction as any)}catch{}returnSelection=undefined}}else panel?.focus({preventScroll:true})}
 export function overlayReady(){return !composing&&!auxiliaryComposition&&!actionPending&&!transferPending}

 $effect(()=>{if(suspended)untrack(snapshotFocus);if(!suspended)untrack(layout)});let titleInput=$state<HTMLInputElement>(),descriptionInput=$state<HTMLTextAreaElement>();
 let editor=$state(''),more=$state(false),localError=$state(''),composing=$state(false);
 let position=$state({left:12,top:12}),viewport=$state({height:0,top:0,mobile:false});
 let target=$state(untrack(()=>draft.list_id)),index=$state(''),newItem=$state(''),comment=$state(''),renaming=$state(0),itemTitle=$state('');
 let renameGeneration=0,newItemGeneration=0,commentGeneration=0;
 let attachments=$state<Attachments|null>(null),actionPending=$state(false),transferPending=$state(false);
 async function transfer(){if(transferPending||actionPending)return;transferPending=true;try{await ontransfer?.()}catch(e){localError=e instanceof Error?e.message:'转移准备失败，请重试'}finally{transferPending=false}}
 export function restoreAux(value:any){renameGeneration++;newItemGeneration++;commentGeneration++;comment=value.comment;newItem=value.newItem;itemTitle=value.itemTitle;renaming=value.renaming;editor=value.renaming||value.newItem?'checklist':value.comment?'comment':'schedule'}
 let auxSnapshot='';
 $effect(()=>{const value={comment,newItem,itemTitle,renaming},key=JSON.stringify(value);if(key!==auxSnapshot){auxSnapshot=key;untrack(()=>onauxiliary(value))}});
 const moveSlots=$derived(cardSlots(board,draft.id,Number(target)));
 const selectedSlot=$derived(moveSlots.find((s:any)=>slotKey(s)===index)||moveSlots[0]);
 const items=$derived(board.checklist.filter(i=>i.card_id===draft.id));
 const comments=$derived(board.comments.filter(c=>c.card_id===draft.id));
 const remote=$derived(review?.cards.find(c=>c.id===draft.id));
 const tools=[{id:'people',label:'负责人',path:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8h5M19.5 5.5v5'},{id:'checklist',label:'添加清单条目',path:'m3 6 2 2 4-4M12 6h9M3 13h6M12 13h9M3 20h6M12 20h9'},{id:'comment',label:'发表评论',path:'M21 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10Z'},{id:'attachment',label:'添加附件',path:'m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9M6 14l8-8'},{id:'move',label:'移动卡片',path:'M12 3v18M3 12h18m-4-4 4 4-4 4M8 7l4-4 4 4M8 17l4 4 4-4'}];
 function growDescription(){if(descriptionInput){descriptionInput.style.height="0px";descriptionInput.style.height=descriptionInput.scrollHeight+2+"px"}}
 $effect(()=>{draft.description;untrack(()=>{void tick().then(growDescription)})});
 function layout(){
  const vv=window.visualViewport;viewport={height:vv?.height||window.innerHeight,top:vv?.offsetTop||0,mobile:window.innerWidth<=640};
  const shell=document.querySelector<HTMLElement>('.app-shell');if(shell&&!suspended)shell.inert=viewport.mobile;
  if(panel&&anchor)position=positionPanel(anchor.getBoundingClientRect(),panel.offsetWidth,panel.offsetHeight,window.innerWidth,window.innerHeight);
  if(viewport.mobile)void tick().then(()=>{
   const focused=document.activeElement as HTMLElement;
   if(body?.contains(focused)&&focused.matches('input,textarea,select')){
    const field=focused.getBoundingClientRect(),bounds=body.getBoundingClientRect();
    if(field.bottom>bounds.bottom-12)body.scrollTop+=field.bottom-bounds.bottom+12;
    else if(field.top<bounds.top+12)body.scrollTop-=bounds.top+12-field.top;
   }
  });
 }
 onMount(()=>{
  panel.focus({preventScroll:true});growDescription();layout();const observer=new ResizeObserver(layout);observer.observe(panel);
  const outside=(e:PointerEvent)=>{if(suspended)return;const el=e.target as HTMLElement;if(!panel.contains(el)&&!el.closest('.selection-toolbar,.view-options,.card,.archived-card,.calendar-view button,.calendar-view select,.completion-toast,.smart-row,.three-pane-nav,.function-rail,.mobile-navigation')&&!composing)onclose()};
  const keyboard=(e:KeyboardEvent)=>{
   if(suspended||e.isComposing||composing||(e.target as Element)?.closest('.view-options'))return;
   if(e.key==='Escape'){e.preventDefault();if(more)more=false;else onclose()}
   if(viewport.mobile&&e.key==='Tab'){
    const nodes=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]')).filter(n=>n.getClientRects().length);
    const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===panel)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}
   }
  };
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard);window.addEventListener('resize',layout);window.addEventListener('scroll',layout,true);window.visualViewport?.addEventListener('resize',layout);window.visualViewport?.addEventListener('scroll',layout);
  return()=>{const shell=document.querySelector<HTMLElement>('.app-shell');if(shell&&!suspended)shell.inert=false;observer.disconnect();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard);window.removeEventListener('resize',layout);window.removeEventListener('scroll',layout,true);window.visualViewport?.removeEventListener('resize',layout);window.visualViewport?.removeEventListener('scroll',layout);if(!suspended&&anchor?.isConnected)(anchor.matches('button')?anchor:anchor.querySelector<HTMLElement>('button'))?.focus({preventScroll:true})};
 });
 async function openEditor(id:string){if(editor==='schedule'&&!recoveryHold&&!await onblur())return;editor=editor===id?'':id;more=false;await tick();if(id==='description'){titleInput?.focus()}else body.querySelector<HTMLElement>(`[data-editor="${id}"] input,[data-editor="${id}"] textarea,[data-editor="${id}"] select`)?.focus();}
 function editorBlur(event?:FocusEvent){if((event?.relatedTarget as Element|null)?.closest('.view-options'))return;return onblur()}
 function composition(active:boolean){composing=active;oncomposition(active)}
 export function transferReady(){if(composing||auxiliaryComposition||hasPending()){localError='请先完成输入，并发送或清空未发送的评论、清单和附件队列，再转移。';return false}return true}
 export function hasPending(){return !!newItem||!!comment||!!itemTitle||!!renaming||actionPending||!!attachments?.hasPending()}
 export function canLeave(confirmPending=true){
  if(composing){localError='请先完成当前输入，再关闭或切换。';return false}
  if(actionPending){localError='操作仍在保存，请稍候。';return false}
  // Preflight blocks active input/actions without confirming a draft that may change during flush.
  if(!confirmPending)return true;

  if(attachments&&!attachments.canLeave())return false;
  if((newItem||comment||itemTitle||renaming)&&!confirm('还有未发送的评论或清单编辑。放弃这些输入并继续？'))return false;
  return true;
 }
 export function persistPending(){if(actionPending)onuncertain()}
 async function action(data:Record<string,unknown>){if(actionPending)return false;actionPending=true;try{return await onaction(data)}catch(e){localError=e instanceof Error?e.message:'操作失败，请重试';return false}finally{actionPending=false}}
 async function addItem(){const sent=newItem,generation=newItemGeneration;if(await action({action:'checklist_create',title:sent})&&newItemGeneration===generation&&newItem===sent)newItem=''}
 async function deleteItem(id:number){const generation=renameGeneration;if(await action({action:'checklist_delete',item_id:id})&&renaming===id&&renameGeneration===generation){renaming=0;itemTitle=''}}
 async function postComment(){const sent=comment,generation=commentGeneration;if(await action({action:'comment_create',body:sent})&&commentGeneration===generation&&comment===sent)comment=''}
 // Acknowledgement owns only the submitted target and edit generation, not later input (even equal text).
 async function renameItem(item:Board['checklist'][number]){const target=item.id,sent=itemTitle,generation=renameGeneration;if(await action({action:'checklist_update',item_id:target,title:sent,checked:item.checked})&&renaming===target&&renameGeneration===generation&&itemTitle===sent){renaming=0;itemTitle=''}}
</script>
{#snippet glyph(path:string)}<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={path}/></svg>{/snippet}
{#if viewport.mobile}<div class="sheet-backdrop" aria-hidden="true"></div>{/if}
<div bind:this={panel} inert={suspended} onfocusin={e=>{if((e.target as HTMLElement).matches('input,textarea,select'))lastEditor=e.target as HTMLElement}} class="task-panel" role="dialog" aria-modal={viewport.mobile?'true':undefined} aria-labelledby="card-heading" oncompositionstart={e=>{if(!(e.target as Element).matches(".content-title,.content-description"))auxiliaryComposition=true}} oncompositionend={()=>auxiliaryComposition=false} tabindex="-1" style:left={viewport.mobile?'8px':`${position.left}px`} style:top={viewport.mobile?`${viewport.top+12}px`:`${position.top}px`} style:max-height={viewport.mobile?`${viewport.height-20}px`:'calc(100dvh - 24px)'}>
 <div class="task-panel-top">
  <header class="task-panel-head"><span class="eyebrow">卡片 #{draft.id}</span><span class="task-save" role="status" aria-live="polite">{recoveryHold?'已恢复 · 未保存':newItem||comment||itemTitle||renaming?'有未发送输入':saveState==='saving'?'保存中…':saveState==='pending'?'待保存':saveState==='error'||saveState==='conflict'||saveState==='invalid'?'未保存':'已保存'}</span><button class="tool-button" aria-label="关闭卡片" title="关闭卡片 (Esc)" onclick={onclose}>{@render glyph('m6 6 12 12M6 18 18 6')}</button></header>
  <div class="task-toolbar" role="toolbar" aria-label="卡片顶部操作">
   <button class="completion-button" disabled={actionPending||composing||draft.archived} onclick={()=>action({action:'card_complete',completed:!draft.completed})}>{draft.completed?'撤销完成':'完成任务'}</button>
   <button class="text-button" aria-label="设置日期和重复" onclick={()=>openEditor('schedule')}>日期{draft.due_date?` · ${draft.due_date}`:''}</button>
   {#each tools.filter(t=>['checklist','attachment'].includes(t.id)) as tool}<button class="tool-button" class:active={editor===tool.id} aria-label={tool.label} aria-expanded={editor===tool.id} aria-controls={`editor-${tool.id}`} data-tooltip={tool.label} title={tool.label} onclick={()=>openEditor(tool.id)}>{@render glyph(tool.path)}</button>{/each}
   <div class="task-more"><button class="tool-button" aria-label="更多操作" title="更多操作" data-tooltip="更多操作" aria-expanded={more} onclick={()=>more=!more}>{@render glyph('M5 12h.01M12 12h.01M19 12h.01')}</button>{#if more}<div class="task-more-menu"><button disabled={composing||actionPending||transferPending} onclick={async()=>{await onsavetemplate?.();more=false}}>保存为私人模板</button><button onclick={()=>{draft.archived=!draft.archived;onchange(true);more=false}}>{draft.archived?'恢复卡片':'归档卡片'}</button></div>{/if}</div>
  </div>
  {#if saveState==='error'||saveState==='conflict'}<div class="task-alert" role="alert"><strong>{saveState==='conflict'?'版本冲突，输入已保留。':'保存失败，输入已保留。'}</strong><p>{saveError}</p>{#if saveState==='conflict'}<button onclick={onreview}>查看最新版本并处理</button>{:else}<button onclick={onretry}>重试保存</button><button onclick={onreview}>查看最新版本并核对</button>{/if}</div>{/if}
  {#if detailRecovery&&!recoveryHold}<section class="draft-recovery" role="status"><span>{recoveryReview?'服务器内容已变化，请核对最新标题：'+detailRecovery.fresh.cards.find((c:Card)=>c.id===draft.id)?.title:'有此标签页保留的草稿'}</span>{#if recoveryReview}{@const latest=detailRecovery.fresh.cards.find((c:Card)=>c.id===draft.id)}<div class="recovery-baseline"><p>{latest.description||'无描述'}</p><p>日期与重复：{latest.schedule?JSON.stringify(latest.schedule):'无'} · 负责人：{latest.assignee_id??'无'} · {latest.archived?'已归档':'未归档'}</p><p>恢复后仍需单独确认保存；评论和清单不会自动发送。</p></div>{/if}<button onclick={onrestore}>{recoveryReview?'已核对，恢复到编辑器':'恢复草稿'}</button><button onclick={ondiscard}>丢弃草稿</button></section>{/if}
  {#if recoveryHold}<section class="draft-recovery" role="status"><span>{detailRecovery?.record.unknownCreateOutcome?'核对后再操作；未知结果不会重放':'恢复仅填入编辑器，尚未写入服务器'}</span><button onclick={onconfirmsave} disabled={detailRecovery?.record.unknownCreateOutcome}>确认保存恢复的修改</button><button onclick={ondiscard}>丢弃恢复的修改</button></section>{/if}
  {#if recoveryMessage}<p class="capture-message" role="status">{recoveryMessage}</p>{/if}
  {#if localError}<div class="task-alert" role="alert">{localError}<button onclick={()=>localError=''}>知道了</button></div>{/if}
 </div>
 <div class="task-panel-body" bind:this={body}>
  {#if review}<section class="conflict-review"><h3>最新版本 · {review.revision}</h3>{#if remote}<p><strong>{remote.title}</strong></p><p class="task-description">{remote.description||'无描述'}</p><p>负责人：{board.members.find(m=>m.user_id===remote.assignee_id)?.username||'未分配'} · 截止：{remote.due_date||'无'} · {remote.archived?'已归档':'未归档'}</p><p class="muted">继续会将本地修改的字段写入此版本；未修改字段不会被覆盖。评论和清单请检查下方最新内容。</p><button onclick={onrebase}>保留我的修改并重试</button>{:else}<p>卡片已不存在，请复制本地输入后返回。</p>{/if}<button onclick={oncancelreview}>返回继续编辑</button></section>{/if}
  <label class="content-title-label"><span class="sr-only">卡片标题</span><input id="card-heading" class="content-title" class:completed={draft.completed} bind:this={titleInput} aria-label="卡片标题" maxlength="500" required bind:value={draft.title} oninput={()=>onchange()} onblur={editorBlur} oncompositionstart={()=>composition(true)} oncompositionend={()=>composition(false)}/></label>
  {#if draft.archived}<p class="muted">已归档{draft.completed?' · 已完成':''}</p>{/if}
  <textarea class="content-description" bind:this={descriptionInput} aria-label="描述" placeholder="添加描述…" rows="6" maxlength="20000" bind:value={draft.description} oninput={()=>onchange()} onblur={editorBlur} oncompositionstart={()=>composition(true)} oncompositionend={()=>composition(false)}></textarea>
  {#if editor==='schedule'}<ScheduleEditor value={draft.scheduleInput} completed={draft.completed} onchange={()=>onchange()} onblur={editorBlur}/>{/if}
  {#if editor==='people'}<section id="editor-people" data-editor="people" class="task-editor move-fields"><label>负责人<select aria-label="负责人" value={draft.assignee_id??''} onchange={e=>{draft.assignee_id=e.currentTarget.value?Number(e.currentTarget.value):null;onchange(true)}}><option value="">未分配</option>{#each board.members.filter(m=>m.active||m.user_id===draft.assignee_id) as member}<option value={member.user_id} disabled={!member.active}>{member.username}{member.active?'':' · 已停用'}</option>{/each}</select></label></section>{/if}
  {#if editor==='move'}<section id="editor-move" data-editor="move" class="task-editor"><h3>移动卡片</h3>{#if positionDisabled}<p class="view-order-note">按日期显示时不能修改卡片位置，请先切回手动顺序。</p>{/if}<p class="muted">未完成在前、已完成在后；移动修改真实顺序，取消完成后沿用最新顺序。</p><div class="move-fields"><label>目标列表<select aria-label="目标列表" disabled={positionDisabled} bind:value={target} onchange={()=>index=''}>{#each board.lists as list}<option value={list.id}>{list.title}</option>{/each}</select></label><label>插入位置<select aria-label="插入位置" disabled={positionDisabled} value={slotKey(selectedSlot)} onchange={e=>index=e.currentTarget.value}>{#each moveSlots as slot}<option value={slotKey(slot)}>{slot.beforeId?`在「${board.cards.find(c=>c.id===slot.beforeId)?.title}」前（同完成分组内）`:'列表末尾（同完成分组内）'}</option>{/each}</select></label></div><button disabled={busy||draft.archived||positionDisabled} onclick={()=>action({action:'card_move',move_slot:selectedSlot,move_revision:board.revision})}>移动到此位置</button></section>{/if}
  <Attachments bind:this={attachments} boardId={board.id} cardId={draft.id} editing={editor==='attachment'}/>
  {#if items.length||editor==='checklist'}<section class="task-section" id="editor-checklist" data-editor="checklist"><h3>清单 <span class="muted">{items.filter(i=>i.checked).length}/{items.length}</span></h3>
   {#each items as item,i (item.id)}<div class="task-checklist-row"><label class="checkbox"><input type="checkbox" aria-label={`完成 ${item.title}`} checked={item.checked} disabled={actionPending} onchange={async e=>{const input=e.currentTarget;if(!await action({action:'checklist_update',item_id:item.id,title:item.title,checked:input.checked}))input.checked=item.checked}}/><span>{item.title}</span></label><button class="tool-button" aria-label={`编辑清单 ${item.id}`} title="编辑条目" onclick={()=>{renameGeneration++;renaming=item.id;itemTitle=item.title}}>{@render glyph('m4 16 12-12 4 4L8 20H4v-4')}</button></div>
   {#if renaming===item.id}<form class="task-editor" onsubmit={e=>{e.preventDefault();void renameItem(item)}}><input aria-label="清单条目标题" bind:value={itemTitle} oninput={()=>renameGeneration++} oncompositionstart={()=>renameGeneration++} required maxlength="500"/><div class="item-actions"><button disabled={actionPending}>保存条目</button><button type="button" onclick={()=>{renameGeneration++;renaming=0;itemTitle=''}}>取消</button><button type="button" aria-label={`上移 ${item.title}`} disabled={actionPending||i===0} onclick={()=>action({action:'checklist_move',item_id:item.id,index:i-1})}>↑</button><button type="button" aria-label={`下移 ${item.title}`} disabled={actionPending||i===items.length-1} onclick={()=>action({action:'checklist_move',item_id:item.id,index:i+1})}>↓</button><button type="button" disabled={actionPending} onclick={()=>deleteItem(item.id)}>删除</button></div></form>{/if}{/each}
   {#if editor==='checklist'}<form class="task-editor" onsubmit={e=>{e.preventDefault();void addItem()}}><label>新清单条目<input aria-label="新清单条目" bind:value={newItem} oninput={()=>newItemGeneration++} oncompositionstart={()=>newItemGeneration++} maxlength="500" required/></label><button disabled={actionPending}>添加条目</button></form>{/if}
  </section>{/if}
  {#if comments.length||editor==='comment'}<section class="task-section" id="editor-comment" data-editor="comment"><h3>评论</h3>{#each comments as note (note.id)}<article class="comment"><header><strong>{note.author}</strong><time datetime={new Date(note.created_at*1000).toISOString()}>{new Date(note.created_at*1000).toLocaleString('zh-CN')}</time>{#if note.author_id===userId||board.role==='admin'}<button aria-label={`删除评论 ${note.id}`} disabled={actionPending} onclick={()=>action({action:'comment_delete',comment_id:note.id})}>删除</button>{/if}</header><p>{note.body}</p></article>{/each}
  {#if editor==='comment'}<form class="task-editor" onsubmit={e=>{e.preventDefault();void postComment()}}><label>发表评论<textarea aria-label="发表评论" bind:value={comment} oninput={()=>commentGeneration++} oncompositionstart={()=>commentGeneration++} rows="3" maxlength="10000" required></textarea></label><button disabled={actionPending}>发送评论</button></form>{/if}</section>{/if}
 </div>
 <div class="task-panel-bottom" role="toolbar" aria-label="卡片底部操作">
 {#each tools.filter(t=>['people','comment','move'].includes(t.id)&&!(board.inbox_owner_id&&t.id==='move')) as tool}<button class="tool-button" class:move-tool={tool.id==='move'} class:active={editor===tool.id} aria-label={tool.label} title={tool.label} aria-expanded={editor===tool.id} onclick={()=>openEditor(tool.id)}>{@render glyph(tool.path)}</button>{/each}
 {#if board.inbox_owner_id}<button disabled={actionPending||transferPending} onclick={transfer}>移入普通看板</button>{/if}
 </div>
 {@render feedback?.()}
</div>
