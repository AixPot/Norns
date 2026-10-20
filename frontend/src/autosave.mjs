// A single owner per open card. Never replace live inputs with response snapshots.
export function createAutosave({read,write,revision,delay=600,onstate=(_state,_error)=>{}}){
 let saved=JSON.stringify(read()),timer=null,running=null,stopped=false,composing=false,error=null;const actions=[];
 const dirty=()=>JSON.stringify(read())!==saved;
 const state=()=>onstate(error?(error.validation?'invalid':error.status===409?'conflict':'error'):running?'saving':dirty()?'pending':'saved',error);
 function clear(){if(timer!==null)clearTimeout(timer);timer=null}
 async function drain(){
  while(!stopped&&!composing&&(dirty()||actions.length)){
   if(!dirty()&&actions.length){
    const job=actions.shift();
    try{revision=await job.write(revision);job.resolve(true)}catch(e){error=e;job.resolve(false);return false}
    continue;
   }
   const data=structuredClone(read());
   try{revision=await write(data,revision);saved=JSON.stringify(data)}
   catch(e){if(e.revision!==undefined)revision=e.revision;error=e;return false}
  }
  return !stopped&&!composing&&!dirty();
 }
 function flush(){
  clear();if(stopped||composing||error)return Promise.resolve(false);
  if(running)return running;
  running=Promise.resolve().then(drain).finally(()=>{running=null;state()});state();return running;
 }
 return {
  change(immediate=false){clear();if(error?.validation)error=null;state();if(!stopped&&!composing&&!error){if(immediate)void flush();else timer=setTimeout(flush,delay)}},
  flush,
  async action(write){
   if(stopped||composing||error)return false;
   let resolve;const done=new Promise(r=>resolve=r);actions.push({write,resolve});
   if(!await flush()){for(const job of actions.splice(0))job.resolve(false)}
   return await done;
  },
  retry(){error=null;return flush()},
  composition(active){composing=active;if(active)clear();else this.change()},
  pending(){return !!running||dirty()||!!error||composing},
  revision(){return revision},
  rebaseBaseline(value,rev){saved=JSON.stringify(value);revision=rev;error=null;state()},
    stop(){stopped=true;clear()},
 };
}
