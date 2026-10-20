for (const name of ["PLAYWRIGHT_MODULE", "CHROMIUM_PATH", "EVIDENCE_ROOT"]) { if (!process.env[name]) throw Error('Set '+name+' before running this browser test'); }
import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=process.env.NORNS_ROOT||process.cwd(), evidence=process.env.EVIDENCE_ROOT+'/phase2-'+Date.now();fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const password=crypto.randomBytes(24).toString('base64url');fs.writeFileSync(evidence+'/synthetic-password',password,{mode:0o600});
const base='http://127.0.0.1:48745',env={...process.env,DATABASE_URL:'sqlite://'+evidence+'/norns.sqlite',BIND_ADDR:'127.0.0.1:48745',APP_ORIGIN:base,COOKIE_SECURE:'false',STATIC_DIR:root+'/frontend/dist'};
assert.equal(spawnSync(root+'/target/release/norns',['init-admin','admin'],{env,input:password,cwd:evidence}).status,0);
let server,browser;const errors=[];const checks=[];
function start(){const log=fs.openSync(evidence+'/server.log','a');server=spawn(root+'/target/release/norns',[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log)}
async function stop(){if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(base)).ok)return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('readiness')}
async function login(page,name){page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill(name);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录 Norns',exact:true}).click();await page.getByRole('heading',{name:'我的看板',exact:true}).waitFor()}
async function action(page,data){return page.evaluate(async data=>{const me=await(await fetch('/api/me')).json();const boards=await(await fetch('/api/boards')).json();const b=await(await fetch('/api/boards/'+boards[0].id)).json();const r=await fetch('/api/boards/'+b.id+'/mutate',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({expected_revision:b.revision,...data})});return {status:r.status,body:await r.json()}},data)}
async function open(page){await page.getByRole('button',{name:/Phase2 验收/}).click();await page.getByRole('group',{name:'协作任务',exact:true}).waitFor()}
async function detail(page){await page.getByRole('button',{name:'移动或编辑 协作任务',exact:true}).click();await page.getByRole('dialog').waitFor()}
try{
 start();await ready();browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const a=await browser.newContext({viewport:{width:1440,height:1000}}),b=await browser.newContext({viewport:{width:1280,height:1000}}),m=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const p=await a.newPage(),q=await b.newPage(),phone=await m.newPage();await login(p,'admin');
 await p.evaluate(async password=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({username:'worker',password})});if(r.status!==201)throw Error('create account')},password);
 await p.getByLabel('看板名称').fill('Phase2 验收');await p.getByRole('button',{name:'创建看板',exact:true}).click();await p.getByLabel('新列表',{exact:true}).fill('待办');await p.getByRole('button',{name:'＋ 添加列表',exact:true}).click();await p.getByLabel('在待办添加卡片').fill('协作任务');await p.getByRole('button',{name:'添加到待办',exact:true}).click();await p.getByRole('group',{name:'协作任务',exact:true}).waitFor();
 assert.equal((await action(p,{action:'member_set',username:'worker',role:'member'})).status,200);
 await login(q,'worker');await open(q);await detail(q);
 await q.getByLabel('描述',{exact:true}).fill('导航前本地草稿');
 await action(p,{action:'comment_create',card_id:1,body:'force stale revision'});
 await q.locator('.comment').filter({hasText:'force stale revision'}).waitFor({timeout:12000});
 await q.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await q.waitForTimeout(500);
 let release, capturedResolve;const captured=new Promise(r=>capturedResolve=r);const gate=new Promise(r=>release=r);let held=false;
 await q.route('**/api/boards/1',async route=>{if(held)return route.continue();held=true;const response=await route.fetch();capturedResolve();await gate;await route.fulfill({response})});
 await q.getByRole('button',{name:'刷新版本，保留草稿',exact:true}).click();await captured;

 await q.locator('button.back').focus();await q.keyboard.press('Enter');
 await q.getByRole('heading',{name:'我的看板',exact:true}).waitFor({timeout:12000});
 const afterNavigate={dialogs:await q.getByRole('dialog').count(),overview:await q.getByRole('heading',{name:'我的看板',exact:true}).count()};
 release();await q.waitForTimeout(700);
 const afterRelease={dialogs:await q.getByRole('dialog').count(),overview:await q.getByRole('heading',{name:'我的看板',exact:true}).count(),text:await q.locator('body').innerText()};
 fs.writeFileSync(evidence+'/race-result.json',JSON.stringify({afterNavigate,afterRelease,pageErrors:errors},null,2));console.log('RACE_EVIDENCE '+evidence+' '+JSON.stringify({afterNavigate,afterRelease,pageErrors:errors}));assert.equal(afterRelease.dialogs,0,'delayed refresh must not resurrect abandoned draft');assert.equal(afterRelease.overview,1);assert.deepEqual(errors,[]);

 await q.unroute('**/api/boards/1');await open(q);await detail(q);
 await q.getByLabel('描述',{exact:true}).fill('normal refresh draft');
 await q.getByLabel('发表评论',{exact:true}).fill('normal comment draft');
 await q.getByLabel('新清单条目',{exact:true}).fill('normal checklist draft');
 const before=await q.locator('footer .muted').innerText();
 await action(p,{action:'comment_create',card_id:1,body:'normal refresh server update'});
 await q.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
 await q.locator('.comment').filter({hasText:'normal refresh server update'}).waitFor({timeout:12000});
 assert.equal(await q.locator('footer .muted').innerText(),before);
 await q.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
 let releaseNormal,captureNormal;const normalGate=new Promise(r=>releaseNormal=r),normalCaptured=new Promise(r=>captureNormal=r);
 await q.route('**/api/boards/1',async route=>{const response=await route.fetch();captureNormal();await normalGate;await route.fulfill({response})});
 await q.getByRole('button',{name:'刷新版本，保留草稿',exact:true}).click();await normalCaptured;
 await q.getByLabel('描述',{exact:true}).fill('typed during refresh');releaseNormal();
 await q.getByText('已刷新版本，草稿未变。再次保存将使用当前版本。',{exact:true}).waitFor();
 assert.equal(await q.getByLabel('描述',{exact:true}).inputValue(),'typed during refresh');
 assert.equal(await q.getByLabel('发表评论',{exact:true}).inputValue(),'normal comment draft');
 assert.equal(await q.getByLabel('新清单条目',{exact:true}).inputValue(),'normal checklist draft');
 assert.notEqual(await q.locator('footer .muted').innerText(),before);
 await q.getByRole('button',{name:'保存更改',exact:true}).click();await q.getByRole('dialog').waitFor({state:'hidden'});
 await q.unroute('**/api/boards/1');
 const saved=await q.evaluate(async()=>await(await fetch('/api/boards/1')).json());assert.equal(saved.cards[0].description,'typed during refresh');
 await detail(q);await action(p,{action:'comment_create',card_id:1,body:'failure path update'});
 await q.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
 await q.locator('.comment').filter({hasText:'failure path update'}).waitFor({timeout:12000});
 await q.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
 let releaseFailure,captureFailure;const failureGate=new Promise(r=>releaseFailure=r),failureCaptured=new Promise(r=>captureFailure=r);
 await q.route('**/api/boards/1',async route=>{captureFailure();await failureGate;await route.abort('failed')});
 await q.getByRole('button',{name:'刷新版本，保留草稿',exact:true}).click();await failureCaptured;
 await q.locator('button.back').focus();await q.keyboard.press('Enter');await q.getByRole('heading',{name:'我的看板',exact:true}).waitFor();releaseFailure();await q.waitForTimeout(700);
 assert.equal(await q.getByRole('alert').count(),0);assert.equal(await q.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);
 fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,checks:['delayed successful refresh discarded after overview navigation','normal refresh preserves description/comment/checklist including typing during request; explicit revision adoption and save','delayed failed refresh discarded after navigation'],pageErrors:errors},null,2));console.log('REFRESH_RACE_PASS '+evidence);

}catch(e){console.error(e);fs.writeFileSync(evidence+'/error.txt',String(e.stack));if(browser)for(const [i,c] of browser.contexts().entries())for(const p of c.pages()){await p.screenshot({path:evidence+'/failure-'+i+'.png',fullPage:true}).catch(()=>{});fs.writeFileSync(evidence+'/failure-'+i+'.txt',await p.locator('body').innerText().catch(()=>''))}process.exitCode=1}
finally{if(browser)await browser.close();await stop()}