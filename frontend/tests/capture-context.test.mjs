import test from 'node:test';
import assert from 'node:assert/strict';
import {captureContext} from '../src/capture-context.mjs';
const now=new Date('2026-10-27T15:59:00Z');
test('today/tomorrow use submit instant in Shanghai, not UTC or mount day',()=>{
 assert.equal(captureContext('today',undefined,'',now).schedule.start_date,'2026-10-27');
 assert.equal(captureContext('tomorrow',undefined,'',now).schedule.start_date,'2026-10-28');
 assert.equal(captureContext('today',undefined,'',new Date('2026-10-27T16:01:00Z')).schedule.start_date,'2026-10-28');
});
test('seven-day context never supplies a silent default; explicit dates win and report destination',()=>{
 const c=captureContext('next7',undefined,'',now);assert.equal(c.needsChoice,true);assert.equal(c.schedule,undefined);assert.equal(c.dates.at(-1),'2026-11-02');
 assert.equal(captureContext('next7',undefined,'2026-10-30',now).schedule.start_date,'2026-10-30');
 const explicit={start_date:'2026-11-15',timezone:'Asia/Shanghai'};
 assert.deepEqual(captureContext('today',explicit,'',now).schedule,explicit);assert.equal(captureContext('today',explicit,'',now).outside,true);
 assert.equal(captureContext('inbox',undefined,'',now).schedule,undefined);
});
