// A single confirmed completion. Timer callbacks and undo retain exact entry identity.
export function createCompletionFeedback({change,setTimer=setTimeout,clearTimer=clearTimeout}){
 let current=null,timer;
 function clear(){clearTimer(timer);current=null;change(null)}
 return {
  clear,
  show(item){clearTimer(timer);const entry={...item,pending:false};current=entry;change(entry);timer=setTimer(()=>{if(current===entry)clear()},10000)},
  async undo(run){
   const entry=current;if(!entry||entry.pending)return;
   entry.pending=true;change({...entry});
   try{if(await run(entry)&&current===entry)clear()}
   finally{entry.pending=false;if(current===entry)change({...entry})}
  },
 };
}
