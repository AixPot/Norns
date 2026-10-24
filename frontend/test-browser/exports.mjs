import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const {default:S3rver}=await import(process.env.LOCAL_S3_MODULE);
const root=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/,''),out=process.env.EVIDENCE_ROOT+'/browser-'+Date.now();fs.mkdirSync(out,{mode:0o700});
const binary=process.env.NORNS_BINARY,base='http://127.0.0.1:48871',password=crypto.randomBytes(24).toString('base64url');
const env={PATH:process.env.PATH,DATABASE_URL:'sqlite://'+out+'/synthetic.sqlite',APP_ORIGIN:base,COOKIE_SECURE:'false',BIND_ADDR:'127.0.0.1:48871',STATIC_DIR:root+'/frontend/dist',S3_ENDPOINT:'http://127.0.0.1:48872',S3_REGION:'us-east-1',S3_BUCKET:'export-ui',S3_ACCESS_KEY_ID:'S3RVER',S3_SECRET_ACCESS_KEY:'S3RVER',ATTACHMENT_MAX_BYTES:'4096',ATTACHMENT_BOARD_QUOTA_BYTES:'65536',TMPDIR:out};
let server,browser,s3;let stage='startup';const checks=[],errors=[];
async function rpc(p,path,body,method=body?'POST':'GET'){return p.evaluate(async({path,body,method})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?null:await r.json()}},{path,body,method})}
async function action(p,id,data){const b=(await rpc(p,'/boards/'+id)).body;const r=await rpc(p,`/boards/${id}/mutate`,{expected_revision:b.revision,...data});assert.equal(r.status,200,JSON.stringify(r));return r.body}
async function open(p,authExpected=false){if(await p.getByLabel('打开导航',{exact:true}).isVisible())await p.getByLabel('打开导航',{exact:true}).click();await p.locator('.global-actions').getByRole('button',{name:'更多操作',exact:true}).filter({visible:true}).click();await p.getByRole('button',{name:'导出数据',exact:true}).click();if(!authExpected)await p.getByRole('dialog',{name:'导出所选数据',exact:true}).waitFor()}
try{
 for(const port of [48871,48872])await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve))});
 fs.mkdirSync(out+'/objects');s3=new S3rver({address:'127.0.0.1',port:48872,silent:true,directory:out+'/objects',allowMismatchedSignatures:false,configureBuckets:[{name:'export-ui'}]});await s3.run();
 assert.equal(spawnSync(binary,['init-admin','admin'],{env,input:password,cwd:out}).status,0);
 const log=fs.openSync(out+'/server.log','a');server=spawn(binary,[],{env,cwd:out,stdio:['ignore',log,log]});fs.closeSync(log);
 for(let n=0;n<100;n++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,50))}
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill('admin');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();
 stage='global entry and explicit inbox default';await open(p);assert.equal(await p.getByRole('checkbox',{name:'收集箱（仅自己）',exact:true}).isChecked(),true);checks.push(stage);

 const otherPassword=crypto.randomBytes(24).toString('base64url');assert.equal((await rpc(p,'/admin/users',{username:'other',password:otherPassword})).status,201);
 const ib=(await rpc(p,'/inbox')).body;
 const sharedResponse=await rpc(p,'/boards',{title:'协作清单'});assert.equal(sharedResponse.status,201);const shared=sharedResponse.body;
 function sql(query,params=[]){const code="import sqlite3,json,sys;d=json.load(sys.stdin);c=sqlite3.connect(d['db']);r=c.execute(d['query'],d['params']);rows=r.fetchall();c.commit();print(json.dumps(rows))";const r=spawnSync('python3',['-c',code],{input:JSON.stringify({db:out+'/synthetic.sqlite',query,params}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)}
 sql("INSERT INTO lists(board_id,title,position) VALUES(?,'协作列表',0)",[shared.id]);const sl=sql('SELECT id FROM lists WHERE board_id=?',[shared.id])[0][0];
 const fixtures=[{id:10,list:ib.lists[0].id,title:'=SUM(1,2) 中文 "引用"\n第二行',completed:false,archived:false},{id:11,list:ib.lists[0].id,title:'  @完成任务',completed:true,archived:false},{id:12,list:ib.lists[0].id,title:'归档原件',completed:false,archived:true},{id:13,list:ib.lists[0].id,title:'归档且完成',completed:true,archived:true},{id:20,list:sl,title:'协作任务',completed:false,archived:false}];
 for(const f of fixtures)sql('INSERT INTO cards(id,list_id,title,description,position,completed,archived) VALUES(?,?,?,?,?,?,?)',[f.id,f.list,f.title,'多行描述\nUnicode 内容',f.id,Number(f.completed),Number(f.archived)]);
 const originals={};
 for(const f of fixtures){const bid=f.id===20?shared.id:ib.id,bytes=Buffer.from('original '+f.id+' 附件\n\u0000'),path=`/boards/${bid}/cards/${f.id}/attachments`;const up=await rpc(p,path,{filename:'同名.txt',size:bytes.length});assert.equal(up.status,200,JSON.stringify(up));const result=await fetch(up.body.put_url,{method:'PUT',body:bytes});assert.equal(result.status,200);assert.equal((await rpc(p,path+'/'+up.body.id+'/complete',{})).status,200);originals[up.body.id]={card:f.id,hex:bytes.toString('hex')};}
 for(const state of ['pending','deleted'])sql('INSERT INTO attachments VALUES(?,10,?,5,?,?,?,?,9999999999,100)',['excluded-'+state,'排除记录.txt','text/plain',state,'stage-'+state,'final-'+state]);
 await p.getByRole('button',{name:'关闭导出',exact:true}).click();await p.reload();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();await open(p);
 const previewRequests=[];p.on('request',r=>{if(r.url().endsWith('/api/exports/preview'))previewRequests.push(r.postDataJSON())});
 async function prepare(){await p.getByRole('button',{name:'获取最新导出预览',exact:true}).click();await p.getByRole('region',{name:'导出预览'}).waitFor()}
 // A section with accessible name is a region. Download through the rendered button, not fetch.
 async function artifact(fmt,comp,arch,mixed=false){await p.getByRole('checkbox',{name:'包含已完成任务',exact:true}).setChecked(comp);await p.getByRole('checkbox',{name:'包含已归档任务',exact:true}).setChecked(arch);await p.getByLabel('导出格式',{exact:true}).selectOption(fmt);await prepare();const expected=fixtures.filter(f=>(mixed||f.id!==20)&&(!f.completed||comp)&&(!f.archived||arch));const summary=await p.getByRole('region',{name:'导出预览'}).innerText();assert.ok(summary.includes(expected.length+' 个任务'));const wait=p.waitForEvent('download');await p.getByRole('button',{name:'确认下载 '+fmt.toUpperCase(),exact:true}).click();const file=await wait;assert.match(file.suggestedFilename(),new RegExp('^norns-export-\\d{8}T\\d{6}Z\\.'+fmt+'$'));const saved=out+`/${fmt}-${Number(comp)}-${Number(arch)}-${mixed?'mixed':'own'}.`+fmt;await file.saveAs(saved);const r=spawnSync('python3',['-c',verify],{encoding:'utf8',input:JSON.stringify({saved,fmt,expected,originals})});assert.equal(r.status,0,r.stderr);fs.writeFileSync(saved+'.verified.json',r.stdout);return file}
 const verify=`import json,sys,zipfile,csv,io,hashlib
v=json.load(sys.stdin);b=open(v['saved'],'rb').read();expected=v['expected'];ids=[f['id'] for f in expected]
def rows(raw):
 assert raw.startswith(b'\\xef\\xbb\\xbf');data=list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))));assert [int(r['task_id']) for r in data]==ids
 for f,r in zip(expected,data):
  title=f['title'];safe="'"+title if title.lstrip()[:1] in ['=','+','-','@'] else title;assert r['title']==safe,(r['title'],safe);assert r['description']=='多行描述\\nUnicode 内容'
if v['fmt']=='csv':rows(b)
elif v['fmt']=='json':
 d=json.loads(b);assert [f['id'] for f in d['tasks']]==ids;assert [f['title'] for f in d['tasks']]==[f['title'] for f in expected]
else:
 z=zipfile.ZipFile(io.BytesIO(b));d=json.loads(z.read('data.json'));m=json.loads(z.read('manifest.json'));assert [f['id'] for f in d['tasks']]==ids;rows(z.read('tasks.csv'));found=[]
 for e in m['entries']:
  raw=z.read(e['path']);assert len(raw)==e['size'];assert hashlib.sha256(raw).hexdigest()==e['sha256']
  if 'attachment_id' in e:
   a=v['originals'][e['attachment_id']];assert a['card'] in ids;assert raw==bytes.fromhex(a['hex']);found.append(e['attachment_id'])
 assert sorted(found)==sorted(k for k,a in v['originals'].items() if a['card'] in ids)
 assert sorted(e['state'] for e in m['excluded_attachments'])==['deleted','pending'];assert m['ready_original_count']==len(found)
 for raw in [z.read('data.json'),z.read('manifest.json')]:
  for forbidden in [b'final_key',b'X-Amz-',b'S3RVER',b'48872']:assert forbidden not in raw
print(json.dumps({'format':v['fmt'],'task_ids':ids,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}))`;
 stage='rendered CSV BOM Unicode multiline formulas, JSON exact IDs and original ZIP hashes';
 await artifact('csv',false,false);await artifact('json',true,false);await artifact('zip',false,true);await artifact('zip',true,true);checks.push(stage);
 stage='mixed explicit own inbox and shared board selection';await p.getByRole('checkbox',{name:'协作清单',exact:true}).check();assert.equal(await p.getByRole('region',{name:'导出预览'}).count(),0);await artifact('json',true,true,true);await artifact('zip',true,true,true);checks.push(stage);
 stage='preview contract explicit independent flags and no inherited filters';for(const r of previewRequests){assert.equal(Object.hasOwn(r,'expected_snapshot'),false);assert.equal(typeof r.include_completed,'boolean');assert.equal(typeof r.include_archived,'boolean')}assert.deepEqual(previewRequests.slice(0,4).map(r=>[r.include_completed,r.include_archived]),[[false,false],[true,false],[false,true],[true,true]]);checks.push(stage);
 stage='stale snapshot requires fresh preview and separate explicit download';await prepare();sql("UPDATE cards SET description='stale snapshot' WHERE id=10");let downloads=0;const count=()=>downloads++;p.on('download',count);await p.getByRole('button',{name:'确认下载 ZIP',exact:true}).click();await p.getByRole('status').filter({hasText:'请重新获取预览'}).waitFor();assert.equal(downloads,0);assert.equal(await p.getByRole('button',{name:'确认下载 ZIP',exact:true}).count(),0);await prepare();assert.equal(downloads,0);sql("UPDATE cards SET description=? WHERE id=10",['多行描述\nUnicode 内容']);p.off('download',count);checks.push(stage);
 stage='format and scope changes abort stale preview';let release,held;const paused=new Promise(r=>held=r);await p.route('**/api/exports/preview',async r=>{const response=await r.fetch();held();await new Promise(res=>release=res);await r.fulfill({response}).catch(()=>{})},{times:1});await p.getByRole('button',{name:'获取最新导出预览',exact:true}).click();await paused;await p.getByLabel('导出格式',{exact:true}).selectOption('csv');release();await p.waitForTimeout(150);assert.equal(await p.getByRole('region',{name:'导出预览'}).count(),0);checks.push(stage);
 stage='cancel held binary response never downloads';await p.getByLabel('导出格式',{exact:true}).selectOption('zip');await prepare();let releaseDownload,heldDownload;const pausedDownload=new Promise(r=>heldDownload=r);await p.route('**/api/exports/download',async r=>{const response=await r.fetch();heldDownload();await new Promise(res=>releaseDownload=res);await r.fulfill({response}).catch(()=>{})},{times:1});p.on('download',count);await p.getByRole('button',{name:'确认下载 ZIP',exact:true}).click();await pausedDownload;await p.getByRole('button',{name:'取消当前导出',exact:true}).click();releaseDownload();await p.waitForTimeout(200);assert.equal(downloads,0);p.off('download',count);checks.push(stage);
 stage='375 and 1440 responsive dialog, keyboard focus and no horizontal overflow';for(const width of [375,1440]){await p.setViewportSize({width,height:width===375?700:1000});await p.getByRole('checkbox',{name:'协作清单',exact:true}).uncheck();await prepare();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const bounds=await p.getByRole('dialog',{name:'导出所选数据',exact:true}).boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.equal(await p.evaluate(()=>document.querySelector('[role=dialog]').scrollWidth<=document.querySelector('[role=dialog]').clientWidth),true);if(width===375){const confirm=await p.getByRole('button',{name:'确认下载 ZIP',exact:true}).boundingBox();assert.ok(confirm.y>=0&&confirm.y+confirm.height<=700,'mobile preview download must be initially visible')}await p.getByRole('button',{name:'关闭',exact:true}).focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'关闭导出');await p.screenshot({path:out+'/export-'+width+'.png',fullPage:true});if(width===375){await p.getByRole('button',{name:'确认下载 ZIP',exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:out+'/export-375-preview.png',fullPage:true})}}checks.push(stage);
 stage='export owns interaction above an unsent card draft and returns its editor';
 await p.getByRole('button',{name:'关闭导出',exact:true}).click();
 await p.locator('.smart-navigation').getByRole('button',{name:'收集箱',exact:true}).click();
 await p.locator('.smart-results .task-result').filter({hasText:fixtures[0].title}).click();
 await p.getByLabel('发表评论',{exact:true}).click();
 const unsent=p.getByRole('textbox',{name:'发表评论',exact:true}),raw='未发送 · export modal\n exact draft';
 await unsent.fill(raw);await unsent.evaluate(el=>el.setSelectionRange(2,7));
 const originalPanel=await p.locator('.task-panel').elementHandle();
 const prompts=[];const reject=d=>{if(d.type()==='beforeunload'){void d.accept();return}prompts.push(d.message());void d.dismiss()};p.on('dialog',reject);
 let modalWrites=0;const writes=r=>{if(r.method()==='POST'&&r.url().endsWith('/mutate'))modalWrites++};p.on('request',writes);
 await p.locator('.global-actions').getByRole('button',{name:'更多操作',exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('button',{name:'导出数据',exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('dialog',{name:'导出所选数据',exact:true}).waitFor();
 for(const width of [1440,375,1440]){
  await p.setViewportSize({width,height:width===375?700:1000});
  await p.getByRole('checkbox',{name:'包含已完成任务',exact:true}).uncheck();
  await p.getByRole('checkbox',{name:'包含已归档任务',exact:true}).check();
  await p.getByLabel('导出格式',{exact:true}).selectOption('json');await prepare();
  assert.equal(await p.locator('.task-panel').evaluate(el=>el.inert),true,'underlying editor must be inert');
  assert.equal(await p.locator('.app-shell').evaluate(el=>el.inert),true,'resize/scroll cannot release export background');
 }
 await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'导出所选数据',exact:true}).waitFor({state:'hidden'});
 assert.equal(await originalPanel.evaluate(el=>el.isConnected),true,'same mounted editor owns the draft');
 assert.equal(await unsent.inputValue(),raw);assert.deepEqual(prompts,[],'export must not attempt draft discard');assert.equal(modalWrites,0);
 assert.equal(await unsent.evaluate(el=>document.activeElement===el),true,'focus returns to card editor');
 assert.deepEqual(await unsent.evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,7]);
 assert.equal(await p.locator('.app-shell').evaluate(el=>el.inert),false);
 // Explicit recovery remains held across export: no save or auxiliary submission.
 await p.waitForTimeout(350);await p.reload();await p.locator('.quick-inbox input').waitFor();
 await p.locator('.smart-navigation').getByRole('button',{name:'收集箱',exact:true}).click();
 await p.locator('.smart-results .task-result').filter({hasText:fixtures[0].title}).click();
 await p.locator('.task-panel').getByRole('button',{name:'恢复草稿',exact:true}).click();
 if(await p.getByRole('button',{name:'已核对，恢复到编辑器',exact:true}).count())await p.getByRole('button',{name:'已核对，恢复到编辑器',exact:true}).click();
 await p.getByText('恢复仅填入编辑器，尚未写入服务器',{exact:true}).waitFor();
 assert.equal(await unsent.inputValue(),raw);await unsent.focus();
 const heldPanel=await p.locator('.task-panel').elementHandle();
 await p.locator('.global-actions').getByRole('button',{name:'更多操作',exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('button',{name:'导出数据',exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('dialog',{name:'导出所选数据',exact:true}).waitFor();await p.setViewportSize({width:375,height:700});await p.getByRole('button',{name:'关闭导出',exact:true}).click();
 assert.equal(await unsent.inputValue(),raw);assert.equal(await p.locator('.app-shell').evaluate(el=>el.inert),true,'mobile sheet still owns shell');
 assert.equal(await p.locator('.task-panel').evaluate(el=>el.inert),false);
 assert.equal(await heldPanel.evaluate(el=>el.isConnected),true);await p.getByText('恢复仅填入编辑器，尚未写入服务器',{exact:true}).waitFor();assert.deepEqual(prompts,[]);assert.equal(modalWrites,0);
 await p.setViewportSize({width:1440,height:1000});await unsent.fill('');await p.getByRole('button',{name:'丢弃恢复的修改',exact:true}).click();p.off('dialog',reject);p.off('request',writes);
 await p.getByRole('button',{name:'关闭卡片',exact:true}).click();await p.locator('.task-panel').waitFor({state:'hidden'});checks.push(stage);
 await open(p);
 stage='scope default current board and aggregate entries';await p.getByRole('button',{name:'关闭导出',exact:true}).click();assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('aria-label')),'更多操作','closing export restores entry focus');await p.locator('.board-navigation').getByRole('button',{name:'协作清单',exact:true}).click();await p.getByRole('heading',{name:'协作清单',exact:true}).waitFor();await open(p);assert.equal(await p.getByRole('checkbox',{name:'协作清单',exact:true}).isChecked(),true);assert.equal(await p.getByRole('checkbox',{name:'收集箱（仅自己）',exact:true}).isChecked(),false);for(const name of ['日历','搜索']){await p.getByRole('button',{name:'关闭导出',exact:true}).click();await p.locator('.function-rail').getByRole('button',{name,exact:true}).click();await open(p);assert.equal(await p.getByRole('checkbox',{name:'收集箱（仅自己）',exact:true}).isChecked(),true);assert.equal(await p.getByRole('checkbox',{name:'协作清单',exact:true}).isChecked(),false)}checks.push(stage);
 stage='revoked scope failure hides unavailable selection';await p.getByRole('checkbox',{name:'协作清单',exact:true}).check();sql('DELETE FROM board_members WHERE board_id=?',[shared.id]);await p.getByRole('button',{name:'获取最新导出预览',exact:true}).click();await p.getByRole('status').filter({hasText:'所选范围已不可用'}).waitFor();assert.equal(await p.getByRole('checkbox',{name:'协作清单',exact:true}).count(),0);checks.push(stage);
 stage='account invalidation aborts pending download and follows existing auth path';await p.getByRole('button',{name:'关闭导出',exact:true}).click();await open(p);await p.getByLabel('导出格式',{exact:true}).selectOption('zip');await prepare();let releaseOld,heldOld;const oldPaused=new Promise(r=>heldOld=r);await p.route('**/api/exports/download',async r=>{const response=await r.fetch();heldOld();await new Promise(res=>releaseOld=res);await r.fulfill({response}).catch(()=>{})},{times:1});p.on('download',count);await p.getByRole('button',{name:'确认下载 ZIP',exact:true}).click();await oldPaused;sql('DELETE FROM sessions');await p.getByRole('button',{name:'关闭导出',exact:true}).click();await open(p,true);await p.getByLabel('用户名',{exact:true}).waitFor();await p.getByLabel('用户名',{exact:true}).fill('other');await p.getByLabel('密码',{exact:true}).fill(otherPassword);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'今天',exact:true}).waitFor();releaseOld();await p.waitForTimeout(200);assert.equal(downloads,0);p.off('download',count);await open(p);assert.equal(await p.getByRole('checkbox',{name:'协作清单',exact:true}).count(),0);await prepare();assert.ok((await p.getByRole('region',{name:'导出预览'}).innerText()).includes('0 个任务'));checks.push(stage);
 stage='mobile global entry remains available without permanent toolbar';await p.getByRole('button',{name:'关闭导出',exact:true}).click();await p.setViewportSize({width:375,height:700});await open(p);assert.equal(await p.getByRole('checkbox',{name:'收集箱（仅自己）',exact:true}).isChecked(),true);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:out+'/mobile-entry.png',fullPage:true});checks.push(stage);
 assert.deepEqual(errors,[]);

 fs.writeFileSync(out+'/result.json',JSON.stringify({checks,errors,out},null,2));console.log(JSON.stringify({checks,errors,out}));
}catch(e){if(browser){const ps=browser.contexts().flatMap(c=>c.pages());await ps[0]?.screenshot({path:out+'/failure.png',fullPage:true});fs.writeFileSync(out+'/failure-dom.txt',await ps[0]?.locator('body').innerText()||'')}fs.writeFileSync(out+'/failure.txt',stage+' '+e.stack);console.log('EVIDENCE '+out);throw e}finally{await browser?.close();if(server){server.kill();await new Promise(r=>server.once('exit',r))}await s3?.close()}
