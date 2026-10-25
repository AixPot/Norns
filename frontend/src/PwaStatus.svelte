<script lang="ts">
 import {onMount} from 'svelte';
 import {watchRegistration} from './pwa.mjs';
 let offline=$state(false),failed=$state(false),update=$state(false);
 onMount(()=>{
  let alive=true,stop=()=>{},registration:ServiceWorkerRegistration|undefined;
  const connectivity=()=>offline=!navigator.onLine;
  const result=(event:Event)=>failed=!(event as CustomEvent).detail;
  const check=()=>{if(document.visibilityState==='visible')void registration?.update().catch(()=>{})};
  connectivity();window.addEventListener('online',connectivity);window.addEventListener('offline',connectivity);window.addEventListener('norns-connection',result);document.addEventListener('visibilitychange',check);
  if('serviceWorker' in navigator&&window.isSecureContext&&import.meta.env.PROD){
   void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).then(r=>{if(!alive)return;registration=r;stop=watchRegistration(r,()=>update=true);void r.update().catch(()=>{})}).catch(()=>{});
  }
  return ()=>{alive=false;stop();window.removeEventListener('online',connectivity);window.removeEventListener('offline',connectivity);window.removeEventListener('norns-connection',result);document.removeEventListener('visibilitychange',check)};
 });
</script>
{#if offline||failed||update}<aside class="pwa-status" aria-label="连接与版本" role="status">
 {#if offline||failed}<p>无法连接{offline?'：浏览器报告网络已断开':'：请求未能到达服务器或服务暂不可用'}。请保留此页并检查保存状态；失败操作不会自动补交。网络恢复不代表已保存，请核对后再操作。</p>{/if}
 {#if update}<details><summary>有新版本 · 查看更新方式</summary><p>此页不会自动刷新。请先在各个 Norns 标签页／独立窗口中完成输入、明确保存并核对结果，再自行关闭所有 Norns 窗口后重新打开。仍有草稿、输入法组合输入、处理中操作或弹窗时，请继续留在原页；不要为更新放弃内容。</p></details>{/if}
</aside>{/if}
<style>.pwa-status{background:var(--warning-surface);color:var(--warning);border-bottom:1px solid var(--warning-border);padding:8px max(16px,env(safe-area-inset-right)) 8px max(16px,env(safe-area-inset-left));font-size:13px}.pwa-status p{margin:4px 0}.pwa-status summary{cursor:pointer;min-height:32px;display:list-item;padding:5px 0}.pwa-status details p{max-width:70rem}</style>
