<script lang="ts">
 import {onMount} from 'svelte';
 let prompt=$state<any>(null),standalone=$state(false),message=$state('');
 onMount(()=>{
  const media=matchMedia('(display-mode: standalone)');const sync=()=>standalone=media.matches||!!(navigator as any).standalone;
  const before=(e:Event)=>{e.preventDefault();prompt=e};const installed=()=>{prompt=null;standalone=true};sync();
  window.addEventListener('beforeinstallprompt',before);window.addEventListener('appinstalled',installed);media.addEventListener('change',sync);
  return ()=>{window.removeEventListener('beforeinstallprompt',before);window.removeEventListener('appinstalled',installed);media.removeEventListener('change',sync)};
 });
 async function install(){const event=prompt;if(!event)return;prompt=null;try{await event.prompt();await event.userChoice}catch{message='请使用浏览器菜单中的安装选项。'}}
</script>
{#if !standalone}<details class="pwa-install"><summary>安装 Norns</summary>
 <p>安装可选，仍需联网使用。浏览器支持时，可从地址栏或菜单选择“安装应用”。</p>
 {#if prompt}<button onclick={install}>安装到此设备</button>{/if}
 <p>iPhone／iPad：在 Safari 打开本站，使用“共享”→“添加到主屏幕”；如有“作为网页 App 打开”，启用后点“添加”。若未显示该项，可在共享菜单“编辑操作”中添加。无需开启通知。</p>
 {#if message}<p role="status">{message}</p>{/if}
</details>{/if}
<style>.pwa-install{padding:6px 10px;max-width:min(300px,75vw)}summary{cursor:pointer;min-height:36px;padding:6px 0}p{font-size:13px;color:var(--secondary);white-space:normal;margin:8px 0}</style>
