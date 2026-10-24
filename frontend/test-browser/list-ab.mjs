for(const name of ['PLAYWRIGHT_MODULE','CHROMIUM_PATH','EVIDENCE_ROOT'])if(!process.env[name])throw Error('Set '+name);
import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),out=process.env.EVIDENCE_ROOT+'/list-ab-'+Date.now();fs.mkdirSync(out,{mode:0o700});
const base='http://127.0.0.1:48771',password=crypto.randomBytes(24).toString('base64url'),env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+out+'/synthetic.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48771',STATIC_DIR:root+'/frontend/dist'};
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(48771,'127.0.0.1',()=>s.close(resolve))});
const binary=process.env.NORNS_BINARY||root+'/target/release/norns';
assert.equal(spawnSync(binary,['init-admin','admin'],{env,input:password,cwd:out}).status,0);
let stage='boot';let server,browser,s3;const checks=[],errors=[],consoleErrors=[];const log=fs.openSync(out+'/server.log','a');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const manifest=()=>Object.fromEntries(fs.readdirSync(root+'/frontend/dist',{recursive:true}).filter(f=>fs.statSync(root+'/frontend/dist/'+f).isFile()).map(f=>[f,hash(root+'/frontend/dist/'+f)]));const frozen=manifest();
async function rpc(p,path,body,method=body?'POST':'GET'){return p.evaluate(async({path,body,method})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?null:await r.json()}},{path,body,method})}
const snapshot=async(p,id)=>(await rpc(p,'/boards/'+id)).body;
async function action(p,id,data){const b=await snapshot(p,id),r=await rpc(p,`/boards/${id}/mutate`,{expected_revision:b.revision,...data});assert.equal(r.status,200,JSON.stringify(r));return r.body}
async function login(p,name='admin',pass=password){p.on('pageerror',e=>{errors.push({stage,stack:e.stack});fs.writeFileSync(out+'/pageerrors.json',JSON.stringify(errors,null,2))});p.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill(name);await p.getByLabel('密码',{exact:true}).fill(pass);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor()}
async function nav(p,name){if(await p.getByLabel('打开导航',{exact:true}).isVisible()){await p.getByLabel('打开导航',{exact:true}).click();await p.getByRole('dialog',{name:'导航'}).getByRole('button',{name,exact:true}).click()}else await p.getByRole('button',{name,exact:true}).click()}
async function titles(p,expected){await p.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.smart-results .task-result strong')].map(x=>x.textContent).sort())===JSON.stringify(expected.sort()),expected)}
async function close(p){await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.locator('.task-panel').waitFor({state:'hidden'})}
async function persist(p,id,predicate){for(let n=0;n<100;n++){const b=await snapshot(p,id);if(predicate(b))return b;await p.waitForTimeout(50)}throw Error('persistence timeout')}
try{
 if(process.env.LOCAL_S3_MODULE){
  const {default:S3rver}=await import(process.env.LOCAL_S3_MODULE);const objectDir=out+'/objects';fs.mkdirSync(objectDir);
  s3=new S3rver({address:'127.0.0.1',port:48772,silent:true,directory:objectDir,allowMismatchedSignatures:false,configureBuckets:[{name:'synthetic-frontend',configs:[Buffer.from('<CORSConfiguration><CORSRule><AllowedOrigin>'+base+'</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader></CORSRule></CORSConfiguration>')]}]});await s3.run();Object.assign(env,{S3_ENDPOINT:'http://127.0.0.1:48772',S3_REGION:'us-east-1',S3_BUCKET:'synthetic-frontend',S3_ACCESS_KEY_ID:'S3RVER',S3_SECRET_ACCESS_KEY:'S3RVER',ATTACHMENT_MAX_BYTES:'4096',ATTACHMENT_BOARD_QUOTA_BYTES:'4096'});
 }
 server=spawn(binary,[],{env,cwd:out,stdio:['ignore',log,log]});fs.closeSync(log);fs.writeFileSync(out+'/artifacts.json',JSON.stringify({binary,sha256:hash(binary),processExe:fs.readlinkSync('/proc/'+server.pid+'/exe'),processSha256:hash('/proc/'+server.pid+'/exe'),dist:frozen},null,2));for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addInitScript(()=>{window.workspaceFrames=[];new MutationObserver(()=>{if(document.querySelector('.three-pane-shell')&&!window.workspaceFrames.length)window.workspaceFrames.push({theme:document.documentElement.dataset.theme,scheme:document.documentElement.style.colorScheme,meta:document.querySelector('meta[name="theme-color"]')?.content})}).observe(document,{subtree:true,childList:true})});const p=await ctx.newPage();await login(p);

 stage='seed and today groups';
 const D=new Date(Date.now()+8*3600000).toISOString().slice(0,10),day=n=>new Date(Date.parse(D+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const ib=(await rpc(p,'/inbox')).body;let b=(await rpc(p,'/boards',{title:'产品计划'})).body;b=await action(p,b.id,{action:'list_create',title:'待办'});const bid=b.id,lid=b.lists[0].id;
 const long='整理本周工作记录，补齐跨团队协作中尚未确认的负责人、截止日期与交接事项，周一晨会前发给同事核对';
 const defs=[['逾期任务',-2,-1],['今天任务',0,0],['跨日任务',-1,2],['明天任务',1,1],['第七天',6,6],['第八天',7,7],[long,0,0]];
 for(const [title,start,end] of defs){b=await action(p,bid,{action:'card_create',list_id:lid,title});const c=b.cards.find(c=>c.title===title);b=await action(p,bid,{action:'card_schedule',card_id:c.id,schedule:{start_date:day(start),end_date:day(end),timezone:'Asia/Shanghai'}})}
 await p.reload();await titles(p,['逾期任务','今天任务','跨日任务',long]);
 assert.equal(await p.locator('[data-group="overdue"] .smart-row').count(),1);
 assert.equal(await p.locator(`[data-group="${D}"] .smart-row`).count(),3);
 assert.equal(await p.locator('.smart-completed').count(),0);
 await p.getByRole('button',{name:'展开已完成',exact:true}).click();await p.getByRole('button',{name:'收起已完成',exact:true}).click();
 checks.push('today overdue/active separation and collapsed completed');
 stage='next7 unique projection';await nav(p,'最近七天');await titles(p,['今天任务','跨日任务','明天任务','第七天',long]);
 const keys=await p.locator('.smart-results [data-group]').evaluateAll(es=>es.map(e=>e.dataset.group));assert.deepEqual(keys,[D,day(1),day(6)]);
 const ids=await p.locator('.smart-results .smart-row').evaluateAll(es=>es.map(e=>e.dataset.taskId));assert.equal(new Set(ids).size,ids.length);assert.match(await p.locator('.smart-summary').textContent(),/5 个未完成任务/);
 checks.push('next7 uses actual dates; spanning task once; day8 excluded; count equals real complete result');
 stage='actual recurrence and assigned filtering';
 b=await action(p,bid,{action:'card_create',list_id:lid,title:'尚未完成的重复任务'});const repeating=b.cards.find(c=>c.title==='尚未完成的重复任务');
 await action(p,bid,{action:'card_schedule',card_id:repeating.id,schedule:{start_date:D,timezone:'Asia/Shanghai',repeat:{unit:'day',interval:1,mode:'calendar',weekdays:[]}}});
 await action(p,bid,{action:'card_details',card_id:repeating.id,assignee_id:1,due_date:D});
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await titles(p,['今天任务','跨日任务','明天任务','第七天',long,'尚未完成的重复任务']);
 assert.equal(await p.locator(`[data-task-id="${repeating.id}"]`).count(),1);b=await snapshot(p,bid);const series=b.cards.find(c=>c.id===repeating.id).series_id;assert.equal(b.cards.filter(c=>c.series_id===series).length,1);
 await nav(p,'指派给我');await titles(p,['尚未完成的重复任务']);assert.equal(await p.locator('.smart-results [data-group]').count(),0);
 await action(p,bid,{action:'card_details',card_id:repeating.id,assignee_id:null,due_date:D});await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await titles(p,[]);
 await action(p,bid,{action:'card_update',card_id:repeating.id,title:repeating.title,description:'',archived:true});
 checks.push('one real recurrence row, no hypothetical future occurrences; explicitly assigned view includes only actual assignee, flat rows');

 stage='quick entry default and failure preservation';await nav(p,'指派给我');await titles(p,[]);
 assert.ok(await p.getByLabel('添加到收集箱',{exact:true}).getAttribute('placeholder').then(x=>x.includes('私人收集箱')));
 await p.getByLabel('添加到收集箱',{exact:true}).fill('失败后保留');
 await p.route('**/api/boards/*/mutate',r=>r.abort('failed'));await p.getByRole('button',{name:'添加',exact:true}).click();await p.waitForTimeout(250);
 assert.equal(await p.getByLabel('添加到收集箱',{exact:true}).inputValue(),'失败后保留');await p.unrouteAll({behavior:'wait'});
 // Unknown mutation is deliberately not replayed; recovery now survives reload.
 // Explicitly discard this synthetic failed create before starting an independent capture.
 await p.reload();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();
 await p.getByRole('button',{name:'丢弃草稿',exact:true}).click();
 await p.getByLabel('添加到收集箱',{exact:true}).fill('私人捕获');await p.getByRole('button',{name:'添加',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[aria-label="添加到收集箱"]').value==='');
 let privateCard=(await snapshot(p,ib.id)).cards.find(c=>c.title==='私人捕获');assert.equal(privateCard.schedule,null);assert.equal(privateCard.due_date,null);assert.equal(privateCard.assignee_id,null);
 await nav(p,'指派给我');await titles(p,[]);await nav(p,'收集箱');await titles(p,['私人捕获']);assert.equal(await p.locator('.smart-results [data-group]').count(),0);
 stage='edit autosave and navigation barrier';await p.locator('.smart-row .task-result').click();await p.getByLabel('卡片标题',{exact:true}).fill('私人捕获已编辑');await p.getByLabel('卡片标题',{exact:true}).blur();await close(p);await titles(p,['私人捕获已编辑']);assert.equal((await snapshot(p,ib.id)).cards[0].title,'私人捕获已编辑');
 await p.getByLabel('添加到收集箱',{exact:true}).fill('保留输入');await p.getByLabel('添加到收集箱',{exact:true}).dispatchEvent('compositionstart');await p.getByLabel('添加到收集箱',{exact:true}).press('Enter');assert.equal((await snapshot(p,ib.id)).cards.length,1);await nav(p,'明天');assert.equal(await p.getByRole('heading',{name:'收集箱',exact:true}).count(),1);await p.getByLabel('添加到收集箱',{exact:true}).dispatchEvent('compositionend');p.once('dialog',d=>d.dismiss());await nav(p,'明天');assert.equal(await p.getByLabel('添加到收集箱',{exact:true}).inputValue(),'保留输入');await p.getByLabel('添加到收集箱',{exact:true}).fill('');
 stage='completion and undo';await p.getByLabel('完成 私人捕获已编辑',{exact:true}).check();const toast=p.getByRole('region',{name:'最近完成的任务'});await toast.getByText('私人捕获已编辑',{exact:true}).waitFor();await titles(p,[]);assert.equal(await p.locator('.task-panel').count(),0);await p.getByRole('button',{name:'展开已完成',exact:true}).click();await p.locator('.smart-completed .task-result').waitFor();await toast.getByRole('button',{name:'撤销',exact:true}).click();await titles(p,['私人捕获已编辑']);assert.equal((await snapshot(p,ib.id)).cards[0].completed,false);
 checks.push('private default undated/unassigned; failed entry retained; IME/rejected navigation retained; edited through real autosave; complete bottom and undo readback');
 const ratios=[];function lum(h){return h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0)}const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
 stage='screenshots and layout';
 // A second real private record makes card separation and long-title wrapping visible in Inbox.
 await action(p,ib.id,{action:'card_create',list_id:ib.lists[0].id,title:long});
 const interactions=[];

 for(const width of [1440,375,320]){await p.setViewportSize({width,height:1000});for(const mode of ['light','dark']){
  if(width<=800)await p.getByLabel('打开导航',{exact:true}).click();await p.getByRole('button',{name:'外观',exact:true}).click();await p.getByRole('dialog',{name:'外观设置'}).getByRole('button',{name:mode==='light'?'浅色':'深色',exact:true}).click();await p.keyboard.press('Escape');if(width<=800)await p.getByLabel('关闭导航',{exact:true}).click();
  for(const label of ['今天','最近七天','收集箱']){await nav(p,label);await p.waitForTimeout(200);await p.screenshot({path:out+'/'+label+'-'+mode+'-'+width+'.png',fullPage:true});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await p.mouse.move(0,0);await p.locator('.smart-results .task-result').first().blur();await p.waitForTimeout(180);
   const cards=await p.locator('.smart-results .smart-row').evaluateAll(es=>es.map(e=>{const c=getComputedStyle(e),b=e.getBoundingClientRect(),t=e.querySelector('strong'),s=getComputedStyle(t),r=e.querySelector('.task-result').getBoundingClientRect();return {border:c.borderTopWidth,borderStyle:c.borderTopStyle,borderColor:c.borderTopColor,bg:c.backgroundColor,radius:c.borderRadius,gap:c.marginBottom,shadow:c.boxShadow,width:b.width,height:b.height,titleHeight:t.getBoundingClientRect().height,titleScroll:t.scrollHeight,titleClient:t.clientHeight,clamp:s.webkitLineClamp,overflow:s.overflow,buttonHeight:r.height}}));for(const c of cards){assert.equal(c.border,'0px');assert.equal(c.bg,'rgba(0, 0, 0, 0)');assert.equal(c.radius,'6px');assert.ok(parseFloat(c.gap)>=4);assert.equal(c.shadow,'none');assert.equal(c.clamp,'none');assert.ok(c.titleScroll<=c.titleClient+1);assert.ok(c.buttonHeight>=44)}
   const first=p.locator('.smart-results .smart-row').first(),detail=first.locator('.task-result');
   await p.mouse.move(0,0);await detail.blur();await p.waitForTimeout(180);const idle=await first.evaluate(e=>getComputedStyle(e).backgroundColor);
   await first.hover();await p.waitForTimeout(180);const hover=await first.evaluate(e=>getComputedStyle(e).backgroundColor);assert.notEqual(hover,idle);
   await p.mouse.move(0,0);await detail.focus();await p.waitForTimeout(180);assert.equal(await first.evaluate(e=>getComputedStyle(e).backgroundColor),hover);await detail.blur();
   await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await first.evaluate(e=>getComputedStyle(e).transitionDuration),'0s');await p.emulateMedia({reducedMotion:'no-preference'});
   interactions.push({width,mode,label,idle,hover});
  const geometry=await p.locator('.smart-results .smart-row').evaluateAll(es=>es.map(e=>{const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};const t=e.querySelector('strong'),c=e.querySelector('.smart-check input'),d=e.querySelector('.card-schedule');const range=document.createRange();range.selectNodeContents(t);return {row:rect(e),title:rect(t),lines:[...range.getClientRects()].map(r=>({x:r.x,y:r.y,width:r.width,height:r.height})),check:rect(c),date:d?rect(d):null,source:rect(e.querySelector('.task-source'))}}));for(const g of geometry){assert.ok(Math.abs(g.check.y+g.check.height/2-(g.title.y+12))<5,JSON.stringify(g));assert.ok(Math.abs(g.source.x-g.title.x)<1);for(const line of g.lines)assert.ok(Math.abs(line.x-g.title.x)<1);if(g.date){if(width>800){assert.ok(g.date.x>=g.title.right);assert.ok(Math.abs(g.date.y-g.title.y)<3)}else assert.ok(g.date.y>=g.title.bottom)}}fs.writeFileSync(out+'/geometry-'+label+'-'+mode+'-'+width+'.json',JSON.stringify(geometry,null,2));
   const edges=await p.evaluate(()=>[document.querySelector('.selection-toolbar'),document.querySelector('.smart-heading h1'),document.querySelector('.capture-entry'),document.querySelector('.task-date-group h2')].filter(Boolean).map(e=>e.getBoundingClientRect().x));assert.ok(edges.every(x=>Math.abs(x-edges[0])<1),JSON.stringify(edges));fs.writeFileSync(out+'/column-'+label+'-'+mode+'-'+width+'.json',JSON.stringify({edges},null,2));
   const box=await p.locator('.smart-tasks').boundingBox();assert.ok(box.width<=800);const check=await p.locator('.smart-check').first().boundingBox();assert.ok(check.width>=44&&check.height>=44);
   if(width<800){assert.ok(await p.locator('.task-result strong').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)===16));assert.ok(await p.locator('.task-source').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=13));const date=p.locator('.smart-results .card-schedule').first();if(await date.count()){const db=await date.boundingBox(),tb=await date.locator('..').locator('strong').boundingBox();assert.ok(db.y>=tb.y+tb.height)}}
  }

  const colors=await p.evaluate(()=>{const c=getComputedStyle(document.documentElement);return Object.fromEntries(['--text','--secondary','--canvas','--surface','--surface-muted','--overdue'].map(k=>[k,c.getPropertyValue(k).trim()]))});for(const fg of ['--text','--secondary','--overdue'])for(const bg of ['--canvas','--surface','--surface-muted']){const r=ratio(colors[fg],colors[bg]);ratios.push({mode,fg,bg,ratio:r});assert.ok(r>=4.5,JSON.stringify({mode,fg,bg,r}))}
 }}

 stage='mobile selection completion undo and detail save';await p.setViewportSize({width:375,height:812});await nav(p,'收集箱');
 const short=p.locator('.smart-results .smart-row').filter({has:p.getByText('私人捕获已编辑',{exact:true})});
 await p.getByRole('button',{name:'选择任务',exact:true}).click();const select=short.getByLabel('选择 私人捕获已编辑',{exact:true});await select.check();
 assert.equal((await snapshot(p,ib.id)).cards.find(c=>c.id===privateCard.id).completed,false);
 await p.waitForTimeout(180);const selection=await short.evaluate(e=>({background:getComputedStyle(e).backgroundColor,selection:getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim(),width:e.getBoundingClientRect().width,check:e.querySelector('.smart-check').getBoundingClientRect().width}));assert.notEqual(selection.background,'rgba(0, 0, 0, 0)');assert.ok(selection.check>=44);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:out+'/mobile-selection-375.png',fullPage:true});
 for(const width of [1440,375]){await p.setViewportSize({width,height:1000});const boxes=await p.evaluate(()=>['.selection-toolbar','.smart-tasks'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,width:r.width}}));assert.ok(Math.abs(boxes[0].x-boxes[1].x)<1&&Math.abs(boxes[0].width-boxes[1].width)<1,JSON.stringify(boxes));fs.writeFileSync(out+'/selection-column-'+width+'.json',JSON.stringify(boxes,null,2));await p.screenshot({path:out+'/selection-'+width+'.png',fullPage:true})}

 await p.getByRole('button',{name:'退出选择',exact:true}).click();await short.getByLabel('完成 私人捕获已编辑',{exact:true}).check();const mobileToast=p.getByRole('region',{name:'最近完成的任务'});await mobileToast.getByText('私人捕获已编辑',{exact:true}).waitFor();assert.equal((await snapshot(p,ib.id)).cards.find(c=>c.id===privateCard.id).completed,true);assert.equal(await p.locator('.task-panel').count(),0);await mobileToast.getByRole('button',{name:'撤销',exact:true}).click();await short.waitFor();assert.equal((await snapshot(p,ib.id)).cards.find(c=>c.id===privateCard.id).completed,false);
 await short.locator('.task-result').click();await p.getByLabel('卡片标题',{exact:true}).fill('私人捕获手机已编辑');await p.getByLabel('卡片标题',{exact:true}).blur();await close(p);await persist(p,ib.id,b=>b.cards.find(c=>c.id===privateCard.id).title==='私人捕获手机已编辑');checks.push('375px real selection is separate from completion; completion/undo persisted; detail title autosave persisted');
 fs.writeFileSync(out+'/card-interactions.json',JSON.stringify(interactions,null,2));fs.writeFileSync(out+'/contrast.json',JSON.stringify(ratios,null,2));checks.push('1440/375/320 light/dark today/next7/inbox screenshots; no overflow; 44px checks; mobile 16px title/13px metadata; dates below; token contrast >=4.5');
 assert.deepEqual(manifest(),frozen);assert.deepEqual(errors,[]);fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors,consoleErrors,date:D},null,2));console.log('PASS '+out);
}catch(e){fs.writeFileSync(out+'/failure.txt',stage+'\n'+e.stack);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:out+'/failure.png'}).catch(()=>{});console.error('FAIL '+out,stage,e);process.exitCode=1}finally{await browser?.close();await s3?.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
