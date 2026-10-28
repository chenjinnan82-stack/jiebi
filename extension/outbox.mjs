// One durable active task and one replaceable waiting snapshot. Network results
// update only their own task, never overwrite edits queued while they were away.
const running=t=>t&&['submitting','queued','running'].includes(t.status);
const summary=t=>t?Object.fromEntries(Object.entries(t).filter(([k])=>!['request','transport'].includes(k))):null;
export const emptyOutbox=()=>({schema:3,active:null,waiting:null,pending:[],latest:null,latestByPaper:{},history:[],lastQueued:null,lastQueuedByPaper:{},connection:'unknown'});
export const visibleOutbox=s=>({...s,active:summary(s.active),waiting:summary(s.waiting),pending:s.pending.map(summary),history:s.history.map(summary)});
export const receiptFor=(s,id)=>s?.latestByPaper?.[id]||(s?.latest?.paperId===id?s.latest:null);
export const lastHandoffFor=(s,id)=>s?.lastQueuedByPaper?.[id]||(s?.lastQueued?.paperId===id?s.lastQueued:null);
export const needsHandoff=(p,s)=>Boolean(p.paperText?.trim()||p.texts?.some(t=>t.text.trim())||p.strokes.length||p.turns?.length)&&p.userRevision>0&&!(lastHandoffFor(s,p.id)?.userRevision>=p.userRevision)&&(p.schema!==4||JSON.stringify([p.strokes,p.texts,p.groups])!==JSON.stringify([p.baseline.strokes,p.baseline.texts,p.baseline.groups]));
function promote(s){s.active=s.waiting;s.waiting=s.pending.shift()||null;}
function remember(s,t){
 const entry={jobId:t.jobId,paperId:t.paperId,baseVersion:t.baseVersion,status:t.status,createdAt:t.createdAt,seen:false,error:t.error||'',transport:t.transport};
 s.history=[...s.history.filter(x=>x.jobId!==t.jobId),entry];s.latest=summary(t);s.latestByPaper[t.paperId]=s.latest;
}
function migrate(old){
 if(old.handoff){if(![2,3].includes(old.handoff.schema)||!Array.isArray(old.handoff.history))throw Error('交接记录无法读取，原记录已保留。');const s={...emptyOutbox(),...old.handoff,schema:3};if(s.latest?.paperId)s.latestByPaper[s.latest.paperId]=s.latest;if(s.lastQueued?.paperId)s.lastQueuedByPaper[s.lastQueued.paperId]=s.lastQueued;return s;}
 const s=emptyOutbox(),p=old.pending;s.history=(old.history||[]).map(x=>({...x,baseVersion:x.baseVersion??x.version,seen:true}));
 if(p){s.lastQueued={paperId:p.paperId,userRevision:p.baseVersion,version:p.baseVersion};if(running(p))s.active=p;else if(['ready','failed'].includes(p.status))remember(s,p);}
 return s;
}
export class PaperOutbox{
 constructor(storage,http,onChange=async()=>{}){this.storage=storage;this.http=http;this.onChange=onChange;this.serial=Promise.resolve();this.checking=null;}
 transaction(change){
  const work=this.serial.then(async()=>{const old=await this.storage.get(['handoff','pending','history']);const s=structuredClone(migrate(old));await change(s);await this.storage.set({handoff:s});await this.onChange(s);return visibleOutbox(s);});
  this.serial=work.catch(()=>{});return work;
 }
 async state(){await this.serial;const old=await this.storage.get(['handoff','pending','history']);if(!old.handoff)return this.transaction(()=>{});return visibleOutbox(migrate(old));}
 enqueue(request,userRevision,force=false,transport){
  const content=request?.protocol==='paper.v2'?Array.isArray(request.texts)&&request.context&&Boolean(request.strokes?.length||request.texts.length||request.context.turns?.length):typeof request?.paperText==='string'&&Boolean(request.strokes?.length||request.paperText.trim());
  if(!['paper.v1','paper.v2'].includes(request?.protocol)||!Number.isSafeInteger(userRevision)||userRevision<1||!Number.isSafeInteger(request.version)||userRevision>request.version||!Array.isArray(request.strokes)||!content||JSON.stringify(request).length>3000000)throw Error('这一页尚未交出，请保留纸面。');
  for(const id of [request.jobId,request.paperId])if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw Error('任务编号无效');
  return this.transaction(s=>{
   if(!force&&lastHandoffFor(s,request.paperId)?.userRevision>=userRevision)return;
   if(force&&[s.active,s.waiting,...s.pending].some(t=>t?.paperId===request.paperId))throw Error('这一页已在等待回应。');
   const t={jobId:request.jobId,paperId:request.paperId,baseVersion:request.version,userRevision,status:'submitting',createdAt:Date.now()/1000,request:structuredClone(request),transport:structuredClone(transport)};
   if(s.active){const q=[s.waiting,...s.pending].filter(Boolean),index=q.findIndex(v=>v.paperId===t.paperId);if(index<0)q.push(t);else q[index]=t;s.waiting=q.shift()||null;s.pending=q;}else s.active=t;
   s.lastQueued={paperId:request.paperId,userRevision,version:request.version};s.lastQueuedByPaper[request.paperId]=s.lastQueued;
  });
 }
 async tick(){
  if(this.checking)return this.checking;
  this.checking=(async()=>{
   await this.serial;const {handoff}=await this.storage.get('handoff');const task=structuredClone(handoff?.active);
   if(!task||task.retryAt>Date.now())return this.state();
   let response,error;try{response=task.status==='submitting'?await this.http('/api/jobs',task.request,task.transport):await this.http('/api/jobs/'+task.jobId,undefined,task.transport);}catch(e){error=e;}
   return this.transaction(s=>{
    if(s.active?.jobId!==task.jobId)return;
    if(error){
     if(error.status&&error.status<500&&![408,429].includes(error.status)){remember(s,{...task,status:'failed',error:error.message});promote(s);s.connection='online';}
     else{s.active={...s.active,error:'连接暂时中断，纸面已保存。',retryAt:Date.now()+60000};s.connection='offline';}return;
    }
    if(response?.jobId!==task.jobId||!['queued','running','ready','failed'].includes(response.status)){s.active={...s.active,error:'交接状态尚未确认，纸面已保存。',retryAt:Date.now()+60000};s.connection='offline';return;}
    s.connection='online';
    if(running(response))s.active={...response,userRevision:task.userRevision,request:task.request,transport:task.transport};
    else{remember(s,{...response,transport:task.transport});promote(s);}
   });
  })().finally(()=>{this.checking=null;});return this.checking;
 }
 seen(jobId){return this.transaction(s=>{for(const t of s.history)if(t.jobId===jobId)t.seen=true;});}
 async read(jobId){if(!/^[a-f0-9-]{36}$/.test(jobId))throw Error('任务编号无效');await this.serial;const s=migrate(await this.storage.get(['handoff','pending','history']));const saved=Object.values(s.latestByPaper).find(v=>v.jobId===jobId);if(saved)return saved;return this.http('/api/jobs/'+jobId,undefined,s.history.find(t=>t.jobId===jobId)?.transport);}
}
