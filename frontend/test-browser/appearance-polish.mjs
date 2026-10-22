for(const name of ['PLAYWRIGHT_MODULE','CHROMIUM_PATH','EVIDENCE_ROOT'])if(!process.env[name])throw Error('Set '+name);
import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE),root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),out=process.env.EVIDENCE_ROOT+'/colors-'+Date.now();fs.mkdirSync(out,{mode:0o700});
const base='http://127.0.0.1:48774',password=crypto.randomBytes(24).toString('base64url'),env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+out+'/synthetic.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48774',STATIC_DIR:root+'/frontend/dist'};
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(48774,'127.0.0.1',()=>s.close(resolve))});
assert.equal(spawnSync(root+'/target/release/norns',['init-admin','admin'],{env,input:password,cwd:out}).status,0);
let stage='boot';let server,browser,s3;const checks=[],errors=[],consoleErrors=[];const log=fs.openSync(out+'/server.log','a');
async function rpc(p,path,body,method=body?'POST':'GET'){return p.evaluate(async({path,body,method})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?null:await r.json()}},{path,body,method})}
const snapshot=async(p,id)=>(await rpc(p,'/boards/'+id)).body;
async function action(p,id,data){const b=await snapshot(p,id),r=await rpc(p,`/boards/${id}/mutate`,{expected_revision:b.revision,...data});assert.equal(r.status,200,JSON.stringify(r));return r.body}
async function login(p,name='admin',pass=password){if(!p.__themeDiagnostics){p.__themeDiagnostics=true;p.on('pageerror',e=>{errors.push({stage,stack:e.stack});fs.writeFileSync(out+'/pageerrors.json',JSON.stringify(errors,null,2))});p.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),url:m.location().url})});}await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill(name);await p.getByLabel('密码',{exact:true}).fill(pass);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor()}
async function nav(p,name){if(await p.getByLabel('打开导航',{exact:true}).isVisible()){await p.getByLabel('打开导航',{exact:true}).click();await p.getByRole('dialog',{name:'导航'}).getByRole('button',{name,exact:true}).click()}else await p.locator('.function-rail,.three-pane-nav').getByRole('button',{name,exact:true}).click()}
async function titles(p,expected){await p.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('.smart-results .task-result strong')].map(x=>x.textContent).sort())===JSON.stringify(expected.sort()),expected)}
async function close(p){await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.locator('.task-panel').waitFor({state:'hidden'})}
async function persist(p,id,predicate){for(let n=0;n<100;n++){const b=await snapshot(p,id);if(predicate(b))return b;await p.waitForTimeout(50)}throw Error('persistence timeout')}
try{
 if(process.env.LOCAL_S3_MODULE){
  const {default:S3rver}=await import(process.env.LOCAL_S3_MODULE);const objectDir=out+'/objects';fs.mkdirSync(objectDir);
  s3=new S3rver({address:'127.0.0.1',port:48772,silent:true,directory:objectDir,allowMismatchedSignatures:false,configureBuckets:[{name:'synthetic-frontend',configs:[Buffer.from('<CORSConfiguration><CORSRule><AllowedOrigin>'+base+'</AllowedOrigin><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader></CORSRule></CORSConfiguration>')]}]});await s3.run();Object.assign(env,{S3_ENDPOINT:'http://127.0.0.1:48772',S3_REGION:'us-east-1',S3_BUCKET:'synthetic-frontend',S3_ACCESS_KEY_ID:'S3RVER',S3_SECRET_ACCESS_KEY:'S3RVER',ATTACHMENT_MAX_BYTES:'4096',ATTACHMENT_BOARD_QUOTA_BYTES:'4096'});
 }
 server=spawn(root+'/target/release/norns',[],{env,cwd:out,stdio:['ignore',log,log]});fs.closeSync(log);for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.addInitScript(()=>{window.workspaceFrames=[];new MutationObserver(()=>{if(document.querySelector('.three-pane-shell')&&!window.workspaceFrames.length){window.firstWorkspaceMotion=getComputedStyle(document.querySelector('.three-pane-shell')).transitionDuration;window.workspaceFrames.push({theme:document.documentElement.dataset.theme,scheme:document.documentElement.style.colorScheme,meta:document.querySelector('meta[name="theme-color"]')?.content})}}).observe(document,{subtree:true,childList:true})});const p=await ctx.newPage();await login(p);

 stage='seed realistic tasks';
 const D=new Date(Date.now()+8*3600000).toISOString().slice(0,10),day=n=>new Date(Date.parse(D+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const ib=(await rpc(p,'/inbox')).body;let b=(await rpc(p,'/boards',{title:'产品计划'})).body;b=await action(p,b.id,{action:'list_create',title:'待办'});const bid=b.id,lid=b.lists[0].id;
 const long='核对季度计划与跨团队依赖，保留长标题的自然换行，不挤压日期和任务来源。';
 for(const [title,offset] of [['核对本周交付计划',0],[long,0],['确认上周未完成的采购',-2]]){b=await action(p,bid,{action:'card_create',list_id:lid,title});b=await action(p,bid,{action:'card_schedule',card_id:b.cards.find(c=>c.title===title).id,schedule:{start_date:day(offset),timezone:'Asia/Shanghai'}})}
 await p.reload();await titles(p,['核对本周交付计划',long,'确认上周未完成的采购']);
 const colorNames={blue:'雾蓝',iris:'鸢尾',clay:'陶橙',graphite:'石墨'},modeNames={light:'浅色',dark:'深色',system:'系统'};
 const picker=()=>p.locator('.appearance-popover:popover-open');
 async function showPicker(){if(!await picker().count())await p.getByRole('button',{name:'外观',exact:true}).filter({visible:true}).click();await picker().waitFor()}
 const paletteSelect=()=>({selectOption:async value=>{await showPicker();await picker().getByRole('button',{name:colorNames[value],exact:true}).click()},inputValue:()=>p.evaluate(()=>document.documentElement.dataset.palette)});
 const modeSelect=()=>({selectOption:async value=>{await showPicker();await picker().getByRole('button',{name:modeNames[value],exact:true}).click()},inputValue:()=>p.evaluate(()=>localStorage.getItem(document.querySelector('.login-card')?'norns.theme.anonymous':'norns.theme.user.1')||'system')});
 async function select(palette,mode,width=1440){
  if(await picker().count())await p.keyboard.press('Escape');
  await p.setViewportSize({width,height:1000});
  if(width<=800)await p.getByLabel('打开导航',{exact:true}).click();
  await paletteSelect().selectOption(palette);await modeSelect().selectOption(mode);
  await p.waitForFunction(({palette,mode})=>document.documentElement.dataset.palette===palette&&document.documentElement.dataset.theme===mode,{palette,mode});
  await p.keyboard.press('Escape');if(width<=800)await p.getByLabel('关闭导航',{exact:true}).click();await p.waitForTimeout(220);
 }
 stage='responsive popover and branding';
 assert.equal(await p.locator('.three-pane-nav .norns-logo').count(),0);assert.equal(await p.locator('.function-rail .norns-logo').count(),1);
 for(const width of [1440,375,320])for(const mode of ['light','dark']){
  await select('iris',mode,width);await p.setViewportSize({width,height:width===1440?1000:812});await p.screenshot({path:out+`/after-${width}-${mode}-workspace.png`,fullPage:true});
  if(width<800){assert.equal(await p.locator('.mobile-brand .norns-logo').count(),1);await p.getByLabel('打开导航',{exact:true}).click()}
  await showPicker();await p.waitForTimeout(220);
  const bounds=await picker().boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=(width===1440?1000:812));if(width<800){const drawerBox=await p.getByRole('dialog',{name:'导航',exact:true}).boundingBox();assert.ok(bounds.x+bounds.width<=drawerBox.x+drawerBox.width)}
  for(const btn of await picker().getByRole('button').all()){const r=await btn.boundingBox();assert.ok(r.height>=44&&r.width>=44)}
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await picker().getByRole('button',{name:'鸢尾',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await picker().getByRole('button',{name:mode==='light'?'浅色':'深色',exact:true}).getAttribute('aria-pressed'),'true');
  await p.screenshot({path:out+`/after-${width}-${mode}-popover.png`,fullPage:true});
  await p.keyboard.press('Escape');await p.screenshot({path:out+`/after-${width}-${mode}.png`,fullPage:true});
  if(width<800)await p.getByLabel('关闭导航',{exact:true}).click();
 }
 await p.setViewportSize({width:1440,height:1000});
 await showPicker();await p.getByRole('heading',{name:'今天',exact:true}).click();await picker().waitFor({state:'hidden'});
 checks.push('desktop single logo; mobile header logo retained; 1440/375/320 light/dark screenshots; bounded native popover; >=44px options; explicit selected state; outside click; keyboard and layered Escape');
 const tokens=['--text','--secondary','--canvas','--surface','--surface-muted','--surface-raised','--accent','--accent-hover','--on-accent','--accent-soft','--accent-text','--focus','--danger','--warning','--warning-surface','--success','--success-surface','--completed','--overdue','--selection','--selection-text'];
 function lum(h){return h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0)}
 const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05),contrasts=[],matrix=[];
 stage='eight palette/mode combinations';
 for(const palette of ['blue','iris','clay','graphite'])for(const mode of ['light','dark']){
  await select(palette,mode);
  const c=await p.evaluate(tokens=>{const c=getComputedStyle(document.documentElement);return Object.fromEntries(tokens.map(k=>[k,c.getPropertyValue(k).trim()]))},tokens);
  for(const fg of ['--text','--secondary','--overdue','--danger'])for(const bg of ['--canvas','--surface','--surface-muted','--surface-raised','--completed']){const r=ratio(c[fg],c[bg]);contrasts.push({palette,mode,fg,bg,ratio:r});assert.ok(r>=4.5,JSON.stringify({palette,mode,fg,bg,r}))}
  for(const [fg,bg] of [['--on-accent','--accent'],['--on-accent','--accent-hover'],['--accent-text','--accent-soft'],['--warning','--warning-surface'],['--text','--warning-surface'],['--danger','--warning-surface'],['--success','--success-surface'],['--selection-text','--selection']]){const r=ratio(c[fg],c[bg]);contrasts.push({palette,mode,fg,bg,ratio:r});assert.ok(r>=4.5,JSON.stringify({palette,mode,fg,bg,r}))}
  for(const bg of ['--canvas','--surface','--surface-muted'])assert.ok(ratio(c['--focus'],c[bg])>=3);
  assert.equal(await p.evaluate(()=>document.querySelector('meta[name="theme-color"]').content),c['--canvas']);assert.ok((await p.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href')).endsWith(`favicon-${palette}-${mode}.svg`));
  await nav(p,'今天');await titles(p,['核对本周交付计划',long,'确认上周未完成的采购']);
  await p.waitForFunction(()=>document.querySelector('.smart-summary')?.textContent==='3 个未完成任务');await p.mouse.move(0,0);if(mode==='light')await p.screenshot({path:out+'/'+palette+'-desktop-light.png',fullPage:true});
  await nav(p,'产品计划');await p.locator('.board-scroll').waitFor();assert.equal(await p.locator('.card').count(),3);
  await nav(p,'日历');await p.locator('.calendar-task').first().waitFor();
  await nav(p,'搜索');await p.locator('.task-filters').waitFor();
  await nav(p,'今天');await p.locator('.smart-row .task-result').filter({hasText:'核对本周交付计划'}).click();await p.getByLabel('卡片标题',{exact:true}).waitFor();const actual=await p.locator('.completion-button').evaluate(e=>({fg:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}));const rgbhex=s=>'#'+s.match(/\d+/g).slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join('');assert.ok(ratio(rgbhex(actual.fg),rgbhex(actual.bg))>=4.5);await close(p);
  if(mode==='dark'){
   await select(palette,mode,375);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:out+'/'+palette+'-mobile-dark.png',fullPage:true});
   await p.getByLabel('打开导航',{exact:true}).click();const d=p.getByRole('dialog',{name:'导航'});await p.screenshot({path:out+'/'+palette+'-mobile-picker.png'});await showPicker();const box=await picker().getByRole('button',{name:'雾蓝',exact:true}).boundingBox();assert.ok(box.width>=44&&box.height>=44);await p.screenshot({path:out+'/'+palette+'-mobile-popover.png'});await p.keyboard.press('Tab');assert.equal(await picker().evaluate(e=>e.contains(document.activeElement)),true);await p.keyboard.press('Escape');assert.equal(await d.isVisible(),true);assert.equal(await d.getByRole('button',{name:'外观',exact:true}).evaluate(e=>e===document.activeElement),true);await p.keyboard.press('Escape');await d.waitFor({state:'hidden'});
   await p.locator('.smart-row .task-result').filter({hasText:long}).click();await p.getByLabel('卡片标题',{exact:true}).waitFor();assert.equal(await p.locator('.app-shell').evaluate(e=>e.inert),true);await p.screenshot({path:out+'/'+palette+'-mobile-detail.png'});await close(p);await p.setViewportSize({width:1440,height:1000});
  }
  matrix.push({palette,mode,tokens:c,views:['today','board','calendar','search','detail'],mobile:mode==='dark'});
 }
 checks.push('4 palettes × light/dark: core surfaces, states, selection >=4.5 text contrast; focus >=3; board/calendar/search/detail render; dark mobile drawer and long-title details');
 stage='keyboard selection';await select('blue','light');await p.getByRole('button',{name:'外观',exact:true}).filter({visible:true}).focus();await p.keyboard.press('Enter');await picker().getByRole('button',{name:'鸢尾',exact:true}).focus();await p.keyboard.press('Space');await p.waitForFunction(()=>document.documentElement.dataset.palette==='iris');assert.equal(await modeSelect().inputValue(),'light');await p.keyboard.press('Escape');
 stage='dirty draft identity, selection and autosave';
 await p.locator('.smart-row .task-result').filter({hasText:'核对本周交付计划'}).click();const input=p.getByLabel('卡片标题',{exact:true}),handle=await input.elementHandle();await input.fill('核对本周交付计划（主题切换后自动保存）');await input.evaluate(e=>{e.setSelectionRange(2,7);e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))});
 const before=await input.evaluate(e=>({start:e.selectionStart,end:e.selectionEnd}));
 await paletteSelect().selectOption('clay');await modeSelect().selectOption('dark');assert.equal(await input.evaluate((e,old)=>e===old,handle),true);assert.equal(await input.inputValue(),'核对本周交付计划（主题切换后自动保存）');assert.deepEqual(await input.evaluate(e=>({start:e.selectionStart,end:e.selectionEnd})),before);
 assert.equal(await picker().count(),1);await picker().getByRole('button',{name:'深色',exact:true}).dispatchEvent('keydown',{key:'Escape',isComposing:true});assert.equal(await picker().count(),1);await input.dispatchEvent('compositionend');await input.blur();await persist(p,bid,b=>b.cards.some(c=>c.title==='核对本周交付计划（主题切换后自动保存）'));await p.keyboard.press('Escape');await close(p);await titles(p,['核对本周交付计划（主题切换后自动保存）',long,'确认上周未完成的采购']);
 await p.getByLabel('完成 核对本周交付计划（主题切换后自动保存）',{exact:true}).check();const toast=p.getByRole('region',{name:'最近完成的任务'});await toast.waitFor();await paletteSelect().selectOption('graphite');await p.keyboard.press('Escape');await toast.getByRole('button',{name:'撤销',exact:true}).click();await persist(p,bid,b=>b.cards.find(c=>c.title==='核对本周交付计划（主题切换后自动保存）')?.completed===false);
 checks.push('keyboard popover; palette/mode changes preserve dirty IME draft DOM, selected range and actual autosave; completion toast survives switch and undo verified by API');
 stage='reload and live system';await select('iris','dark');await p.reload();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.firstWorkspaceMotion),'0s');assert.equal(await paletteSelect().inputValue(),'iris');assert.equal(await modeSelect().inputValue(),'dark');assert.deepEqual(await p.evaluate(()=>window.workspaceFrames),[{theme:'dark',scheme:'dark',meta:'#191b20'}]);await modeSelect().selectOption('system');for(const scheme of ['dark','light','dark']){await p.emulateMedia({colorScheme:scheme});await p.waitForFunction(s=>document.documentElement.dataset.theme===s,scheme);assert.equal(await paletteSelect().inputValue(),'iris')}
 await modeSelect().selectOption('light');await p.emulateMedia({colorScheme:'dark'});assert.equal(await p.evaluate(()=>document.documentElement.dataset.theme),'light');
 stage='account isolation';const second='theme-member',memberPass=crypto.randomBytes(24).toString('base64url');const ur=await rpc(p,'/admin/users',{username:second,password:memberPass});assert.ok([200,201].includes(ur.status),JSON.stringify(ur));
 await p.getByRole('button',{name:'退出',exact:true}).click();await p.getByLabel('用户名',{exact:true}).waitFor();assert.equal(await paletteSelect().inputValue(),'blue');await paletteSelect().selectOption('clay');await modeSelect().selectOption('dark');await p.reload();await p.getByLabel('用户名',{exact:true}).waitFor();assert.equal(await paletteSelect().inputValue(),'clay');await p.screenshot({path:out+'/login-clay-dark.png'});
 await login(p,second,memberPass);assert.equal(await paletteSelect().inputValue(),'blue');assert.equal(await p.evaluate(()=>localStorage.getItem('norns.theme.user.2')||'system'),'system');await paletteSelect().selectOption('graphite');await modeSelect().selectOption('dark');await p.getByRole('button',{name:'退出',exact:true}).click();await p.getByLabel('用户名',{exact:true}).waitFor();assert.equal(await paletteSelect().inputValue(),'clay');await login(p);assert.equal(await paletteSelect().inputValue(),'iris');assert.equal(await modeSelect().inputValue(),'light');
 checks.push('account theme before first workspace; refresh palette/mode; system live changes keep palette; explicit ignores system; anonymous and second account isolated across real logout/login');
 stage='storage denied';const denied=await browser.newContext({colorScheme:'dark'});await denied.addInitScript(()=>{Storage.prototype.getItem=()=>{throw Error('storage denied')};Storage.prototype.setItem=()=>{throw Error('storage denied')}});const dp=await denied.newPage();await login(dp);assert.equal(await dp.evaluate(()=>document.documentElement.dataset.palette),'blue');await dp.getByRole('button',{name:'外观',exact:true}).filter({visible:true}).click();await dp.locator('.appearance-popover:popover-open').getByRole('button',{name:'陶橙',exact:true}).click();await dp.locator('.appearance-popover:popover-open').getByRole('button',{name:'浅色',exact:true}).click();assert.equal(await dp.evaluate(()=>document.documentElement.dataset.palette),'clay');await denied.close();checks.push('denied localStorage keeps picker usable with safe defaults');
 stage='motion and favicon';await p.keyboard.press('Escape');await select('iris','dark');
 assert.ok((await p.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href')).endsWith('favicon-iris-dark.svg'));
 const motion=await p.locator('.workspace').evaluate(e=>({duration:getComputedStyle(e).transitionDuration,property:getComputedStyle(e).transitionProperty}));assert.equal(motion.duration,'0.18s');assert.ok(!motion.property.includes('all'));assert.ok(!motion.property.includes('width'));
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.workspace').evaluate(e=>getComputedStyle(e).transitionDuration),'0s');await p.emulateMedia({reducedMotion:'no-preference'});
 checks.push('first workspace 0s transition and correct restored dark tokens; 180ms color-only transitions, reduced motion 0s; favicon updated in all 8 states; no app remount');
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors.filter(m=>!((m.url.endsWith('/api/me')&&m.text.includes('401'))||(m.url.endsWith('/favicon.ico')&&m.text.includes('404')))),[]);
 fs.writeFileSync(out+'/contrast.json',JSON.stringify(contrasts,null,2));fs.writeFileSync(out+'/matrix.json',JSON.stringify(matrix,null,2));fs.writeFileSync(out+'/result.json',JSON.stringify({passed:true,checks,pageErrors:errors,consoleErrors,Q1:{status:'OPEN',release_blocking:true,reproduced:false},date:D},null,2));console.log('PASS '+out);
}catch(e){fs.writeFileSync(out+'/failure.txt',stage+'\n'+e.stack);if(browser)for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({path:out+'/failure.png'}).catch(()=>{});console.error('FAIL '+out,stage,e);process.exitCode=1}finally{await browser?.close();await s3?.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}}
