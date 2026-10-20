export function scheduleDraft(schedule){
 return {enabled:!!schedule,start:schedule?.start_date||'',end:schedule?.end_date||'',startTime:schedule?.start_time||'',endTime:schedule?.end_time||'',unit:schedule?.repeat?.unit||'',interval:schedule?.repeat?.interval||1,mode:schedule?.repeat?.mode||'calendar',weekdays:schedule?.repeat?.weekdays||[],ending:schedule?.repeat?.count?'count':schedule?.repeat?.until?'until':'never',until:schedule?.repeat?.until||'',count:schedule?.repeat?.count||2};
}
export function scheduleValidation(d){
 const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!s.startsWith('0000')&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!d.start){return d.enabled||d.end||d.startTime||d.endTime||d.unit?'请填写开始日期；或清除日期和重复。':''}
 if(!date(d.start)||d.end&&!date(d.end))return '日期必须是有效的 YYYY-MM-DD（年份 0001–9999）';
 if(d.end&&d.end<d.start)return '结束日期不能早于开始日期';
 if((!d.end||d.end===d.start)&&d.startTime&&d.endTime&&d.endTime<d.startTime)return '同日结束时间不能早于开始时间';
 if(d.unit){
  if(!Number.isInteger(Number(d.interval))||Number(d.interval)<1||Number(d.interval)>1000)return '重复间隔必须为 1–1000 的整数';
  if(d.unit==='week'&&!d.weekdays.length)return '每周重复必须选择至少一个星期';
  if(d.ending==='count'&&(!Number.isInteger(Number(d.count))||Number(d.count)<1||Number(d.count)>4294967295))return '重复总次数必须为至少 1 的整数（最多 4294967295）';
  if(d.ending==='until'&&(!date(d.until)||d.until<d.start))return '重复截至日期不能早于开始日期，且不能为空';
 }
 return '';
}
export function scheduleValue(d){
 if(!d.start)return null;
 return {start_date:d.start,timezone:'Asia/Shanghai',...(d.end?{end_date:d.end}:{}),...(d.startTime?{start_time:d.startTime}:{}),...(d.endTime?{end_time:d.endTime}:{}),...(d.unit?{repeat:{unit:d.unit,interval:Number(d.interval),mode:d.mode,weekdays:d.unit==='week'?d.weekdays:[],...(d.ending==='count'?{count:Number(d.count)}:d.ending==='until'?{until:d.until}:{})}}:{})};
}
