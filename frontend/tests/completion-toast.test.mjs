import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.env.NORNS_FRONTEND_PACKAGE || new URL('../package.json',import.meta.url));
const resolve=s=>pathToFileURL(require.resolve(s)).href;
const {compile}=require('svelte/compiler');
const {render}=await import(resolve('svelte/server'));
const source=await readFile(new URL('../src/CompletionToast.svelte',import.meta.url),'utf8');
const compiled=compile(source,{generate:'server',filename:'CompletionToast.svelte'});
const code=compiled.js.code.replace("'./completion-clearance.mjs'",JSON.stringify(new URL('../src/completion-clearance.mjs',import.meta.url).href)).replace(/(['"])(svelte(?:\/[^'"]*)?)\1/g,(_,q,s)=>JSON.stringify(resolve(s)));
const {default:Toast}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const item={card:1,board:1,user:1,epoch:0,title:'今日写作',pending:false};
const html=(patch={})=>render(Toast,{props:{item:{...item,...patch},onundo(){},onclose(){}}}).body;
test('confirmed slot renders a decorative solid seal and real completed text; escaping is retained',()=>{
 assert.match(html(),/completion-seal/);assert.match(html(),/aria-hidden="true"/);assert.match(html(),/已完成/);assert.match(html(),/撤销/);
 assert.match(html({title:'<script>bad</script>'}),/&lt;script/);
});
test('undo and unknown use neutral text without success seal or enabled replay',()=>{
 const pending=html({pending:true});assert.match(pending,/正在恢复/);assert.doesNotMatch(pending,/已完成|completion-seal/);
 const unknown=html({status:'unknown'});assert.match(unknown,/待核对/);assert.doesNotMatch(unknown,/已完成|completion-seal/);assert.match(unknown,/disabled/);
});
