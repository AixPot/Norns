import test from 'node:test';
import assert from 'node:assert/strict';
import {cardSchedule} from '../src/card-schedule.mjs';
const now=new Date('2026-10-19T15:59:59Z');
const card=(s)=>({schedule:{timezone:'Asia/Shanghai',...s}});
test('scheduled today has compact label and absolute accessible detail',()=>{
 assert.deepEqual(cardSchedule(card({start_date:'2026-10-19'}),now),{label:'今天',title:'2026-10-19 · Asia/Shanghai'});
});

test('Beijing classification changes at midnight and month/year boundaries',()=>{
 for(const [date,clock,label] of [
 ['2026-10-20','2026-10-19T15:59:59Z','明天'],['2026-10-20','2026-10-19T16:00:00Z','今天'],
 ['2026-11-01','2026-10-31T15:59:59Z','明天'],['2027-01-01','2026-12-31T15:59:59Z','明天'],
 ['2027-01-03','2026-12-31T15:59:59Z','2027/1/3'],['2026-10-22','2026-10-19T00:00:00-07:00','10/22'],
 ['0001-01-01','2026-10-19T00:00:00Z','0001/1/1']])assert.equal(cardSchedule(card({start_date:date}),new Date(clock)).label,label);
});
test('unscheduled cards have no placeholder and legacy date is supported',()=>{
 assert.equal(cardSchedule({},now),null);assert.equal(cardSchedule({schedule:null,due_date:null},now),null);
 assert.equal(cardSchedule({schedule:null,due_date:'2026-10-20'},now).label,'明天');
 assert.equal(cardSchedule({...card({start_date:'2026-10-19'}),due_date:'2026-10-22'},now).label,'今天');
});

test('same-day ranges omit duplicate dates without losing either optional time',()=>{
 for(const [s,label,title] of [
 [{start_time:'09:00'},'今天 09:00','2026-10-19 09:00'],
 [{start_time:'09:00',end_time:'11:00'},'今天 09:00–11:00','2026-10-19 09:00–11:00'],
 [{end_date:'2026-10-19',end_time:'11:00'},'今天 截至11:00','2026-10-19 截至11:00'],
 [{end_date:'2026-10-19',start_time:'09:00'},'今天 09:00','2026-10-19 09:00'],
 [{end_date:'2026-10-19'},'今天','2026-10-19']]){
  assert.deepEqual(cardSchedule(card({start_date:'2026-10-19',...s}),now),{label,title:title+' · Asia/Shanghai'});
 }
});
test('cross-day endpoints each keep date and optional time; cross-year includes years',()=>{
 for(const [s,label,title] of [
 [{end_date:'2026-10-20'},'今天—明天','2026-10-19—2026-10-20'],
 [{end_date:'2026-10-20',start_time:'09:00'},'今天 09:00—明天','2026-10-19 09:00—2026-10-20'],
 [{end_date:'2026-10-20',end_time:'11:00'},'今天—明天 11:00','2026-10-19—2026-10-20 11:00'],
 [{start_date:'2026-12-31',end_date:'2027-01-01',start_time:'09:00',end_time:'11:00'},'2026/12/31 09:00—2027/1/1 11:00','2026-12-31 09:00—2027-01-01 11:00']]){
  assert.deepEqual(cardSchedule(card({start_date:'2026-10-19',...s}),now),{label,title:title+' · Asia/Shanghai'});
 }
});
