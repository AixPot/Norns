import test from 'node:test';
import assert from 'node:assert/strict';
import * as capture from '../src/capture-context.mjs';
const now=new Date('2026-10-30T04:00:00Z');
test('capture date label follows the submitted schedule precedence without inventing a seven-day default',()=>{
 assert.equal(typeof capture.captureDateLabel,'function');
 assert.equal(capture.captureDateLabel('today'), '日期 · 今天');
 assert.equal(capture.captureDateLabel('tomorrow'), '日期 · 明天');
 assert.equal(capture.captureDateLabel('next7'), '选择日期');
 for(const route of ['today','tomorrow','next7']){
  const explicit={start_date:'2026-11-04',timezone:'Asia/Shanghai'};
  for(const [parsed,choice] of [[undefined,'2026-11-02'],[explicit,'2026-11-02'],[explicit,'']]){
   const context=capture.captureContext(route,parsed,choice,now);
   assert.equal(capture.captureDateLabel(route,parsed,choice),'日期 · '+context.schedule.start_date);
  }
 }
});
