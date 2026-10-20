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
 browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),p=await context.newPage();await login(p);
 await rpc(p,'/boards',{title:'轻量详情验收'});
 let b;for(const title of ['待办','进行中','待确认','完成'])b=await action(p,{action:'list_create',title});
 for(const [i,list] of b.lists.entries())await action(p,{action:'card_create',list_id:list.id,title:'任务'+(i+1),description:i===0?'现有任务内容\n'+('内容优先，操作固定在顶部。\n'.repeat(60)):''});
 await p.reload();await p.getByRole('button',{name:/轻量详情验收/}).click();


 const card=p.getByRole('group',{name:'任务1',exact:true});await card.waitFor();
 assert.equal(await card.getByRole('checkbox').count(),1);assert.equal(await card.locator('.card-number,.card-excerpt,.card-menu').count(),0);
 assert.ok((await card.boundingBox()).height<=60,'compact outer cards');
 let before=await snapshot(p);const pos=before.cards[0].position;
 await card.getByRole('checkbox').check();await p.waitForTimeout(300);
 assert.equal(await p.getByRole('dialog').count(),0,'completion checkbox must not open task');
 let state=await snapshot(p);assert.equal(state.cards[0].completed,true);assert.equal(state.cards[0].position,pos);assert.equal(state.cards[0].archived,false);
 await card.getByRole('checkbox').uncheck();await p.waitForTimeout(300);assert.equal((await snapshot(p)).cards[0].completed,false);checks.push('compact right checkbox, no dialog, independent stable completion toggle');
 await card.locator('.card-content').click();await p.getByLabel('卡片标题',{exact:true}).waitFor();
 assert.equal(await p.getByLabel('描述',{exact:true}).count(),1);assert.equal(await p.getByRole('button',{name:'编辑标题和描述',exact:true}).count(),0);
 await p.getByLabel('卡片标题',{exact:true}).fill('直接编辑');await p.getByLabel('描述',{exact:true}).fill('直接输入自动保存');await p.waitForTimeout(900);
 state=await snapshot(p);assert.equal(state.cards[0].title,'直接编辑');assert.equal(state.cards[0].description,'直接输入自动保存');
 const top=await p.getByRole('toolbar',{name:'卡片顶部操作'}).boundingBox(),bottom=await p.getByRole('toolbar',{name:'卡片底部操作'}).boundingBox();
 assert.ok(bottom.y>top.y);const people=await p.getByRole('button',{name:'负责人',exact:true}).boundingBox(),comment=await p.getByRole('button',{name:'发表评论',exact:true}).boundingBox(),move=await p.getByRole('button',{name:'移动卡片',exact:true}).boundingBox();assert.ok(people.x<comment.x&&comment.x<move.x);
 assert.equal(await p.getByRole('button',{name:'归档卡片',exact:true}).count(),0);checks.push('direct text autosave, complete/date top, fixed bottom assignee/comment left move right');
 await p.getByRole('button',{name:'设置日期和重复',exact:true}).click();
 await p.getByLabel('开始日期',{exact:true}).fill('2028-01-02');
 await p.getByLabel('开始时间',{exact:true}).focus();
 await waitBoard(p,b=>b.cards.find(c=>c.id===1).schedule?.start_date==='2028-01-02');
 assert.equal((await snapshot(p)).cards[0].schedule.start_date,'2028-01-02');
 await p.getByLabel('结束日期',{exact:true}).fill('2028-01-01');
 await p.getByLabel('开始时间',{exact:true}).focus();
 await p.locator('.schedule-editor [role="alert"]').waitFor();
 assert.equal((await snapshot(p)).cards[0].schedule.start_date,'2028-01-02');
 await p.getByRole('button',{name:'设置日期和重复',exact:true}).click();
 assert.equal(await p.getByLabel('开始日期',{exact:true}).count(),1,'invalid range must block hiding the editor');
 await p.getByLabel('开始日期',{exact:true}).fill('2020-01-31');
 await p.getByLabel('开始时间',{exact:true}).fill('09:30');await p.getByLabel('结束日期',{exact:true}).fill('2020-02-02');await p.getByLabel('结束时间',{exact:true}).fill('17:45');
 await p.getByLabel('重复',{exact:true}).selectOption('month');await p.getByLabel('重复间隔',{exact:true}).fill('2');await p.getByLabel('重复结束',{exact:true}).selectOption('count');await p.getByLabel('重复总次数',{exact:true}).fill('3');
 await p.getByLabel('重复总次数',{exact:true}).blur();await waitBoard(p,b=>b.cards[0].schedule?.repeat?.count===3);
 state=await snapshot(p);assert.equal(state.cards[0].schedule.start_time,'09:30');assert.equal(state.cards[0].schedule.end_date,'2020-02-02');assert.equal(state.cards[0].schedule.repeat.interval,2);
 await p.getByRole('button',{name:'添加清单条目',exact:true}).click();await p.getByLabel('新清单条目',{exact:true}).fill('继承并重置');await p.getByRole('button',{name:'添加条目',exact:true}).click();await p.getByLabel('完成 继承并重置',{exact:true}).check();
 await p.getByRole('button',{name:'发表评论',exact:true}).click();await p.getByRole('textbox',{name:'发表评论',exact:true}).fill('只留本次');await p.getByRole('button',{name:'发送评论',exact:true}).click();await p.getByText('只留本次',{exact:true}).waitFor();
 await p.getByRole('button',{name:'完成任务',exact:true}).click();await p.getByRole('button',{name:'撤销完成',exact:true}).waitFor();await p.waitForTimeout(300);
 state=await snapshot(p);let successor=state.cards.find(c=>c.predecessor_id===1);assert.ok(successor);assert.equal(successor.completed,false);assert.equal(successor.title,'直接编辑');assert.equal(successor.position,1);assert.equal(state.cards.find(c=>c.id===1).position,pos);
 assert.equal(state.checklist.find(i=>i.card_id===successor.id).checked,false);assert.equal(state.comments.filter(c=>c.card_id===successor.id).length,0);
 assert.equal(successor.schedule.start_time,'09:30');assert.equal(successor.schedule.end_time,'17:45');assert.equal(successor.occurrence_no,2);fs.writeFileSync(evidence+'/successor.json',JSON.stringify(state,null,2));await p.screenshot({path:evidence+'/desktop-completed-recurrence.png'});
 await p.getByRole('button',{name:'撤销完成',exact:true}).click();await p.getByRole('button',{name:'完成任务',exact:true}).waitFor();assert.equal((await snapshot(p)).cards.some(c=>c.predecessor_id===1),false);
 await p.getByRole('button',{name:'完成任务',exact:true}).click();await p.getByRole('button',{name:'撤销完成',exact:true}).waitFor();successor=(await snapshot(p)).cards.find(c=>c.predecessor_id===1);
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 await p.reload();await p.getByRole('button',{name:/轻量详情验收/}).click();await p.getByRole('group',{name:'直接编辑',exact:true}).first().waitFor();
 assert.equal((await snapshot(p)).cards.find(c=>c.id===1).completed,true);checks.push('rich date range + endpoint times + interval/count saved; successor atomic, inherited reset checklist, comments excluded, safe undo and reload');
 // Touch successor using real API, then stale UI's explicit refresh and blocked undo.
 await action(p,{action:'comment_create',card_id:successor.id,body:'后续已有处理'});await p.getByRole('button',{name:'刷新看板',exact:true}).click();await p.getByRole('group',{name:'直接编辑',exact:true}).first().locator('.card-content').click();
 await p.getByRole('button',{name:'撤销完成',exact:true}).click();await p.getByText(/下一次任务已有修改或处理/).waitFor();assert.equal((await snapshot(p)).cards.find(c=>c.id===1).completed,true);assert.ok((await snapshot(p)).comments.some(c=>c.body==='后续已有处理'));await p.screenshot({path:evidence+'/blocked-undo.png'});checks.push('touched successor explicit actionable warning, no silent deletion');
 // Guard semantic error does not trap text autosave or other actions.
 await p.getByRole('button',{name:'更多操作',exact:true}).click();await p.getByRole('button',{name:'归档卡片',exact:true}).click();await waitBoard(p,b=>b.cards.find(c=>c.id===1).archived);assert.equal((await snapshot(p)).cards.find(c=>c.id===1).archived,true);assert.equal((await snapshot(p)).cards.find(c=>c.id===1).completed,true);
 await p.getByRole('button',{name:'更多操作',exact:true}).click();await p.getByRole('button',{name:'恢复卡片',exact:true}).click();await waitBoard(p,b=>!b.cards.find(c=>c.id===1).archived);assert.equal((await snapshot(p)).cards.find(c=>c.id===1).completed,true);assert.equal((await snapshot(p)).cards.find(c=>c.id===1).archived,false);
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 p.on('dialog',async d=>d.accept());await p.getByRole('button',{name:'列表操作 待办',exact:true}).click();await p.getByRole('button',{name:'归档已完成任务',exact:true}).click();await p.waitForTimeout(400);state=await snapshot(p);assert.equal(state.cards.find(c=>c.id===1).archived,true);assert.equal(state.cards.find(c=>c.id===successor.id).archived,false);checks.push('archive/restore completion preserved, bulk archive only completed, successor unaffected');
 // Mobile emulation exercises bottom sheet and date form, not a physical Safari claim.
 const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const m=await phone.newPage();await login(m);await m.getByRole('button',{name:/轻量详情验收/}).click();await m.getByRole('group',{name:'任务2',exact:true}).locator('.card-content').click();await m.getByLabel('描述',{exact:true}).fill('移动端直接编辑');await m.waitForTimeout(850);
 assert.equal(await m.getByRole('dialog').getAttribute('aria-modal'),'true');await m.getByRole('button',{name:'设置日期和重复',exact:true}).click();await m.getByLabel('开始日期',{exact:true}).fill('2030-06-01');await m.getByLabel('开始时间',{exact:true}).fill('09:00');await m.getByLabel('结束时间',{exact:true}).fill('11:00');await m.getByLabel('重复',{exact:true}).selectOption('week');await m.getByLabel('周一',{exact:true}).check();await m.getByLabel('周五',{exact:true}).check();await m.getByLabel('周五',{exact:true}).blur();await waitBoard(m,b=>b.cards.find(c=>c.id===2).schedule?.repeat?.weekdays.length===2);
 const mb=await m.getByRole('dialog').boundingBox();assert.ok(mb.y>=0&&mb.y+mb.height<=844);await m.screenshot({path:evidence+'/mobile-schedule.png'});state=await snapshot(m);assert.deepEqual(state.cards.find(c=>c.id===2).schedule.repeat.weekdays,[0,4]);assert.equal(state.cards.find(c=>c.id===2).schedule.end_time,'11:00');checks.push('Chromium mobile bottom sheet, same-day interval, weekly selected weekdays persistence');
 fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors},null,2));assert.deepEqual(errors,[]);console.log('PASS '+evidence);
}catch(e){fs.writeFileSync(evidence+'/failure.txt',e.stack);console.error('FAIL '+evidence,e);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:evidence+'/failure.png'}).catch(()=>{});process.exitCode=1}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
