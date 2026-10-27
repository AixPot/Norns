// One stable slot, owned by the latest acknowledgement, never by the latest gesture.
// `valid` is supplied by the account/task owner; this module owns no transport or retry.
export function createCompletionFeedback({change,setTimer=setTimeout,clearTimer=clearTimeout,valid=()=>true}){
 let current=null,timer;
 function clear(){clearTimer(timer);current=null;change(null)}
 return {
  clear,
  show(item){
   if(!valid(item))return false;
   clearTimer(timer);const entry={...item,pending:false,status:'confirmed'};current=entry;change(entry);
   timer=setTimer(()=>{if(current===entry)clear()},10000);return true;
  },
  async undo(run){
   const entry=current;if(!entry||entry.pending||entry.status==='unknown')return;
   if(!valid(entry)){clear();return}
   entry.pending=true;change({...entry});
   try{
    const result=await run(entry);
    if(current!==entry)return;
    if(!valid(entry)||result===true){clear();return}
    if(result==='unknown')entry.status='unknown';
   }catch(error){
    // A thrown transport error has no authoritative outcome. The owner may map
    // definite semantic rejection to false; everything else requires readback.
    if(current===entry)entry.status='unknown';throw error;
   }finally{entry.pending=false;if(current===entry)change({...entry})}
  },
 };
}
