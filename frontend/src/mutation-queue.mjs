// One CAS writer per board. A failed/unknown commit is never automatically replayed.
export function createMutationQueue({revision,apply,onstate=(_active)=>{}}){
 let tail=Promise.resolve(),count=0,blocked=null;
 return {
  run(write,startingRevision){
   // Only a not-yet-admitted intent may choose a new round's baseline.
   // Accepted queued work must follow our acknowledgements, never external polls.
   const firstRevision=count===0?startingRevision:undefined;
   count++;onstate(true);
   const job=tail.then(async()=>{
    if(blocked)throw new Error('前一操作未确认，后续操作未发送。请刷新看板并核对后重新操作。');
    try{const result=await write(firstRevision??revision());apply(result);return result}
    catch(e){
     const semantic=['successor_touched','archived_completion','completed_schedule','invalid','invalid_schedule'].includes(e.code);
     if(!semantic)blocked=e;
     if(!e.status||e.status>=500)throw Object.assign(new Error('操作结果未知，后续操作未发送。请查看最新版本核对，勿重复完成。'),{cause:e});
     throw e;
    }
   });
   tail=job.catch(()=>{}).finally(()=>{count--;onstate(count>0)});
   return job;
  },
  async idle(){while(count)await tail},
  pending(){return count>0},
  reset(){if(count)throw new Error('操作尚未结束');blocked=null},
 };
}
