import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTheme, palettes} from '../src/theme.mjs';
function fixture(storage) {
 let dark=false,listener,applied;
 const media={get matches(){return dark},addEventListener(_,f){listener=f},removeEventListener(){listener=null}};
 const t=createTheme({storage,media,apply:(value,preference,palette)=>applied={value,preference,palette}});
 return {t,get applied(){return applied},dark(v){dark=v;listener?.()}};
}
test('legacy mode migrates without rewriting; independent palettes survive reload and identity switches',()=>{
 const data=new Map([['norns.theme.user.1','dark']]),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},f=fixture(storage);
 assert.deepEqual(f.applied,{value:'light',preference:'system',palette:'blue'});
 f.t.identity(1);assert.deepEqual(f.applied,{value:'dark',preference:'dark',palette:'blue'});
 for(const palette of palettes){f.t.setPalette(palette);assert.equal(f.applied.value,'dark');assert.equal(f.applied.palette,palette)}
 assert.equal(data.get('norns.theme.user.1'),'dark');
 f.t.set('light');assert.equal(f.applied.palette,'graphite');
 const restored=fixture(storage);restored.t.identity(1);assert.deepEqual(restored.applied,f.applied);
 f.t.identity(2);assert.deepEqual(f.applied,{value:'light',preference:'system',palette:'blue'});
 f.t.setPalette('clay');f.dark(true);assert.deepEqual(f.applied,{value:'dark',preference:'system',palette:'clay'});
 f.t.identity(1);assert.equal(f.applied.palette,'graphite');assert.equal(f.applied.value,'light');
 f.t.identity(null);assert.equal(f.applied.palette,'blue');f.t.stop();f.dark(false);assert.equal(f.applied.value,'dark');
});
test('storage denial, invalid values, account-scoped events and system listener',()=>{
 const f=fixture({getItem(){throw Error('denied')},setItem(){throw Error('quota')}});
 f.t.identity(1);f.t.setPalette('iris');f.dark(true);assert.deepEqual(f.applied,{value:'dark',preference:'system',palette:'iris'});
 f.t.set('light');f.dark(true);assert.equal(f.applied.value,'light');
 f.t.external('norns.theme.user.2.palette','clay');assert.equal(f.applied.palette,'iris');
 f.t.external('norns.theme.user.1.palette','clay');assert.equal(f.applied.palette,'clay');
 f.t.external('norns.theme.user.1','dark');assert.equal(f.applied.palette,'clay');assert.equal(f.applied.value,'dark');
 f.t.setPalette('green');f.t.set('invalid');assert.deepEqual(f.applied,{value:'dark',preference:'system',palette:'blue'});
 f.t.external(null,null);assert.equal(f.applied.palette,'blue');
});
