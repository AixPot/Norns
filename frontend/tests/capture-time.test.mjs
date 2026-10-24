import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCapture} from '../src/capture-time.mjs';
const options={now:new Date('2026-10-23T15:59:59Z'),timezone:'Asia/Shanghai'};
test('relative date candidate preserves exact source span and leaves title for explicit acceptance',()=>{
 assert.equal(typeof parseCapture,'function');
 assert.deepEqual(parseCapture('明天 买牛奶',options),{
  schedule:{start_date:'2026-10-24',timezone:'Asia/Shanghai'},
  spans:[{start:0,end:2,text:'明天'}],remainingTitle:'买牛奶',reason:'date',emptyTitle:false
 });
});

test('Shanghai midnight and relative month/year/leap rollover do not use browser timezone',()=>{
 for(const [clock,input,expected] of [
 ['2026-10-23T16:00:00Z','今天','2026-10-24'],
 ['2026-12-31T15:59:59Z','明天','2027-01-01'],
 ['2024-02-28T16:00:00Z','今天','2024-02-29'],
 ['2024-02-28T15:59:59Z','后天','2024-03-01']])
 assert.equal(parseCapture(input,{...options,now:new Date(clock)}).schedule.start_date,expected);
});
test('explicit dates and next Monday-based week validate leap dates and year boundaries',()=>{
 for(const [input,expected] of [['2024-02-29 复查','2024-02-29'],['2027年1月2日 买票','2027-01-02'],['下周一 开会','2026-10-26'],['下周日 休息','2026-11-01'],['下周天 休息','2026-11-01'],['0001-01-01 记录','0001-01-01'],['9999-12-31 记录','9999-12-31']])
 assert.equal(parseCapture(input,options)?.schedule.start_date,expected,input);
 assert.equal(parseCapture('下周一 开会',{...options,now:new Date('2026-12-31T16:00:00Z')}).schedule.start_date,'2027-01-04');
 assert.equal(parseCapture('下周一 开会',{...options,now:new Date('2026-10-25T16:00:00Z')}).schedule.start_date,'2026-11-02');
 for(const input of ['2026-02-29 复查','2024-02-30 复查','0000-01-01 记录','2026年13月1日 记录','12026-01-01 记录','2026-01-011 记录','9999-12-32 记录'])assert.equal(parseCapture(input,options),null,input);
});

test('explicit clock and Chinese meridiem produce backend schedule without reminders',()=>{
 for(const [phrase,time] of [
 ['明天09:05','09:05'],['明天 00:00','00:00'],['明天 23:59','23:59'],
 ['明天 上午9点','09:00'],['明天 下午3点半','15:30'],['明天上午三点','03:00'],
 ['明天下午三点十五分','15:15'],['明天 上午十二点','00:00'],['明天 下午十二点','12:00'],
 ['明天下午两点零五分','14:05'],['明天上午十一点五十九分','11:59'],
 ['明天 下午3点5分','15:05'],['2027年1月2日 下午三点半','15:30']]){
  const value=parseCapture(phrase+' 买票',options);
  assert.equal(value?.schedule.start_time,time,phrase);
  assert.equal(value.reason,'date-time');
  assert.equal(value.remainingTitle,'买票');
  assert.equal('repeat' in value.schedule,false);
  assert.deepEqual(Object.keys(value.schedule).sort(),['start_date','start_time','timezone']);
 }
});
test('invalid and ambiguous times never fall back to a date-only suggestion',()=>{
 for(const clock of ['24:00','9:5','09:000','009:00','12:60','-1:00','下午13点','上午0点','下午零点','下午三点六十分','下午三点60分','下午三点半分','下午三点一百分','下午二三点','下午3点30','下午3:00','上午9点下午3点','3点','三点半','15点','9:00:30'])
 assert.equal(parseCapture('明天 '+clock+' 开会',options),null,clock);
});

