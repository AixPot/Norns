// Presentation only: never mutates acknowledged records or delays a write.
export function createCompletionMotion({change,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,reduced=()=>false}){
 let entries=[],timers=new Map();
 const emit=()=>change([...entries]);
 function remove(entry){clearTimer(timers.get(entry));timers.delete(entry);entries=entries.filter(e=>e!==entry);emit()}
 return {
  begin(record,target){const entry={id:record.id,record:{...record},target,phase:'pending',started:now()};entries=entries.filter(e=>{if(e.id!==entry.id)return true;clearTimer(timers.get(e));timers.delete(e);return false});entries.push(entry);emit();return entry},
  finish(entry,success){if(!entries.includes(entry))return;if(!success||!entry.target||reduced()){remove(entry);return}entry.phase='settling';emit();const delay=Math.max(120,360-(now()-entry.started));timers.set(entry,setTimer(()=>remove(entry),delay))},
  clear(){for(const timer of timers.values())clearTimer(timer);timers.clear();entries=[];emit()},
 };
}
export function completionRows(rows,entries){
 const held=new Map(entries.filter(e=>e.target).map(e=>[e.id,e]));
 const unique=new Map();for(const row of rows)unique.set(row.id,row);
 const result=[...unique.values()].map(row=>{const entry=held.get(row.id);held.delete(row.id);return entry&&!row.archived?{...row,completed:entry.record.completed}:row});
 // Smart queries may remove an acknowledged completed row before the visual hold ends.
 for(const entry of held.values())if(!entry.record.archived)result.push({...entry.record});
 return result;
}
// Shared FLIP action includes rows in adjacent groups. One observer per owning surface.
export function completionLayout(root){
 let frames=0,previous=new Map(),animations=new Map(),disposed=false,focused=null,wasCompleting=false;
 const remember=event=>{focused=event.target.closest('[data-completion-id]')};root.addEventListener('focusin',remember);
 const media=matchMedia('(prefers-reduced-motion: reduce)');
 const nodes=()=>[...root.querySelectorAll('[data-completion-id]')];
 const key=node=>node.dataset.completionId;
 function measure(){return new Map(nodes().map(node=>[key(node),{node,rect:node.getBoundingClientRect()}]))}
 function update(){frames=0;if(disposed)return;const completing=!!root.querySelector('[data-completion-phase="pending"],[data-completion-phase="settling"]'),animate=wasCompleting||completing;wasCompleting=completing;if(root.closest('.dragging-board')){previous=measure();return}const next=measure();
  for(const [id,{node,rect}] of next){const old=previous.get(id);if(animate&&!media.matches&&old){const dy=old.rect.top-rect.top,dx=old.rect.left-rect.left;if(Math.abs(dy)>1||Math.abs(dx)>1){animations.get(node)?.cancel();const a=node.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:220,easing:'cubic-bezier(.2,.7,.3,1)'});animations.set(node,a);a.onfinish=()=>animations.delete(node)}}}
  if(focused&&!focused.isConnected&&document.activeElement===document.body){const old=[...previous.keys()],index=old.indexOf(key(focused)),target=old.slice(index+1).map(id=>next.get(id)?.node).find(Boolean)||[...next.values()][0]?.node;target?.querySelector('input:not(:disabled),button:not(:disabled)')?.focus({preventScroll:true});focused=null}
  previous=next;
 }
 previous=measure();const observer=new MutationObserver(()=>{if(!frames)frames=requestAnimationFrame(update)});observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-completion-phase']});
 const reset=()=>{for(const a of animations.values())a.cancel();animations.clear();previous=measure()};
 const prepareDrag=event=>{if(event.target.closest('.card-content,[data-list-drag]'))reset()};
 media.addEventListener('change',reset);root.addEventListener('pointerdown',prepareDrag,true);root.addEventListener('touchstart',prepareDrag,{capture:true,passive:true});
 return {destroy(){disposed=true;root.removeEventListener('focusin',remember);focused=null;observer.disconnect();cancelAnimationFrame(frames);media.removeEventListener('change',reset);root.removeEventListener('pointerdown',prepareDrag,true);root.removeEventListener('touchstart',prepareDrag,true);reset();previous.clear()}};
}
