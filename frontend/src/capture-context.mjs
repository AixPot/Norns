// Creation-only context. Never parse or rewrite existing task/template titles.
export function captureContext(route,explicit,choice='',now=new Date()){
 const today=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
 const day=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 const dates=Array.from({length:7},(_,i)=>day(i));
 const schedule=explicit||(choice?{start_date:choice,timezone:'Asia/Shanghai'}:route==='today'||route==='tomorrow'?{start_date:day(route==='tomorrow'?1:0),timezone:'Asia/Shanghai'}:undefined);
 const needsChoice=route==='next7'&&!schedule;
 const start=schedule?.start_date,end=schedule?.end_date||start;
 const outside=!!start&&(route==='today'?!(start<=today&&end>=today):route==='tomorrow'?!(start<=day(1)&&end>=day(1)):route==='next7'?!(start<=day(6)&&end>=today):false);
 return {schedule,dates,needsChoice,outside,notice:outside?`已保存到私人收集箱 · ${start}，不在当前日期视图；可去收集箱或对应日期查看。`:''};
}
