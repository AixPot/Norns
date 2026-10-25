import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Build-time only: no Node APIs or typings are needed by the browser application.
export function onlinePwa() {
 return {
  name:'norns-online-pwa',
  generateBundle(_options,bundle){
   const template=readFileSync(new URL('./pwa-worker.js',import.meta.url),'utf8');
   const digest=createHash('sha256').update(template).update(readFileSync(new URL('./public/offline.html',import.meta.url)));
   for(const key of Object.keys(bundle).sort()){
    const item=bundle[key];digest.update(key).update(item.type==='chunk'?item.code:item.source);
   }
   this.emitFile({type:'asset',fileName:'sw.js',source:template.replace('__BUILD__',digest.digest('hex').slice(0,20))});
  }
 };
}
