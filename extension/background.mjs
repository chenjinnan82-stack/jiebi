import {PaperOutbox} from './outbox.mjs';
import {PaperLibrary} from './library.mjs';
const LOCAL='http://127.0.0.1:5331',PUBLIC='https://sanliang.online/jiebi',ALARM='paper-job';let soon=null;
async function connection(){const {connection:s}=await chrome.storage.local.get('connection');if(s)return s;const c={base:LOCAL,code:'',session:crypto.randomUUID()};await chrome.storage.local.set({connection:c});return c;}
async function http(path,body,transport){
 const s=transport||await connection();if(![LOCAL,PUBLIC].includes(s.base))throw Error('连接地址不允许');
 const headers=body?{'Content-Type':'application/json'}:{};if(s.base===PUBLIC){headers.Authorization='Bearer '+s.code;headers['X-Jiebi-Session']=s.session;}
 const r=await fetch(s.base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000),redirect:'error',credentials:'omit'});
 let data;try{data=await r.json();}catch{throw Error('连接暂时不可用');}
 if(!r.ok){const e=Error(data.error||'这一页未能交出。');e.status=r.status;throw e;}return data;
}
async function schedule(s){
 const unread=s.history.some(t=>!t.seen&&t.status==='ready'),failed=s.history.some(t=>!t.seen&&t.status==='failed');
 await chrome.action.setBadgeText({text:unread?'•':failed?'!':''});await chrome.action.setBadgeBackgroundColor({color:failed?'#8f5363':'#316c67'});
 clearTimeout(soon);soon=null;
 if(s.active){await chrome.alarms.create(ALARM,{delayInMinutes:1,periodInMinutes:1});const delay=Math.max(0,(s.active.retryAt||0)-Date.now())||(s.active.status==='submitting'?0:2000);if(delay<60000)soon=setTimeout(()=>box.tick().catch(()=>{}),delay);}
 else await chrome.alarms.clear(ALARM);
}
const box=new PaperOutbox(chrome.storage.local,http,schedule);
const library=new PaperLibrary(chrome.storage.local),mounts=new Map();
chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
const viewOf=s=>s.documentId||`${s.tab?.id??'popup'}:${s.frameId??0}`;
async function mountState(){if(chrome.storage.session){const s=await chrome.storage.session.get('mounts');for(const [k,v]of Object.entries(s.mounts||{}))mounts.set(Number(k),v);}}
const mountsReady=mountState();
async function rememberMounts(){await chrome.storage.session?.set({mounts:Object.fromEntries(mounts)});}
async function tellHost(tabId,message){if(tabId!==undefined)try{await chrome.tabs.sendMessage(tabId,message,{frameId:0});}catch{}}
async function handle(m,sender){
 if(sender.id!==chrome.runtime.id)throw Error('来源不允许');
 if(m.type==='mount'){
  if(sender.frameId!==0||!/^https?:\/\//.test(sender.url||'')||sender.tab?.id===undefined)throw Error('来源不允许');
  await mountsReady;const nonce=crypto.randomUUID();mounts.set(sender.tab.id,{nonce});await rememberMounts();
  await chrome.action.setPopup?.({tabId:sender.tab.id,popup:''});return {nonce};
 }
 if(sender.url?.split('?')[0]!==chrome.runtime.getURL('popup.html'))throw Error('来源不允许');
 if(sender.tab&&sender.frameId!==0){
  await mountsReady;const mount=mounts.get(sender.tab.id);
  if(m.type==='bind'){if(!mount||m.nonce!==mount.nonce)throw Error('纸面来源未验证');mount.frame=viewOf(sender);await rememberMounts();return {bound:true};}
  if(mount?.frame!==viewOf(sender))throw Error('纸面来源未验证');
 }
 const view=viewOf(sender);
 if(m.type==='paper-claim'){
  const result=await library.claim(view,m.paperId);
  if(result.previousView&&result.previousView!==view)chrome.runtime.sendMessage({type:'lease-revoked',view:result.previousView}).catch(()=>{});
  return {...result,view};
 }
 if(m.type==='paper-save')return library.save(view,m.lease,m.value);
 if(m.type==='paper-list')return library.list();
 if(m.type==='paper-release')return library.release(view,m.lease);
 if(m.type==='surface'){await tellHost(sender.tab?.id,{type:'jiebi-surface',expanded:Boolean(m.expanded)});return {ok:true};}
 if(m.type==='state')return {...await box.state(),paperProtocols:['paper.v1','paper.v2']};
 if(m.type==='enqueue'){await library.authorize(view,m.lease,m.request.paperId,m.request.version);return box.enqueue(m.request,m.userRevision,Boolean(m.force),await connection());}
 if(m.type==='connection-read'){const c=await connection();return {base:c.base,configured:Boolean(c.code)};}
 if(m.type==='connection-save'){
  const c=await connection();if(![LOCAL,PUBLIC].includes(m.base)||typeof m.code!=='string'||m.code.length>256)throw Error('连接设置无效');
  const code=m.code||c.code;if(m.base===PUBLIC&&!/^[A-Za-z0-9_-]{32,256}$/.test(code))throw Error('请填写评审访问码。');
  await chrome.storage.local.set({connection:{...c,base:m.base,code}});return {saved:true};
 }
 if(m.type==='read')return box.read(m.jobId);
 if(m.type==='health')return http('/api/status');
 if(m.type==='seen')return box.seen(m.jobId);
 if(m.type==='check'){const s=await box.state();box.tick().catch(()=>{});return {...s,paperProtocols:['paper.v1','paper.v2']};}
 throw Error('插件需要完成更新，请重新加载接笔。');
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{handle(m,sender).then(value=>reply({ok:true,value})).catch(e=>reply({ok:false,error:e.message}));return true;});
chrome.action.onClicked?.addListener(tab=>tellHost(tab.id,{type:'jiebi-toggle'}));
chrome.tabs?.onRemoved?.addListener(id=>{mounts.delete(id);rememberMounts().catch(()=>{});});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM)box.tick().catch(()=>{});});
const resume=async()=>{const s=await box.state();await schedule(s);};
chrome.runtime.onStartup.addListener(resume);chrome.runtime.onInstalled.addListener(resume);
