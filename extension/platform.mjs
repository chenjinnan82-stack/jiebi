import {PaperOutbox,visibleOutbox} from './outbox.mjs';
import {PaperLibrary} from './library.mjs';
export const isExtension=typeof chrome!=='undefined'&&Boolean(chrome.runtime?.id);
const listeners=[];
export const storage=isExtension?chrome.storage.local:{
 async get(keys){const all=JSON.parse(localStorage.getItem('jiebi.extension-preview.v1')||'{}');return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,all[k]]));},
 async set(values){const all=JSON.parse(localStorage.getItem('jiebi.extension-preview.v1')||'{}');localStorage.setItem('jiebi.extension-preview.v1',JSON.stringify({...all,...values}));if(values.handoff)queueMicrotask(()=>listeners.forEach(fn=>fn(visibleOutbox(values.handoff))));}
};
async function http(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});const data=await r.json();if(!r.ok){const e=Error(data.error||'交接服务未连接');e.status=r.status;throw e;}return data;}
const preview=isExtension?null:new PaperOutbox(storage,http);
const previewLibrary=isExtension?null:new PaperLibrary(storage),previewView='preview-'+crypto.randomUUID();
export async function rpc(type,extra={}){
 if(isExtension){
  const r=await chrome.runtime.sendMessage({type,...extra});
  if(['check','state'].includes(type)&&(!r?.ok||r.value?.schema!==3||!r.value.paperProtocols?.includes('paper.v2'))){
   // An unpacked popup can change on disk while its old worker is still registered.
   const {paperV2Reloaded}=await storage.get('paperV2Reloaded');
   if(!paperV2Reloaded){await storage.set({paperV2Reloaded:true});chrome.runtime.reload();}
   throw Error('插件更新尚未完成，请重新加载接笔。');
  }
  if(!r?.ok)throw Error(r?.error||'交接暂时不可用');return r.value;
 }
 if(type==='state')return preview.state();
 if(type==='check'){const s=await preview.state();preview.tick().catch(()=>{});return s;}
 if(type==='enqueue')return preview.enqueue(extra.request,extra.userRevision,extra.force);
 if(type==='seen')return preview.seen(extra.jobId);
 if(type==='read')return preview.read(extra.jobId);
 if(type==='health')return http('/api/status');
 if(type==='paper-claim')return {...await previewLibrary.claim(previewView,extra.paperId),view:previewView};
 if(type==='paper-list')return previewLibrary.list();
 if(type==='paper-save')return previewLibrary.save(previewView,extra.lease,extra.value);
 if(type==='paper-release')return previewLibrary.release(previewView,extra.lease);
 if(type==='surface')return {};
 if(type==='connection-read')return {base:'http://127.0.0.1:5331',configured:false};
 if(type==='connection-save')throw Error('开发预览只连接本机；请在插件中设置评审连接。');
 throw Error('未知交接操作');
}
export function watchPending(fn){if(isExtension)chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.handoff)fn(visibleOutbox(changes.handoff.newValue));});else listeners.push(fn);}
// Preview polling lives only while a development page is open. It is not a Chrome worker.
if(!isExtension){const timer=setInterval(()=>preview.tick().catch(()=>{}),2000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});}
export function closeView(){window.dispatchEvent(new Event('jiebi-close'));}
