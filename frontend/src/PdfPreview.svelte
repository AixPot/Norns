<script lang="ts">
 import {onMount} from 'svelte';
 import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
 let {url}:{url:string}=$props();let canvas:HTMLCanvasElement;let error=$state('');let pages=$state(0);
 onMount(()=>{let stopped=false;let task:import('pdfjs-dist').PDFDocumentLoadingTask|undefined;
 void (async()=>{try{const {getDocument,GlobalWorkerOptions}=await import('pdfjs-dist');if(stopped)return;GlobalWorkerOptions.workerSrc=workerUrl;task=getDocument({url,enableXfa:false,useWasm:false,disableFontFace:true,disableRange:true,maxImageSize:16*1024*1024,canvasMaxAreaInBytes:32*1024*1024,stopAtErrors:true});const pdf=await task.promise;if(stopped)return;pages=pdf.numPages;const page=await pdf.getPage(1);if(stopped)return;const initial=page.getViewport({scale:1});const scale=Math.min(1.5,1000/Math.max(initial.width,initial.height));const viewport=page.getViewport({scale});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvas,viewport}).promise;}catch(e){if(!stopped)error='PDF 无法安全渲染，请下载原文件。'}})();return()=>{stopped=true;void task?.destroy()};
 });
</script>
<div class="pdf-preview">{#if error}<p role="alert">{error}</p>{:else}<p class="muted">PDF 第一页预览 · 共 {pages||'…'} 页。查看其余页面请下载。不执行文档脚本、表单或外部链接。</p>{/if}<canvas bind:this={canvas} aria-label="PDF 第一页"></canvas></div>
<style>canvas{max-width:100%;height:auto;background:white}</style>
