<script lang="ts">
 export type CompletionNotice={card:number;board:number;user:number;epoch:number;title:string;pending:boolean};
 let {item,onundo,onclose}:{item:CompletionNotice;onundo:()=>void;onclose:()=>void}=$props();
</script>
<section class="completion-toast" aria-label="最近完成的任务">
 <span role="status">已完成：<strong>{item.title}</strong></span>
 <button disabled={item.pending} onclick={onundo}>{item.pending?'撤销中…':'撤销'}</button>
 <button aria-label="关闭完成提示" onclick={onclose}>×</button>
</section>
<style>
 .completion-toast{position:fixed;z-index:40;bottom:calc(20px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;max-width:calc(100vw - 24px);width:max-content;padding:8px 12px;background:var(--surface-muted);color:var(--text);border:1px solid var(--border-strong);border-radius:12px;box-shadow:0 6px 24px var(--shadow-color);animation:notice-in .16s ease-out}
 span{min-width:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}strong{font-weight:550}button{flex-shrink:0;min-height:44px}button:last-child{padding:8px;min-width:36px}
 :global(.task-panel) .completion-toast{bottom:calc(84px + env(safe-area-inset-bottom))}
 @media(max-width:640px){.completion-toast{gap:6px;padding:6px 8px;width:calc(100vw - 24px);font-size:12px}span{display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}}
 @keyframes notice-in{from{opacity:0;translate:0 5px}to{opacity:1;translate:0 0}}
 @media(prefers-reduced-motion:reduce){.completion-toast{animation:none}}
</style>
