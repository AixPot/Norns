import fs from 'node:fs';import {spawn,spawnSync} from 'node:child_process';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';import {fileURLToPath} from 'node:url';
for(const k of ['PLAYWRIGHT_MODULE','CHROMIUM_PATH','EVIDENCE_ROOT'])if(!process.env[k])throw Error('Set '+k);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),out=process.env.EVIDENCE_ROOT+'/latency-'+Date.now();fs.mkdirSync(out,{recursive:true,mode:0o700});const base='http://127.0.0.1:48763',password=crypto.randomBytes(24).toString('base64url');
const env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+out+'/synthetic.sqlite',BIND_ADDR:'127.0.0.1:48763',APP_ORIGIN:base,COOKIE_SECURE:'false',STATIC_DIR:root+'/frontend/dist'};
await new Promise((r,j)=>{let s=net.createServer();s.once('error',j);s.listen(48763,'127.0.0.1',()=>s.close(r))});assert.equal(spawnSync(root+'/target/release/norns',['init-admin','probe'],{input:password,env,cwd:out}).status,0);
const log=fs.openSync(out+'/server.log','a');let server=spawn(root+'/target/release/norns',[],{env,cwd:out,stdio:['ignore',log,log]}),browser;fs.closeSync(log);let results=[];
try{for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});let p=await browser.newPage({viewport:{width:1440,height:900}});await p.goto(base);assert.equal(await p.getByRole('link',{name:'源代码',exact:true}).count(),1);await p.getByLabel('用户名',{exact:true}).fill('probe');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor();
assert.equal(await p.locator('.topbar').getByRole('link',{name:'源代码',exact:true}).count(),0);
async function rpc(path,data){return p.evaluate(async({path,data})=>{let me=await(await fetch('/api/me')).json(),r=await fetch('/api'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(data?{body:JSON.stringify(data)}:{})});if(!r.ok)throw Error(await r.text());return r.json()},{path,data})}
let b=await rpc('/boards',{title:'Latency synthetic'});b=await rpc('/boards/'+b.id+'/mutate',{expected_revision:b.revision,action:'list_create',title:'Probe'});for(let n=1;n<=3;n++)b=await rpc('/boards/'+b.id+'/mutate',{expected_revision:b.revision,action:'card_create',list_id:b.lists[0].id,title:'Probe '+n});
for(const delay of [0,350,'get-only','get-fail'])for(const mode of ['three-clicks','edit-then-complete','edit-immediate']){
 await p.unrouteAll({behavior:'wait'});b=await rpc('/boards/1');for(const c of b.cards)if(c.completed)b=await rpc('/boards/1/mutate',{expected_revision:b.revision,action:'card_complete',card_id:c.id,completed:false});
 await p.reload();await p.getByRole('button',{name:/Latency synthetic/}).click();await p.getByRole('group',{name:'Probe 1',exact:true}).waitFor();
 if(mode!=='three-clicks'){await p.getByRole('group',{name:'Probe 1',exact:true}).locator('.card-content').click();await p.getByLabel('描述',{exact:true}).waitFor()}
 let netEvents=[],epoch=Date.now();await p.route('**/api/**',async route=>{let req=route.request(),url=new URL(req.url()),t=Date.now()-epoch;if(delay==='get-fail'&&url.pathname==='/api/boards')return route.abort('failed');let res=await route.fetch();let fetched=Date.now()-epoch;const injected=(delay===350&&(url.pathname.endsWith('/mutate')||url.pathname==='/api/boards'))||(delay==='get-only'&&url.pathname==='/api/boards')?350:0;if(injected)await new Promise(r=>setTimeout(r,injected));await route.fulfill({response:res});netEvents.push({method:req.method(),path:url.pathname,start:t,serverResponse:fetched,delivered:Date.now()-epoch,injected,body:req.postDataJSON?.()})});
 await p.evaluate(()=>{window.probe={start:performance.now(),events:[]};const snap=()=>Array.from(document.querySelectorAll('input[type=checkbox],button')).filter(x=>x.type==='checkbox'||['完成任务','撤销完成'].includes(x.getAttribute('aria-label'))).map(x=>({text:x.getAttribute('aria-label')||x.textContent,disabled:x.disabled,checked:x.checked}));let last='';new MutationObserver(()=>{let s=JSON.stringify(snap());if(s!==last){last=s;window.probe.events.push({t:performance.now()-window.probe.start,type:'state',items:JSON.parse(s)})}}).observe(document.body,{subtree:true,attributes:true,childList:true});document.addEventListener('click',e=>window.probe.events.push({t:performance.now()-window.probe.start,type:'click',tag:e.target.tagName,label:e.target.getAttribute('aria-label')}),true);window.probe.events.push({t:0,type:'state',items:snap()})});
 let attempts=[];if(mode==='three-clicks'){for(let n=1;n<=3;n++){let l=p.getByRole('group',{name:'Probe '+n,exact:true}).getByRole('checkbox'),box=await l.boundingBox();attempts.push({n,t:Date.now()-epoch,disabled:await l.isDisabled()});await p.mouse.click(box.x+box.width/2,box.y+box.height/2);await p.waitForTimeout(60)}}else{await p.getByLabel('描述',{exact:true}).fill('Synthetic edit '+delay+' '+mode);await p.waitForTimeout(mode==='edit-immediate'?20:650);let l=p.getByRole('button',{name:'完成任务',exact:true}),box=await l.boundingBox();attempts.push({t:Date.now()-epoch,disabled:await l.isDisabled()});await p.mouse.click(box.x+box.width/2,box.y+box.height/2)}
 await p.waitForTimeout(1800);let dom=await p.evaluate(()=>window.probe);await p.unrouteAll({behavior:'wait'});b=await rpc('/boards/1');let result={delay,mode,attempts,netEvents,dom,persisted:b.cards.map(c=>({id:c.id,completed:c.completed,description:c.description}))};assert.equal(netEvents.filter(n=>n.path==='/api/boards').length,0,'full mutation snapshot updates summary without another GET');if(mode==='three-clicks'){assert.equal(b.cards.filter(c=>c.completed).length,3);const posts=netEvents.filter(n=>n.method==='POST');assert.equal(posts.length,3);for(let i=1;i<posts.length;i++)assert.equal(posts[i].body.expected_revision,posts[i-1].body.expected_revision+1)}results.push(result);fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2));console.log(JSON.stringify({delay,mode,attempts,completed:b.cards.filter(c=>c.completed).length}));if(mode!=='three-clicks')assert.equal(b.cards[0].completed,true,'first completion click after editing must persist');if(delay===350&&mode==='three-clicks'){assert.equal(attempts[1].disabled,false);assert.equal(b.cards.filter(c=>c.completed).length,3)}
}

