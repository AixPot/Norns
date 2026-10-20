for(const k of ['PLAYWRIGHT_MODULE','CHROMIUM_PATH','EVIDENCE_ROOT'])if(!process.env[k])throw Error('Set '+k);
import {fileURLToPath} from 'node:url';import net from 'node:net';import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),evidence=process.env.EVIDENCE_ROOT+'/drag-'+Date.now();fs.mkdirSync(evidence,{mode:0o700});
const password=crypto.randomBytes(24).toString('base64url'),base='http://127.0.0.1:48759',env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+evidence+'/norns.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48759',STATIC_DIR:root+'/frontend/dist'};
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(48759,'127.0.0.1',()=>probe.close(resolve))});
assert.equal(spawnSync(root+'/target/release/norns',['init-admin','admin'],{env,input:password,cwd:evidence}).status,0);
let server,browser;const errors=[],checks=[],posts=[];const log=fs.openSync(evidence+'/server.log','a');
async function login(p){p.on('pageerror',e=>errors.push(e.message));await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill('admin');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor()}
async function rpc(p,path,body){return p.evaluate(async({path,body})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}},{path,body})}
const snapshot=async p=>(await rpc(p,'/boards/1')).body;
async function action(p,data){const b=await snapshot(p),r=await rpc(p,'/boards/1/mutate',{expected_revision:b.revision,...data});assert.equal(r.status,200);return r.body}
async function persisted(p,predicate){for(let i=0;i<100;i++){const b=await snapshot(p);if(predicate(b))return b;await p.waitForTimeout(40)}assert.fail('persisted condition timed out')}
const lists=p=>p.locator('.column');const list=(p,id)=>p.locator(`[data-list-id="${id}"]`);const card=(p,id)=>p.locator(`[data-card-id="${id}"]`);
async function refresh(p){await p.getByRole('button',{name:'刷新看板',exact:true}).click();await p.waitForTimeout(150)}
const center=async locator=>{const r=await locator.boundingBox();assert.ok(r);return {x:r.x+r.width/2,y:r.y+r.height/2}};
async function startMouse(p,node){const a=await center(node);await p.mouse.move(a.x,a.y);await p.mouse.down();await p.mouse.move(a.x+8,a.y,{steps:3});await p.locator('.board-drag-ghost').waitFor();}
async function hover(p,point){await p.mouse.move(point.x,point.y,{steps:12});await p.waitForTimeout(100)}
async function unique(p){assert.equal(await p.locator('.drag-placeholder').count(),1)}
try{
 server=spawn(root+'/target/release/norns',[],{env,cwd:evidence,stdio:['ignore',log,log]});fs.closeSync(log);for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:900}}),p=await ctx.newPage();await login(p);p.on('request',r=>{if(r.url().endsWith('/mutate'))posts.push(r.postDataJSON())});
 await rpc(p,'/boards',{title:'Drag synthetic'});let b;for(const title of ['Alpha','Beta','Empty'])b=await action(p,{action:'list_create',title});const [a,z,e]=b.lists.map(l=>l.id);
 for(const title of ['Done','One','Two','Three'])b=await action(p,{action:'card_create',list_id:a,title});const [done,one,two,three]=b.cards.map(c=>c.id);
 await action(p,{action:'card_complete',card_id:done,completed:true});await p.reload();await p.getByRole('button',{name:/Drag synthetic/}).click();
 const listOrder=()=>p.locator('.column').evaluateAll(es=>es.map(e=>Number(e.dataset.listId)));
 await startMouse(p,list(p,a).locator('h2'));let r=await list(p,e).boundingBox();await hover(p,{x:r.x+r.width-25,y:r.y+32});await unique(p);await p.screenshot({path:evidence+'/list-target.png'});await p.mouse.up();await persisted(p,b=>b.lists[2].id===a);assert.deepEqual(await listOrder(),[z,e,a]);
 await startMouse(p,list(p,a).locator('h2'));r=await list(p,z).boundingBox();await hover(p,{x:r.x+25,y:r.y+32});await unique(p);await p.mouse.up();await persisted(p,b=>b.lists[0].id===a);await p.reload();await p.getByRole('button',{name:/Drag synthetic/}).click();assert.deepEqual(await listOrder(),[a,z,e]);checks.push('real mouse list first-to-last and last-to-first; GET and refresh persistence');
 // Same-column unfinished tail: physical Done remains at front.
 await startMouse(p,card(p,one).locator('.card-content'));r=await card(p,three).boundingBox();await hover(p,{x:r.x+60,y:r.y+r.height-4});await unique(p);await p.screenshot({path:evidence+'/card-target.png'});await p.mouse.up();b=await persisted(p,b=>b.cards.find(c=>c.id===one).position===3);assert.equal(b.cards.find(c=>c.id===done).position,0);assert.equal(await p.getByRole('dialog').count(),0);
 // Cross-column empty target.
 await startMouse(p,card(p,two).locator('.card-content'));r=await list(p,z).locator('.card-stack').boundingBox();await hover(p,{x:r.x+70,y:r.y+22});await unique(p);await p.mouse.up();await persisted(p,b=>b.cards.find(c=>c.id===two).list_id===z);
 // completed cross-column to only-incomplete boundary, preserves state.
 await startMouse(p,card(p,done).locator('.card-content'));r=await list(p,z).locator('.card-stack').boundingBox();await hover(p,{x:r.x+70,y:r.y+r.height-2});await unique(p);await p.mouse.up();await persisted(p,b=>b.cards.find(c=>c.id===done).list_id===z&&b.cards.find(c=>c.id===done).completed);checks.push('same column real grouped tail index, empty cross-list and completed cross-list boundary with unique placeholder');
 // Wrong-group hover must not advertise impossible insertion.
 await startMouse(p,card(p,three).locator('.card-content'));await hover(p,await center(card(p,done)));assert.equal(await p.locator('.drag-placeholder').count(),0);const before=posts.length;await p.mouse.up();assert.equal(posts.length,before);
 // Same-revision polling must not cancel an otherwise valid gesture.
 await startMouse(p,card(p,three).locator('.card-content'));await p.waitForTimeout(3200);assert.equal(await p.locator('.board-drag-ghost').count(),1);await p.keyboard.press('Escape');await p.mouse.up();
 // Escape and polling cancellation, no drag POST.
 await startMouse(p,card(p,three).locator('.card-content'));await p.keyboard.press('Escape');assert.equal(await p.locator('.board-drag-ghost').count(),0);await p.mouse.up();
 await startMouse(p,card(p,three).locator('.card-content'));await action(p,{action:'list_update',list_id:e,title:'Empty changed remotely'});const external=posts.length;await p.waitForTimeout(3200);assert.equal(await p.locator('.board-drag-ghost').count(),0);await p.mouse.up();assert.equal(posts.length,external);checks.push('wrong-group rejects; Escape and real poll revision cancel without stale POST');
 // List menu keyboard fallback retains the actual select focus.
 await list(p,a).getByRole('button',{name:'列表操作 Alpha',exact:true}).click();await p.getByLabel('移动列表 Alpha',{exact:true}).focus();await p.keyboard.press('End');await p.keyboard.press('Enter');await persisted(p,b=>b.lists[2].id===a);assert.equal(await p.getByLabel('移动列表 Alpha',{exact:true}).evaluate(n=>n===document.activeElement),true);await list(p,a).getByRole('button',{name:'列表操作 Alpha',exact:true}).click();await refresh(p);
 // Restore first column by API for mobile scenarios.
 await action(p,{action:'list_move',list_id:a,index:0});await refresh(p);
 // Create a long column, exercise document edge scroll.
 for(let i=0;i<15;i++)await action(p,{action:'card_create',list_id:a,title:'Long '+i});await refresh(p);
 await startMouse(p,card(p,three).locator('.card-content'));const scrollBefore=await p.evaluate(()=>scrollY);await hover(p,{x:160,y:892});await p.waitForTimeout(450);assert.ok(await p.evaluate(()=>scrollY)>scrollBefore);await p.keyboard.press('Escape');await p.mouse.up();await p.evaluate(()=>scrollTo(0,0));checks.push('keyboard list position fallback focus and real document edge auto-scroll with cleanup');
 // Native Chromium CDP touch sequences, never DOM dispatchEvent.
 for(const width of [375,320]){
  const mc=await browser.newContext({viewport:{width,height:740},isMobile:true,hasTouch:true,reducedMotion:'reduce'}),m=await mc.newPage();await login(m);await m.getByRole('button',{name:/Drag synthetic/}).click();const cdp=await mc.newCDPSession(m);
  let touchId=1;const touch=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({x:p.x,y:p.y,id:p.id??touchId,radiusX:1,radiusY:1,force:1}))});
  async function press(node){const q=await center(node);await touch('touchStart',[q]);await m.waitForTimeout(430);await m.locator('.board-drag-ghost').waitFor();return q}
  async function moveTouch(q){await touch('touchMove',[q]);await m.waitForTimeout(90)}
  // Ordinary content swipe scrolls instead of starting a drag.
  let q=await center(card(m,three).locator('.card-content'));await touch('touchStart',[q]);for(let i=1;i<=8;i++){await touch('touchMove',[{x:q.x,y:q.y-i*18}]);await m.waitForTimeout(16)}await touch('touchEnd',[]);await m.waitForTimeout(150);assert.ok(await m.evaluate(()=>scrollY)>30);assert.equal(await m.locator('.board-drag-ghost').count(),0);await m.evaluate(()=>scrollTo(0,0));await m.waitForTimeout(250);
  // Short tap opens detail, closing returns; checkbox never starts drag.
  q=await center(card(m,three).locator('.card-content'));await touch('touchStart',[q]);await touch('touchEnd',[]);await m.getByRole('dialog').waitFor();await m.getByRole('button',{name:'关闭卡片',exact:true}).click();await m.getByRole('dialog').waitFor({state:'hidden'});
  // touch same-list reordering before first unfinished task.
  const first=await list(m,a).locator('.card').first().getAttribute('data-card-id');const moving=one;
  await card(m,moving).scrollIntoViewIfNeeded();await press(card(m,moving).locator('.card-content'));r=await card(m,Number(first)).boundingBox();await moveTouch({x:r.x+60,y:r.y+4});await unique(m);await m.screenshot({path:evidence+'/touch-'+width+'.png'});await touch('touchEnd',[]);await persisted(m,b=>b.cards.find(c=>c.id===moving).position===0);assert.equal(await m.getByRole('dialog').count(),0);
  // Second finger cancels, no write. System touchCancel also clears timer/frame.
  await m.waitForTimeout(750);q=await press(card(m,moving).locator('.card-content'));let rev=(await snapshot(m)).revision;await touch('touchStart',[{...q,id:1},{x:q.x+25,y:q.y+25,id:2}]);await touch('touchEnd',[]);assert.equal(await m.locator('.board-drag-ghost').count(),0);assert.equal((await snapshot(m)).revision,rev);
  await m.waitForTimeout(750);await press(card(m,moving).locator('.card-content'));await touch('touchCancel',[]);assert.equal(await m.locator('.board-drag-ghost').count(),0);
  // A held finger on the bottom edge keeps scrolling without further moves.
  await m.waitForTimeout(750);await press(card(m,moving).locator('.card-content'));const sy=await m.evaluate(()=>scrollY);await moveTouch({x:160,y:732});await m.waitForTimeout(350);assert.ok(await m.evaluate(()=>scrollY)>sy);await touch('touchCancel',[]);assert.equal(await m.locator('.board-drag-ghost').count(),0);await m.evaluate(()=>scrollTo(0,0));
  // Long-press title, horizontal board edge scroll and list-to-end ordering.
  await m.waitForTimeout(750);await press(list(m,a).locator('h2'));await moveTouch({x:width-3,y:330});await m.waitForTimeout(1800);assert.ok(await m.locator('.board-scroll').evaluate(n=>n.scrollLeft)>100);r=await list(m,e).boundingBox();await moveTouch({x:Math.max(60,Math.min(width-70,r.x+r.width-70)),y:r.y+160});await unique(m);await touch('touchEnd',[]);await persisted(m,b=>b.lists[2].id===a);await m.reload();await m.getByRole('button',{name:/Drag synthetic/}).click();assert.deepEqual(await m.locator('.column').evaluateAll(es=>es.map(n=>Number(n.dataset.listId))),[z,e,a]);
  await list(m,a).locator('h2').scrollIntoViewIfNeeded();await m.waitForTimeout(250);await press(list(m,a).locator('h2'));await moveTouch({x:3,y:330});await m.waitForTimeout(1800);r=await list(m,z).boundingBox();await moveTouch({x:Math.max(20,r.x+20),y:r.y+32});await touch('touchEnd',[]);await persisted(m,b=>b.lists[0].id===a);assert.equal(await m.locator('.board-scroll').evaluate(n=>n.style.scrollSnapType),'');
  // Native touch cross-list drop into a genuinely empty column.
  await m.waitForTimeout(750);await m.locator('.board-scroll').evaluate(n=>n.scrollLeft=0);await m.waitForTimeout(200);await press(card(m,moving).locator('.card-content'));await moveTouch({x:width-3,y:430});await m.waitForTimeout(850);r=await list(m,e).locator('.card-stack').boundingBox();await moveTouch({x:Math.max(80,Math.min(width-80,(Math.max(0,r.x)+Math.min(width,r.x+r.width))/2)),y:r.y+24});await unique(m);await touch('touchEnd',[]);await persisted(m,b=>b.cards.find(c=>c.id===moving).list_id===e);assert.equal(await m.getByRole('dialog').count(),0);
  await mc.close();checks.push(`CDP native touch ${width}: ordinary swipe, short tap detail, long-press same/cross-empty reorder, persisted list first-last/last-first, second finger/cancel, fixed-finger document/board edge scroll; snap cleanup`);
  // Return One below Three to repeat native same-list move at next width.
  await action(p,{action:'card_move',card_id:one,target_list_id:a,index:1});await refresh(p);
 }
 // Dispatch-time remote change creates a real 409; the writer must never rebase/replay.
 await p.evaluate(()=>scrollTo(0,0));await refresh(p);let injected=false;const conflictStart=posts.length;
 // External writes bypass the dragged page's route interception.
 const remote=await ctx.newPage();await remote.goto(base);await p.bringToFront();await p.route('**/api/boards/1/mutate',async route=>{if(!injected){injected=true;await action(remote,{action:'list_update',list_id:e,title:'CAS remote'})}await route.continue()});
 await startMouse(p,card(p,one).locator('.card-content'));r=await card(p,three).boundingBox();await hover(p,{x:r.x+50,y:r.y+3});await unique(p);await p.mouse.up();await p.getByRole('alert').waitFor();assert.equal(posts.length,conflictStart+1);await p.waitForTimeout(350);assert.equal(posts.length,conflictStart+1);await p.unrouteAll({behavior:'wait'});await refresh(p);
 // Lost genuine acknowledgement after commit is unknown, not rollback and not auto replay.
 let lost=false;const unknownStart=posts.length;await p.route('**/api/boards/1/mutate',async route=>{await route.fetch();lost=true;await route.abort('failed')});
 await startMouse(p,card(p,one).locator('.card-content'));r=await card(p,three).boundingBox();await hover(p,{x:r.x+50,y:r.y+3});await p.mouse.up();await p.getByRole('alert').filter({hasText:/未知/}).waitFor();assert.ok(lost);await persisted(p,b=>b.cards.find(c=>c.id===one).position===0);await p.waitForTimeout(350);assert.equal(posts.length,unknownStart+1);await p.unrouteAll({behavior:'wait'});await remote.close();checks.push('real 409 and committed response loss: one POST only, no automatic replay; unknown persistence read back');
 assert.deepEqual(errors,[]);fs.writeFileSync(evidence+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors,postCount:posts.length,touchScope:'Chromium CDP native input only; physical iPhone Safari / Android not exercised'},null,2));console.log('PASS '+evidence);
}catch(e){fs.writeFileSync(evidence+'/requests.json',JSON.stringify(posts,null,2));fs.writeFileSync(evidence+'/failure.txt',e.stack);console.error('FAIL '+evidence,e);if(browser)for(const c of browser.contexts())for(const p of c.pages()){fs.writeFileSync(evidence+'/dom.json',JSON.stringify(await p.evaluate(()=>({scrollY,columns:[...document.querySelectorAll('.column')].map(n=>({id:n.dataset.listId,r:n.getBoundingClientRect().toJSON(),cards:[...n.querySelectorAll('.card,.drag-placeholder')].map(c=>({id:c.dataset.cardId,text:c.textContent,r:c.getBoundingClientRect().toJSON(),margin:getComputedStyle(c).margin}))})),status:[...document.querySelectorAll('[role=status]')].map(n=>n.textContent)})),null,2));await p.screenshot({path:evidence+'/failure-'+c.pages().indexOf(p)+'.png'}).catch(()=>{})}process.exitCode=1}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
