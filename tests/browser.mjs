for (const name of ["PLAYWRIGHT_MODULE", "CHROMIUM_PATH", "EVIDENCE_ROOT"]) { if (!process.env[name]) throw Error('Set '+name+' before running this browser test'); }
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const root=process.env.NORNS_ROOT || process.cwd();const evidence=(process.env.EVIDENCE_ROOT || root+'/target/browser-evidence')+'/run-'+Date.now();fs.mkdirSync(evidence,{recursive:true,mode:0o700});
const password=crypto.randomBytes(24).toString('base64url');fs.writeFileSync(evidence+'/synthetic-password',password,{mode:0o600});
const base='http://127.0.0.1:48731';const env={...process.env,DATABASE_URL:'sqlite://'+evidence+'/norns.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48731',STATIC_DIR:root+'/frontend/dist'};
const init=spawnSync(root+'/target/debug/norns',['init-admin','admin'],{env,input:password,cwd:evidence,encoding:'utf8'});assert.equal(init.status,0,init.stderr);
let server;let browser;const errors=[];
function start(){const log=fs.openSync(evidence+'/server.log','a');server=spawn(root+'/target/debug/norns',[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log)}
async function stop(){if(server&&!server.killed){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
async function ready(){for(let i=0;i<60;i++){try{if((await fetch(base)).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error('server not ready')}
async function login(page){await page.goto(base);await page.getByLabel('用户名',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录 Norns',exact:true}).click();await page.getByRole('heading',{name:'我的看板',exact:true}).waitFor()}
try{
 start();await ready();
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const desktop=await browser.newContext({viewport:{width:1440,height:1000}});const page=await desktop.newPage();page.on('pageerror',e=>errors.push(e.message));
 await login(page);
 await page.getByLabel('看板名称').fill('Norns 核心验收');await page.getByRole('button',{name:'创建看板',exact:true}).click();await page.getByRole('heading',{name:'Norns 核心验收',exact:true}).waitFor();
 for(const name of ['待办','进行中','已完成']){await page.getByLabel('新列表',{exact:true}).fill(name);await page.getByRole('button',{name:'＋ 添加列表',exact:true}).click();await page.getByRole('heading',{name:new RegExp('^'+name)}).waitFor()}
 for(const title of ['梳理项目目标','确认交互与权限','完成上线前检查']){await page.getByLabel('在待办添加卡片',{exact:true}).fill(title);await page.getByRole('button',{name:'添加到待办',exact:true}).click();await page.getByRole('group',{name:title,exact:true}).waitFor()}
 await page.getByRole('group',{name:'梳理项目目标',exact:true}).getByRole('button').first().click();await page.getByLabel('描述',{exact:true}).fill('核心范围已确定：真实服务、明确权限、可靠保存。');await page.getByRole('button',{name:'保存更改',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 // Real desktop DragEvent: same column and cross-column, state verified through rendered card order.
 const third=page.getByRole('group',{name:'完成上线前检查',exact:true});await third.dragTo(page.locator('.column').nth(0).locator('.dropzone').first());
 await page.waitForFunction(()=>document.querySelector('.card-content strong')?.textContent==='完成上线前检查');
 await page.getByRole('group',{name:'确认交互与权限',exact:true}).dragTo(page.locator('.column').nth(1).locator('.dropzone.end'));
 await page.locator('.column').nth(1).getByRole('group',{name:'确认交互与权限',exact:true}).waitFor();
 await page.screenshot({path:evidence+'/desktop-board.png',fullPage:true});
 // Site account management and board membership are exercised through real UI.
 await page.getByRole('button',{name:'账号管理',exact:true}).click();
 await page.getByLabel('新用户名',{exact:true}).fill('collaborator');await page.getByLabel('初始密码',{exact:true}).fill(password);await page.getByRole('button',{name:'创建账号',exact:true}).click();await page.getByText('账号已创建',{exact:true}).waitFor();
 await page.getByRole('button',{name:'账号管理',exact:true}).click();
 await page.getByRole('button',{name:'成员 (1)',exact:true}).click();await page.getByLabel('成员用户名').fill('collaborator');await page.getByRole('button',{name:'添加或提权',exact:true}).click();await page.getByRole('button',{name:'成员 (2)',exact:true}).waitFor();
 await page.getByRole('button',{name:'成员 (2)',exact:true}).click();
 // Independent writer changes card while original window has a draft.
 await page.getByRole('group',{name:'梳理项目目标',exact:true}).getByRole('button').first().click();await page.getByLabel('卡片标题').fill('我的未保存草稿');
 const conflict=await page.evaluate(async()=>{const me=await(await fetch('/api/me')).json();const boards=await(await fetch('/api/boards')).json();const board=await(await fetch('/api/boards/'+boards[0].id)).json();const card=board.cards.find(c=>c.title==='梳理项目目标');const res=await fetch('/api/boards/'+board.id+'/mutate',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({expected_revision:board.revision,action:'card_update',card_id:card.id,title:'其他成员的版本',description:card.description,archived:false})});return res.status});assert.equal(conflict,200);
 await page.getByRole('button',{name:'保存更改',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();assert.equal(await page.getByLabel('卡片标题').inputValue(),'我的未保存草稿');
 await page.screenshot({path:evidence+'/desktop-conflict-draft.png',fullPage:true});
 await page.getByRole('button',{name:'刷新版本，保留草稿',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor({state:'hidden'});assert.equal(await page.getByLabel('卡片标题').inputValue(),'我的未保存草稿');await page.getByRole('button',{name:'保存更改',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.reload();await page.getByRole('heading',{name:'我的看板',exact:true}).waitFor();await page.getByRole('button',{name:/Norns 核心验收/}).click();await page.getByRole('group',{name:'我的未保存草稿',exact:true}).waitFor();
 // Mobile uses real touch emulation and explicit move menu; no claim of touch drag support.
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));await login(phone);await phone.getByRole('button',{name:/Norns 核心验收/}).tap();await phone.getByRole('group',{name:'我的未保存草稿',exact:true}).waitFor();
 await phone.screenshot({path:evidence+'/mobile-board.png',fullPage:true});
 await phone.getByRole('button',{name:'移动或编辑 我的未保存草稿',exact:true}).tap();await phone.getByLabel('目标列表').selectOption({label:'已完成'});await phone.getByLabel('插入位置').selectOption('0');await phone.getByRole('button',{name:'移动到此位置',exact:true}).tap();
 await phone.getByRole('button',{name:'关闭卡片',exact:true}).tap();
 await phone.locator('.column').nth(2).scrollIntoViewIfNeeded();await phone.locator('.column').nth(2).getByRole('group',{name:'我的未保存草稿',exact:true}).waitFor();
 await phone.getByRole('button',{name:'移动或编辑 我的未保存草稿',exact:true}).tap();await phone.getByLabel('描述',{exact:true}).fill('手机触屏完成编辑与非拖拽移动。');await phone.screenshot({path:evidence+'/mobile-detail.png',fullPage:true});await phone.getByRole('button',{name:'保存更改',exact:true}).tap();await phone.getByRole('dialog').waitFor({state:'hidden'});
 await phone.getByRole('button',{name:'移动或编辑 我的未保存草稿',exact:true}).tap();await phone.getByLabel('归档卡片（不删除数据）').check();await phone.getByRole('button',{name:'保存更改',exact:true}).tap();await phone.getByRole('dialog').waitFor({state:'hidden'});await phone.getByRole('button',{name:'已归档',exact:true}).tap();await phone.getByRole('button',{name:'我的未保存草稿 打开 →',exact:true}).waitFor();await phone.screenshot({path:evidence+'/mobile-archive.png',fullPage:true});
 await stop();start();await ready();await phone.reload();await phone.getByRole('button',{name:/Norns 核心验收/}).tap();await phone.getByRole('button',{name:'已归档',exact:true}).tap();await phone.getByRole('button',{name:'我的未保存草稿 打开 →',exact:true}).waitFor();
 // Archive is reversible, not a destructive delete.
 await phone.getByRole('button',{name:'我的未保存草稿 打开 →',exact:true}).tap();await phone.getByLabel('归档卡片（不删除数据）').uncheck();await phone.getByRole('button',{name:'保存更改',exact:true}).tap();await phone.getByRole('dialog').waitFor({state:'hidden'});await phone.getByRole('button',{name:'返回看板',exact:true}).tap();await phone.locator('.column').nth(2).scrollIntoViewIfNeeded();await phone.locator('.column').nth(2).getByRole('group',{name:'我的未保存草稿',exact:true}).waitFor();
 // Reset and disable through the administrator UI, not an API substitute.
 await page.getByRole('button',{name:'账号管理',exact:true}).click();
 const row=page.locator('.user-row').filter({has:page.getByText('collaborator',{exact:true})});await row.getByLabel('为collaborator重置密码').fill(password+'reset');await row.getByRole('button',{name:'重置密码',exact:true}).click();await page.getByText('账号已更新，旧会话已撤销',{exact:true}).waitFor();
 await row.getByRole('button',{name:'停用',exact:true}).click();await row.getByRole('button',{name:'启用',exact:true}).waitFor();await row.getByRole('button',{name:'启用',exact:true}).click();await row.getByRole('button',{name:'停用',exact:true}).waitFor();
 // Logout invalidation is reflected by the login page after reload.
 await phone.getByRole('button',{name:'退出',exact:true}).tap();await phone.getByRole('button',{name:'登录 Norns',exact:true}).waitFor();await phone.reload();await phone.getByRole('button',{name:'登录 Norns',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,desktop:['login','create board/list/card','edit','same-list drag','cross-list drag','account create/reset/disable/enable','membership add','409 draft retained','explicit refresh retry','reload persistence'],mobile:['touch login','horizontal columns','menu move','edit','archive','restart persistence','restore archive','logout'],pageErrors:errors},null,2));console.log('BROWSER_PASS '+evidence);
}catch(e){if(browser){for(const context of browser.contexts())for(const [i,page] of context.pages().entries()){await page.screenshot({path:evidence+'/failure-'+i+'.png',fullPage:true}).catch(()=>{});fs.writeFileSync(evidence+'/failure-'+i+'.txt',await page.locator('body').innerText().catch(()=>''))}}fs.writeFileSync(evidence+'/error.txt',String(e.stack));console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();await stop()}
