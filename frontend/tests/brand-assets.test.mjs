import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const paths=s=>[...s.matchAll(/<path\s+d="([^"]+)"/g)].map(m=>m[1]);
test('approved B2/C2 variants keep master paths and true vector transparency',()=>{
 for(const name of ['b2','c2']){const master=read(`public/brand/norns-${name}.svg`);assert.ok(paths(master).length>0);assert.doesNotMatch(master,/<image|data:image|<rect|<script/);
  for(const palette of ['blue','iris','clay','graphite'])for(const mode of ['light','dark']){const variant=read(`public/brand/${name}-${palette}-${mode}.svg`);assert.deepEqual(paths(variant),paths(master));assert.doesNotMatch(variant,/var\(|undefined|<image|<rect/)}
  if(name==='b2')assert.deepEqual(paths(read('src/BrandMark.svelte')),paths(master));
 }
});
test('favicon bootstrap and runtime use same-origin exports, decorative SVG has one accessible owner',()=>{
 const app=read('src/App.svelte'),bootstrap=read('public/theme-init.js'),component=read('src/BrandMark.svelte');assert.match(app,/favicon-\$\{palette\}-\$\{value\}\.svg/);assert.match(bootstrap,/favicon-.*palette.*value/);assert.match(component,/aria-hidden="true"/);assert.doesNotMatch(component,/<title|aria-label/);assert.match(read('index.html'),/favicon-blue-light\.svg/);
});
