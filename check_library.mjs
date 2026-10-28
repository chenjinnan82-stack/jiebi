import assert from 'node:assert/strict';
import {PaperLibrary} from './extension/library.mjs';
import {PaperOutbox,emptyOutbox,needsHandoff,receiptFor} from './extension/outbox.mjs';
import {newSheet,editSheet,requestSheet} from './extension/sheet.mjs';
let state={};const memory={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(state[k])])),set:async v=>Object.assign(state,structuredClone(v))};
const old=newSheet();state.paper2=old;const book=new PaperLibrary(memory);let a=await book.claim('tab-a');assert.equal(a.paper.id,old.id);assert.deepEqual(state.paper2,old,'legacy retained');
a.paper=editSheet(a.paper,{...a.paper,texts:[{id:'t',author:'human',humanEdited:false,text:'保留',x:24,y:24,w:352}]});await book.save('tab-a',a.lease,a);
const b=await book.claim('tab-b');await assert.rejects(book.save('tab-a',a.lease,{...a,paper:old}),/另一处/);assert.equal(b.paper.texts[0].text,'保留');
const next=await book.claim('tab-b',null);assert.notEqual(next.paper.id,b.paper.id);assert.equal(next.paper.turns.length,0);const cards=(await book.list()).papers;assert.equal(cards.filter(p=>!p.id.startsWith('recovery:')).length,2);assert.equal(cards.filter(p=>p.id.startsWith('recovery:')).length,1);
const back=await book.claim('tab-a',b.paper.id);assert.deepEqual(back.paper,b.paper);
const workerRestart=new PaperLibrary(memory);await workerRestart.authorize('tab-a',back.lease,back.paper.id,back.paper.version);
const clone=JSON.stringify(state.library.entries);await assert.rejects(book.save('tab-a',back.lease,{...back,paper:old}),/更新/);assert.equal(JSON.stringify(state.library.entries),clone);
// One pending snapshot per paper, preserving the order and isolation of other papers.
const requests=[],box=new PaperOutbox(memory,async(path,body)=>{requests.push(body);return {protocol:'paper.v2',jobId:body.jobId,paperId:body.paperId,baseVersion:body.version,status:'ready',result:{version:body.version,decision:'pause',strokes:[],texts:[],remove:[]}};});
const req=paper=>requestSheet(paper,'test-only'),p1=back.paper,p2=editSheet(next.paper,{...next.paper,texts:structuredClone(p1.texts)});
await box.enqueue(req(p1),p1.userRevision);const p1b=editSheet(p1,p1);await box.enqueue(req(p1b),p1b.userRevision);await box.enqueue(req(p2),p2.userRevision);const p1c=editSheet(p1b,p1b);await box.enqueue(req(p1c),p1c.userRevision);
let q=await box.state();assert.equal(q.waiting.paperId,p1.id);assert.equal(q.waiting.baseVersion,p1c.version);assert.equal(q.pending[0].paperId,p2.id);
await box.tick();await box.tick();await box.tick();q=await box.state();assert.equal(requests.length,3);assert.equal(q.active,null);assert.equal(receiptFor(q,p1.id).baseVersion,p1c.version);assert.equal(receiptFor(q,p2.id).baseVersion,p2.version);assert(!needsHandoff(p1c,q));
console.log('PASS: legacy retention, tab lease, stale save rejection, new-paper context, per-paper coalescing, independent receipts');