test('unsupported clauses and contradictory dates are preserved rather than partially parsed',()=>{
 for(const input of [
 '周一 开会','下星期一 开会','下午三点 开会','09:00 开会','三点 开会',
 '2026/10/24 开会','10月24日 开会','10-24 开会','明天 10月24日 开会',
 '明天或后天 开会','明天今天 开会','明天 2026-10-25 开会','明天 下周一 开会',
 '明天到后天 出差','明天至周日 出差','明天 09:00-10:00 开会','明天 09:00—10点 开会',
 '明天 09:00~10:00 开会','明天 下午三点到五点 开会','明天 上午9点、下午3点 开会',
 '明天 每周 复查','每天 明天 复查','明天 隔两天 复查','明天 重复 复查',
 '明天 2小时后 开会','明天 半小时 开会','明天 三天 开会','明天 提前10分钟 开会',
 '明天之前 交稿','明天以后 交稿','明天左右 开会','大约明天 开会',
 '2026-01-01T09:00 开会','2026-1-01 明天 开会','2026年2月30日 明天 开会',
 '明天上午三点一刻 开会','明天下午三点钟 开会','明天 09:00至 开会',
 '阅读《明天》','记录“明天下午三点”这句话','明天的天气报告',
 '明天/后天 开会','明天 / 2026/10/25 开会','明天 3天内完成',
 ]) assert.equal(parseCapture(input,options),null,input);
});
test('source spans use UTF-16 offsets; only recognized clause is removed and internal title whitespace stays exact',()=>{
 const text='  📋  买  牛奶 明天 下午三点半  给妈妈  ';
 const candidate=parseCapture(text,options);
 const start=text.indexOf('明天'),end=text.indexOf('半')+1;
 assert.deepEqual(candidate.spans,[{start,end,text:'明天 下午三点半'}]);
 assert.equal(candidate.remainingTitle,'📋  买  牛奶   给妈妈');
 assert.equal(text,'  📋  买  牛奶 明天 下午三点半  给妈妈  ');
 assert.equal(parseCapture('明天',options).emptyTitle,true);
 assert.equal(parseCapture('明天下午三点',options).emptyTitle,true);
 assert.equal(parseCapture('  买  牛奶  ',options),null);
});
test('invalid options are safe and deterministic, with no wall-clock fallback',()=>{
 for(const now of [undefined,null,'2026-10-23','bad',new Date(NaN),NaN,Infinity,{},true,8640000000000000])
 assert.equal(parseCapture('明天 开会',{now,timezone:'Asia/Shanghai'}),null);
 assert.equal(parseCapture('明天 开会',{...options,timezone:'America/New_York'}),null);
 for(const input of [null,undefined,{},12])assert.equal(parseCapture(input,options),null);
 const before=options.now.getTime();
 assert.deepEqual(parseCapture('明天 开会',{now:before}),parseCapture('明天 开会',options));
 assert.deepEqual(parseCapture('明天 开会',{now:'2026-10-23T23:59:59+08:00'}),parseCapture('明天 开会',options));
 assert.equal(options.now.getTime(),before);
});

test('unsupported temporal modifiers and embedded date identifiers never yield partial candidates',()=>{
 for(const input of ['明天早上 开会','明天晚上 开会','明天中午 开会','明天凌晨 开会','明天傍晚 开会','明天9时 开会','明天 9am 开会','明天 09:00 PM 开会','明天 每两天 开会','明天 每隔三日 开会','明天 三日后 开会','明天-后天 开会','-2026-10-24 开会','v2026-10-24 更新','2026-10-24abc 更新','明天上午三点多 开会','明天上午三点许 开会','明天上午三点整 开会'])
 assert.equal(parseCapture(input,options),null,input);
});

test('HH:mm requires two digits and numeric clock tokens cannot be partially consumed',()=>{
 for(const input of ['明天 9:00 开会','明天 000:00 开会','明天 09:00.5 开会','明天 09:00Z 开会','明天 09:00+08:00 开会','明天 下午003点 开会','明天 下午3点005分 开会'])assert.equal(parseCapture(input,options),null,input);
});


for(const input of ['明天 每星期复查','明天 每季度复查','明天 每工作日晨跑'])
 test('unsupported recurrence clause: '+input,()=>{
  assert.equal(parseCapture(input,options),null,input);
 });


for(const input of ['明天或周末开会','明天 2026.10.25 开会'])
 test('competing unsupported date clause: '+input,()=>{
  assert.equal(parseCapture(input,options),null,input);
 });


for(const [input,title,time] of [
 ['明天 整理资料','整理资料'],
 ['明天 起草报告','起草报告'],
 ['明天 前往医院','前往医院'],
 ['明天下午三点整理资料','整理资料','15:00']
]) test('ordinary title is not a temporal modifier: '+input,()=>{
 const clause=time?'明天下午三点':'明天';
 assert.deepEqual(parseCapture(input,options),{
  schedule:{start_date:'2026-10-24',timezone:'Asia/Shanghai',...(time?{start_time:time}:{})},
  spans:[{start:0,end:clause.length,text:clause}],
  remainingTitle:title,reason:time?'date-time':'date',emptyTitle:false
 });
});

for(const [input,clause,time] of [
 ['明天 到医院复诊','明天'],
 ['明天下午三点到医院复诊','明天下午三点','15:00'],
 ['明天 09:00 到医院复诊','明天 09:00','09:00']
]) test('destination verb after date clause stays in exact title: '+input,()=>{
 assert.deepEqual(parseCapture(input,options),{
  schedule:{start_date:'2026-10-24',timezone:'Asia/Shanghai',...(time?{start_time:time}:{})},
  spans:[{start:0,end:clause.length,text:clause}],
  remainingTitle:'到医院复诊',reason:time?'date-time':'date',emptyTitle:false
 });
});

for(const input of ['明天到后天 出差','明天到周末 出差','明天 到09: 开会','明天下午三点到下午 开会','明天 09:00到五点 开会','明天 09:00至 开会'])
 test('temporal range RHS remains conservative: '+input,()=>{
  assert.equal(parseCapture(input,options),null,input);
 });

test('unsupported every-occasion recurrence is never salvaged as a one-off date',()=>{
 assert.equal(parseCapture('明天 每逢节假日休息',options),null);
});
