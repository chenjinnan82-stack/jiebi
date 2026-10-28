import assert from 'node:assert/strict';
import {PaperOutbox,needsHandoff,emptyOutbox} from './extension/outbox.mjs';
import {newPaper,applyJob,undoPaper} from './extension/paper.mjs';
import {newSheet,snapshot,editSheet,undoSheet} from './extension/sheet.mjs';
const memory=(seed={})=>{let saved=structuredClone(seed);return {get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(saved[k])])),set:async v=>Object.assign(saved,structuredClone(v))};};
const storage=memory();let calls=[],resolveHttp,mode='defer';
const http=async(path,body)=>{calls.push({path,body});if(mode==='defer')return new Promise(r=>resolveHttp=r);if(mode==='lost')throw TypeError('acknowledgement lost');if(mode==='fail'){const e=Error('invalid');e.status=422;throw e;}return {protocol:'paper.v1',jobId:path.split('/').at(-1),status:'running'};};
let box=new PaperOutbox(storage,http),p=newPaper();p.version=p.userRevision=1;p.paperText='测试原话';
const request=(version=1)=>({protocol:'paper.v1',jobId:crypto.randomUUID(),paperId:p.id,version,strokes:[],groups:[],paperText:p.paperText,paperNotes:[],image:'test-only'});
const a=request();let state=await box.enqueue(a,1);assert.equal(calls.length,0);assert(!needsHandoff(p,state));
const blocked=box.tick();await new Promise(setImmediate);assert.equal(calls.length,1);
const b=request(2),c=request(3);await box.enqueue(b,2);await box.enqueue(c,3);
assert.equal((await box.state()).waiting.jobId,c.jobId);assert.equal(calls.length,1,'local close must not wait for HTTP');
resolveHttp({protocol:'paper.v1',jobId:a.jobId,paperId:p.id,baseVersion:1,status:'queued'});await blocked;
assert.equal((await box.state()).waiting.jobId,c.jobId,'HTTP response must not overwrite the newer waiting snapshot');
const finishing=box.tick();await new Promise(setImmediate);
resolveHttp({protocol:'paper.v1',jobId:a.jobId,paperId:p.id,baseVersion:1,status:'ready',result:{version:1,strokes:[],remove:[],note:'只写一句话'}});await finishing;
state=await box.state();assert.equal(state.active.jobId,c.jobId);assert.equal(state.waiting,null);assert.equal(state.history.length,1);
const answered=applyJob(p,state.latest);assert.equal(answered.userRevision,1);assert(!needsHandoff(answered,state));
const undone=undoPaper(answered,p);assert.equal(undone.userRevision,3);
// A different paper's receipt cannot suppress edits.
assert(needsHandoff({...answered,id:crypto.randomUUID(),userRevision:2},state));
mode='lost';await box.tick();assert.equal((await box.state()).active.status,'submitting');assert.equal((await box.state()).connection,'offline');
const offlineCalls=calls.length;await box.tick();assert.equal(calls.length,offlineCalls,'offline reopen must not poll faster than the retry deadline');
box=new PaperOutbox(storage,http);assert.equal((await box.state()).active.jobId,c.jobId);
let data=await storage.get('handoff');data.handoff.active.retryAt=0;await storage.set(data);mode='fail';await box.tick();
assert.equal((await box.state()).latest.status,'failed');assert.equal((await box.state()).active,null);
const failCalls=calls.length;await box.tick();assert.equal(calls.length,failCalls,'explicitly failed generation must not retry automatically');
assert.equal(calls.filter(x=>x.body?.jobId===b.jobId).length,0,'replaced waiting snapshot was never sent');
assert.deepEqual(calls.filter(x=>x.body?.jobId===c.jobId).map(x=>x.body),[c,c],'unknown receipt retries exactly the same ID and content');
await box.seen(a.jobId);assert((await box.state()).history.find(t=>t.jobId===a.jobId).seen);
const legacy=memory({pending:{...a,baseVersion:1,status:'collected'},history:[{jobId:a.jobId,status:'ready'}]});const legacyBox=new PaperOutbox(legacy,()=>{throw Error('migration invoked network');});
assert.equal((await legacyBox.state()).active,null);assert.equal((await legacy.get('pending')).pending.status,'collected');
const noSpace=new PaperOutbox({get:memory().get,set:async()=>{throw Error('quota');}},http);await assert.rejects(noSpace.enqueue(request(),1),/quota/);
// v2 carries exact snapshots and context through the unchanged durable queue.
const v2store=memory({paper:{schema:3,id:'legacy-kept'}}),v2calls=[];
let v2offline=true;
let v2box=new PaperOutbox(v2store,async(path,body)=>{v2calls.push({path,body});if(v2offline)throw TypeError('offline');return {protocol:'paper.v2',jobId:body.jobId,paperId:body.paperId,baseVersion:body.version,status:'ready',result:{decision:'pause',strokes:[],texts:[],remove:[],version:body.version},paper:{texts:body.texts,strokes:[],groups:[]},context:body.context};});
const v2={...request(),protocol:'paper.v2',texts:[{id:'human-text',author:'human',humanEdited:false,text:'保留原文',x:24,y:24,w:352}],context:{turns:[],changes:[]}};
await v2box.enqueue(v2,1);await v2box.tick();assert.equal(v2calls.length,1);v2box=new PaperOutbox(v2store,v2box.http);await v2box.tick();assert.equal(v2calls.length,1);
const recovered=await v2store.get('handoff');recovered.handoff.active.retryAt=0;await v2store.set(recovered);v2offline=false;await v2box.tick();assert.deepEqual(v2calls[0].body,v2calls[1].body);
const v2state=await v2box.state();assert.equal(v2state.latest.result.decision,'pause');assert.equal(v2state.active,null);assert(!needsHandoff({id:p.id,userRevision:1,strokes:[],texts:v2.texts},v2state));assert.deepEqual((await v2store.get('paper')).paper,{schema:3,id:'legacy-kept'});
// Undoing a human edit back to the actually presented paper has nothing to hand over.
const settled={...newSheet(),version:2,userRevision:1,texts:structuredClone(v2.texts)};settled.baseline=snapshot(settled);
const resized=editSheet(settled,{...settled,texts:settled.texts.map(t=>({...t,w:440}))});
assert(needsHandoff(resized,emptyOutbox()));assert(!needsHandoff(undoSheet(resized,settled),emptyOutbox()));
assert(!needsHandoff({...settled,version:3,userRevision:3},emptyOutbox()));
const retryBox=new PaperOutbox(memory(),http);await retryBox.enqueue({...v2,jobId:crypto.randomUUID()},1,true);assert((await retryBox.state()).active,'explicit retry stays available');
// Actual worker listener and alarm wiring. No real Chrome process is simulated here.
let listeners={},badge='',alarms=0;const chromeStorage=memory();
globalThis.chrome={storage:{local:chromeStorage},action:{setBadgeText:async v=>badge=v.text,setBadgeBackgroundColor:async()=>{}},alarms:{create:async()=>alarms++,clear:async()=>{},onAlarm:{addListener:f=>listeners.alarm=f}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:f=>listeners.message=f},onStartup:{addListener:f=>listeners.startup=f},onInstalled:{addListener:f=>listeners.installed=f}}};
globalThis.setTimeout=()=>1;globalThis.clearTimeout=()=>{};let fetches=0;
globalThis.fetch=async()=>{fetches++;return new Response(JSON.stringify({protocol:'paper.v1',jobId:a.jobId,paperId:a.paperId,baseVersion:1,status:'ready',result:{note:'mock'}}));};
await import('./extension/background.mjs?test=fold');
const send=(m,sender={id:'test',url:'chrome-extension://test/popup.html'})=>new Promise(resolve=>listeners.message(m,sender,resolve));
const claim=await send({type:'paper-claim'});const current=claim.value;current.paper={...current.paper,id:a.paperId,version:1,userRevision:1};
// The worker rejects calls without a live saved editor; queue tests above cover valid content.
assert(!(await send({type:'enqueue',request:a,userRevision:1})).ok);
await chromeStorage.set({library:{schema:1,currentId:a.paperId,entries:{[a.paperId]:{paper:current.paper}},lease:{view:'popup:0',token:'test-lease',id:a.paperId}}});
assert((await send({type:'enqueue',lease:'test-lease',request:a,userRevision:1})).ok);assert.equal(fetches,0);assert(alarms>0,'wake-up alarm saved before acknowledging local enqueue');
await listeners.alarm({name:'paper-job'});await new Promise(setImmediate);await new Promise(setImmediate);
assert.equal(fetches,1);assert.equal(badge,'•');
assert((await send({type:'seen',jobId:a.jobId})).ok);assert.equal(badge,'');
assert(!(await send({type:'state'},{id:'evil',url:'chrome-extension://test/popup.html'})).ok);
await chromeStorage.set({handoff:{...emptyOutbox(),active:{...a,status:'submitting',request:a,retryAt:Date.now()+60000}}});
alarms=0;await listeners.startup();assert(alarms>0);assert.equal(fetches,1,'startup restores the wake-up alarm without repeating a call');
// Host page messages cannot read the paper or bind a forged editor iframe.
const host={id:'test',url:'https://example.com/',frameId:0,tab:{id:7}},frame={id:'test',url:'chrome-extension://test/popup.html?curtain=1',frameId:2,documentId:'editor-a',tab:{id:7}};
assert(!(await send({type:'state'},host)).ok);assert(!(await send({type:'enqueue',request:a,userRevision:1},host)).ok);
const mount=await send({type:'mount'},host);assert(mount.ok);
assert(!(await send({type:'bind',nonce:'forged'},frame)).ok);
assert((await send({type:'bind',nonce:mount.value.nonce},frame)).ok);
assert((await send({type:'state'},frame)).ok);
assert(!(await send({type:'state'},{...frame,documentId:'another-frame'})).ok);
// A changed unpacked popup must reload an old worker once, not enter a reload loop.
let reloads=0;chrome.runtime.sendMessage=async()=>({ok:true,value:null});chrome.runtime.reload=()=>reloads++;
const platform=await import('./extension/platform.mjs?test=upgrade');
await assert.rejects(platform.rpc('check'),/更新/);await assert.rejects(platform.rpc('check'),/更新/);assert.equal(reloads,1);
console.log('PASS: fast local enqueue, latest-only waiting snapshot, concurrent HTTP merge, no AI reply loop, offline pacing, same-ID retry, worker restart, explicit failure, migration, quota protection, sender and badge wiring (mock APIs)');
