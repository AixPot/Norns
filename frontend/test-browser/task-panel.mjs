for (const name of ["PLAYWRIGHT_MODULE", "CHROMIUM_PATH", "EVIDENCE_ROOT"]) { if (!process.env[name]) throw Error('Set '+name+' before running this browser test'); }
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
if(!process.env.EVIDENCE_ROOT)throw Error('Set EVIDENCE_ROOT to an existing disposable audit directory');
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),evidence=process.env.EVIDENCE_ROOT+'/run-'+Date.now();fs.mkdirSync(evidence,{mode:0o700});
const password=crypto.randomBytes(24).toString('base64url'),base='http://127.0.0.1:48759';
const env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+evidence+'/norns.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48759',STATIC_DIR:root+'/frontend/dist'};
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(48759,'127.0.0.1',()=>probe.close(resolve))});
assert.equal(spawnSync(root+'/target/release/norns',['init-admin','admin'],{env,input:password,cwd:evidence}).status,0);
let server,browser;const errors=[];const checks=[];const log=fs.openSync(evidence+'/server.log','a');
async function login(p){p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill('admin');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor()}
async function rpc(p,path,body){return p.evaluate(async({path,body})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}},{path,body})}
async function snapshot(p){return (await rpc(p,'/boards/1')).body}
async function action(p,data){const b=await snapshot(p);const r=await rpc(p,'/boards/1/mutate',{expected_revision:b.revision,...data});assert.equal(r.status,200);return r.body}
try{
 server=spawn(root+'/target/release/norns',[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),p=await context.newPage();await login(p);
 await rpc(p,'/boards',{title:'轻量详情验收'});
 let b;for(const title of ['待办','进行中','待确认','完成'])b=await action(p,{action:'list_create',title});
 for(const [i,list] of b.lists.entries())await action(p,{action:'card_create',list_id:list.id,title:'任务'+(i+1),description:i===0?'现有任务内容\n'+('内容优先，操作固定在顶部。\n'.repeat(60)):''});
 await p.reload();await p.getByRole('button',{name:/轻量详情验收/}).click();
 // A leave request must inspect auxiliary input created while its autosave flush waits.
 for(const leave of ['close','switch','navigation']){
  await p.getByRole('group',{name:'任务1',exact:true}).locator('.card-content').click();
  
  let release,capture;const gate=new Promise(r=>release=r),captured=new Promise(r=>capture=r);let held=false;
  await p.route('**/api/boards/1/mutate',async route=>{if(held)return route.continue();held=true;const response=await route.fetch();capture();await gate;await route.fulfill({response})});
  await p.getByLabel('描述',{exact:true}).fill(`saved before ${leave}`);await captured;
  if(leave==='close')await p.getByRole('button',{name:'关闭卡片',exact:true}).click();
  else if(leave==='switch')await p.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click();
  else await p.getByRole('button',{name:'← 我的看板',exact:true}).click();
  await p.getByRole('button',{name:'发表评论',exact:true}).click();
  const unsent=`unsent during ${leave}`;await p.getByRole('textbox',{name:'发表评论',exact:true}).fill(unsent);
  let prompts=0;const dismiss=async dialog=>{prompts++;await dialog.dismiss()};p.on('dialog',dismiss);
  const responded=p.waitForResponse(r=>r.url().endsWith('/api/boards/1/mutate'));release();await responded;await p.waitForTimeout(250);
  const outcome={leave,panelCount:await p.getByRole('dialog').count(),prompts,comments:(await snapshot(p)).comments};
  fs.writeFileSync(evidence+`/leave-${leave}.json`,JSON.stringify(outcome,null,2));
  assert.equal(outcome.panelCount,1,`${leave}: auxiliary draft created during flush must keep panel open`);
  assert.ok(prompts>=1,`${leave}: leaving must ask before discarding the new auxiliary draft`);
  assert.equal(await p.getByRole('textbox',{name:'发表评论',exact:true}).inputValue(),unsent);
  assert.equal(outcome.comments.length,0,'unsent comments must not be posted automatically');
  assert.equal((await snapshot(p)).cards.find(c=>c.id===1).description,`saved before ${leave}`);
  p.off('dialog',dismiss);let confirmations=0;const accept=async dialog=>{confirmations++;await dialog.accept()};p.on('dialog',accept);
  await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(confirmations,1,'existing auxiliary draft requires only one discard confirmation');p.off('dialog',accept);
  await p.unroute('**/api/boards/1/mutate');checks.push(`${leave} rechecks auxiliary input after held autosave`);
 }
 const card=p.getByRole('group',{name:'任务1',exact:true});await card.locator('.card-content').click();
 // Restore long content for the scrolling checks after the race fixtures.
 await action(p,{action:'card_update',card_id:1,title:'任务1',description:'现有任务内容\n'+('内容优先，操作固定在顶部。\n'.repeat(60)),archived:false});
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();
 await p.getByRole('button',{name:'刷新看板',exact:true}).click();
 await card.locator('.card-content').click();await p.getByRole('dialog').waitFor();
 const cb=await card.boundingBox(),pb=await p.getByRole('dialog').boundingBox();
 assert.ok(pb.x>=cb.x+cb.width||pb.x+pb.width<=cb.x,'panel must be beside clicked card');
 assert.equal(await p.getByLabel('描述',{exact:true}).count(),1,'description directly editable on open');
 await p.screenshot({path:evidence+'/desktop-anchored.png'});checks.push('desktop anchored content-first');

 // Fixed actions with long content; reveal editor only on demand.
 const longDescription=p.getByLabel('描述',{exact:true});
 assert.ok(await longDescription.evaluate(el=>el.scrollHeight<=el.clientHeight+2),'long description expands so only the panel body scrolls');
 const bottomToolbar=await p.getByRole('toolbar',{name:'卡片底部操作'}).boundingBox();
 const toolbar=await p.getByRole('toolbar',{name:'卡片顶部操作'}).boundingBox();await p.locator('.task-panel-body').evaluate(el=>el.scrollTop=el.scrollHeight);
 assert.deepEqual(await p.getByRole('toolbar',{name:'卡片顶部操作'}).boundingBox(),toolbar);assert.deepEqual(await p.getByRole('toolbar',{name:'卡片底部操作'}).boundingBox(),bottomToolbar);checks.push('long content body-only scrolling');
 
 const title=p.getByLabel('卡片标题',{exact:true}),description=p.getByLabel('描述',{exact:true});
 await title.fill('自动保存标题');await description.fill('输入后自动保存');await p.getByText('已保存',{exact:true}).first().waitFor();
 await p.waitForTimeout(850);assert.equal((await snapshot(p)).cards.find(c=>c.id===1).description,'输入后自动保存');
 assert.equal(await description.evaluate(el=>el===document.activeElement),true);checks.push('debounce persistence without focus loss');
 await description.fill('blur 保存');await title.focus();await p.waitForTimeout(250);assert.equal((await snapshot(p)).cards.find(c=>c.id===1).description,'blur 保存');
 // Hold a real committed response; newer keystrokes must be sent serially, with unchanged DOM/caret.
 let release,capture;const gate=new Promise(r=>release=r),captured=new Promise(r=>capture=r);let held=false,inFlight=0,maxFlight=0;
 await p.route('**/api/boards/1/mutate',async route=>{inFlight++;maxFlight=Math.max(maxFlight,inFlight);try{if(!held){held=true;const response=await route.fetch();capture();await gate;await route.fulfill({response})}else await route.continue()}finally{inFlight--}});
 await description.fill('first in flight');await captured;
 await description.fill('latest while saving');await description.evaluate(el=>{window.savedNode=el;el.setSelectionRange(4,4)});release();await p.waitForTimeout(500);
 assert.equal((await snapshot(p)).cards.find(c=>c.id===1).description,'latest while saving');
 assert.deepEqual(await description.evaluate(el=>[el===window.savedNode,el===document.activeElement,el.selectionStart]),[true,true,4]);assert.equal(maxFlight,1);await p.unroute('**/api/boards/1/mutate');checks.push('in-flight serialization latest text/caret');
 // Composition input cannot be sent mid-composition, including blur/close.
 let requests=0;await p.route('**/api/boards/1/mutate',async route=>{requests++;await route.continue()});
 await description.dispatchEvent('compositionstart');await description.fill('中文组合输入');await p.waitForTimeout(800);
 assert.equal(requests,0);await p.getByRole('button',{name:'关闭卡片',exact:true}).click();assert.equal(await p.getByRole('dialog').count(),1);
 await description.dispatchEvent('compositionend');await p.waitForTimeout(800);assert.equal(requests,1);await p.unroute('**/api/boards/1/mutate');
 await p.getByRole('button',{name:'知道了',exact:true}).click();checks.push('IME defers writes and close');
 // Transport failure keeps live input and blocks close/switch until explicit retry.
 await p.route('**/api/boards/1/mutate',route=>route.abort('failed'));
 await description.fill('失败后仍保留');await p.getByText('保存失败，输入已保留。',{exact:true}).waitFor();
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();assert.equal(await p.getByRole('dialog').count(),1);
 await p.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click();assert.equal(await p.getByLabel('描述',{exact:true}).inputValue(),'失败后仍保留');
 await p.screenshot({path:evidence+'/error-retention.png'});await p.unroute('**/api/boards/1/mutate');await p.getByRole('button',{name:'重试保存',exact:true}).click();await p.waitForTimeout(400);assert.equal((await snapshot(p)).cards.find(c=>c.id===1).description,'失败后仍保留');checks.push('error retained retry close/switch safeguard');
 // Real independent revision conflict. Unchanged remote title must survive local description retry.
 await action(p,{action:'card_update',card_id:1,title:'外部改名',description:'外部描述',archived:false});
 await description.fill('冲突本地输入');await p.getByText('版本冲突，输入已保留。',{exact:true}).waitFor();
 assert.equal((await snapshot(p)).cards.find(c=>c.id===1).title,'外部改名');await p.getByRole('button',{name:'查看最新版本并处理',exact:true}).click();
 await p.getByRole('heading',{name:/最新版本/}).waitFor();assert.equal(await description.inputValue(),'冲突本地输入');await p.screenshot({path:evidence+'/conflict-review.png'});
 await p.getByRole('button',{name:'保留我的修改并重试',exact:true}).click();await p.waitForTimeout(500);
 const rebased=await snapshot(p);assert.equal(rebased.cards.find(c=>c.id===1).description,'冲突本地输入');assert.equal(rebased.cards.find(c=>c.id===1).title,'外部改名','unchanged remote fields must not be overwritten');checks.push('real409 explicit review preserves untouched remote fields');
 // Immediate selectors, and text saved before checklist/comment actions.
 await p.getByRole('button',{name:'负责人',exact:true}).click();await p.getByRole('combobox',{name:'负责人',exact:true}).selectOption('1');await p.waitForTimeout(200);await p.getByRole('button',{name:'设置日期和重复',exact:true}).click();await p.getByLabel('开始日期',{exact:true}).fill('2026-12-31');await p.getByLabel('开始日期',{exact:true}).blur();await p.locator('.task-save').filter({hasText:'已保存'}).waitFor();
 assert.equal((await snapshot(p)).cards.find(c=>c.id===1).due_date,'2026-12-31');assert.equal((await snapshot(p)).cards.find(c=>c.id===1).assignee_id,1);
 await p.getByRole('button',{name:'添加清单条目',exact:true}).click();await p.getByLabel('新清单条目',{exact:true}).fill('验收清单');await p.getByRole('button',{name:'添加条目',exact:true}).click();await p.getByLabel('完成 验收清单',{exact:true}).check();
 await p.getByRole('button',{name:'发表评论',exact:true}).click();await p.getByRole('textbox',{name:'发表评论',exact:true}).fill('正式评论');await p.getByRole('button',{name:'发送评论',exact:true}).click();await p.getByText('正式评论',{exact:true}).waitFor();checks.push('selectors checklist comments');
 // Closing during a held committed response waits, then drains newer input before removing the panel.
 
 let releaseClose,captureClose;const closeGate=new Promise(r=>releaseClose=r),closeCaptured=new Promise(r=>captureClose=r);let firstClose=true;
 await p.route('**/api/boards/1/mutate',async route=>{if(!firstClose)return route.continue();firstClose=false;const response=await route.fetch();captureClose();await closeGate;await route.fulfill({response})});
 await p.getByLabel('描述',{exact:true}).fill('close first request');await closeCaptured;await p.getByLabel('描述',{exact:true}).fill('close latest input');await p.getByRole('button',{name:'关闭卡片',exact:true}).click();assert.equal(await p.getByRole('dialog').count(),1);releaseClose();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await snapshot(p)).cards.find(c=>c.id===1).description,'close latest input');await p.unroute('**/api/boards/1/mutate');checks.push('close waits for in-flight latest input drain');
 await p.getByRole('group',{name:'外部改名',exact:true}).locator('.card-content').click();
 // Pending input flush on switch and close, then reload verifies persistence.
 await p.getByLabel('描述',{exact:true}).fill('切换前必须保存');
 await p.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click();await p.waitForFunction(()=>document.querySelector('input[aria-label="卡片标题"]')?.value==='任务2');assert.equal((await snapshot(p)).cards.find(c=>c.id===1).description,'切换前必须保存');
 await p.getByLabel('描述',{exact:true}).fill('关闭前必须保存');await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await snapshot(p)).cards.find(c=>c.id===2).description,'关闭前必须保存');
 await p.reload();await p.getByRole('button',{name:/轻量详情验收/}).click();await p.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click();assert.equal(await p.getByLabel('描述',{exact:true}).inputValue(),'关闭前必须保存');await p.getByRole('button',{name:'关闭卡片',exact:true}).click();checks.push('switch close flush reload persistence');
 // Existing attachment rendering with explicit list fixture (not a real-provider storage claim).
 await p.route('**/api/boards/1/cards/4/attachments',route=>route.fulfill({json:{configured:true,max_bytes:16777216,items:[{id:'synthetic',filename:'已有关联资料.txt',size:12,mime:'text/plain',state:'ready'}]}}));
 // Right edge flips left, staying fully in bounds.
 const edge=p.getByRole('group',{name:'任务4',exact:true});await edge.scrollIntoViewIfNeeded();await edge.locator('.card-content').click();const eb=await edge.boundingBox(),ep=await p.getByRole('dialog').boundingBox();assert.ok(ep.x+ep.width<=eb.x);assert.ok(ep.x>=0&&ep.y>=0&&ep.x+ep.width<=1440&&ep.y+ep.height<=900);await p.getByText('已有关联资料.txt · 12 字节 · ready',{exact:true}).waitFor();assert.equal(await p.getByLabel('选择附件',{exact:true}).count(),0);await p.getByRole('button',{name:'添加附件',exact:true}).click();await p.getByLabel('选择附件',{exact:true}).waitFor();await p.screenshot({path:evidence+'/desktop-flipped.png'});checks.push('attachment list fixture content and on-demand upload controls');await p.getByRole('button',{name:'关闭卡片',exact:true}).click();checks.push('right edge flips and clamps');
 // Archive stays in More, persists immediately and is reversible; movement uses existing API.
 await p.getByRole('group',{name:'任务3',exact:true}).locator('.card-content').click();assert.equal(await p.getByRole('button',{name:'归档卡片',exact:true}).count(),0);await p.getByRole('button',{name:'更多操作',exact:true}).click();await p.getByRole('button',{name:'归档卡片',exact:true}).click();await p.waitForTimeout(300);assert.equal((await snapshot(p)).cards.find(c=>c.id===3).archived,true);await p.getByRole('button',{name:'更多操作',exact:true}).click();await p.getByRole('button',{name:'恢复卡片',exact:true}).click();await p.waitForTimeout(300);assert.equal((await snapshot(p)).cards.find(c=>c.id===3).archived,false);
 await p.getByRole('button',{name:'移动卡片',exact:true}).click();await p.getByLabel('目标列表',{exact:true}).selectOption('1');await p.getByRole('button',{name:'移动到此位置',exact:true}).click();await p.waitForTimeout(300);assert.equal((await snapshot(p)).cards.find(c=>c.id===3).list_id,1);await p.getByRole('button',{name:'关闭卡片',exact:true}).click();checks.push('more archive restore and on-demand move');
 // Navigation uses the same flush guard; no abandoned draft resurrects after a response.
 await p.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click();await p.getByLabel('描述',{exact:true}).fill('离开看板前自动保存');await p.getByRole('button',{name:'← 我的看板',exact:true}).click();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor();assert.equal(await p.getByRole('dialog').count(),0);assert.equal((await snapshot(p)).cards.find(c=>c.id===2).description,'离开看板前自动保存');checks.push('overview navigation flush');
 // Mobile sheet, accessible editor focus and keyboard-sized viewport.
 const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const m=await phone.newPage();await login(m);await m.getByRole('button',{name:/轻量详情验收/}).click();await m.getByRole('group',{name:'外部改名',exact:true}).locator('.card-content').click();
 assert.equal(await m.getByRole('dialog').getAttribute('aria-modal'),'true');assert.equal(await m.locator('.app-shell').evaluate(el=>el.inert),true,'mobile background must be inert');await m.getByLabel('描述',{exact:true}).fill('手机输入保持焦点');await m.waitForTimeout(800);assert.equal(await m.getByLabel('描述',{exact:true}).evaluate(el=>el===document.activeElement),true);
 await m.setViewportSize({width:390,height:440});await m.getByLabel('描述',{exact:true}).focus();await m.waitForTimeout(100);const mobileBox=await m.getByRole('dialog').boundingBox();assert.ok(mobileBox.y>=0&&mobileBox.y+mobileBox.height<=440);const inputBox=await m.getByLabel('描述',{exact:true}).boundingBox(),mt=await m.getByRole('toolbar',{name:'卡片顶部操作'}).boundingBox();assert.ok(inputBox.y>=mt.y+mt.height&&inputBox.y+inputBox.height<=mobileBox.y+mobileBox.height,'focused mobile editor must scroll fully above keyboard');await m.screenshot({path:evidence+'/mobile-keyboard-sized.png'});
 await m.getByRole('button',{name:'关闭卡片',exact:true}).click();await m.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await snapshot(m)).cards.find(c=>c.id===1).description,'手机输入保持焦点');checks.push('mobile sheet keyboard viewport focus persistence');

 fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors},null,2));assert.deepEqual(errors,[]);console.log('PASS '+evidence);
}catch(e){fs.writeFileSync(evidence+'/failure.txt',e.stack);console.error('FAIL '+evidence,e);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:evidence+'/failure.png'}).catch(()=>{});process.exitCode=1}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
