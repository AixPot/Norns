for (const name of ["PLAYWRIGHT_MODULE", "CHROMIUM_PATH", "EVIDENCE_ROOT"]) { if (!process.env[name]) throw Error("Set "+name+" before running this browser test"); }
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
if(!process.env.EVIDENCE_ROOT)throw Error('Set EVIDENCE_ROOT to a disposable audit directory');
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),evidence=process.env.EVIDENCE_ROOT+'/independent-'+Date.now();fs.mkdirSync(evidence,{mode:0o700});
const password=crypto.randomBytes(24).toString('base64url'),base='http://127.0.0.1:48759';
const env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+evidence+'/norns.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48759',STATIC_DIR:root+'/frontend/dist'};
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(48759,'127.0.0.1',()=>probe.close(resolve))});
assert.equal(spawnSync((process.env.NORNS_BINARY||root+'/target/release/norns'),['init-admin','admin'],{env,input:password,cwd:evidence}).status,0);
let server,browser;const errors=[],checks=[];const log=fs.openSync(evidence+'/server.log','a');
async function rpc(p,path,body){return p.evaluate(async({path,body})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}},{path,body})}
async function snapshot(p,id=2){return (await rpc(p,'/boards/'+id)).body}
async function action(p,id,data){const b=await snapshot(p,id);const r=await rpc(p,`/boards/${id}/mutate`,{expected_revision:b.revision,...data});assert.equal(r.status,200,JSON.stringify(r));return r.body}
async function results(p,n){await p.waitForFunction(n=>document.querySelectorAll('.task-result').length===n,n);await p.waitForTimeout(80)}

