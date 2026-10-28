// The host page gets an empty mount only. All paper data lives in an extension iframe.
(()=>{
 if(window!==top||document.getElementById('jiebi-paper-mount'))return;
 const root=document.createElement('div');root.id='jiebi-paper-mount';
 const shadow=root.attachShadow({mode:'closed'}),frame=document.createElement('iframe');
 frame.title='接笔';frame.src=chrome.runtime.getURL('popup.html')+'?curtain=1';
 frame.setAttribute('allow','');frame.style.cssText='display:block;border:0;background:transparent;width:100%;height:100%;color-scheme:light';shadow.append(frame);
 root.style.cssText='all:initial;display:block!important;position:fixed!important;top:12px!important;right:12px!important;width:200px;height:60px;z-index:2147483646!important;isolation:isolate;';
 let nonce=null,expanded=false;
 const post=type=>{if(nonce)frame.contentWindow.postMessage({type,nonce},new URL(chrome.runtime.getURL('')).origin);};
 frame.onload=async()=>{try{const r=await chrome.runtime.sendMessage({type:'mount'});if(r?.ok){nonce=r.value.nonce;post('jiebi-bind');}}catch{}};
 document.documentElement.append(root);
 chrome.runtime.onMessage.addListener(m=>{
  if(m.type==='jiebi-surface'){expanded=m.expanded;root.style.width=expanded?'min(460px, calc(100vw - 24px))':'200px';root.style.height=expanded?'min(590px, calc(100vh - 24px))':'60px';}
  if(m.type==='jiebi-toggle')post('jiebi-toggle');
 });
 document.addEventListener('pointerdown',e=>{if(expanded&&!e.composedPath().includes(root))post('jiebi-hide');},true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)post('jiebi-hide');});
 window.addEventListener('pagehide',()=>post('jiebi-hide'));
})();
