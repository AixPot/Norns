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
 await rpc(p,'/boards',{title:'Completion display synthetic'});
 let b=await action(p,{action:'list_create',title:'Tasks'});const list=b.lists[0].id;
 for(const title of ['A','B','C','D'])b=await action(p,{action:'card_create',list_id:list,title});
 await p.reload();await p.getByRole('button',{name:/Completion display synthetic/}).click();
 const card=n=>p.getByRole('group',{name:n,exact:true}),box=n=>card(n).getByRole('checkbox'),toast=p.getByRole('region',{name:'最近完成的任务'});
 const order=()=>p.locator('.card').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
 async function shown(expected){await p.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.card')].map(e=>e.getAttribute('aria-label')))===JSON.stringify(expected),expected)}
 async function complete(n){await box(n).check();await toast.getByText(n,{exact:true}).waitFor()}
 const positions=b.cards.map(c=>[c.id,c.position]);
 // A committed response is deliberately held; feedback waits for acknowledgement.
 let release,started;let gate=new Promise(r=>release=r),held=new Promise(r=>started=r);let posts=[];
 await p.route('**/api/boards/2/mutate',async route=>{const data=route.request().postDataJSON();posts.push(data);const response=await route.fetch();if(posts.length===1){started();await gate}await route.fulfill({response})});
 await box('B').check();await held;assert.equal(await toast.count(),0);assert.equal(await box('B').isDisabled(),true);
 await box('A').check();await box('C').check();release();await toast.getByText('C',{exact:true}).waitFor();await shown(['D','A','B','C']);
 assert.deepEqual((await snapshot(p)).cards.map(c=>[c.id,c.position]),positions);assert.equal(posts.length,3);for(let i=1;i<3;i++)assert.equal(posts[i].expected_revision,posts[i-1].expected_revision+1);
 await p.unrouteAll({behavior:'wait'});
 await toast.getByRole('button',{name:'撤销',exact:true}).click();await shown(['C','D','A','B']);assert.equal((await snapshot(p)).cards.find(c=>c.title==='C').completed,false);
 await p.reload();await p.getByRole('button',{name:/Completion display synthetic/}).click();await shown(['C','D','A','B']);checks.push('three rapid queued completions, stable physical order, only latest acknowledged toast, undo exact latest, refresh preserves grouping');
 // Older timeout must not close a newer completion. Fake clock is installed only after startup.
 await p.clock.install();await complete('C');await p.clock.runFor(6000);await complete('D');await p.clock.runFor(4001);assert.equal(await toast.count(),1);assert.equal(await toast.getByText('D',{exact:true}).count(),1);await p.clock.runFor(5998);assert.equal(await toast.count(),1);await p.clock.runFor(2);await toast.waitFor({state:'hidden'});assert.equal(await toast.count(),0);
 await box('D').uncheck();await shown(['D','A','B','C']);checks.push('fake clock: replacement resets 10 seconds, older timer harmless, expiry leaves normal cancellation available');
 // Exact undo is captured even if another queued success replaces the toast while undo waits.
 await box('C').uncheck();await shown(['C','D','A','B']);await complete('C');
 posts=[];gate=new Promise(r=>release=r);held=new Promise(r=>started=r);
 await p.route('**/api/boards/2/mutate',async route=>{posts.push(route.request().postDataJSON());const response=await route.fetch();if(posts.length===1){started();await gate}await route.fulfill({response})});
 await box('D').check();await held;await toast.getByRole('button',{name:'撤销',exact:true}).click();assert.equal(await toast.getByRole('button',{name:'撤销中…',exact:true}).isDisabled(),true);release();await shown(['C','A','B','D']);assert.deepEqual(posts.map(x=>[x.card_id,x.completed]),[[4,true],[3,false]]);assert.equal(await toast.getByText('D',{exact:true}).count(),1);await p.unrouteAll({behavior:'wait'});checks.push('undo captured C while D completion pending; D replaces toast but is not undone; queue CAS maintained');
 await toast.getByRole('button',{name:'关闭完成提示'}).click();assert.equal(await toast.count(),0);
 // Move menu maps named visual anchors to physical indices; undo follows newest real move.
 await card('B').locator('.card-content').click();await p.getByRole('button',{name:'移动卡片',exact:true}).click();await p.getByLabel('插入位置',{exact:true}).selectOption({label:'列表末尾（同完成分组内）'});await p.getByRole('button',{name:'移动到此位置',exact:true}).click();await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});await box('B').uncheck();await shown(['C','B','A','D']);checks.push('named move menu physical index mapping, cancellation follows latest true position rather than stale saved array');
 // First completion click after text blur saves text and shares feedback with detail.
 await card('C').locator('.card-content').click();await p.getByLabel('描述',{exact:true}).fill('edited before complete');await p.getByRole('button',{name:'完成任务',exact:true}).click();await toast.getByText('C',{exact:true}).waitFor();assert.equal((await snapshot(p)).cards.find(c=>c.title==='C').description,'edited before complete');await toast.getByRole('button',{name:'撤销',exact:true}).click();await p.getByRole('button',{name:'完成任务',exact:true}).waitFor();await p.getByRole('button',{name:'关闭卡片',exact:true}).click();checks.push('detail edit blur first-click completion and shared toast undo through autosave writer');
 // A real mouse gesture before C resolves a same-group identity, not a visual index.
 const from=await card('B').locator('.card-content').boundingBox();await p.mouse.move(from.x+40,from.y+20);await p.mouse.down();await p.mouse.move(from.x+48,from.y+20,{steps:3});await p.locator('.board-drag-ghost').waitFor();await p.clock.runFor(20);const to=await card('C').boundingBox();await p.mouse.move(to.x+40,to.y+3,{steps:10});await p.clock.runFor(20);assert.equal(await p.locator('.drag-placeholder').count(),1);await p.mouse.up();await waitBoard(p,b=>b.cards.find(c=>c.title==='B').position===1);await shown(['B','C','A','D']);checks.push('real mouse drag same-group identity maps grouped display to persisted index');
 // Safe recurrence cancellation and sticky touched-successor refusal via toast.
 b=await snapshot(p);const cid=b.cards.find(c=>c.title==='C').id;
 await action(p,{action:'card_schedule',card_id:cid,schedule:{start_date:'2030-01-01',timezone:'Asia/Shanghai',repeat:{unit:'day',interval:1,mode:'calendar',count:3,weekdays:[]}}});
 await p.getByRole('button',{name:'刷新看板',exact:true}).click();await complete('C');let successor=(await snapshot(p)).cards.find(c=>c.predecessor_id===cid);assert.ok(successor);await toast.getByRole('button',{name:'撤销',exact:true}).click();await waitBoard(p,b=>!b.cards.some(c=>c.predecessor_id===cid));
 await complete('C');successor=(await snapshot(p)).cards.find(c=>c.predecessor_id===cid);await action(p,{action:'comment_create',card_id:successor.id,body:'touched successor'});
 // Refresh would clear feedback. Let ordinary poll adopt the revision first instead.
 await p.clock.runFor(3000);await p.waitForTimeout(100);await toast.getByRole('button',{name:'撤销',exact:true}).click();await p.getByText(/下一次任务已有修改或处理/).waitFor();b=await snapshot(p);assert.ok(b.cards.find(c=>c.id===successor.id));assert.ok(b.cards.find(c=>c.id===cid).completed);assert.ok(b.comments.find(c=>c.body==='touched successor'));checks.push('real recurrence successor withdrawn only when untouched; touched successor retained with actionable refusal');
 // Scope changes clear feedback, including an acknowledgement held while navigation drains.
 await toast.getByRole('button',{name:'关闭完成提示'}).click();
 let navRelease,navStarted;const navGate=new Promise(r=>navRelease=r),navHeld=new Promise(r=>navStarted=r);
 await p.route('**/api/boards/2/mutate',async route=>{const response=await route.fetch();navStarted();await navGate;await route.fulfill({response})});
 await box('B').check();await navHeld;await p.getByRole('button',{name:'← 今天',exact:true}).click();navRelease();
 await p.getByRole('heading',{name:'今天',exact:true}).waitFor();assert.equal(await toast.count(),0);await p.unrouteAll({behavior:'wait'});await p.getByRole('button',{name:/Completion display synthetic/}).click();assert.equal(await toast.count(),0);
 await box('B').uncheck();await box('B').check();await toast.getByText('B',{exact:true}).waitFor();
 await p.getByRole('button',{name:'← 今天',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();assert.equal(await toast.count(),0);await p.getByRole('button',{name:/Completion display synthetic/}).click();assert.equal(await toast.count(),0);
 await box('B').uncheck();await waitBoard(p,b=>!b.cards.find(c=>c.title==='B').completed);
 // A cancellation elsewhere must clear stale feedback, not toggle the task back on.
 await box('B').check();await toast.getByText('B',{exact:true}).waitFor();await action(p,{action:'card_complete',card_id:2,completed:false});await p.clock.runFor(3000);await toast.waitFor({state:'hidden'});assert.equal((await snapshot(p)).cards.find(c=>c.id===2).completed,false);
 checks.push('held acknowledgement drains before navigation; no feedback survives re-entry; remote cancellation clears stale undo');
 await p.screenshot({path:evidence+'/desktop.png'});
 // Narrow mobile detail: toast inside focus scope, above fixed bottom operations.
 for(const width of [320,375]){
  const ctx=await browser.newContext({viewport:{width,height:740},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),m=await ctx.newPage();await login(m);await shellNav(m,'Completion display synthetic',true);
  await m.getByRole('group',{name:'B',exact:true}).locator('.card-content').click();await m.getByRole('button',{name:'完成任务',exact:true}).click();const mt=m.getByRole('region',{name:'最近完成的任务'});await mt.waitFor();const tb=await mt.boundingBox(),bottom=await m.getByRole('toolbar',{name:'卡片底部操作'}).boundingBox();assert.ok(tb.x>=0&&tb.x+tb.width<=width&&tb.y>=0&&tb.y+tb.height<=740&&(tb.y+tb.height<=bottom.y||tb.y>=bottom.y+bottom.height),JSON.stringify({tb,bottom}));assert.equal(await m.locator('.app-shell').evaluate(e=>e.inert),true);await m.screenshot({path:evidence+'/mobile-'+width+'.png'});await mt.getByRole('button',{name:'撤销',exact:true}).click();await m.getByRole('button',{name:'完成任务',exact:true}).waitFor();await ctx.close();
 }
 checks.push('320/375 Chromium mobile: readable interactive toast in detail focus scope, safe area bottom operations unobstructed, reduced motion');
 fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors},null,2));assert.deepEqual(errors,[]);console.log('PASS '+evidence);
}catch(e){fs.writeFileSync(evidence+'/failure.txt',e.stack);console.error('FAIL '+evidence,e);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:evidence+'/failure.png'}).catch(()=>{});process.exitCode=1}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