async function shellNav(p,name,regex=false){if(await p.getByLabel('打开导航',{exact:true}).isVisible()){await p.getByLabel('打开导航',{exact:true}).click();await p.getByRole('dialog',{name:'导航'}).getByRole('button',{name:regex?new RegExp(name):name,exact:!regex}).click()}else await p.getByRole('button',{name:regex?new RegExp(name):name,exact:!regex}).click()}
try{
 server=spawn((process.env.NORNS_BINARY||root+'/target/release/norns'),[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900}}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);assert.equal(await p.getByRole('link',{name:'源代码',exact:true}).getAttribute('href'),'https://github.com/AixPot/Norns');
 await p.getByLabel('用户名',{exact:true}).fill('admin');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();
 for(const title of ['第一看板','第二看板']){
  const board=(await rpc(p,'/boards',{title})).body;let b=await action(p,board.id,{action:'list_create',title:'进行中'});
  b=await action(p,board.id,{action:'card_create',list_id:b.lists[0].id,title:title==='第一看板'?'搜索目标':'其他工作',description:'中文 needle 100%_'});
  await action(p,board.id,{action:'card_details',card_id:b.cards[0].id,assignee_id:1,due_date:'2028-02-29'});
 }
 await p.reload();await p.getByRole('button',{name:'搜索',exact:true}).click();await results(p,2);
 const observations={};
 const opts=()=>p.getByLabel('筛选负责人',{exact:true}).evaluate(el=>({value:el.value,selectedIndex:el.selectedIndex,options:[...el.options].map(o=>({value:o.value,text:o.text}))}));
 await p.getByLabel('筛选负责人',{exact:true}).selectOption('1');
 await p.getByLabel('任务关键词',{exact:true}).fill('no-such-task');await results(p,0);
 observations.beforeRemount=await opts();
 await p.getByRole('button',{name:'Norns 今天',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();
 await p.getByRole('button',{name:'搜索',exact:true}).click();await results(p,0);await p.waitForTimeout(300);
 observations.afterRemount=await opts();
 observations.visibleKeyword=await p.getByLabel('任务关键词',{exact:true}).inputValue();
 observations.directFiltered=(await rpc(p,'/tasks?q=no-such-task&assignee_id=1')).body;
 await p.screenshot({path:evidence+'/remount-empty-assignee.png'});
 observations.remountBug=observations.beforeRemount.value==='1'&&observations.afterRemount.selectedIndex===-1;
 await p.getByRole('button',{name:'清除筛选',exact:true}).click();await results(p,2);
 const user=await rpc(p,'/admin/users',{username:'only-board-two-person',password:crypto.randomBytes(24).toString('base64url')});assert.equal(user.status,201);
 await action(p,3,{action:'member_set',username:'only-board-two-person',role:'member'});
 await action(p,3,{action:'card_details',card_id:2,assignee_id:2,due_date:'2028-02-29'});
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await p.waitForFunction(()=>[...document.querySelectorAll('[aria-label="筛选负责人"] option')].some(o=>o.text==='only-board-two-person'));
 observations.beforeRevocation=await opts();
 const removed=spawnSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('DELETE FROM board_members WHERE board_id=3 AND user_id=1'); c.commit()",evidence+'/norns.sqlite']);assert.equal(removed.status,0);
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await results(p,1);
 observations.afterRevocation=await opts();
 observations.serverAfterRevocation=(await rpc(p,'/tasks')).body;
 observations.deniedOriginal=(await rpc(p,'/boards/3')).status;
 observations.retainedRevokedPerson=observations.afterRevocation.options.some(o=>o.text==='only-board-two-person');
 observations.retainedRevokedBoard=await p.getByLabel('筛选看板',{exact:true}).locator('option').allTextContents();
 await p.screenshot({path:evidence+'/revoked-options.png'});
 assert.equal((observations.serverAfterRevocation.tasks??observations.serverAfterRevocation).length,1);assert.equal(observations.deniedOriginal,404);
 assert.equal(observations.visibleKeyword,'no-such-task');assert.equal(observations.afterRemount.value,'1','F1: applied assignee must survive empty-result remount');assert.equal(observations.retainedRevokedPerson,false,'F2: revoked person must disappear');assert.ok(!observations.retainedRevokedBoard.includes('第二看板'),'F2: revoked board must disappear');assert.deepEqual(errors,[]);
 // Regrant in this disposable database, select both soon-to-be-revoked filters, revoke again.
 const restore=spawnSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"INSERT INTO board_members(board_id,user_id,role) VALUES(3,1,'admin')\"); c.commit()",evidence+'/norns.sqlite']);assert.equal(restore.status,0);
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await results(p,2);
 await p.getByLabel('筛选看板',{exact:true}).selectOption('3');await results(p,1);
 await p.getByLabel('筛选负责人',{exact:true}).selectOption('2');await results(p,1);
 // Narrowed nonempty remount still offers the other authorized person and board.
 await p.getByRole('button',{name:'Norns 今天',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();
 await p.getByRole('button',{name:'搜索',exact:true}).click();await results(p,1);
 assert.equal(await p.getByLabel('筛选负责人',{exact:true}).inputValue(),'2');
 assert.ok((await opts()).options.some(o=>o.value==='1'),'other authorized assignee survives narrow remount');
 let refreshRequests=0;const count= req=>{if(new URL(req.url()).pathname==='/api/tasks')refreshRequests++};p.on('request',count);
 const revokeAgain=spawnSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('DELETE FROM board_members WHERE board_id=3 AND user_id=1'); c.commit()",evidence+'/norns.sqlite']);assert.equal(revokeAgain.status,0);
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await results(p,1);await p.waitForTimeout(400);
 observations.selectedRevocation={person:await opts(),board:await p.getByLabel('筛选看板',{exact:true}).inputValue(),refreshRequests};
 assert.equal(observations.selectedRevocation.person.value,'');assert.equal(observations.selectedRevocation.person.selectedIndex,0);
 assert.equal(observations.selectedRevocation.board,'');assert.ok(refreshRequests>=2&&refreshRequests<=3,'reconciliation must settle without request loop');
 assert.equal(await p.locator('.task-result').innerText().then(t=>t.includes('第一看板')),true);
 await p.getByRole('button',{name:'Norns 今天',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();
 assert.deepEqual(await p.locator('.board-navigation button span:last-child').allTextContents(),['第一看板'],'App overview shares refreshed board metadata');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(evidence+'/result.json',JSON.stringify({ok:true,observations,errors},null,2));console.log(JSON.stringify({evidence,observations,errors},null,2));
}catch(e){fs.writeFileSync(evidence+'/failure.txt',String(e.stack));if(browser){const pages=browser.contexts().flatMap(c=>c.pages());if(pages[0])await pages[0].screenshot({path:evidence+'/failure.png'})}throw e}
finally{await browser?.close();if(server){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}

