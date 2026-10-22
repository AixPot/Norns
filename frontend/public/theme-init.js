// Synchronous same-origin anonymous bootstrap. Account identity is known only after /api/me.
(function(){
 var mode='system',palette='blue';
 try{var saved=localStorage.getItem('norns.theme.anonymous');if(['light','dark','system'].includes(saved))mode=saved;var color=localStorage.getItem('norns.theme.anonymous.palette');if(['blue','iris','clay','graphite'].includes(color))palette=color}catch(_){}
 var value=mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):mode;
 var root=document.documentElement;root.dataset.theme=value;root.dataset.palette=palette;root.style.colorScheme=value;
 var favicon=document.querySelector('link[rel="icon"][type="image/svg+xml"]');if(favicon)favicon.href="/brand/favicon-"+palette+"-"+value+".svg";
 var meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=value==='dark'?(palette==='clay'?'#1c1b1a':'#191b20'):'#f6f7f9';
})();
