<script lang="ts">
 import {onMount, tick} from 'svelte';
 let {palette, mode, onpalette, onmode}:{palette:string;mode:string;onpalette:(value:string)=>void;onmode:(value:string)=>void}=$props();
 let trigger:HTMLButtonElement, panel:HTMLDivElement;
 let open=$state(false), left=$state(0), top=$state(0);
 const colors=[['blue','雾蓝'],['iris','鸢尾'],['clay','陶橙'],['graphite','石墨']];
 function position(){
  const anchor=trigger.getBoundingClientRect(), box=panel.getBoundingClientRect();
  const drawer=trigger.closest('.navigation-drawer')?.getBoundingClientRect();
  const edge=drawer?Math.min(innerWidth,drawer.right):innerWidth;
  left=Math.max(8,Math.min(anchor.right+8,edge-box.width-8));
  top=Math.max(8,Math.min(anchor.bottom-box.height,innerHeight-box.height-8));
 }
 function close(restore=true){open=false;panel.hidePopover();if(restore)trigger.focus({preventScroll:true})}
 async function toggle(){
  if(open){close();return}
  panel.showPopover();position();await tick();
  panel.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({preventScroll:true});
 }
 onMount(()=>{
  // Capture before the navigation drawer's Escape handler: one layer per Escape.
  const key=(e:KeyboardEvent)=>{if(!panel.matches(':popover-open')||e.isComposing)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}};
  const resize=()=>{if(open)position()};
  window.addEventListener('keydown',key,true);window.addEventListener('resize',resize);
  return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('resize',resize)};
 });
</script>
<div class="appearance-control">
 <button class="appearance-trigger" bind:this={trigger} aria-label="外观" title="外观" aria-haspopup="dialog" aria-expanded={open} onclick={toggle}>
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.4-3.4 1.4 1.4 0 0 1 1-2.4H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="10" cy="6.8" r=".8"/><circle cx="14" cy="6.8" r=".8"/><circle cx="17" cy="10" r=".8"/></svg><span>外观</span>
 </button>
 <div class="appearance-popover" popover="auto" role="dialog" aria-label="外观设置" bind:this={panel} style:left={`${left}px`} style:top={`${top}px`} ontoggle={e=>{open=e.newState==='open';if(!open&&panel&&trigger&&(document.activeElement===document.body||panel.contains(document.activeElement)))trigger.focus({preventScroll:true})}}>
  <h2>外观</h2>
  <div class="appearance-label">配色</div>
  <div class="appearance-palettes" role="group" aria-label="配色">
   {#each colors as [value,label]}<button class="appearance-palette" aria-pressed={palette===value} onclick={()=>onpalette(value)}><span class="appearance-swatch" data-color={value}></span><span>{label}</span><svg class="appearance-check" style:visibility={palette===value?'visible':'hidden'} viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg></button>{/each}
  </div>
  <div class="appearance-label">明暗</div>
  <div class="appearance-modes" role="group" aria-label="明暗">{#each [['light','浅色'],['dark','深色'],['system','系统']] as [value,label]}<button aria-pressed={mode===value} onclick={()=>onmode(value)}>{label}</button>{/each}</div>
 </div>
</div>
<style>
 .appearance-control{display:flex;justify-content:center}
 .appearance-control .appearance-trigger{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:44px;min-height:44px;width:48px;border:0;background:transparent;color:var(--secondary);padding:8px 4px;font-size:10px}
 .appearance-control .appearance-trigger:hover,.appearance-control .appearance-trigger[aria-expanded="true"]{background:var(--accent-soft);color:var(--accent-text)}
 .appearance-popover{position:fixed;inset:auto;margin:0;width:min(264px,calc(100vw - 16px));max-height:calc(100dvh - 16px);overflow:auto;padding:16px;border:1px solid var(--border);border-radius:14px;background:var(--surface-raised);color:var(--text);box-shadow:0 8px 28px var(--shadow-color);z-index:100}
 h2{font-size:14px;line-height:1.5;margin:0 0 14px;font-weight:650}
 .appearance-label{font-size:12px;color:var(--secondary);margin:12px 0 6px}
 .appearance-palettes{display:grid;grid-template-columns:1fr 1fr;gap:4px}
 .appearance-popover .appearance-palette{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:8px;width:auto;min-width:0;min-height:44px;padding:8px;border:1px solid transparent;font-size:13px;color:var(--text);background:transparent;border-radius:8px}
 .appearance-popover button[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent-text);border-color:var(--border)}
 .appearance-popover button:hover{background:var(--surface-muted)}
 .appearance-swatch{width:14px;height:14px;flex-shrink:0;border-radius:50%;box-shadow:inset 0 0 0 1px var(--border-strong)}
 [data-color="blue"]{background:#6686b4}[data-color="iris"]{background:#9783c7}[data-color="clay"]{background:#c17a59}[data-color="graphite"]{background:#8793a5}
 .appearance-check{margin-left:auto;flex-shrink:0}
 .appearance-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;background:var(--surface-muted);border:1px solid var(--border);border-radius:10px;padding:3px}
 .appearance-popover .appearance-modes button{width:auto;min-width:44px;min-height:44px;padding:7px 4px;border:1px solid transparent;border-radius:7px;background:transparent;font-size:13px;color:var(--secondary)}
 .appearance-popover .appearance-modes button[aria-pressed="true"]{background:var(--surface);color:var(--accent-text);border-color:var(--border)}
 button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
</style>
