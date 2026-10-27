import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as clearance from '../src/completion-clearance.mjs';

function fixture() {
 const listeners=new Set(), values=new Map();let base=40;
 const owner={isConnected:true,style:{setProperty:(k,v)=>values.set(k,v),removeProperty:k=>values.delete(k)},getBoundingClientRect:()=>({bottom:667})};
 const scroll={scrollTop:0,scrollHeight:1600,clientHeight:667};
 globalThis.document={scrollingElement:scroll,querySelector:()=>owner,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
 globalThis.window={innerHeight:667,addEventListener(){},removeEventListener(){}};
 globalThis.getComputedStyle=()=>({getPropertyValue:()=>`${base}px`,paddingBottom:values.get('--completion-clearance')||`${base}px`});
 globalThis.ResizeObserver=class {observe(){}disconnect(){}};
 const toast={closest:()=>null,getBoundingClientRect:()=>({top:589})};
 return {owner,scroll,listeners,values,toast,mobile:()=>base=25,fire:()=>[...listeners].forEach(fn=>fn())};
}

test('close after breakpoint uses current baseline and reclaims only after natural upward scroll',()=>{
 const f=fixture(),action=clearance.reserveCompletionClearance(f.toast);f.mobile();
 // Original mobile extent is 868px; old desktop baseline incorrectly permits 878px.
 f.scroll.scrollTop=878;action.destroy();
 assert.equal(f.values.get('--completion-clearance'),'90px');assert.equal(f.listeners.size,1);
 f.scroll.scrollTop=868;f.fire();assert.equal(f.values.has('--completion-clearance'),false);assert.equal(f.listeners.size,0);
});

test('owner destroy releases deferred reclaim, including toast destroy after owner destroy',()=>{
 assert.equal(typeof clearance.completionClearanceOwner,'function');
 const f=fixture(),lifecycle=clearance.completionClearanceOwner(f.owner);
 f.scroll.scrollTop=933;const first=clearance.reserveCompletionClearance(f.toast);first.destroy();assert.equal(f.listeners.size,1);
 const replacement=clearance.reserveCompletionClearance(f.toast);assert.equal(f.listeners.size,0);replacement.destroy();assert.equal(f.listeners.size,1);
 lifecycle.destroy();assert.equal(f.listeners.size,0);assert.equal(f.values.size,0);
 const g=fixture(),owner=clearance.completionClearanceOwner(g.owner),toast=clearance.reserveCompletionClearance(g.toast);g.scroll.scrollTop=933;owner.destroy();toast.destroy();assert.equal(g.listeners.size,0);
});
