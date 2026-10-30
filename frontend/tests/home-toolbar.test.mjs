import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compile} from 'svelte/compiler';
const read=name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
test('smart home orders title, capture, shared selection/display toolbar, then results',()=>{
 const smart=read('SmartTasks.svelte');
 assert.ok(smart.indexOf('<TaskCapture')<smart.indexOf('class="smart-toolbar"'));
 assert.ok(smart.indexOf('class="smart-toolbar"')<smart.indexOf('class="smart-results"'));
 assert.match(smart,/@render selectionControls\?\.\(\)/);
 assert.doesNotMatch(smart,/placeholder="添加到私人收集箱/);
 const app=read('App.svelte');assert.match(app,/selectionControls=\{selectionControls\}/);
 assert.match(app,/批量选择/);
 assert.match(read('ViewOptions.svelte'),/显示设置/);
 for(const name of ['App.svelte','SmartTasks.svelte','TaskCapture.svelte','ViewOptions.svelte'])assert.ok(compile(read(name),{filename:name,generate:'client'}).js.code);
});

test('shared selection keeps board and search entry unchanged',()=>{
 const app=read('App.svelte');
 assert.match(app,/class=\{view==='smart'\?'text-button':'secondary'\}/);
 assert.match(app,/\{view==='smart'\?'批量选择':'选择任务'\}/);
});

test('new mobile capture spacing is limited to smart quick inbox',()=>{
 const css=read('TaskCapture.svelte').split('@media(max-width:800px)')[1];
 const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
 for(const [,selector,body] of rules){
  if(/gap:|padding/.test(body))assert.ok(selector.includes(':global(.smart-tasks) .quick-inbox'),selector);
 }
 assert.match(css,/\.capture-preview button\{min-height:44px\}/);
});

test('new display styling is limited to smart toolbar but shared label stays',()=>{
 const css=read('style.css');
 const rule=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([,selector,body])=>selector.trim().endsWith('.view-options>button')&&body.includes('box-shadow:none'));
 assert.ok(rule);
 assert.equal(rule[1].trim(),'.smart-toolbar .view-options>button');
 assert.match(read('ViewOptions.svelte'),/显示设置<svg/);
});
