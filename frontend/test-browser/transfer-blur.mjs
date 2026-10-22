for(const name of ['PLAYWRIGHT_MODULE','CHROMIUM_PATH','EVIDENCE_ROOT'])if(!process.env[name])throw Error('Set '+name);
import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),out=process.env.EVIDENCE_ROOT+'/session-probe-'+Date.now();fs.mkdirSync(out,{mode:0o700});
const base='http://127.0.0.1:48771',password=crypto.randomBytes(24).toString('base64url'),env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+out+'/synthetic.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48771',STATIC_DIR:root+'/frontend/dist'};
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(48771,'127.0.0.1',()=>s.close(resolve))});
assert.equal(spawnSync(root+'/target/release/norns',['init-admin','admin'],{env,input:password,cwd:out}).status,0);
let server,browser,s3;const checks=[],errors=[],consoleErrors=[];const log=fs.openSync(out+'/server.log','a');
async function rpc(p,path,body,method=body?'POST':'GET'){return p.evaluate(async({path,body,method})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?null:await r.json()}},{path,body,method})}
const snapshot=async(p,id)=>(await rpc(p,'/boards/'+id)).body;
async function action(p,id,data){const b=await snapshot(p,id),r=await rpc(p,`/boards/${id}/mutate`,{expected_revision:b.revision,...data});assert.equal(r.status,200,JSON.stringify(r));return r.body}
let stage='boot';const diagnostics=[],network=[];
async function login(p,name='admin',pass=password){p.on('request',r=>{network.push({stage,url:r.url(),method:r.method(),t:Date.now()});if(network.length>80)network.shift()});p.on('pageerror',e=>{diagnostics.push({stage,stack:e.stack,url:p.url(),network:[...network]});fs.writeFileSync(out+'/pageerror-diagnostics.json',JSON.stringify(diagnostics,null,2))});p.on('pageerror',e=>errors.push(e.stack));p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill(name);await p.getByLabel('密码',{exact:true}).fill(pass);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor()}
async function nav(p,name){if(await p.getByLabel('打开导航',{exact:true}).isVisible()){await p.getByLabel('打开导航',{exact:true}).click();await p.getByRole('dialog',{name:'导航'}).getByRole('button',{name,exact:true}).click()}else await p.getByRole('button',{name,exact:true}).click();if(['项目清单','另一个清单'].includes(name))await p.getByRole('heading',{name,exact:true}).waitFor()}
async function titles(p,expected){await p.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.smart-results .task-result strong')].map(x=>x.textContent).sort())===JSON.stringify(expected.sort()),expected)}
async function close(p){await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.locator('.task-panel').waitFor({state:'hidden'})}
async function persist(p,id,predicate){for(let n=0;n<100;n++){const b=await snapshot(p,id);if(predicate(b))return b;await p.waitForTimeout(50)}throw Error('persistence timeout')}
try{
 if(process.env.LOCAL_S3_MODULE){
  const {default:S3rver}=await import(process.env.LOCAL_S3_MODULE);const objectDir=out+'/objects';fs.mkdirSync(objectDir);
  s3=new S3rver({address:'127.0.0.1',port:48772,silent:true,directory:objectDir,allowMismatchedSignatures:false,configureBuckets:[{name:'synthetic-frontend',configs:[Buffer.from('<CORSConfiguration><CORSRule><AllowedOrigin>'+base+'</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader></CORSRule></CORSConfiguration>')]}]});await s3.run();Object.assign(env,{S3_ENDPOINT:'http://127.0.0.1:48772',S3_REGION:'us-east-1',S3_BUCKET:'synthetic-frontend',S3_ACCESS_KEY_ID:'S3RVER',S3_SECRET_ACCESS_KEY:'S3RVER',ATTACHMENT_MAX_BYTES:'4096',ATTACHMENT_BOARD_QUOTA_BYTES:'4096'});
 }
 server=spawn(root+'/target/release/norns',[],{env,cwd:out,stdio:['ignore',log,log]});fs.closeSync(log);for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addInitScript(()=>{window.workspaceFrames=[];new MutationObserver(()=>{if(document.querySelector('.three-pane-shell')&&!window.workspaceFrames.length)window.workspaceFrames.push({theme:document.documentElement.dataset.theme,scheme:document.documentElement.style.colorScheme,meta:document.querySelector('meta[name="theme-color"]')?.content})}).observe(document,{subtree:true,childList:true})});await ctx.route('**/api/**',async route=>{const response=await route.fetch();const path=new URL(route.request().url()).pathname;await new Promise(r=>setTimeout(r,path.endsWith('/logout')?110:path.includes('/boards/')?40:15));await route.fulfill({response})});const p=await ctx.newPage();await login(p);


 stage='pointer blur transfer intent';
 const ib=(await rpc(p,'/inbox')).body;let tb=(await rpc(p,'/boards',{title:'Quality target'})).body;tb=await action(p,tb.id,{action:'list_create',title:'Target'});
 let b=await action(p,ib.id,{action:'card_create',list_id:ib.lists[0].id,title:'Pointer private'});const card=b.cards[0];
 await p.reload();await nav(p,'收集箱');await titles(p,['Pointer private']);await p.locator('.smart-row .task-result').click();
 await p.evaluate(()=>{window.pointerTrace=[];for(const type of ['pointerdown','blur','pointerup','click'])document.addEventListener(type,e=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='移入普通看板');window.pointerTrace.push({type,target:e.target.getAttribute('aria-label')||e.target.textContent?.slice(0,25),disabled:b?.disabled,t:performance.now()})},true)});
 let release,started;const gate=new Promise(r=>release=r),held=new Promise(r=>started=r);let saves=0;
 await p.route(`**/api/boards/${ib.id}/mutate`,async route=>{saves++;const response=await route.fetch();started();await gate;await route.fulfill({response})});
 await p.getByLabel('卡片标题',{exact:true}).fill('Pointer saved');
 const btn=p.getByRole('button',{name:'移入普通看板',exact:true}),box=await btn.boundingBox();
 await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await held;await p.mouse.up();
 await p.waitForTimeout(50);const trace=await p.evaluate(()=>window.pointerTrace);fs.writeFileSync(out+'/pointer-events.json',JSON.stringify(trace,null,2));
 assert.ok(trace.some(x=>x.type==='click'&&x.target==='移入普通看板'));assert.equal(await btn.isDisabled(),true,'accepted transfer intent prevents duplicates');assert.ok(trace.some(x=>x.type==='blur'));assert.equal(await p.locator('.transfer-dialog').count(),0,'preview cannot precede save acknowledgement');
 release();await p.unrouteAll({behavior:'wait'});
 await p.locator('.transfer-dialog').waitFor({timeout:2000});
 assert.equal((await snapshot(p,ib.id)).cards[0].title,'Pointer saved');assert.equal(saves,1);
 checks.push('single real pointerdown/blur/pointerup/click accepts transfer intent; dialog opens only after real save acknowledged; exactly one save');
 await p.getByLabel('转移目标看板',{exact:true}).selectOption(String(tb.id));await p.getByRole('button',{name:'获取最新完整预览',exact:true}).click();await p.locator('.transfer-summary').waitFor();

 await p.getByRole('button',{name:'取消',exact:true}).click();
 // An auxiliary draft entered while text save awaits acknowledgement must survive.
 await p.locator('.smart-row .task-result').click();
 await p.getByRole('button',{name:'发表评论',exact:true}).click();
 let releaseAux,startAux;const auxGate=new Promise(r=>releaseAux=r),auxHeld=new Promise(r=>startAux=r);
 await p.route(`**/api/boards/${ib.id}/mutate`,async route=>{const response=await route.fetch();startAux();await auxGate;await route.fulfill({response})});
 await p.getByLabel('卡片标题',{exact:true}).fill('Auxiliary saved');await btn.click();await auxHeld;
 await p.getByRole('textbox',{name:'发表评论',exact:true}).fill('Unsent while waiting');releaseAux();await p.unrouteAll({behavior:'wait'});
 await p.locator('.task-alert').filter({hasText:'请先完成输入，并发送或清空未发送的评论、清单和附件队列，再转移。'}).waitFor();
 assert.equal(await p.getByRole('textbox',{name:'发表评论',exact:true}).inputValue(),'Unsent while waiting');assert.equal(await p.locator('.transfer-dialog').count(),0);assert.equal((await snapshot(p,ib.id)).comments.length,0);
 await p.getByRole('textbox',{name:'发表评论',exact:true}).fill('');
 await p.getByLabel('卡片标题',{exact:true}).dispatchEvent('compositionstart');await btn.click();assert.equal(await p.locator('.transfer-dialog').count(),0);await p.getByLabel('卡片标题',{exact:true}).dispatchEvent('compositionend');
 checks.push('auxiliary draft created during held save and IME prevent transfer; comment preserved and never published');
 // Navigation accepted during save owns the leave; the old transfer cannot open later.
 let releaseNav,startNav;const navGate=new Promise(r=>releaseNav=r),navHeld=new Promise(r=>startNav=r);
 await p.route(`**/api/boards/${ib.id}/mutate`,async route=>{const response=await route.fetch();startNav();await navGate;await route.fulfill({response})});
 await p.getByLabel('卡片标题',{exact:true}).fill('Navigation saved');await btn.click();await navHeld;
 await nav(p,'明天');releaseNav();await p.unrouteAll({behavior:'wait'});await p.getByRole('heading',{name:'明天',exact:true}).waitFor();
 assert.equal(await p.locator('.transfer-dialog,.task-panel').count(),0);assert.equal((await snapshot(p,ib.id)).cards[0].title,'Navigation saved');
 checks.push('navigation during accepted transfer save prevents stale dialog after release; saved title persists');
 fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors,trace},null,2));assert.deepEqual(errors,[]);console.log('PASS '+out);
}catch(e){fs.writeFileSync(out+'/diagnostics.json',JSON.stringify({stage,pageErrors:errors,network},null,2));fs.writeFileSync(out+'/failure.txt',e.stack);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:out+'/failure.png'}).catch(()=>{});console.error('FAIL '+out,e);process.exitCode=1}finally{await browser?.close();await s3?.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
