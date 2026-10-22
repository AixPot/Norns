export function taskQuery(filters){
 const q=new URLSearchParams();
 for(const key of ['q','view','status','assignee_id','board_id','from','to'])if(filters[key]!==''&&filters[key]!=null)q.set(key,String(filters[key]));
 return q.toString();
}
export function createTaskLoader({read,apply,onerror}){
 let epoch=0;
 return {async load(query){const token=++epoch;try{const rows=await read(query);if(token===epoch)apply(rows)}catch(e){if(token===epoch)onerror(e)}},stop(){++epoch}};
}

export function reconcileTaskFilters(filters,{boards,people,inbox}){
 const board_id=[...boards,...(inbox?[inbox]:[])].some(b=>String(b.id)===filters.board_id)?filters.board_id:'';
 const assignee_id=people.some(p=>String(p.id)===filters.assignee_id)?filters.assignee_id:'';
 return board_id===filters.board_id&&assignee_id===filters.assignee_id?filters:{...filters,board_id,assignee_id};
}
