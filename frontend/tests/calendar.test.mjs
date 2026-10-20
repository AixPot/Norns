import test from 'node:test';
const task=(id,schedule,extra={})=>({id,title:'Task '+id,schedule,...extra});
test('projection includes civil boundaries, all-day ranges and only real dated instances',()=>{
 const rows=[task(1,{start_date:'2028-02-28',end_date:'2028-03-01'}),task(2,null),task(3,{start_date:'2028-02-29',repeat:{unit:'day'}}),task(4,null,{due_date:'2028-03-01'}),task(5,{start_date:'2028-02-29'},{archived:true})];
 const days=projectCalendar(rows,calendarRange('2028-02-29','week'));
 assert.deepEqual(days[0].allDay.map(x=>x.task.id),[1]);assert.deepEqual(days[1].allDay.map(x=>x.task.id),[1,3]);assert.deepEqual(days[2].allDay.map(x=>x.task.id),[1,4]);assert.equal(days[3].allDay.length,0);
});
test('timed cross-day splits, partial boundaries and visual point duration never change data',()=>{
 const rows=[task(1,{start_date:'2028-02-28',end_date:'2028-03-01',start_time:'23:00',end_time:'01:00'}),task(2,{start_date:'2028-02-29',end_time:'10:00'}),task(3,{start_date:'2028-02-29',start_time:'12:00'}),task(4,{start_date:'2028-02-29',end_date:'2028-03-01',end_time:'09:00'})];
 const before=JSON.stringify(rows),d=projectCalendar(rows,calendarRange('2028-02-29','week'));
 assert.deepEqual(d.slice(0,3).map(x=>x.timed.find(t=>t.task.id===1)).map(x=>[x.start,x.end]),[[1380,1440],[0,1440],[0,60]]);
 assert.deepEqual(d[1].timed.filter(x=>[2,3].includes(x.task.id)).map(x=>[x.start,x.end]),[[600,630],[720,750]]);
 assert.deepEqual(d[1].timed.find(x=>x.task.id===4).start,0);assert.equal(d[2].timed.find(x=>x.task.id===4).end,540);assert.equal(JSON.stringify(rows),before);
});
test('collision lanes use visual minimum height, connected overlap groups and chronological order, not completion',()=>{
 const rows=[{task:{id:1,completed:true},start:600,end:601},{task:{id:2},start:610,end:620},{task:{id:3},start:640,end:700},{task:{id:4},start:680,end:720}];
 const laid=layoutTimed(rows);assert.deepEqual(laid.map(x=>x.task.id),[1,2,3,4]);assert.deepEqual(laid.map(x=>x.columns),[2,2,2,2]);assert.notEqual(laid[0].lane,laid[1].lane);assert.equal(laid[0].visualEnd,630);
 assert.equal(layoutTimed([{task:{id:5},start:1439,end:1439}])[0].start,1410);
});
import assert from 'node:assert/strict';
import {calendarRange,shiftCalendar,shanghaiToday,projectCalendar,layoutTimed} from '../src/calendar.mjs';
test('civil month is Monday-first, includes leap day and adjacent month; independent of browser TZ',()=>{
 assert.equal(shanghaiToday(new Date('2028-02-28T16:05:00Z')),'2028-02-29');
 const r=calendarRange('2028-02-29','month');assert.equal(r.from,'2028-01-31');assert.equal(r.to,'2028-03-05');assert.equal(r.days.length,35);
 assert.equal(calendarRange('2028-03-01','week').from,'2028-02-28');
 assert.equal(shiftCalendar('2028-01-31','month',1),'2028-02-29');
 assert.equal(shiftCalendar('2028-02-29','month',12),'2029-02-28');
});
