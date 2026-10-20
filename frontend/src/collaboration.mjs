// One in-flight request. Lifecycle owner stops the poller on board/session changes.
export function acceptSnapshot(current,incoming){return current&&incoming.id===current.id&&incoming.revision>=current.revision?incoming:current}
export function createPoller({read,apply,visible=()=>!document.hidden,onerror=(_error)=>{},schedule=fn=>setTimeout(fn,3000),cancel=clearTimeout}){
 let stopped=false,running=false,timer=null;
 async function check(){
  if(timer!==null){cancel(timer);timer=null}
  if(stopped||running||!visible())return;
  running=true;
  try{const value=await read();if(!stopped)apply(value)}catch(e){if(!stopped)onerror(e)}
  finally{running=false;if(!stopped&&visible())timer=schedule(check)}
 }
 return {check,stop(){stopped=true;if(timer!==null)cancel(timer);timer=null}};
}
