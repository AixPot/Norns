import test from 'node:test';import assert from 'node:assert/strict';
const {positionPanel}=await import('../src/panel-position.mjs').catch(()=>({}));
test('detail panel sits beside card, flips at right edge and clamps within viewport',()=>{
 assert.equal(typeof positionPanel,'function');
 assert.deepEqual(positionPanel({left:100,right:360,top:180},500,600,1440,900),{left:372,top:180});
 assert.deepEqual(positionPanel({left:900,right:1160,top:800},500,600,1200,900),{left:388,top:288});
 assert.deepEqual(positionPanel({left:12,right:300,top:100},500,600,700,700),{left:188,top:88});
});