<script lang="ts">
 export type CompletionNotice={card:number;board:number;user:number;epoch:number;title:string;pending:boolean;status?:'confirmed'|'unknown'};
 let {item,onundo,onclose}:{item:CompletionNotice;onundo:()=>void;onclose:()=>void}=$props();
 const confirmed=$derived(!item.pending&&item.status!=='unknown');
</script>
<section class="completion-toast" class:confirmed aria-label="最近完成的任务">
 {#if confirmed}<svg class="completion-seal" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7 12 3.2 3.2L17 8.5" fill="none" stroke="var(--completion-ink,var(--on-accent,#fff))" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
 <span role="status" aria-atomic="true">{item.pending?'正在恢复：':item.status==='unknown'?'恢复结果待核对：':'已完成：'}<strong>{item.title}</strong></span>
 <button disabled={item.pending||item.status==='unknown'} onclick={onundo}>{item.pending?'撤销中…':item.status==='unknown'?'待核对':'撤销'}</button>
 <button aria-label="关闭完成提示" onclick={onclose}>×</button>
</section>
<style>
 .completion-toast{position:fixed;z-index:40;bottom:calc(20px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);width:max-content;padding:8px 12px;background:var(--surface-muted);color:var(--text);border:1px solid var(--border-strong);border-radius:12px;box-shadow:0 6px 24px var(--shadow-color)}
 .confirmed{background:var(--surface);border-color:var(--accent)}
 .completion-seal{width:26px;height:26px;flex:none;color:var(--accent);animation:seal-in 180ms ease-out}
 span{min-width:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}strong{font-weight:550}button{flex-shrink:0;min-height:44px}button:last-child{padding:8px;min-width:36px}
 :global(.task-panel) .completion-toast{bottom:calc(84px + env(safe-area-inset-bottom))}
 @media(max-width:640px){.completion-toast{gap:6px;padding:6px 8px;width:calc(100vw - 24px);font-size:12px}}
 @keyframes seal-in{from{opacity:.5;transform:scale(.9)}to{opacity:1;transform:scale(1)}}
 @media(prefers-reduced-motion:reduce){.completion-seal{animation:none}}
 @media(forced-colors:active){.completion-seal{color:CanvasText;--completion-ink:Canvas}.confirmed{border-color:CanvasText}}
</style>
