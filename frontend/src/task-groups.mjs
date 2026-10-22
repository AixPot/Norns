function dateHeading(date,today){
 const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const prefix=date===today?'今天 · ':date===tomorrow?'明天 · ':'';
 const formatted=new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',month:'long',day:'numeric',weekday:'long',...(date.slice(0,4)!==today.slice(0,4)?{year:'numeric'}:{})}).format(new Date(date+'T00:00:00Z'));
 return prefix+formatted;
}

// Presentation only: consume the complete server result, never expand recurrence.
export function groupSmartTasks(tasks,route,today){
 if(route==='next7'){
  const groups=new Map();
  for(const task of tasks){
   const start=task.schedule?.start_date||task.due_date;
   const key=start?(start<today?today:start):'undated';
   if(!groups.has(key))groups.set(key,{key,label:key==='undated'?'无日期':dateHeading(key,today),tasks:[]});
   groups.get(key).tasks.push(task);
  }
  return [...groups.values()].sort((a,b)=>a.key.localeCompare(b.key));
 }
 if(route!=='today')return [{key:'all',label:'',tasks}];
 const overdue=[],current=[];
 for(const task of tasks){
  const start=task.schedule?.start_date||task.due_date;
  const end=task.schedule?.end_date||start;
  (end&&end<today?overdue:current).push(task);
 }
 return [{key:'overdue',label:'已逾期',tasks:overdue},{key:today,label:'今天',tasks:current}].filter(g=>g.tasks.length);
}
