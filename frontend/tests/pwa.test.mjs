import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const publicFile=p=>new URL('../public/'+p,import.meta.url);
test('online manifest has stable identity and separately sized brand icons',()=>{
 const m=JSON.parse(fs.readFileSync(publicFile('manifest.webmanifest')));
 assert.equal(m.id,'/');assert.equal(m.start_url,'/');assert.equal(m.scope,'/');assert.equal(m.display,'standalone');assert.equal(m.name,'Norns');
 for(const size of [192,512]){const icon=m.icons.find(i=>i.sizes===`${size}x${size}`&&i.purpose==='any');assert.ok(icon);const b=fs.readFileSync(publicFile(icon.src.slice(1)));assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size)}
 const mask=m.icons.find(i=>i.purpose==='maskable');assert.ok(mask);assert.equal(mask.sizes,'512x512');
});

import vm from 'node:vm';
test('worker caches only public explanation and never intercepts APIs or writes',async()=>{
 const source=fs.readFileSync(new URL('../pwa-worker.js',import.meta.url),'utf8');
 const handlers={},puts=[];const store={addAll:async paths=>puts.push(...paths)};
 const self={location:{origin:'https://norns.test'},addEventListener:(name,fn)=>handlers[name]=fn};
 const context={self,URL,Response,fetch:async()=>{throw Error('offline')},caches:{open:async()=>store,keys:async()=>[],match:async()=>new Response('public offline',{status:503})}};
 vm.runInNewContext(source,context);
 let job;handlers.install({waitUntil:p=>job=p});await job;assert.deepEqual(puts,['/offline.html']);
 for(const [method,path,mode] of [['GET','/api/tasks','navigate'],['POST','/','navigate'],['GET','/assets/app.js','cors'],['GET','/?secret=x','navigate']]){let handled=false;handlers.fetch({request:{method,url:'https://norns.test'+path,mode},respondWith:()=>handled=true});assert.equal(handled,false)}
 let response;handlers.fetch({request:{method:'GET',url:'https://norns.test/',mode:'navigate'},respondWith:p=>response=p});assert.equal((await response).status,503);
 assert.equal(handlers.message,undefined,'no forced activation protocol');
});

test('update discovery notifies without activating or reloading a document',async()=>{
 const {watchRegistration}=await import('../src/pwa.mjs');
 const callbacks={};let changed=0;const registration={waiting:{},addEventListener:(n,fn)=>callbacks[n]=fn,removeEventListener:(n)=>delete callbacks[n]};
 const stop=watchRegistration(registration,()=>changed++);assert.equal(changed,1);callbacks.updatefound();assert.equal(changed,2);stop();assert.equal(Object.keys(callbacks).length,0);
});
