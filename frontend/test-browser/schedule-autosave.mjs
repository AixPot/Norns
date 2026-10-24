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
assert.equal(spawnSync((process.env.NORNS_BINARY||root+'/target/release/norns'),['init-admin','admin'],{env,input:password,cwd:evidence}).status,0);
let server,browser;const errors=[];const checks=[];const log=fs.openSync(evidence+'/server.log','a');
async function login(p){p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill('admin');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor()}
async function rpc(p,path,body){return p.evaluate(async({path,body})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}},{path,body})}
async function snapshot(p){return (await rpc(p,'/boards/2')).body}
async function waitBoard(p,predicate){for(let i=0;i<100;i++){const b=await snapshot(p);if(predicate(b))return b;await p.waitForTimeout(50)}assert.fail('persisted board condition timed out')}
async function action(p,data){const b=await snapshot(p);const r=await rpc(p,'/boards/2/mutate',{expected_revision:b.revision,...data});assert.equal(r.status,200);return r.body}

async function shellNav(p,name,regex=false){if(await p.getByLabel('打开导航',{exact:true}).isVisible()){await p.getByLabel('打开导航',{exact:true}).click();await p.getByRole('dialog',{name:'导航'}).getByRole('button',{name:regex?new RegExp(name):name,exact:!regex}).click()}else await p.getByRole('button',{name:regex?new RegExp(name):name,exact:!regex}).click()}
try{
 server=spawn((process.env.NORNS_BINARY||root+'/target/release/norns'),[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),p=await context.newPage();await login(p);
 await rpc(p,'/boards',{title:'轻量详情验收'});
 let b;for(const title of ['待办','进行中','待确认','完成'])b=await action(p,{action:'list_create',title});
 for(const [i,list] of b.lists.entries())await action(p,{action:'card_create',list_id:list.id,title:'任务'+(i+1),description:i===0?'现有任务内容\n'+('内容优先，操作固定在顶部。\n'.repeat(60)):''});
 await p.reload();await p.getByRole('button',{name:/轻量详情验收/}).click();


 const field=name=>p.getByLabel(name,{exact:true});
 const button=name=>p.getByRole('button',{name,exact:true});
 const open=async(name='任务1')=>{await p.getByRole('group',{name,exact:true}).locator('.card-content').click();await field('卡片标题').waitFor()};
 const schedule=()=>button('设置日期和重复').click();
 const saved=()=>p.locator('.task-save').filter({hasText:'已保存'}).waitFor();
 await open();await schedule();await field('开始日期').fill('2028-01-02');await field('开始时间').focus();
 await waitBoard(p,b=>b.cards[0].schedule?.start_date==='2028-01-02');await saved();
 await field('重复').selectOption('day');await field('重复间隔').fill('2');
 await waitBoard(p,b=>b.cards[0].schedule?.repeat?.interval===2);await saved();
 await button('关闭卡片').click();await p.getByRole('dialog').waitFor({state:'hidden'});
 await p.reload();await p.getByRole('button',{name:/轻量详情验收/}).click();await open();await schedule();
 assert.equal(await field('开始日期').inputValue(),'2028-01-02');assert.equal(await field('重复间隔').inputValue(),'2');
 checks.push('date blur and recurrence debounce persist actual backend, reopen/reload');
 // Real committed response held: further date/repeat/text edits stay live and drain in the same queue.
 let release,capture;const gate=new Promise(r=>release=r),captured=new Promise(r=>capture=r);let held=false,flight=0,maxFlight=0;
 await p.route('**/api/boards/2/mutate',async route=>{flight++;maxFlight=Math.max(maxFlight,flight);try{if(!held){held=true;const response=await route.fetch();capture();await gate;await route.fulfill({response})}else await route.continue()}finally{flight--}});
 await field('开始日期').fill('2028-01-03');await captured;
 await field('开始日期').fill('2028-01-04');await field('重复间隔').fill('3');await field('描述').fill('same serialized owner');
 await field('开始日期').evaluate(el=>window.dateNode=el);
 release();await waitBoard(p,b=>b.cards[0].schedule?.start_date==='2028-01-04'&&b.cards[0].schedule?.repeat?.interval===3&&b.cards[0].description==='same serialized owner');await saved();
 assert.equal(await field('开始日期').evaluate(el=>el===window.dateNode),true);assert.equal(await field('开始日期').inputValue(),'2028-01-04');assert.equal(maxFlight,1);await p.unroute('**/api/boards/2/mutate');
 checks.push('inflight edits preserve DOM/current input; date/repeat/text serialize');
 // Invalid partial ranges never claim saved, hide/close/switch/navigation retain exact input.
 await field('结束日期').fill('2028-01-01');await field('开始时间').focus();await p.locator('.schedule-editor [role="alert"]').waitFor();
 await p.locator('.task-save').filter({hasText:'未保存'}).waitFor();
 for(const leave of [()=>schedule(),()=>button('关闭卡片').click(),()=>p.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click(),()=>button('Norns 今天').click()]){await leave();assert.equal(await field('结束日期').inputValue(),'2028-01-01');assert.equal(await field('卡片标题').inputValue(),'任务1')}
 assert.equal((await snapshot(p)).cards[0].schedule.end_date,undefined);
 await field('结束日期').fill('2028-01-05');await waitBoard(p,b=>b.cards[0].schedule?.end_date==='2028-01-05');await saved();
 await field('重复').selectOption('week');await p.locator('.schedule-editor [role="alert"]').waitFor();await button('关闭卡片').click();assert.equal(await field('重复').inputValue(),'week');
 await field('周一').check();await waitBoard(p,b=>b.cards[0].schedule?.repeat?.unit==='week');await saved();
 checks.push('invalid range/partial weekly recurrence retain input and block all leave paths, recover automatically');
 // Network errors require an explicit retry even after further edits.
 await p.route('**/api/boards/2/mutate',route=>route.abort('failed'));
 await field('开始日期').fill('2028-01-05');await p.getByText('保存失败，输入已保留。',{exact:true}).waitFor();
 await field('开始日期').fill('2028-01-06');await field('结束日期').fill('2028-01-07');await button('关闭卡片').click();assert.equal(await field('开始日期').inputValue(),'2028-01-06');
 await p.unroute('**/api/boards/2/mutate');await button('重试保存').click();await p.getByRole('heading',{name:/最新版本/}).waitFor();await button('保留我的修改并重试').click();await waitBoard(p,b=>b.cards[0].schedule?.start_date==='2028-01-06');await saved();
 checks.push('transport failure retains newer date draft, blocks close, explicit retry');
 // Independent server revision must never replace dirty date fields or silently overwrite.
 await action(p,{action:'card_update',card_id:1,title:'remote title',description:'external',archived:false});
 await field('开始日期').fill('2028-01-07');await p.getByText('版本冲突，输入已保留。',{exact:true}).waitFor();
 assert.equal((await snapshot(p)).cards[0].schedule.start_date,'2028-01-06');await button('查看最新版本并处理').click();await p.getByRole('heading',{name:/最新版本/}).waitFor();
 assert.equal(await field('开始日期').inputValue(),'2028-01-07');await button('保留我的修改并重试').click();await waitBoard(p,b=>b.cards[0].schedule?.start_date==='2028-01-07');await saved();assert.equal((await snapshot(p)).cards[0].title,'remote title');
 checks.push('real409 explicit review retains dirty dates and untouched server fields');
 // Clearing the start field is an incomplete edit, not implicit destructive clear.
 await field('开始日期').fill('');await field('开始时间').focus();
 await p.locator('.schedule-editor [role="alert"]').waitFor();
 await button('关闭卡片').click();assert.equal(await field('开始日期').inputValue(),'');
 assert.equal((await snapshot(p)).cards[0].schedule.start_date,'2028-01-07');
 await field('开始日期').fill('2028-01-07');await saved();
 // Invalid input created during an awaited close cannot be lost after the response.
 let releaseLeave,captureLeave;const leaveGate=new Promise(r=>releaseLeave=r),leaveCaptured=new Promise(r=>captureLeave=r);let holdLeave=true;
 await p.route('**/api/boards/2/mutate',async route=>{if(!holdLeave)return route.continue();holdLeave=false;const response=await route.fetch();captureLeave();await leaveGate;await route.fulfill({response})});
 await field('重复间隔').fill('6');await leaveCaptured;await button('关闭卡片').click();
 await field('重复间隔').fill('');releaseLeave();await p.locator('.task-save').filter({hasText:'未保存'}).waitFor();
 assert.equal(await p.getByRole('dialog').count(),1);assert.equal(await field('重复间隔').inputValue(),'');
 assert.equal((await snapshot(p)).cards[0].schedule.repeat.interval,6);
 await p.unroute('**/api/boards/2/mutate');await field('重复间隔').fill('7');await waitBoard(p,b=>b.cards[0].schedule?.repeat?.interval===7);await saved();
 checks.push('empty start and invalid input during held close remain recoverable without data loss');
 // Rebase must carry the persisted date projection into assignment-only legacy writes.
 await action(p,{action:'card_schedule',card_id:1,schedule:{start_date:'2028-02-01',repeat:{unit:'day',interval:2}}});
 await field('描述').fill('local after remote schedule');await p.getByText('版本冲突，输入已保留。',{exact:true}).waitFor();
 await button('查看最新版本并处理').click();await p.getByRole('heading',{name:/最新版本/}).waitFor();await button('保留我的修改并重试').click();await saved();
 assert.equal(await field('开始日期').inputValue(),'2028-02-01');
 await button('负责人').click();await p.getByRole('combobox',{name:'负责人',exact:true}).selectOption('1');await saved();
 assert.equal((await snapshot(p)).cards[0].schedule.start_date,'2028-02-01');assert.equal((await snapshot(p)).cards[0].schedule.repeat.unit,'day');
 await schedule();
 checks.push('explicit rebase adopts untouched remote schedule and assignment preserves rich dates');
 // Close/switch must flush a newly changed valid draft immediately, not require Save.
 await field('重复间隔').fill('4');await button('关闭卡片').click();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await snapshot(p)).cards[0].schedule.repeat.interval,4);
 await open('remote title');await schedule();await field('重复间隔').fill('5');await p.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click();await p.waitForFunction(()=>document.querySelector('[aria-label="卡片标题"]')?.value==='任务2');assert.equal((await snapshot(p)).cards[0].schedule.repeat.interval,5);
 checks.push('close/switch immediately flush valid schedule');
 await schedule();await field('开始日期').fill('2029-01-01');await waitBoard(p,b=>b.cards[1].schedule?.start_date==='2029-01-01');await saved();
 await field('开始日期').fill('');await field('开始时间').focus();await p.waitForTimeout(800);
 assert.equal((await snapshot(p)).cards[1].schedule?.start_date,'2029-01-01','empty start must not silently remove saved single-day schedule');
 await button('关闭卡片').click();assert.equal(await p.getByRole('dialog').count(),1);
 await button('清除日期和重复').click();await waitBoard(p,b=>b.cards[1].schedule===null);await saved();
 await button('关闭卡片').click();await p.getByRole('dialog').waitFor({state:'hidden'});
 checks.push('single-day partial empty start retained; explicit clear autosaves and permits close');
 await action(p,{action:'card_schedule',card_id:2,schedule:{start_date:'9999-12-31',repeat:{unit:'day',count:2}}});
 const boundary=await action(p,{action:'card_complete',card_id:2,completed:true});
 assert.equal(boundary.cards.find(c=>c.id===2).completed,true);assert.equal(boundary.cards.some(c=>c.predecessor_id===2),false);
 checks.push('accepted maximum date completes through real backend with no unrepresentable successor');


 fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors},null,2));assert.deepEqual(errors,[]);console.log('PASS '+evidence);
}catch(e){fs.writeFileSync(evidence+'/failure.txt',e.stack);console.error('FAIL '+evidence,e);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:evidence+'/failure.png'}).catch(()=>{});process.exitCode=1}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
