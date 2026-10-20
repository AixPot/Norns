for (const name of ["PLAYWRIGHT_MODULE", "CHROMIUM_PATH", "EVIDENCE_DIR"]) { if (!process.env[name]) throw Error('Set '+name+' before running this browser test'); }
// Real-provider acceptance: private bucket only; no ACL/CORS/lifecycle mutation.
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import net from 'node:net';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=process.cwd(),evidence=process.env.EVIDENCE_DIR;
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(Number(process.env.B2_TEST_PORT||48748),'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
const base=`http://127.0.0.1:${port}`,password=crypto.randomBytes(24).toString('base64url');
const env={...process.env,DATABASE_URL:'sqlite://'+evidence+'/db.sqlite',BIND_ADDR:`127.0.0.1:${port}`,APP_ORIGIN:base,COOKIE_SECURE:'false',STATIC_DIR:root+'/frontend/dist'};
const binary=root+'/target/release/norns',checks=[],observations={origin:base},pageErrors=[];let server,browser;
function db(sql){const r=spawnSync('python3',['-c','import sqlite3,json,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps(c.execute(sys.argv[2]).fetchall()));c.commit()',evidence+'/db.sqlite',sql],{encoding:'utf8',cwd:evidence});assert.equal(r.status,0);return JSON.parse(r.stdout)}
const result={passed:false,checks,observations,pageErrors};
async function api(p,path,method='GET',body){return p.evaluate(async({path,method,body})=>{const me=await(await fetch('/api/me')).json();const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:r.status===204?null:await r.json()}},{path,method,body})}
async function bytes(p,path){return p.evaluate(async path=>{const r=await fetch('/api'+path);return {status:r.status,type:r.headers.get('content-type'),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))}},path)}
try{
 assert.equal(spawnSync(binary,['init-admin','b2acceptance'],{env,input:password,cwd:evidence,stdio:['pipe','ignore','ignore']}).status,0);
 const fd=fs.openSync(evidence+'/server.log','a',0o600);server=spawn(binary,[],{env,cwd:evidence,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'app readiness');
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox']});const context=await browser.newContext(),p=await context.newPage();p.on('pageerror',()=>pageErrors.push('pageerror (details suppressed)'));
 await p.goto(base);await p.getByLabel('用户名',{exact:true}).fill('b2acceptance');await p.getByLabel('密码',{exact:true}).fill(password);await p.getByRole('button',{name:'登录 Norns',exact:true}).click();await p.getByRole('heading',{name:'我的看板',exact:true}).waitFor();
 let r=await api(p,'/boards','POST',{title:'B2独立验收'});assert.equal(r.status,201);let b=r.body;
 for(const op of [{action:'list_create',title:'待办'},{action:'card_create',title:'B2附件'}]){if(op.action==='card_create')op.list_id=b.lists[0].id;r=await api(p,`/boards/${b.id}/mutate`,'POST',{expected_revision:b.revision,...op});assert.equal(r.status,200);b=r.body}
 const path=`/boards/${b.id}/cards/${b.cards[0].id}/attachments`,raw=Buffer.from('手机附件 B2 原始字节\n');
 r=await api(p,path,'POST',{filename:'真实中文附件.txt',size:raw.length});assert.equal(r.status,200);const up=r.body,url=new URL(up.put_url);assert.ok(url.pathname.startsWith(`/${process.env.S3_BUCKET}/norns/staging/`));assert.match(url.searchParams.get('X-Amz-SignedHeaders'),/content-length/);observations.signedHeaders=url.searchParams.get('X-Amz-SignedHeaders');
 const anonymous=new URL(url);anonymous.search='';observations.anonymousStagingStatus=(await fetch(anonymous)).status;assert.ok([401,403,404].includes(observations.anonymousStagingStatus));
 const altered=new URL(url);altered.pathname+='-tampered';observations.tamperedKeyStatus=(await fetch(altered,{method:'PUT',body:raw})).status;assert.equal(observations.tamperedKeyStatus,403);
 observations.wrongLengthStatus=(await fetch(url,{method:'PUT',body:Buffer.from('bad')})).status;assert.equal(observations.wrongLengthStatus,403);
 observations.signedPutStatus=(await fetch(url,{method:'PUT',body:raw})).status;assert.equal(observations.signedPutStatus,200);observations.anonymousExistingStagingStatus=(await fetch(anonymous)).status;assert.equal(observations.anonymousExistingStagingStatus,401);checks.push('B2 path-style SigV4 signed PUT succeeds; tampered key and wrong Content-Length rejected');
 r=await api(p,`${path}/${up.id}/complete`,'POST',{});observations.completeStatus=r.status;assert.equal(r.status,200);assert.equal((await api(p,`${path}/${up.id}/complete`,'POST',{})).status,200);
 assert.equal((await fetch(url,{method:'PUT',body:Buffer.alloc(raw.length,65)})).status,200);
 for(const suffix of ['/content','/content?download=true']){const read=await bytes(p,`${path}/${up.id}${suffix}`);assert.equal(read.status,200);assert.equal(read.type,'text/plain; charset=utf-8');assert.deepEqual(read.bytes,[...raw])}
 const final=new URL(process.env.S3_ENDPOINT);final.pathname=`/${process.env.S3_BUCKET}/norns/final/${up.id}`;observations.anonymousFinalStatus=(await fetch(final)).status;assert.ok([401,403,404].includes(observations.anonymousFinalStatus));checks.push('HEAD/GET/final PUT complete and idempotent complete; staging replay preserves UTF8 proxy preview/download exact bytes; final anonymous GET denied');
 const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:base,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type'}});observations.preflight={status:preflight.status,allowOrigin:preflight.headers.get('access-control-allow-origin'),allowMethods:preflight.headers.get('access-control-allow-methods'),allowHeaders:preflight.headers.get('access-control-allow-headers')};
 // Still exercise actual XHR even if preflight indicates a user-action blocker.
 await p.reload();await p.getByRole('button',{name:/B2独立验收/}).click();await p.getByRole('button',{name:'移动或编辑 B2附件',exact:true}).click();await p.getByLabel('选择附件',{exact:true}).waitFor();
 await p.getByLabel('选择附件',{exact:true}).setInputFiles([{name:'浏览器中文.txt',mimeType:'text/plain',buffer:raw}]);
 const row=p.locator('.attachment-row').filter({hasText:'浏览器中文.txt'});let browserUpload=false;try{await row.getByRole('button',{name:'预览',exact:true}).waitFor({timeout:15000});browserUpload=true}catch{}
 observations.browserUpload=browserUpload;
 if(browserUpload){await row.getByRole('button',{name:'预览',exact:true}).click();const rendered=await p.frameLocator('.attachment-preview iframe').locator('body').innerText();assert.equal(rendered,raw.toString());const [download]=await Promise.all([p.waitForEvent('download'),row.getByRole('link',{name:'下载',exact:true}).click()]);assert.equal(download.suggestedFilename(),'浏览器中文.txt');assert.deepEqual(fs.readFileSync(await download.path()),raw);await p.screenshot({path:evidence+'/utf8-browser.png',fullPage:true});checks.push('actual browser XHR upload, exact Chinese iframe text, original UTF8 download filename and bytes')}else{result.blocker='B2 browser upload failed; inspect preflight metadata and bucket CORS. No bucket settings modified.'}
 assert.equal((await api(p,`${path}/${up.id}`,'DELETE')).status,204);assert.equal((await bytes(p,`${path}/${up.id}/content`)).status,404);
 let drained=false;for(let i=0;i<100;i++){if(db(`SELECT COUNT(*) FROM attachment_outbox WHERE key='norns/final/${up.id}'`)[0][0]===0){drained=true;break}await new Promise(r=>setTimeout(r,250))}assert.ok(drained,'final delete outbox drained');observations.deletedKey=up.id;checks.push('delete immediate proxy404 and actual B2 DeleteObject outbox drained');
 assert.deepEqual(pageErrors,[]);result.passed=browserUpload;
}catch(e){result.failure=String(e.message).replace(/https?:\/\/\S+/g,'[URL REDACTED]');process.exitCode=1}
finally{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill('SIGINT');await new Promise(r=>server.once('exit',r))}observations.portClosed=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1');s.once('error',()=>resolve(true));s.once('connect',()=>{s.destroy();resolve(false)})});fs.writeFileSync(evidence+'/browser-result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({passed:result.passed,evidence,portClosed:observations.portClosed}));}
