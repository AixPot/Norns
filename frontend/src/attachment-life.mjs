export function lifetime(){let active=true;return {current:()=>active,stop:()=>{active=false}}}
