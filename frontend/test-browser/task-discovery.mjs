for (const name of ["PLAYWRIGHT_MODULE", "CHROMIUM_PATH", "EVIDENCE_ROOT"]) { if (!process.env[name]) throw Error("Set "+name+" before running this browser test"); }
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
if(!process.env.EVIDENCE_ROOT)throw Error('Set EVIDENCE_ROOT to a disposable audit directory');
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),evidence=process.env.EVIDENCE_ROOT+'/discovery-'+Date.now();fs.mkdirSync(evidence,{mode:0o700});
const password=crypto.randomBytes(24).toString('base64url'),base='http://127.0.0.1:48759';
const env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+evidence+'/norns.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48759',STATIC_DIR:root+'/frontend/dist'};
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(48759,'127.0.0.1',()=>probe.close(resolve))});
assert.equal(spawnSync(root+'/target/release/norns',['init-admin','admin'],{env,input:password,cwd:evidence}).status,0);
let server,browser;const errors=[],checks=[];const log=fs.openSync(evidence+'/server.log','a');
async function rpc(p,path,body){return p.evaluate(async({path,body})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}},{path,body})}
async function snapshot(p,id=1){return (await rpc(p,'/boards/'+id)).body}
async function action(p,id,data){const b=await snapshot(p,id);const r=await rpc(p,`/boards/${id}/mutate`,{expected_revision:b.revision,...data});assert.equal(r.status,200,JSON.stringify(r));return r.body}
async function results(p,n){await p.waitForFunction(n=>document.querySelectorAll('.task-result').length===n,n);await p.waitForTimeout(80)}
try{
 server=spawn(root+'/target/release/norns',[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);assert.equal(await p.getByRole('link',{name:'源代码',exact:true}).getAttribute('href'),'https://github.com/AixPot/Norns');
 await p.getByLabel('用户名',{exact:true}).fill('admin');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor();
 for(const title of ['第一看板','第二看板']){
  const board=(await rpc(p,'/boards',{title})).body;let b=await action(p,board.id,{action:'list_create',title:'进行中'});
  b=await action(p,board.id,{action:'card_create',list_id:b.lists[0].id,title:title==='第一看板'?'搜索目标':'其他工作',description:'中文 needle 100%_'});
  await action(p,board.id,{action:'card_details',card_id:b.cards[0].id,assignee_id:1,due_date:'2028-02-29'});
 }
 await p.reload();await p.getByRole('button',{name:'任务',exact:true}).click();await results(p,2);
 assert.equal(await p.locator('.topbar').getByRole('link',{name:'源代码',exact:true}).count(),0);
 await p.getByLabel('任务关键词',{exact:true}).fill('needle 100%_');await results(p,2);
 await p.getByLabel('筛选看板',{exact:true}).selectOption('1');await results(p,1);
 await p.getByLabel('筛选负责人',{exact:true}).selectOption('1');await p.getByLabel('完成状态',{exact:true}).selectOption('incomplete');await p.getByLabel('筛选开始日期',{exact:true}).fill('2028-02-29');await p.getByLabel('筛选结束日期',{exact:true}).fill('2028-02-29');await results(p,1);
 await p.screenshot({path:evidence+'/combined-desktop.png'});checks.push('literal description search + board/assignee/completion/inclusive date combined');
 await p.locator('.task-result').click();await p.getByLabel('卡片标题',{exact:true}).waitFor();
 await p.getByLabel('描述',{exact:true}).fill('保存后仍含 needle 100%_');await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal((await snapshot(p)).cards[0].description,'保存后仍含 needle 100%_');assert.equal(await p.getByLabel('任务关键词',{exact:true}).inputValue(),'needle 100%_');await results(p,1);checks.push('original detail serial autosave + close flush + filter-preserving return');
 // A delayed original-board read must not open a task after the filters have changed.
 let releaseOpen,capturedOpen;const openGate=new Promise(r=>releaseOpen=r),openCaptured=new Promise(r=>capturedOpen=r);let heldOpen=false;
 await p.route('**/api/boards/1',async route=>{if(heldOpen)return route.continue();heldOpen=true;const response=await route.fetch();capturedOpen();await openGate;await route.fulfill({response})});
 await p.locator('.task-result').click();await openCaptured;await p.getByRole('button',{name:'清除筛选',exact:true}).click();await results(p,2);releaseOpen();await p.waitForTimeout(200);assert.equal(await p.getByRole('dialog').count(),0,'obsolete original-board read must not reopen detail');await p.unroute('**/api/boards/1');
 await p.getByLabel('筛选看板',{exact:true}).selectOption('1');await p.getByLabel('完成状态',{exact:true}).selectOption('incomplete');await results(p,1);
 // Real board revision conflict from another write; no implicit rebase on aggregate.
 await p.locator('.task-result').click();await p.getByLabel('描述',{exact:true}).waitFor();await action(p,1,{action:'card_update',card_id:1,title:'远端改名',description:'外部描述',archived:false});
 await p.getByLabel('描述',{exact:true}).fill('冲突保留 needle 100%_');await p.getByText('版本冲突，输入已保留。',{exact:true}).waitFor();
 await p.getByLabel('完成状态',{exact:true}).selectOption('complete');await p.waitForTimeout(100);assert.equal(await p.getByLabel('完成状态',{exact:true}).inputValue(),'incomplete','blocked filter must restore control value');await p.getByRole('button',{name:'今天',exact:true}).click();assert.equal(await p.getByRole('dialog').count(),1);assert.equal(await p.getByLabel('描述',{exact:true}).inputValue(),'冲突保留 needle 100%_');
 await p.getByRole('button',{name:'查看最新版本并处理',exact:true}).click();await p.getByRole('button',{name:'保留我的修改并重试',exact:true}).click();await p.waitForTimeout(400);
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await snapshot(p)).cards[0].title,'远端改名');assert.equal((await snapshot(p)).cards[0].description,'冲突保留 needle 100%_');checks.push('aggregate navigation blocks on real409; explicit review retains local and untouched remote fields');
 await p.getByRole('button',{name:'清除筛选',exact:true}).click();await results(p,2);await p.getByRole('button',{name:'我的任务',exact:true}).click();await results(p,2);
 await p.getByRole('button',{name:'今天',exact:true}).click();await results(p,0);await p.getByRole('button',{name:'即将到期',exact:true}).click();await results(p,0);checks.push('my tasks and clearly bounded today/upcoming views');
 await p.getByRole('button',{name:'清除筛选',exact:true}).click();await results(p,2);
 for(const width of [320,375]){
  await p.setViewportSize({width,height:844});await p.screenshot({path:evidence+`/mobile-${width}.png`});
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width} page overflow`);
  for(const input of await p.locator('.task-filters input,.task-filters select,.task-tabs button').all()) {const box=await input.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);}
  await p.locator('.task-result').first().click();await p.getByLabel('描述',{exact:true}).fill(`移动保存 needle ${width}`);await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});await results(p,2);
  assert.equal((await snapshot(p)).cards[0].description,`移动保存 needle ${width}`);
 }
 checks.push('320/375px accessible controls, no horizontal page overflow, real detail save and return');assert.deepEqual(errors,[]);
 fs.writeFileSync(evidence+'/result.json',JSON.stringify({ok:true,checks,errors},null,2));console.log(JSON.stringify({evidence,checks},null,2));
}catch(e){fs.writeFileSync(evidence+'/failure.txt',String(e.stack));if(browser){const pages=browser.contexts().flatMap(c=>c.pages());if(pages[0])await pages[0].screenshot({path:evidence+'/failure.png'})}throw e}
finally{await browser?.close();if(server){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
