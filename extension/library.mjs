import {newSheet,validateSheet} from './sheet.mjs';
const copy=structuredClone;
const entry=paper=>({paper,undo:null,draft:null,lastText:null,recipient:'builtin',updatedAt:Date.now()});
// One writer across all tabs. The worker owns the lease; a stale iframe cannot save.
export class PaperLibrary{
 constructor(storage){this.storage=storage;this.serial=Promise.resolve();this.lease=null;}
 transaction(fn){const p=this.serial.then(async()=>{
  const old=await this.storage.get(['library','paper2','undo2','editorDraft2','lastText2']);let s=copy(old.library);
  if(!s){const p=old.paper2?validateSheet(old.paper2):newSheet();s={schema:1,currentId:p.id,entries:{[p.id]:{...entry(p),undo:old.undo2||null,draft:old.editorDraft2||null,lastText:old.lastText2||null}}};}
  if(s.schema!==1||!s.entries?.[s.currentId])throw Error('纸叠无法读取，原稿已保留。');
  this.lease=s.lease||null;const result=await fn(s);s.lease=this.lease;await this.storage.set({library:s});return copy(result);
 });this.serial=p.catch(()=>{});return p;}
 list(){return this.transaction(s=>({currentId:s.currentId,papers:[...Object.values(s.recoveries||{}).map(e=>({id:'recovery:'+e.view,text:'待恢复的草稿',strokes:e.paper.strokes,texts:e.paper.texts,updatedAt:e.updatedAt})),...Object.values(s.entries).map(e=>({id:e.paper.id,text:e.paper.texts[0]?.text||'',strokes:e.paper.strokes,texts:e.paper.texts,updatedAt:e.updatedAt})).sort((a,b)=>b.updatedAt-a.updatedAt)]}));}
 claim(view,id){return this.transaction(s=>{
  if(typeof id==='string'&&id.startsWith('recovery:')){const r=s.recoveries?.[id.slice(9)];if(!r)throw Error('找不到这份草稿。');const p={...newSheet(),strokes:r.paper.strokes,texts:r.paper.texts,groups:r.paper.groups,version:1,userRevision:1};for(const i of [...p.strokes,...p.texts])i.humanEdited=true;s.entries[p.id]={...entry(p),draft:r.draft};delete s.recoveries[id.slice(9)];id=p.id;}
  if(id!==undefined){if(id===null){const p=newSheet();s.entries[p.id]=entry(p);s.currentId=p.id;}else if(s.entries[id])s.currentId=id;else throw Error('找不到这张纸。');}
  const previousView=this.lease?.view,token=crypto.randomUUID();this.lease={view,token,id:s.currentId};return {...s.entries[s.currentId],lease:token,previousView};
 });}
 async save(view,token,value){const result=await this.transaction(s=>{
  const p=validateSheet(value.paper),old=s.entries[p.id];
  if(value.draft&&(typeof value.draft.text!=='string'||value.draft.text.length>2000))throw Error('草稿过长，尚未保存。');
  if(this.lease?.view!==view||this.lease.token!==token||this.lease.id!==p.id||!old||p.version<old.paper.version){s.recoveries??={};s.recoveries[view]={...entry(p),view,draft:value.draft||null};return {error:'纸已在另一处更新；未覆盖新内容，草稿留在纸叠中。'};}
  if(!['builtin','external'].includes(value.recipient))throw Error('助手连接无效。');
  if(value.undo)validateSheet(value.undo);
  s.entries[p.id]={...entry(p),undo:value.undo||null,draft:value.draft||null,lastText:value.lastText||null,recipient:value.recipient};return {saved:true};
 });if(result.error)throw Error(result.error);return result;}
 authorize(view,token,id,version){return this.transaction(s=>{if(this.lease?.view!==view||this.lease.token!==token||this.lease.id!==id||s.entries[id]?.paper.version!==version)throw Error('纸面已更新，请重新打开后再交出。');return true;});}
 release(view,token){return this.transaction(()=>{if(this.lease?.view===view&&this.lease.token===token)this.lease=null;return {released:true};});}
}
