const DAY=86400000;
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
export function projectCalendar(tasks,range){
 return range.days.map(date=>{
  const allDay=[],timed=[];
  for(const task of tasks){
   const s=task.schedule||(task.due_date?{start_date:task.due_date}:null);
   if(task.archived||!s?.start_date||date<s.start_date||date>(s.end_date||s.start_date))continue;
   if(!s.start_time&&!s.end_time){allDay.push({task});continue}
   const endDate=s.end_date||s.start_date,cross=endDate!==s.start_date;
   let start,end;
   if(!cross){start=minutes(s.start_time||s.end_time);end=s.start_time&&s.end_time?minutes(s.end_time):start+30}
   else {start=date===s.start_date&&s.start_time?minutes(s.start_time):0;end=date===endDate&&s.end_time?minutes(s.end_time):1440}
   timed.push({task,start,end});
  }
  timed.sort((a,b)=>a.start-b.start||a.end-b.end||a.task.id-b.task.id);
  return {date,allDay,timed};
 });
}
// A minimum 30-minute box is visual only. It participates in collision packing.
export function layoutTimed(events){
 const items=events.map(e=>({...e,start:Math.min(e.start,1410),visualEnd:Math.min(1440,Math.max(e.end,Math.min(e.start,1410)+30))})).sort((a,b)=>a.start-b.start||a.end-b.end||a.task.id-b.task.id);
 let group=[],ends=[],limit=-1;
 const finish=()=>{for(const item of group)item.columns=ends.length;group=[];ends=[]};
 for(const item of items){
  if(item.start>=limit){finish();limit=-1}
  let lane=ends.findIndex(end=>end<=item.start);if(lane<0)lane=ends.length;
  item.lane=lane;ends[lane]=item.visualEnd;group.push(item);limit=Math.max(limit,item.visualEnd);
 }
 finish();return items;
}

const civil=d=>new Date(d+'T00:00:00Z');
const iso=d=>d.toISOString().slice(0,10);
export const addDays=(d,n)=>iso(new Date(civil(d).getTime()+n*DAY));
export const shanghaiToday=(now=new Date())=>iso(new Date(now.getTime()+8*3600000));
export function shiftCalendar(date,mode,amount){
 if(mode==='week')return addDays(date,7*amount);
 const d=civil(date),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+amount);
 const last=new Date(d.getTime());last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 d.setUTCDate(Math.min(day,last.getUTCDate()));return iso(d);
}
export function calendarRange(date,mode){
 let from=date,to=date;
 if(mode==='month'){from=date.slice(0,7)+'-01';to=addDays(shiftCalendar(from,'month',1),-1)}
 from=addDays(from,-((civil(from).getUTCDay()+6)%7));
 to=mode==='week'?addDays(from,6):addDays(to,6-((civil(to).getUTCDay()+6)%7));
 const days=[];for(let d=from;d<=to;d=addDays(d,1))days.push(d);
 return {from,to,days};
}
