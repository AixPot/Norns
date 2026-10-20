import {cardSlots,listSlots,slotKey} from './drag-order.mjs';
export const LONG_PRESS=360,TOUCH_SLOP=8,MOUSE_SLOP=6;
export function edgeVelocity(value,start,end){const band=Math.min(44,(end-start)/3);return value<start+band?-650*Math.min(1,(start+band-value)/band):value>end-band?650*Math.min(1,(value-end+band)/band):0}
export function createDragSensor({start,move,end,cancel,setTimer=setTimeout,clearTimer=clearTimeout}){
 let state='idle',origin,point,type,timer;
 const clear=()=>{clearTimer(timer);timer=undefined};
 function reset(){clear();state='idle'}
 function activate(){clear();if(state!=='pending')return;state='dragging';start(point)}
 return {state:()=>state,down(t,p){if(state!=='idle')return;type=t;origin=point=p;state='pending';if(t==='touch')timer=setTimer(activate,LONG_PRESS)},move(p){point=p;if(state==='pending'&&Math.hypot(p.x-origin.x,p.y-origin.y)>(type==='touch'?TOUCH_SLOP:MOUSE_SLOP)){if(type==='touch'){reset();return}activate()}if(state==='dragging')move(p)},up(){const active=state==='dragging';reset();if(active)end()},cancel(){const active=state==='dragging';reset();if(active)cancel()}};
}
// Mouse capture and a non-passive Touch Events adapter share the same sensor.
// touch-action stays auto: pending touches retain native scrolling and pinch zoom.
export function attachBoardDrag(root,{read,disabled,commit,announce,owner=()=>''}){
 const doc=root.ownerDocument,win=doc.defaultView;
 let source,intent,point,slot=null,ghost,marker,frame=0,last=0,capture=null,touch=null,suppressUntil=0,oldSnap='',hitKey='';
 const listeners=[];
 function listen(el,name,fn,opts){el.addEventListener(name,fn,opts);listeners.push(()=>el.removeEventListener(name,fn,opts))}
 const owns=()=>intent&&owner()===intent.owner&&read().id===intent.boardId&&read().revision===intent.revision&&!disabled();
 function cleanup(){
  win.cancelAnimationFrame(frame);frame=0;last=0;ghost?.remove();marker?.remove();ghost=marker=null;
  source?.node.classList.remove('drag-source');root.classList.remove('dragging-board');root.style.scrollSnapType=oldSnap;
  if(capture){const {node,id}=capture;capture=null;try{if(node.hasPointerCapture(id))node.releasePointerCapture(id)}catch{}}
  slot=null;intent=null;source=null;touch=null;hitKey='';
 }
 function cancel(message='已取消移动'){const active=sensor.state()==='dragging';sensor.cancel();cleanup();if(active)announce(message)}
 function getSource(target){
  if(disabled()||!(target instanceof win.Element))return null;
  if(target.closest('input,textarea,select,label,a,[contenteditable],button:not(.card-content),.list-actions,form'))return null;
  const card=target.closest('[data-card-id]'),head=target.closest('[data-list-drag]');
  const node=card||head?.closest('[data-list-id]');if(!node||!root.contains(node))return null;
  return {kind:card?'card':'list',id:Number(card?.dataset.cardId||node.dataset.listId),node};
 }
 function down(type,p,target){
  if(sensor.state()!=='idle')return;
  source=getSource(target);if(!source)return;
  const b=read();intent={kind:source.kind,sourceId:source.id,boardId:b.id,revision:b.revision,owner:owner()};point=p;
  sensor.down(type,p);
 }
 const currentRect=node=>node.getBoundingClientRect();
 function hit(){
  if(!owns()){cancel('看板已更新，请重新拖动');return}
  const key=`${point.x}:${point.y}:${root.scrollLeft}:${win.scrollY}:${win.innerWidth}:${win.innerHeight}`;
  if(key===hitKey)return;hitKey=key;
  if(slot&&marker?.isConnected){const r=marker.getBoundingClientRect();if(point.x>=r.left&&point.x<=r.right&&point.y>=r.top&&point.y<=r.bottom)return}
  const b=read(),top=doc.elementFromPoint(point.x,point.y);
  let next=null,anchor=null,parent=null;
  if(top&&root.contains(top)&&!top.closest('form,.list-actions,.column-head button,input,label,select,.completion-toast')){
   if(intent.kind==='list'){
    const cols=[...root.querySelectorAll(':scope > [data-list-id]')].filter(n=>Number(n.dataset.listId)!==intent.sourceId);
    const before=cols.find(n=>{const r=currentRect(n);return point.x<(r.left+r.right)/2});
    if(top.closest('[data-list-id]')||top===root){const options=listSlots(b,intent.sourceId);next=options.find(s=>s.beforeId===(before?Number(before.dataset.listId):null));anchor=before||root.querySelector('.add-list');parent=root}
   }else{
    const col=top.closest('[data-list-id]'),moving=b.cards.find(c=>c.id===intent.sourceId);
    if(col&&moving){
     const id=Number(col.dataset.listId),options=cardSlots(b,intent.sourceId,id),cards=[...col.querySelectorAll('[data-card-id]')].filter(n=>Number(n.dataset.cardId)!==intent.sourceId);
     const under=cards.find(n=>{const r=currentRect(n);return point.y>=r.top&&point.y<=r.bottom}),underCard=b.cards.find(c=>c.id===Number(under?.dataset.cardId));
     if(!underCard||underCard.id===intent.sourceId||underCard.completed===moving.completed){
      const group=cards.filter(n=>b.cards.find(c=>c.id===Number(n.dataset.cardId))?.completed===moving.completed);
      const before=group.find(n=>{const r=currentRect(n);return point.y<(r.top+r.bottom)/2});
      next=options.find(s=>s.beforeId===(before?Number(before.dataset.cardId):null));parent=col.querySelector('.card-stack');
      anchor=before||(!moving.completed?cards.find(n=>b.cards.find(c=>c.id===Number(n.dataset.cardId))?.completed):null);
     }
    }
   }
  }
  if(slotKey(next)!==slotKey(slot)){
   slot=next||null;
   if(next){parent.insertBefore(marker,anchor||null);marker.hidden=false;const list=b.lists.find(l=>l.id===next.listId);announce(intent.kind==='list'?'移动列表到此位置':`移动到${list?.title||''}，${next.completed?'已完成':'未完成'}分组`)}
   else{marker.remove();announce('此处不可放置；只能在同完成分组内排序')}
  }
 }
 function tick(time){
  if(!owns()){cancel('看板已更新，请重新拖动');return}
  const dt=Math.min(32,last?time-last:16)/1000;last=time;
  const r=root.getBoundingClientRect(),vx=point.y>=r.top&&point.y<=r.bottom?edgeVelocity(point.x,Math.max(0,r.left),Math.min(win.innerWidth,r.right)):0;
  if(vx){const lastColumn=root.querySelector(':scope > [data-list-id]:last-of-type'),lastRect=lastColumn?.getBoundingClientRect();const max=lastRect?root.scrollLeft+lastRect.right-r.left-root.clientWidth+16:root.scrollWidth-root.clientWidth;root.scrollLeft=Math.max(0,Math.min(Math.max(0,max),root.scrollLeft+vx*dt))}
  const scrolling=doc.scrollingElement,vy=edgeVelocity(point.y,0,win.innerHeight);if(vy)scrolling.scrollTop+=vy*dt;
  ghost.style.left=`${point.x+14}px`;ghost.style.top=`${point.y+14}px`;hit();
  if(sensor.state()==='dragging')frame=win.requestAnimationFrame(tick);
 }
 const sensor=createDragSensor({
  start(p){
   if(!owns()){cancel();return}point=p;oldSnap=root.style.scrollSnapType;root.style.scrollSnapType='none';root.classList.add('dragging-board');source.node.classList.add('drag-source');
   ghost=doc.createElement('div');ghost.className='board-drag-ghost';ghost.setAttribute('aria-hidden','true');ghost.textContent=intent.kind==='card'?bTitle():source.node.querySelector('h2')?.textContent;doc.body.append(ghost);
   marker=doc.createElement('div');marker.className=`drag-placeholder ${intent.kind==='list'?'list-placeholder':''}`;marker.setAttribute('aria-hidden','true');marker.textContent='放到这里';
   const r=source.node.getBoundingClientRect();marker.style[intent.kind==='list'?'width':'height']=`${intent.kind==='list'?r.width:r.height}px`;
   suppressUntil=Date.now()+1000;frame=win.requestAnimationFrame(tick);
  },
  move(p){point=p;if(!owns())cancel('看板已更新，请重新拖动')},
  end(){const move=slot&&owns()?{...intent,slot}:null;suppressUntil=Date.now()+700;cleanup();if(move)void Promise.resolve(commit(move)).then(ok=>announce(ok?'已移动并保存':'未移动，请核对看板状态或重新选择位置')).catch(()=>announce('保存未确认，请核对看板'));else announce('已取消移动')},
  cancel(){suppressUntil=Date.now()+700;cleanup()}
 });
 const bTitle=()=>read().cards.find(c=>c.id===intent.sourceId)?.title||'移动卡片';
 listen(root,'pointerdown',e=>{suppressUntil=0;if(e.pointerType==='touch'||e.button!==0)return;down('mouse',{x:e.clientX,y:e.clientY},e.target);if(source)capture={node:source.node,id:e.pointerId}});
 listen(win,'pointermove',e=>{if(e.pointerType==='touch'||!capture||e.pointerId!==capture.id)return;sensor.move({x:e.clientX,y:e.clientY});if(sensor.state()==='dragging'){e.preventDefault();try{capture?.node.setPointerCapture(e.pointerId)}catch{cancel()}}});
 listen(win,'pointerup',e=>{if(e.pointerType==='touch'||!capture||e.pointerId!==capture.id)return;point={x:e.clientX,y:e.clientY};if(sensor.state()==='dragging')hit();sensor.up();cleanup()});
 listen(win,'pointercancel',e=>{if(e.pointerType!=='touch')cancel()});
 listen(root,'lostpointercapture',e=>{if(capture&&e.pointerId===capture.id&&sensor.state()==='dragging')cancel()});
 listen(root,'touchstart',e=>{suppressUntil=0;if(e.touches.length!==1){cancel();return}const t=e.touches[0];down('touch',{x:t.clientX,y:t.clientY},e.target);if(source)touch=t.identifier},{passive:false});
 listen(win,'touchstart',e=>{if(e.touches.length>1)cancel()},{passive:true});
 listen(win,'touchmove',e=>{
  if(touch===null)return;if(e.touches.length!==1){cancel();return}const t=[...e.touches].find(t=>t.identifier===touch);if(!t){cancel();return}
  const active=sensor.state()==='dragging';if(active){if(!e.cancelable){cancel();return}e.preventDefault()}
  sensor.move({x:t.clientX,y:t.clientY});if(sensor.state()==='idle')cleanup();
 },{passive:false});
 listen(win,'touchend',e=>{if(touch===null)return;const t=[...e.changedTouches].find(t=>t.identifier===touch);if(!t)return;point={x:t.clientX,y:t.clientY};if(sensor.state()==='dragging')hit();sensor.up();cleanup()},{passive:true});
 listen(win,'touchcancel',()=>cancel(),{passive:true});
 listen(root,'click',e=>{if(Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation()}},true);
 listen(root,'contextmenu',e=>{if(sensor.state()==='dragging')e.preventDefault()});
 listen(win,'scroll',()=>{if(sensor.state()==='pending')cancel()},true);
 listen(win,'blur',()=>cancel());listen(doc,'visibilitychange',()=>{if(doc.hidden)cancel()});
 listen(doc,'keydown',e=>{if(e.key==='Escape'&&sensor.state()!=='idle'){e.preventDefault();cancel()}});
 return {cancel,destroy(){cancel();listeners.forEach(off=>off())}};
}
