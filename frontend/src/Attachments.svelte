<script lang="ts">
 import {onMount,untrack} from 'svelte';import {api} from './api';import {lifetime} from './attachment-life.mjs';import PdfPreview from './PdfPreview.svelte';
 let {boardId,cardId,editing=false}:{boardId:number;cardId:number;editing?:boolean}=$props();
 type Item={id:string;filename:string;size:number;mime:string;state:string};type Job={file:File;progress:number;error:string;running:boolean;id?:string};
 let configured=$state(false),loaded=$state(false),max=$state(0),items=$state<Item[]>([]),jobs=$state<Job[]>([]),error=$state(''),preview=$state<Item|null>(null);
 let queue=Promise.resolve();
 const life=lifetime();const active=new Set<XMLHttpRequest>();const base=untrack(()=>`/boards/${boardId}/cards/${cardId}/attachments`);
 async function refresh(){try{const r=await api<{configured:boolean;max_bytes:number;items:Item[]}>(base);if(!life.current())return;configured=r.configured;max=r.max_bytes;items=r.items;loaded=true}catch(e){if(life.current())error=e instanceof Error?e.message:'附件列表加载失败'}}
 onMount(()=>{void refresh();return()=>{life.stop();for(const x of active)x.abort()}});
 async function send(job:Job){if(!life.current()||job.running)return;job.running=true;job.error='';job.progress=0;
 try{
  // Retrying a transfer uses a fresh server reservation; old pending is explicitly deleted.
  if(job.id){await api(`${base}/${job.id}`,'DELETE');job.id=undefined;if(!life.current())return}
  const init=await api<{id:string;put_url:string}>(base,'POST',{filename:job.file.name,size:job.file.size});if(!life.current())return;job.id=init.id;
  await new Promise<void>((resolve,reject)=>{const xhr=new XMLHttpRequest();active.add(xhr);xhr.open('PUT',init.put_url);xhr.upload.onprogress=e=>{if(life.current()&&e.lengthComputable)job.progress=Math.round(e.loaded/e.total*100)};xhr.onload=()=>{active.delete(xhr);xhr.status>=200&&xhr.status<300?resolve():reject(new Error('上传失败，请重试'))};xhr.onerror=xhr.onabort=()=>{active.delete(xhr);reject(new Error('上传中断，请重试'))};xhr.send(job.file)});
  if(!life.current())return;
  await api(`${base}/${init.id}/complete`,'POST',{});if(!life.current())return;job.progress=100;await refresh();if(life.current())jobs=jobs.filter(j=>j!==job);
 }catch(e){if(life.current())job.error=e instanceof Error?e.message:'上传失败，请重试'}finally{if(life.current())job.running=false}
 }
 function choose(files:FileList|File[]|null){if(!files||!configured)return;for(const file of Array.from(files)){const job:Job={file,progress:0,error:'',running:false};jobs=[...jobs,job];const reactive=jobs[jobs.length-1];if(file.size===0||file.size>max)reactive.error=`文件须为 1–${max} 字节`;else queue=queue.then(()=>send(reactive))}}
 async function remove(item:Item){try{await api(`${base}/${item.id}`,'DELETE');if(life.current()){if(preview?.id===item.id)preview=null;await refresh()}}catch(e){if(life.current())error=e instanceof Error?e.message:'删除失败'}}
 export function hasPending(){return jobs.length>0}
 export function canLeave(){return !jobs.length||confirm('附件上传尚未完成或失败。离开将中断上传并丢弃重试队列，继续？')}
 const url=(i:Item)=>`/api${base}/${i.id}/content`;
</script>
{#if editing||items.length||jobs.length||error}<section class="task-section attachments" aria-label="附件" id="editor-attachment" data-editor="attachment">
 <h3>附件</h3>{#if error}<p role="alert">{error}<button onclick={refresh}>重试加载</button></p>{/if}
 {#if !loaded}<p>正在加载附件…</p>{:else if !configured}<p role="status">附件存储未配置。其他看板功能可正常使用。</p>{:else}
 {#if editing}<div class="attachment-drop" role="group" aria-label="拖放或粘贴图片上传"  ondragover={e=>e.preventDefault()} ondrop={e=>{e.preventDefault();choose(e.dataTransfer?.files||null)}} onpaste={e=>{const files=Array.from(e.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();choose(files)}}}>
 <label>选择附件（可多选）<input aria-label="选择附件" type="file" multiple onchange={e=>{choose(e.currentTarget.files);e.currentTarget.value=''}}/></label><p class="muted">也可拖放文件或在此粘贴图片。单文件上限 {Math.floor(max/1024/1024)} MiB。</p></div>{/if}
 {#each jobs as job}<div><span>{job.file.name}</span><progress max="100" value={job.progress}></progress><span>{job.progress}%</span>{#if job.error}<p role="alert">{job.error}<button onclick={()=>send(job)} disabled={job.running||job.file.size>max||!job.file.size}>重试上传</button></p>{/if}</div>{/each}
 {#each items as item (item.id)}<div class="attachment-row"><span>{item.filename} · {item.size} 字节 · {item.state}</span>{#if item.state==='ready'}<a href={`${url(item)}?download=true`}>下载</a>{#if item.mime!=='application/octet-stream'}<button onclick={()=>preview=item}>预览</button>{/if}{/if}<button onclick={()=>remove(item)}>删除</button></div>{:else}<p class="muted">暂无附件</p>{/each}
 {#if preview}<div class="attachment-preview"><button onclick={()=>preview=null}>关闭预览</button><p>{preview.filename}</p>{#if preview.mime.startsWith('image/')}<img src={url(preview)} alt={preview.filename}/>{:else if preview.mime.startsWith('audio/')}<audio controls src={url(preview)}></audio>{:else if preview.mime.startsWith('video/')}<video controls src={url(preview)}><track kind="captions"/></video><p class="muted">音视频能否播放取决于浏览器编解码支持；无法播放请下载原文件。</p>{:else if preview.mime==='application/pdf'}{#key preview.id}<PdfPreview url={url(preview)}/>{/key}{:else}<iframe title={`预览 ${preview.filename}`} src={url(preview)} sandbox=""></iframe>{/if}</div>{/if}
 {/if}
</section>{/if}
<style>.attachment-drop{border:1px dashed #9ba9a0;padding:1rem;border-radius:12px}.attachment-row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:.6rem 0}.attachment-row span{overflow-wrap:anywhere;flex:1;min-width:130px}.attachment-preview img,.attachment-preview video{max-width:100%;max-height:55vh}.attachment-preview iframe{width:100%;height:45vh;border:0}progress{max-width:120px;margin:.4rem}</style>
