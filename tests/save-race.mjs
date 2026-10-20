for (const name of ["PLAYWRIGHT_MODULE", "CHROMIUM_PATH", "EVIDENCE_ROOT"]) { if (!process.env[name]) throw Error('Set '+name+' before running this browser test'); }
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';import net from 'node:net';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=process.env.NORNS_ROOT || fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,''),cwd=process.env.EVIDENCE_ROOT;
if(!cwd)throw Error('Set EVIDENCE_ROOT to an existing disposable output directory');
const evidence=cwd+'/save-race-'+Date.now();fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const password=crypto.randomBytes(24).toString('base64url');
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const base=`http://127.0.0.1:${port}`,env={...process.env,DATABASE_URL:'sqlite://'+evidence+'/norns.sqlite',BIND_ADDR:`127.0.0.1:${port}`,APP_ORIGIN:base,COOKIE_SECURE:'false',STATIC_DIR:root+'/frontend/dist'};
let server,browser;const pageErrors=[],results=[];let failure;
async function login(page){page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录 Norns',exact:true}).click();await page.getByRole('heading',{name:'我的看板',exact:true}).waitFor()}
async function overview(page){await page.locator('button.back').click();await page.getByRole('heading',{name:'我的看板',exact:true}).waitFor()}
async function create(page,name,title){await page.getByLabel('看板名称').fill(name);await page.getByRole('button',{name:'创建看板',exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();await page.getByLabel('新列表',{exact:true}).fill('待办');await page.getByRole('button',{name:'＋ 添加列表',exact:true}).click();await page.getByLabel('在待办添加卡片').fill(title);await page.getByRole('button',{name:'添加到待办',exact:true}).click();await page.getByRole('group',{name:title,exact:true}).waitFor();await overview(page)}
try{
 const init=spawnSync(root+'/target/release/norns',['init-admin','admin'],{env,input:password,cwd:evidence});assert.equal(init.status,0,init.stderr.toString());
 const log=fs.openSync(evidence+'/server.log','a');server=spawn(root+'/target/release/norns',[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready,'readiness');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const setup=await browser.newPage();await login(setup);await create(setup,'审查 A','原板卡 A');await create(setup,'审查 B','目标板卡 B');
 const fixtures=await setup.evaluate(async()=>{const bs=await(await fetch('/api/boards')).json();return Promise.all(bs.map(async b=>await(await fetch('/api/boards/'+b.id)).json()))});fs.writeFileSync(evidence+'/fixtures.json',JSON.stringify(fixtures,null,2));await setup.close();
 const a=fixtures.find(b=>b.title==='审查 A'),b=fixtures.find(b=>b.title==='审查 B');assert.ok(a.cards[0].id!==b.cards[0].id);
 for(const mode of ['success','network-failure']){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();await login(page);
  await page.getByRole('button',{name:/审查 A/}).click();await page.getByRole('button',{name:'移动或编辑 原板卡 A',exact:true}).click();await page.getByRole('dialog').waitFor();
  const marker='旧板草稿-'+mode;await page.getByLabel('描述',{exact:true}).fill(marker);
  let release,capture,held=false;const gate=new Promise(r=>release=r),captured=new Promise(r=>capture=r);
  let responseStatus,requestBody;
  await page.route(`**/api/boards/${a.id}/mutate`,async route=>{
   if(held)return route.continue();held=true;requestBody=route.request().postDataJSON();
   const response=await route.fetch();responseStatus=response.status();capture();await gate;
   if(mode==='success')await route.fulfill({response});else await route.abort('failed');
  });
  await page.getByRole('button',{name:'保存更改',exact:true}).click();await captured;assert.equal(responseStatus,200,'real server must commit before response delayed');
  assert.equal(await page.getByRole('button',{name:'关闭卡片',exact:true}).isDisabled(),true);
  let pointerBlocked=false;try{await page.locator('button.back').click({timeout:600})}catch(e){assert.match(String(e),/Timeout/);pointerBlocked=true}
  assert.ok(pointerBlocked,'modal overlay must block ordinary pointer back navigation');
  // Actual keyboard Tab traversal only: no DOM focus(), no direct handler calls.
  const traversal=[];let reached=false;
  for(let i=0;i<100;i++){
   await page.keyboard.press('Shift+Tab');const active=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim(),cls:document.activeElement?.className,aria:document.activeElement?.getAttribute('aria-label')}));traversal.push(active);
   if(await page.locator('button.back').evaluate(e=>e===document.activeElement)){reached=true;break}
  }
  assert.ok(reached,'background back must be keyboard reachable');await page.keyboard.press('Enter');await page.getByRole('heading',{name:'我的看板',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByRole('button',{name:/审查 B/}).click();await page.getByRole('heading',{name:'审查 B',exact:true}).waitFor();await page.getByRole('group',{name:'目标板卡 B',exact:true}).waitFor();
  const before={dialogs:await page.getByRole('dialog').count(),heading:await page.getByRole('heading',{level:1}).innerText()};assert.equal(before.dialogs,0);
  await page.screenshot({path:evidence+'/'+mode+'-before.png',fullPage:true});release();
  await page.getByRole('button',{name:'刷新看板',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.board-controls button').disabled);await page.waitForTimeout(200);
  const after={dialogs:await page.getByRole('dialog').count(),heading:await page.getByRole('heading',{level:1}).innerText(),description:await page.getByLabel('描述',{exact:true}).count()?await page.getByLabel('描述',{exact:true}).inputValue():null,cardTitle:await page.getByLabel('卡片标题',{exact:true}).count()?await page.getByLabel('卡片标题',{exact:true}).inputValue():null,alerts:await page.getByRole('alert').allTextContents(),text:await page.locator('body').innerText()};
  const snapshots=await page.evaluate(async ids=>Promise.all(ids.map(async id=>await(await fetch('/api/boards/'+id)).json())),[a.id,b.id]);
  assert.equal(after.heading,'审查 B');assert.equal(snapshots[0].cards[0].description,marker);assert.equal(snapshots[1].cards[0].description,'');
  const reproduced=after.dialogs===1&&after.description===marker&&after.cardTitle==='原板卡 A';
  results.push({mode,responseStatus,requestBody,pointerBlocked,closeDisabled:true,traversal,before,after,reproduced,snapshots});
  await page.screenshot({path:evidence+'/'+mode+'-after.png',fullPage:true});
  fs.writeFileSync(evidence+'/'+mode+'.json',JSON.stringify(results.at(-1),null,2));await context.close();
 }

 // Same-lifecycle rejection must retain in-flight edits and original revision.
 const conflictContext=await browser.newContext(),conflictPage=await conflictContext.newPage();
 await login(conflictPage);await conflictPage.getByRole('button',{name:/审查 A/}).click();
 await conflictPage.getByRole('button',{name:'移动或编辑 原板卡 A',exact:true}).click();
 await conflictPage.getByLabel('描述',{exact:true}).fill('409 local draft');
 const originalRevision=await conflictPage.locator('footer .muted').innerText();
 const competing=await conflictPage.evaluate(async id=>{
  const me=await(await fetch('/api/me')).json(),board=await(await fetch('/api/boards/'+id)).json();
  const response=await fetch('/api/boards/'+id+'/mutate',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({expected_revision:board.revision,action:'comment_create',card_id:board.cards[0].id,body:'competing revision'})});return response.status;
 },a.id);assert.equal(competing,200);
 let releaseConflict,captureConflict;const conflictGate=new Promise(r=>releaseConflict=r),conflictCaptured=new Promise(r=>captureConflict=r);
 let conflictStatus;
 await conflictPage.route(`**/api/boards/${a.id}/mutate`,async route=>{const response=await route.fetch();conflictStatus=response.status();captureConflict();await conflictGate;await route.fulfill({response})});
 await conflictPage.getByRole('button',{name:'保存更改',exact:true}).click();await conflictCaptured;assert.equal(conflictStatus,409);
 await conflictPage.getByLabel('描述',{exact:true}).fill('typed during rejected save');releaseConflict();
 await conflictPage.getByRole('button',{name:'刷新版本，保留草稿',exact:true}).first().waitFor();
 await conflictPage.waitForFunction(()=>!document.querySelector('footer button').disabled);
 assert.equal(await conflictPage.getByRole('dialog').count(),1);
 assert.equal(await conflictPage.getByLabel('描述',{exact:true}).inputValue(),'typed during rejected save');
 assert.equal(await conflictPage.locator('footer .muted').innerText(),originalRevision);
 await conflictPage.unroute(`**/api/boards/${a.id}/mutate`);
 await conflictPage.getByRole('button',{name:'刷新版本，保留草稿',exact:true}).first().click();
 await conflictPage.getByText('已刷新版本，草稿未变。再次保存将使用当前版本。',{exact:true}).waitFor();
 assert.equal(await conflictPage.getByLabel('描述',{exact:true}).inputValue(),'typed during rejected save');
 assert.notEqual(await conflictPage.locator('footer .muted').innerText(),originalRevision);
 await conflictPage.getByRole('button',{name:'保存更改',exact:true}).click();await conflictPage.getByRole('dialog').waitFor({state:'hidden'});
 const conflictSnapshot=await conflictPage.evaluate(async id=>await(await fetch('/api/boards/'+id)).json(),a.id);
 assert.equal(conflictSnapshot.cards[0].description,'typed during rejected save');
 fs.writeFileSync(evidence+'/conflict.json',JSON.stringify({status:conflictStatus,originalRevision,retainedInFlightInput:true,explicitRefreshAndRetry:true,snapshot:conflictSnapshot},null,2));
 await conflictContext.close();

 assert.deepEqual(pageErrors,[]);
 assert.equal(results.length,2);
 for(const result of results){assert.equal(result.after.dialogs,0,result.mode+": stale save must not restore abandoned draft");assert.deepEqual(result.after.alerts,[],result.mode+": stale save must not restore errors")} 
}catch(e){failure=String(e.stack);console.error(e);process.exitCode=1}
finally{
 if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}
 const portClosed=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(false)});s.once('error',()=>resolve(true))});
 fs.writeFileSync(evidence+'/result.json',JSON.stringify({probeCompleted:!failure,defectReproduced:results.some(r=>r.reproduced),results,pageErrors,failure,port,portClosed,serverExitCode:server?.exitCode,serverSignal:server?.signalCode},null,2));console.log(JSON.stringify({evidence,probeCompleted:!failure,defectReproduced:results.some(r=>r.reproduced),cases:results.map(({mode,reproduced})=>({mode,reproduced})),portClosed,failure}));
}
