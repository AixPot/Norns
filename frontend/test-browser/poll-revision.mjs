import fs from 'node:fs';import {spawn,spawnSync} from 'node:child_process';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';import {fileURLToPath} from 'node:url';
for(const name of ['PLAYWRIGHT_MODULE','CHROMIUM_PATH','EVIDENCE_ROOT'])if(!process.env[name])throw Error('Set '+name);
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

await p.reload();await p.getByRole('button',{name:/Latency synthetic/}).click();
const check=n=>p.getByRole('group',{name:'Probe '+n,exact:true}).getByRole('checkbox');
await check(1).click();await p.waitForFunction(()=>!document.querySelector('.board-heading [role=status]')?.textContent.includes('保存中'));b=await rpc('/boards/1');const confirmed=b.revision;
const me=await(await p.request.get(base+'/api/me')).json();
const remote=await p.request.post(base+'/api/boards/1/mutate',{headers:{'X-CSRF-Token':me.csrf,'Origin':base},data:{expected_revision:b.revision,action:'list_update',list_id:b.lists[0].id,title:'External poll updated'}});assert.equal(remote.status(),200);b=await remote.json();
await p.getByRole('button',{name:'重命名External poll updated',exact:true}).waitFor({timeout:10000});
let bodies=[];p.on('request',r=>{if(r.url().endsWith('/mutate'))bodies.push(r.postDataJSON())});
await check(2).click();await p.waitForTimeout(250);const actual=await rpc('/boards/1');
const result={confirmedRevision:confirmed,externalRevision:b.revision,uiSawExternal:true,sent:bodies,secondCompleted:actual.cards.find(c=>c.id===2).completed,alert:await p.locator('.workspace [role=alert]').allTextContents()};
fs.writeFileSync(out+'/poll-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));console.log('EVIDENCE '+out);
assert.equal(result.secondCompleted,true,'poll-observed revision must be used for next mutation');
assert.equal(result.sent[0].expected_revision,result.externalRevision);
// Active queue: hold a genuine committed response, then commit externally and
// let a poll read that version while another admitted intent is waiting.
await p.reload();await p.getByRole('button',{name:/Latency synthetic/}).click();
let release,ready;const gate=new Promise(r=>release=r),held=new Promise(r=>ready=r);let posts=[];
await p.route('**/api/boards/1/mutate',async route=>{
 posts.push(route.request().postDataJSON());const response=await route.fetch();
 if(posts.length===1){ready();await gate}await route.fulfill({response});
});
await check(1).click();await held;await check(3).click();
b=await rpc('/boards/1');
let external=await p.request.post(base+'/api/boards/1/mutate',{headers:{'X-CSRF-Token':me.csrf,'Origin':base},data:{expected_revision:b.revision,action:'list_update',list_id:b.lists[0].id,title:'Active external'}});
assert.equal(external.status(),200);const activeRemote=await external.json();
const pollResponse=p.waitForResponse(r=>r.url()===base+'/api/boards/1'&&r.request().method()==='GET');
await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
assert.equal((await (await pollResponse).json()).revision,activeRemote.revision);
release();
await p.locator('.workspace [role=alert]').waitFor();await p.waitForTimeout(200);
assert.equal(posts.length,2);assert.equal(posts[1].expected_revision,activeRemote.revision-1);
assert.equal((await rpc('/boards/1')).cards.find(c=>c.id===3).completed,false);
await p.waitForTimeout(800);assert.equal(posts.length,2,'no conflict replay');
fs.writeFileSync(out+'/active-result.json',JSON.stringify({posts,externalRevision:activeRemote.revision},null,2));
await p.unrouteAll({behavior:'wait'});
// Dirty detached draft: freeze autosave using composition, observe a newer poll,
// then flush. The draft's original CAS baseline must conflict, never overwrite.
await p.reload();await p.getByRole('button',{name:/Latency synthetic/}).click();
await p.getByRole('group',{name:'Probe 2',exact:true}).locator('.card-content').click();
const description=p.getByLabel('描述',{exact:true});
await description.dispatchEvent('compositionstart');await description.fill('unsent local draft');
b=await rpc('/boards/1');const draftRevision=b.revision;
external=await p.request.post(base+'/api/boards/1/mutate',{headers:{'X-CSRF-Token':me.csrf,'Origin':base},data:{expected_revision:b.revision,action:'card_update',card_id:2,title:'Probe 2',description:'external preserved',archived:false}});
assert.equal(external.status(),200);b=await external.json();
const dirtyPoll=p.waitForResponse(async r=>r.url()===base+'/api/boards/1'&&r.request().method()==='GET'&&(await r.json()).revision===b.revision);
await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await dirtyPoll;
// Revision counters are intentionally not exposed in the UI; observe the real read,
// then allow its owner to apply before asserting the draft's original write baseline.
await p.waitForTimeout(80);
posts=[];await p.route('**/api/boards/1/mutate',async route=>{posts.push(route.request().postDataJSON());await route.continue()});
await description.dispatchEvent('compositionend');await description.blur();
await p.getByRole('button',{name:'查看最新版本并处理',exact:true}).waitFor();
assert.equal(await description.inputValue(),'unsent local draft');assert.equal(posts.length,1);
assert.equal(posts[0].expected_revision,draftRevision);
assert.equal((await rpc('/boards/1')).cards.find(c=>c.id===2).description,'external preserved');
await p.waitForTimeout(800);assert.equal(posts.length,1,'dirty conflict is not replayed');
fs.writeFileSync(out+'/dirty-result.json',JSON.stringify({posts,draftRevision,externalRevision:b.revision,local:await description.inputValue()},null,2));
console.log('PASS idle poll / active queue conflict / dirty draft baseline');
}catch(e){fs.writeFileSync(out+'/error.txt',e.stack);throw e}finally{if(browser)await browser.close();server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}
