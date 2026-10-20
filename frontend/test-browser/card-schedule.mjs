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
async function waitBoard(p,predicate){for(let i=0;i<100;i++){const b=await snapshot(p);if(predicate(b))return b;await p.waitForTimeout(50)}assert.fail('persisted board condition timed out')}
async function action(p,data){const b=await snapshot(p);const r=await rpc(p,'/boards/1/mutate',{expected_revision:b.revision,...data});assert.equal(r.status,200);return r.body}
try{
 server=spawn(root+'/target/release/norns',[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'America/Los_Angeles',hasTouch:true}),p=await context.newPage();
 await p.clock.install({time:new Date('2026-10-19T15:59:00Z')});await p.clock.resume();await login(p);
 assert.equal((await rpc(p,'/boards',{title:'卡片日期验收'})).status,201);
 await action(p,{action:'list_create',title:'待办'});
 for(const title of ['今天任务','明天任务','同日范围','跨日范围','部分时间','跨年很长任务标题'.repeat(5),'无日期'])await action(p,{action:'card_create',list_id:1,title});
 async function setSchedule(id,schedule){await action(p,{action:'card_schedule',card_id:id,schedule})}
 // Use the real edit API name discovered in the existing autosave contract.
 const fixtures=[{start_date:'2026-10-19'},{start_date:'2026-10-20',start_time:'09:00'},{start_date:'2026-10-19',start_time:'09:00',end_time:'11:00'},{start_date:'2026-10-19',end_date:'2026-10-20'},{start_date:'2026-10-19',end_date:'2026-10-20',end_time:'11:00'},{start_date:'2026-12-31',end_date:'2027-01-01',start_time:'09:00',end_time:'11:00'}];
 for(const [i,s] of fixtures.entries())await setSchedule(i+1,{timezone:'Asia/Shanghai',...s});
 await p.reload();await p.getByRole('button',{name:/卡片日期验收/}).waitFor();
 await p.evaluate(()=>{const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document),set=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);window.scheduleListeners=new Set();window.scheduleTimers=new Set();document.addEventListener=(type,fn,...rest)=>{if(type==='visibilitychange')window.scheduleListeners.add(fn);return add(type,fn,...rest)};document.removeEventListener=(type,fn,...rest)=>{if(type==='visibilitychange')window.scheduleListeners.delete(fn);return remove(type,fn,...rest)};window.setTimeout=(fn,delay,...args)=>{let id=set(()=>{window.scheduleTimers.delete(id);fn(...args)},delay);if(delay>=60000)window.scheduleTimers.add(id);return id};window.clearTimeout=id=>{window.scheduleTimers.delete(id);clear(id)}});
 await p.getByRole('button',{name:/卡片日期验收/}).click();
 const card=id=>p.locator('.card').nth(id-1);
 if(!process.env.MOBILE_ONLY){
 for(const [id,label] of [[1,'今天'],[2,'明天 09:00'],[3,'今天 09:00–11:00'],[4,'今天—明天'],[5,'今天—明天 11:00'],[6,'2026/12/31 09:00—2027/1/1 11:00']])assert.equal(await card(id).locator('.card-schedule').innerText(),label);
 assert.equal(await card(7).locator('.card-schedule').count(),0);
 assert.equal(await card(3).locator('.card-schedule').getAttribute('title'),'2026-10-19 09:00–11:00 · Asia/Shanghai');
 await card(1).getByRole('checkbox').check();await p.waitForTimeout(300);assert.equal(await p.getByRole('dialog').count(),0);assert.equal((await snapshot(p)).cards[0].completed,true);
 assert.equal(await card(1).locator('.completed .card-schedule').count(),1);await card(1).getByRole('checkbox').uncheck();await p.waitForTimeout(300);
 await p.screenshot({path:evidence+'/desktop-board.png'});checks.push('real persisted schedules render all labels, tooltip, unscheduled omission and checkbox independent');
 await p.clock.pauseAt(new Date('2026-10-19T15:59:59Z'));await p.clock.runFor(1100);
 assert.equal(await card(2).locator('.card-schedule').innerText(),'今天 09:00');checks.push('Beijing midnight updates without reload in America/Los_Angeles browser');
 await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});await p.clock.setSystemTime(new Date('2026-10-20T16:01:00Z'));await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))});
 assert.equal(await card(2).locator('.card-schedule').innerText(),'10/20 09:00');checks.push('visibility resume refreshes stale labels');
 }
 await p.clock.resume();
 // Real narrow viewport controls: full endpoints, recurrence until and short keyboard viewport.
 const geometry=[];
 await p.setViewportSize({width:320,height:844});await card(7).locator('.card-content').click();await p.getByRole('button',{name:'设置日期和重复',exact:true}).click();
 await p.getByLabel('开始日期',{exact:true}).fill('2026-10-21');await p.getByLabel('开始日期',{exact:true}).blur();await waitBoard(p,b=>b.cards[6].schedule?.start_date==='2026-10-21');
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 if(!process.env.MOBILE_ONLY)assert.equal(await card(7).locator('.card-schedule').innerText(),'今天');checks.push('320px single date autosaves and immediately appears on actual board card');
 for(const width of [320,375]){
 await p.setViewportSize({width,height:844});await card(6).locator('.card-content').click();await p.getByRole('button',{name:'设置日期和重复',exact:true}).click();
 for(const [label,value] of [['开始日期','2026-12-31'],['结束日期','2027-01-01'],['开始时间','09:00'],['结束时间','11:00']])await p.getByLabel(label,{exact:true}).fill(value);
 await p.getByLabel('重复',{exact:true}).selectOption('day');await p.getByLabel('重复结束',{exact:true}).selectOption('until');await p.getByLabel('重复截至日期',{exact:true}).fill('2027-02-01');await p.getByLabel('重复截至日期',{exact:true}).blur();
 await waitBoard(p,b=>b.cards[5].schedule?.repeat?.until==='2027-02-01');
 for(const height of [844,440]){
 await p.setViewportSize({width,height});
 for(const label of ['开始日期','开始时间','结束日期','结束时间','重复','重复间隔','重复基准','重复结束','重复截至日期']){
 const input=p.getByLabel(label,{exact:true});await input.scrollIntoViewIfNeeded();await input.focus();await p.waitForTimeout(50);
 const g=await input.evaluate(el=>{const r=el.getBoundingClientRect(),panel=el.closest('.task-panel').getBoundingClientRect(),editor=el.closest('.schedule-editor').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,viewport:innerWidth,panelLeft:panel.left,panelRight:panel.right,editorLeft:editor.left,editorRight:editor.right,top:r.top,bottom:r.bottom,bodyTop:el.closest('.task-panel-body').getBoundingClientRect().top,bodyBottom:el.closest('.task-panel-body').getBoundingClientRect().bottom,scroll:el.closest('.task-panel-body').scrollWidth,client:el.closest('.task-panel-body').clientWidth}});
 geometry.push({viewportWidth:width,height,label,...g});
 }
 await p.getByLabel('开始日期',{exact:true}).focus();await p.getByLabel('开始日期',{exact:true}).scrollIntoViewIfNeeded();await p.waitForTimeout(50);await p.screenshot({path:evidence+`/mobile-editor-${width}-${height}.png`});
 }
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 await p.setViewportSize({width,height:844});await card(6).scrollIntoViewIfNeeded();
 const bounds=await card(6).evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,scroll:el.scrollWidth,client:el.clientWidth,height:r.height,checkbox:el.querySelector('.card-completion').getBoundingClientRect().width}});
 assert.ok(bounds.scroll<=bounds.client+1,'long title/schedule card does not overflow');assert.ok(bounds.checkbox>=44);await p.screenshot({path:evidence+`/mobile-board-${width}.png`});
 }
 fs.writeFileSync(evidence+'/geometry.json',JSON.stringify(geometry,null,2));
 for(const g of geometry){assert.ok(g.left>=g.editorLeft-1&&g.right<=g.editorRight+1,`${g.width}x${g.height} ${g.label} overflows editor: ${JSON.stringify(g)}`);assert.ok(g.top>=g.bodyTop-1&&g.bottom<=g.bodyBottom+1,`focused field outside body: ${JSON.stringify(g)}`);assert.ok(g.scroll<=g.client+1,`${g.width} ${g.label}: nested horizontal overflow`)}
 checks.push('320/375 mobile input bounds at 844/440 heights, endpoints and until persisted, long title/card fits');
 const mounted=await p.evaluate(()=>({listeners:window.scheduleListeners.size,timers:window.scheduleTimers.size}));assert.ok(mounted.listeners>=1);assert.equal(mounted.timers,1);
 await p.getByRole('button',{name:'← 我的看板',exact:true}).click();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor();const unmounted=await p.evaluate(()=>({listeners:window.scheduleListeners.size,timers:window.scheduleTimers.size}));assert.equal(unmounted.listeners,0);assert.equal(unmounted.timers,0);checks.push('board unmount removes visibility listeners and midnight timeout');
 assert.deepEqual(errors,[]);fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,checks,geometryChecks:geometry.length,pageErrors:errors},null,2));console.log('PASS '+evidence);
}catch(e){fs.writeFileSync(evidence+'/failure.txt',e.stack);console.error('FAIL '+evidence,e);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:evidence+'/failure.png'}).catch(()=>{});process.exitCode=1}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