// A committed response held back must not permit same-card duplicates; navigation drains all admitted work.
await p.unrouteAll({behavior:'wait'});await p.reload();await p.getByRole('button',{name:/Latency synthetic/}).click();
b=await rpc('/boards/1');for(const c of b.cards)if(c.completed)b=await rpc('/boards/1/mutate',{expected_revision:b.revision,action:'card_complete',card_id:c.id,completed:false});
await p.reload();await p.getByRole('button',{name:/Latency synthetic/}).click();
let release,heldResolve;const gate=new Promise(r=>release=r),held=new Promise(r=>heldResolve=r);let posts=[];
await p.route('**/api/boards/1/mutate',async route=>{posts.push(route.request().postDataJSON());const response=await route.fetch();if(posts.length===1){heldResolve();await gate}await route.fulfill({response})});
const check=n=>p.getByRole('group',{name:'Probe '+n,exact:true}).getByRole('checkbox');
await check(1).click();await held;assert.equal(await check(1).isDisabled(),true);assert.equal(await check(2).isDisabled(),false);
const box=await check(1).boundingBox();await p.mouse.click(box.x+box.width/2,box.y+box.height/2);
await check(2).click();await check(3).click();await p.getByRole('button',{name:'← 我的看板',exact:true}).click();assert.equal(await p.getByRole('heading',{name:'我的看板',exact:true}).count(),0);
release();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor();assert.equal(posts.length,3);assert.deepEqual(posts.map(x=>x.card_id),[1,2,3]);assert.equal((await rpc('/boards/1')).cards.filter(c=>c.completed).length,3);
await p.unrouteAll({behavior:'wait'});
// Real external CAS conflict: only the first queued request is transmitted, others are explicitly rejected.
for(const mode of ['conflict','unknown']){
 b=await rpc('/boards/1');for(const c of b.cards)if(c.completed)b=await rpc('/boards/1/mutate',{expected_revision:b.revision,action:'card_complete',card_id:c.id,completed:false});
 await p.reload();await p.getByRole('button',{name:/Latency synthetic/}).click();
 posts=[];let ready;const started=new Promise(r=>ready=r);let unlock;const wait=new Promise(r=>unlock=r);
 await p.route('**/api/boards/1/mutate',async route=>{
  posts.push(route.request().postDataJSON());ready();await wait;
  if(mode==='unknown'){await route.fetch();await route.abort('failed')}
  else {const response=await route.fetch();await route.fulfill({response})}
 });
 await check(1).click();await started;await check(2).click();await check(3).click();
 if(mode==='conflict'){
  const me=await (await p.request.get(base+'/api/me')).json();b=await rpc('/boards/1');
  const remote=await p.request.post(base+'/api/boards/1/mutate',{headers:{'X-CSRF-Token':me.csrf,'Origin':base},data:{expected_revision:b.revision,action:'list_update',list_id:b.lists[0].id,title:'Probe'}});assert.equal(remote.status(),200);
 }
 unlock();await p.waitForTimeout(300);assert.equal(posts.length,1);assert.match(await p.locator('.workspace [role=alert]').innerText(),/未发送/);
 b=await rpc('/boards/1');assert.equal(b.cards.filter(c=>c.completed).length,mode==='unknown'?1:0);await p.waitForTimeout(700);assert.equal(posts.length,1,'no automatic replay');
 await p.unrouteAll({behavior:'wait'});
}
fs.writeFileSync(out+'/result.json',JSON.stringify(results,null,2));console.log('EVIDENCE '+out);
}catch(e){fs.writeFileSync(out+'/error.txt',e.stack);throw e}finally{if(browser)await browser.close();server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}
