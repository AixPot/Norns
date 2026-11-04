for(const name of ['PLAYWRIGHT_MODULE','CHROMIUM_PATH','EVIDENCE_ROOT','NORNS_BINARY'])if(!process.env[name])throw Error('Set '+name);
import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),out=process.env.EVIDENCE_ROOT+'/inbox-detail-'+Date.now();fs.mkdirSync(out,{mode:0o700});
const binary=process.env.NORNS_BINARY,base='http://127.0.0.1:48881',password=crypto.randomBytes(24).toString('base64url'),env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+out+'/synthetic.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48881',STATIC_DIR:root+'/frontend/dist'};
let server,browser,page,stage='boot';const checks=[],errors=[],prompts=[];
const hash=path=>crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const distHashes=()=>Object.fromEntries(fs.readdirSync(root+'/frontend/dist',{recursive:true}).filter(f=>fs.statSync(root+'/frontend/dist/'+f).isFile()).sort().map(f=>[f,hash(root+'/frontend/dist/'+f)]));const frozenDist=distHashes();
const sql=(query,params=[])=>{const r=spawnSync('python3',['-c',"import sqlite3,json,sys;d=json.load(sys.stdin);c=sqlite3.connect(d['db']);r=c.execute(d['query'],d['params']);rows=r.fetchall();c.commit();print(json.dumps(rows))"],{input:JSON.stringify({db:out+'/synthetic.sqlite',query,params}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)};
async function rpc(p,path,body){return p.evaluate(async({path,body})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}},{path,body})}
async function nav(p,name){if(await p.getByLabel('打开导航',{exact:true}).isVisible()){await p.getByLabel('打开导航',{exact:true}).click();await p.getByRole('dialog',{name:'导航'}).getByRole('button',{name,exact:true}).click()}else await p.locator('.function-rail,.three-pane-nav').getByRole('button',{name,exact:true}).click()}
async function option(p,name,value){const select=p.getByLabel(name,{exact:true});if(!await select.isVisible())await p.getByRole('button',{name:'显示设置',exact:true}).click();await select.selectOption(value)}
const ids=(p,selector)=>p.locator(selector).evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.taskId||n.dataset.cardId)));
async function waitIds(p,selector,expected){await p.waitForFunction(({selector,expected})=>JSON.stringify([...document.querySelectorAll(selector)].map(n=>Number(n.dataset.taskId||n.dataset.cardId)))===JSON.stringify(expected),{selector,expected})}
try{
 await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(48881,'127.0.0.1',()=>s.close(resolve))});
 assert.equal(spawnSync(binary,['init-admin','admin'],{env,input:password,cwd:out}).status,0);const log=fs.openSync(out+'/server.log','a');server=spawn(binary,[],{env,cwd:out,stdio:['ignore',log,log]});fs.closeSync(log);fs.writeFileSync(out+'/artifacts.json',JSON.stringify({binary,sha256:hash(binary),processExe:fs.readlinkSync('/proc/'+server.pid+'/exe'),processSha256:hash('/proc/'+server.pid+'/exe'),dist:frozenDist,database:env.DATABASE_URL,staticDirectory:env.STATIC_DIR,origin:base},null,2));
 for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),p=await ctx.newPage();page=p;p.on('pageerror',e=>errors.push(e.stack));p.on('dialog',d=>{if(d.type()==='beforeunload')return d.accept();prompts.push(d.message());return d.message().includes('退出将清除此账号')?d.accept():d.dismiss()});
 async function login(name='admin',pass=password){await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill(name);await p.getByLabel('密码',{exact:true}).fill(pass);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor()}
 await login();const inbox=(await rpc(p,'/inbox')).body;
 sql('INSERT INTO cards(id,list_id,title,description,position) VALUES(?,?,?,?,?)',[501,inbox.lists[0].id,'整理项目资料','背景说明\n'+('真实长描述用于滚动验收。\n'.repeat(65)),0]);
 sql('INSERT INTO cards(id,list_id,title,description,position) VALUES(?,?,?,?,?)',[502,inbox.lists[0].id,'准备下周计划','第二个任务',1]);
 await nav(p,'收集箱');await p.locator('[data-task-id="501"] .task-result').click();
 stage='default stays floating and inbox display offers opt-in split';
 assert.equal(await p.locator('.task-panel-split').count(),0);
 await p.getByRole('button',{name:'显示设置',exact:true}).click();
 await p.getByLabel('详情展示方式',{exact:true}).selectOption('split');
 await p.locator('.task-panel-split').waitFor();checks.push(stage);

 stage='current split task marker follows real detail, independently of bulk selection';
 const current=()=>p.locator('.smart-row .task-result[aria-current="true"]');
 const currentIds=()=>current().evaluateAll(nodes=>nodes.map(n=>Number(n.closest('[data-task-id]').dataset.taskId)));
 await p.waitForFunction(()=>document.querySelector('[data-task-id="501"] .task-result')?.getAttribute('aria-current')==='true');
 await p.getByRole('button',{name:'显示设置',exact:true}).click();
 await p.getByRole('button',{name:'批量选择',exact:true}).click();
 await p.getByLabel('选择 准备下周计划',{exact:true}).check();
 assert.deepEqual(await currentIds(),[501]);
 await p.locator('[data-task-id="502"] .task-result').click();await p.waitForFunction(()=>document.querySelector('.content-title')?.value==='准备下周计划');
 assert.deepEqual(await currentIds(),[502]);assert.equal(await p.getByLabel('选择 准备下周计划',{exact:true}).isChecked(),true);
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();assert.deepEqual(await currentIds(),[]);
 assert.equal(await p.getByLabel('选择 准备下周计划',{exact:true}).isChecked(),true);
 await p.getByRole('button',{name:'退出选择',exact:true}).click();
 await p.locator('[data-task-id="501"] .task-result').click();
 for(const width of [1179,1180,390,1440]){await p.setViewportSize({width,height:1000});await p.waitForFunction(expected=>document.querySelectorAll('.smart-row .task-result[aria-current="true"]').length===expected,width>=1180?1:0)}
 await option(p,'详情展示方式','drawer');assert.deepEqual(await currentIds(),[]);
 await option(p,'详情展示方式','split');assert.deepEqual(await currentIds(),[501]);
 // Navigation clears the actual open draft, not only its presentation.
 await p.getByRole('button',{name:'显示设置',exact:true}).click();
 await nav(p,'今天');assert.deepEqual(await currentIds(),[]);assert.equal(await p.locator('.task-panel').count(),0);
 await nav(p,'收集箱');await p.locator('[data-task-id="501"] .task-result').click();
 const markerStyles=[];
 for(const theme of ['light','dark']){
  await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await p.locator('h1').click();await p.mouse.move(0,0);await p.waitForTimeout(200);
  const row=p.locator('[data-task-id="501"]');
  const style=()=>row.evaluate(el=>{const c=getComputedStyle(el);return {background:c.backgroundColor,radius:c.borderRadius,border:c.borderWidth,shadow:c.boxShadow}});
  const idle=await style();assert.notEqual(idle.background,'rgba(0, 0, 0, 0)');assert.notEqual(idle.radius,'0px');assert.equal(idle.border,'0px');assert.equal(idle.shadow,'none');
  await row.hover();await p.waitForTimeout(200);const hover=await style();assert.notEqual(hover.background,idle.background);
  await p.mouse.move(0,0);await p.keyboard.press('Tab');await row.locator('.task-result').focus();await p.waitForTimeout(200);
  const focus=await row.locator('.task-result').evaluate(el=>{const c=getComputedStyle(el);return {visible:el.matches(':focus-visible'),outline:c.outlineWidth}});assert.equal(focus.visible,true);assert.notEqual(focus.outline,'0px');
  markerStyles.push({theme,idle,hover,focus});
 }
 await p.locator('h1').click();await p.mouse.move(0,0);fs.writeFileSync(out+'/marker-styles.json',JSON.stringify(markerStyles,null,2));
 // Restore the original runner's open settings state.
 await p.getByRole('button',{name:'显示设置',exact:true}).click();checks.push(stage);

 // Exercise the real global status component, not a fabricated banner.
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('norns-connection',{detail:false})));
 await p.locator('.pwa-status').waitFor();await p.waitForTimeout(100);
 const panel=await p.locator('.task-panel').elementHandle(),title=p.getByLabel('卡片标题',{exact:true}),titleNode=await title.elementHandle();
 const geometry=async()=>p.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {panel:box('.task-panel'),list:box('.smart-tasks'),body:box('.task-panel-body'),workspace:box('.content-layout'),inContent:!!document.querySelector('.content-layout')?.contains(document.querySelector('.task-panel')),notice:document.querySelector('.pwa-status')?.getBoundingClientRect().bottom||0,position:getComputedStyle(document.querySelector('.task-panel')).position,overflow:document.documentElement.scrollWidth>innerWidth}});
 assert.equal(await p.locator('.content-layout .task-panel').count(),1,'detail must be inside content layout');let g=await geometry();assert.equal(g.inContent,true,'detail must belong to content layout');assert.equal(g.position,'relative','split must participate in layout');assert.ok(g.panel.top>=g.workspace.top);assert.ok(g.panel.top>=g.notice);assert.ok(g.list.right<=g.panel.left);assert.ok(g.panel.width>=380);assert.equal(g.overflow,false);assert.equal(await p.locator('.task-panel').getAttribute('role'),'region');assert.equal(await p.locator('.app-shell').evaluate(el=>el.inert),false);
 await p.getByRole('button',{name:'显示设置',exact:true}).click();await p.locator('h1').click();assert.equal(await panel.evaluate(el=>el.isConnected),true);
 await p.screenshot({path:out+'/split-1440.png',fullPage:true});
 for(const theme of ['dark','light']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.waitForTimeout(350);await p.screenshot({path:out+'/split-'+theme+'-1440.png',fullPage:true})}
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('norns-connection',{detail:true})));
 stage='same editor and unsent comment survive layout switches without writes';
 await p.clock.install();let writes=0;p.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/boards/'))writes++});
 await p.getByLabel('发表评论',{exact:true}).click();const comment=p.getByRole('textbox',{name:'发表评论',exact:true});await comment.fill('这段评论尚未发送');
 await title.fill('布局切换中的新标题');await title.dispatchEvent('compositionstart');
 for(const mode of ['drawer','split']){await option(p,'详情展示方式',mode);assert.equal(await titleNode.evaluate(el=>el===document.querySelector('.content-title')),true);assert.equal(await title.inputValue(),'布局切换中的新标题');assert.equal(await comment.inputValue(),'这段评论尚未发送')}
 assert.equal(writes,0);assert.equal(sql('SELECT title FROM cards WHERE id=501')[0][0],'整理项目资料');checks.push(stage);
 stage='responsive split falls back to modal sheet and restores same editor';
 for(const width of [1179,1180,390,1440]){
  await p.setViewportSize({width,height:width===390?780:1000});await p.waitForFunction(w=>document.querySelector('.task-panel').getAttribute('role')===(w>=1180?'region':'dialog'),width);
  assert.equal(await titleNode.evaluate(el=>el===document.querySelector('.content-title')),true);assert.equal(await comment.inputValue(),'这段评论尚未发送');
  assert.equal(await p.locator('.workspace').evaluate(el=>el.inert),width<1180);g=await geometry();assert.equal(g.overflow,false);assert.ok(g.panel.left>=0&&g.panel.right<=width);assert.ok(g.panel.bottom<= (width===390?780:1000));
  if(width===390){assert.equal(await p.locator('.task-panel').evaluate(el=>!!el.closest('[inert]')),false);await p.screenshot({path:out+"/sheet-ime-375.png",fullPage:true})}
 }
 assert.equal(writes,0);await title.dispatchEvent("compositionend");
 // Keyboard navigation is a separate contract: the IME guard intentionally ignores Tab.
 await p.setViewportSize({width:390,height:780});
 await p.waitForFunction(()=>document.querySelector(".task-panel").getAttribute("aria-modal")==="true");
 {await p.getByRole('button',{name:'移入普通看板',exact:true}).focus();await p.keyboard.press('Tab');assert.equal(await p.locator('.task-panel').evaluate(el=>el.contains(document.activeElement)),true);await p.screenshot({path:out+'/sheet-375.png',fullPage:true})}
 await p.setViewportSize({width:1440,height:1000});
 await p.waitForFunction(()=>document.querySelector(".task-panel").getAttribute("role")==="region");
 await p.clock.resume();checks.push(stage);
 stage='switch task waits for real committed autosave and respects current auxiliary draft';
 let release,arrived;const held=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);let gated=false;
 await p.route('**/api/boards/*/mutate',async route=>{if(!gated&&route.request().method()==='POST'){gated=true;const response=await route.fetch();arrived();await gate;await route.fulfill({response})}else await route.continue()});
 // Start a fresh edit after the independent keyboard probe, whose blur may save.
 await title.fill("布局切换后的保存标题");
 // Hold the real committed mutation response before UI acknowledgement.
 await p.locator('[data-task-id="502"] .task-result').click();await Promise.race([held,new Promise((_,reject)=>setTimeout(()=>reject(Error('save response not gated')),8000))]);
 assert.equal(sql('SELECT title FROM cards WHERE id=501')[0][0],'布局切换后的保存标题');assert.equal(await title.inputValue(),'布局切换后的保存标题');
 await comment.fill('等待保存时补充的评论');release();await p.waitForFunction(()=>document.querySelector('.task-save')?.textContent==='有未发送输入');await p.waitForTimeout(150);
 assert.equal(await title.inputValue(),'布局切换后的保存标题');assert.equal(await comment.inputValue(),'等待保存时补充的评论');assert.ok(prompts.length>0);assert.equal(sql('SELECT count(*) FROM comments')[0][0],0);
 await p.unroute('**/api/boards/*/mutate');await comment.fill('');await p.locator('[data-task-id="502"] .task-result').click();await p.waitForFunction(()=>document.querySelector('.content-title')?.value==='准备下周计划');checks.push(stage);
 stage='reload persists inbox mode and long content scrolls';
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.reload();await nav(p,'收集箱');await p.getByRole('button',{name:'显示设置',exact:true}).click();assert.equal(await p.getByLabel('详情展示方式',{exact:true}).inputValue(),'split');await p.getByRole('button',{name:'显示设置',exact:true}).click();
 await p.locator('[data-task-id="501"] .task-result').click();await p.locator('.task-panel-split').waitFor();
 const scroller=p.locator('.task-panel-body');await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);assert.ok(await scroller.evaluate(el=>el.scrollTop>0));assert.equal(await scroller.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<2),true);assert.equal(await p.getByLabel('描述',{exact:true}).evaluate(el=>{const r=el.getBoundingClientRect(),b=el.closest('.task-panel-body').getBoundingClientRect();return r.bottom<=b.bottom&&r.bottom>b.top}),true);await p.screenshot({path:out+'/split-long-scrolled.png',fullPage:true});
 checks.push(stage);stage='split editor survives sibling template modal and responsive ownership';
 const splitTitle=await title.elementHandle();await p.getByLabel('发表评论',{exact:true}).click();await comment.fill('分栏的未发送评论');
 await p.locator('.global-actions').getByLabel('更多操作',{exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('button',{name:'私人模板库',exact:true}).focus();await p.keyboard.press('Enter');
 await p.getByLabel('关闭模板库',{exact:true}).waitFor();assert.equal(await p.locator('.task-panel').evaluate(el=>el.inert),true);
 await p.setViewportSize({width:390,height:780});assert.equal(await p.locator('.app-shell').evaluate(el=>el.inert),true);await p.keyboard.press('Escape');
 assert.equal(await comment.inputValue(),'分栏的未发送评论');assert.equal(await splitTitle.evaluate(el=>el===document.querySelector('.content-title')),true);
 await p.setViewportSize({width:1440,height:1000});await p.locator('.task-panel-split').waitFor();assert.equal(await p.locator('.app-shell').evaluate(el=>el.inert),false);await comment.fill('');checks.push(stage);stage='ordinary view retains floating detail';
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await nav(p,'今天');assert.equal(await p.getByLabel('详情展示方式',{exact:true}).count(),0);assert.deepEqual(await currentIds(),[]);
 const br=(await rpc(p,'/boards',{title:'普通看板'})).body;sql('INSERT INTO lists(board_id,title,position) VALUES(?,?,?)',[br.id,'普通列表',0]);const lid=sql('SELECT id FROM lists WHERE board_id=?',[br.id])[0][0];sql('INSERT INTO cards(id,list_id,title,position) VALUES(?,?,?,?)',[601,lid,'普通看板任务',0]);await p.reload();await nav(p,'普通看板');await p.locator('[data-card-id="601"] .card-content').click();assert.equal(await p.locator('.task-panel').getAttribute('role'),'dialog');assert.equal(await p.locator('.task-panel-split').count(),0);checks.push(stage);
 stage='native select arrow gutter and keyboard retain semantics with long labels';
 await p.getByLabel('移动卡片',{exact:true}).click();const sel=p.getByLabel('插入位置',{exact:true});const selectGeometry=await sel.evaluate(el=>{const c=getComputedStyle(el);el.options[el.selectedIndex].text='一个很长的列表位置标签，应当在箭头之前裁切而不挤占箭头区域'.repeat(5);return {paddingRight:parseFloat(c.paddingRight),backgroundPosition:c.backgroundPosition,backgroundSize:c.backgroundSize,tag:el.tagName,appearance:c.appearance,width:el.getBoundingClientRect().width,parent:el.parentElement.getBoundingClientRect().width}});assert.equal(selectGeometry.tag,'SELECT');assert.ok(selectGeometry.paddingRight>=40);assert.ok(selectGeometry.width<=selectGeometry.parent);await sel.evaluate(el=>el.add(new Option('键盘验收位置','keyboard-probe')));await sel.focus();await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');assert.equal(await sel.inputValue(),'keyboard-probe');await sel.selectOption({index:0});await p.keyboard.press('Escape');await p.screenshot({path:out+'/native-select-long-1440.png',fullPage:true});fs.writeFileSync(out+'/geometry.json',JSON.stringify({g,selectGeometry},null,2));checks.push(stage);
 stage='representative real-component presentation and theme geometry';
 await p.screenshot({path:out+'/board-light-1440.png'});
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await nav(p,'收集箱');
 sql('UPDATE cards SET title=?,description=? WHERE id=501',['整理项目资料，确认首页输入区与任务详情的交互边界',`背景与目标
把本周讨论中的页面反馈整理成可执行清单，先核对现有实现，再标出需要继续确认的部分。

需要保留的交互
输入任务时可以先记录标题，日期识别仅在确认后采用。切换展示方式不应丢失正在编辑的文字和未发送评论。

移动端验收
检查长标题换行、键盘焦点和返回按钮。详情正文独立滚动，最后一段仍应出现在操作栏上方。

下一步
收齐桌面和手机截图后，与林然核对本轮变更。未确认的问题保留原始上下文，不把假设写成已经完成的结论。`]);
 await p.reload();await nav(p,'收集箱');
 const completionTarget=p.locator('[data-task-id="502"]');await completionTarget.getByRole('checkbox').click();await p.waitForFunction(()=>[...document.querySelectorAll('.completion-toast button')].some(el=>el.textContent.includes('撤销')));assert.equal(sql('SELECT completed FROM cards WHERE id=502')[0][0],1);await p.locator('.completion-toast').getByRole('button',{name:'撤销',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[data-task-id="502"] input')?.checked===false);assert.equal(sql('SELECT completed FROM cards WHERE id=502')[0][0],0);
 const contrasts=[];
 await p.locator('.function-rail').getByRole('button',{name:'外观',exact:true}).click();const appearance=p.getByRole('dialog',{name:'外观设置',exact:true});
 for(const palette of ['雾蓝','鸢尾','陶橙','石墨']){await appearance.getByRole('button',{name:palette,exact:true}).click();for(const mode of ['浅色','深色']){await appearance.getByRole('button',{name:mode,exact:true}).click();await p.waitForTimeout(200);const measured=await p.evaluate(()=>{const c=getComputedStyle(document.documentElement);const rgb=s=>{const x=document.createElement('span');x.style.color=s;document.body.append(x);const v=getComputedStyle(x).color.match(/[\d.]+/g).slice(0,3).map(Number);x.remove();return v};const lum=s=>rgb(s).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);const ratio=(a,b)=>{const x=lum(c.getPropertyValue(a)),y=lum(c.getPropertyValue(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};return {palette:document.documentElement.dataset.palette,mode:document.documentElement.dataset.theme,text:ratio('--text','--surface'),secondary:ratio('--secondary','--surface')}});assert.ok(measured.text>=4.5);assert.ok(measured.secondary>=4.5);contrasts.push(measured)}}
 await appearance.getByRole('button',{name:'雾蓝',exact:true}).click();await appearance.getByRole('button',{name:'浅色',exact:true}).click();await p.keyboard.press('Escape');fs.writeFileSync(out+'/contrasts.json',JSON.stringify(contrasts,null,2));
 for(const theme of ['light','dark']){await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await p.waitForTimeout(350);await p.screenshot({path:out+'/inbox-'+theme+'-1440.png'});await p.locator('[data-task-id="501"] .task-result').click();await p.waitForTimeout(350);await p.screenshot({path:out+'/quiet-'+theme+'-1440.png'});await p.setViewportSize({width:390,height:780});await p.waitForTimeout(350);assert.equal(await p.locator('.task-panel').evaluate(el=>!!el.closest('[inert]')),false);await p.screenshot({path:out+'/quiet-'+theme+'-390.png'});await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.waitForTimeout(200);await p.screenshot({path:out+'/inbox-'+theme+'-390.png'});await p.setViewportSize({width:1440,height:1000})}
 await p.evaluate(()=>document.documentElement.dataset.theme='light');checks.push(stage);
 stage='account isolation and private inbox authorization';
 await p.locator('[data-task-id="501"] .task-result').click();assert.deepEqual(await currentIds(),[501]);const other=crypto.randomBytes(24).toString('base64url');assert.equal((await rpc(p,'/admin/users',{username:'other',password:other})).status,201);await p.getByLabel('退出',{exact:true}).click();await login('other',other);await nav(p,'收集箱');await p.getByRole('button',{name:'显示设置',exact:true}).click();assert.equal(await p.getByLabel('详情展示方式',{exact:true}).inputValue(),'drawer');assert.equal((await rpc(p,'/boards/'+inbox.id)).status,404);assert.equal(await p.locator('[data-task-id="501"]').count(),0);assert.deepEqual(await currentIds(),[]);checks.push(stage);
 assert.deepEqual(errors,[]);assert.deepEqual(distHashes(),frozenDist);fs.writeFileSync(out+'/result.json',JSON.stringify({status:'passed',checks,errors,binary},null,2));console.log(JSON.stringify({out,checks}));
}catch(e){if(page){await page.screenshot({path:out+'/failure.png',fullPage:true});fs.writeFileSync(out+'/dom.txt',await page.locator('body').innerText());fs.writeFileSync(out+'/tasks.json',JSON.stringify(await rpc(page,'/tasks?view=today&status=incomplete')))}fs.writeFileSync(out+'/failure.json',JSON.stringify({stage,error:e.stack,checks,errors},null,2));console.error({out,stage,error:e.stack});process.exitCode=1}finally{await browser?.close();if(server){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r))}}