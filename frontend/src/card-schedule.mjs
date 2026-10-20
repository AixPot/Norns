const DAY=86400000;
const SHANGHAI_OFFSET=8*3600000;
// Schedule dates are already local calendar dates, not UTC instants.
export function cardSchedule(card,now=new Date()){
 const s=card.schedule||(card.due_date?{start_date:card.due_date}:null);
 if(!s?.start_date)return null;
 const today=new Date(now.getTime()+SHANGHAI_OFFSET).toISOString().slice(0,10);
 const tomorrow=new Date(now.getTime()+SHANGHAI_OFFSET+DAY).toISOString().slice(0,10);
 const crossYear=!!s.end_date&&s.start_date.slice(0,4)!==s.end_date.slice(0,4);
 const date=d=>d===today?'今天':d===tomorrow?'明天':`${crossYear||d.slice(0,4)!==today.slice(0,4)?d.slice(0,4)+'/':''}${Number(d.slice(5,7))}/${Number(d.slice(8,10))}`;
 const endpoint=(d,t)=>d+(t?' '+t:'');
 const range=format=>{
  if(s.end_date&&s.end_date!==s.start_date)return endpoint(format(s.start_date),s.start_time)+'—'+endpoint(format(s.end_date),s.end_time);
  const times=s.start_time?(s.start_time+(s.end_time?'–'+s.end_time:'')):(s.end_time?'截至'+s.end_time:'');
  return endpoint(format(s.start_date),times);
 };
 return {label:range(date),title:range(d=>d)+' · Asia/Shanghai'};
}
