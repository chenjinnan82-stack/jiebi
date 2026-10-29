// One runnable check for shared-paper invariants and actual popup event handlers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as rules from './extension/sheet.mjs';
import {validatePaper,previewJob} from './extension/paper.mjs';
import {emptyOutbox,needsHandoff,receiptFor,lastHandoffFor} from './extension/outbox.mjs';
let p=rules.newSheet();p=rules.editSheet(p,{...p,texts:[{id:'htext',author:'human',humanEdited:false,text:'本来想一起喝点东西。',x:24,y:24,w:352}],strokes:[{id:'h1',author:'human',humanEdited:false,points:[[100,100],[200,100]]}]});
const job=(p,result)=>({protocol:'paper.v2',status:'ready',jobId:crypto.randomUUID(),paperId:p.id,baseVersion:p.version,paper:rules.snapshot(p),context:{changes:rules.differences(p.baseline,p)},result:{version:p.version,decision:'contribute',strokes:[],texts:[],remove:[],...result}});
const reply=job(p,{strokes:[{id:'a1',author:'ai',humanEdited:false,points:[[240,160],[320,160]]}],texts:[{id:'atext',author:'ai',humanEdited:false,text:'留个位置。',x:250,y:190,w:220}]});
let n=rules.applySheetJob(p,reply);assert.equal(n.turns.length,1);assert.deepEqual(n.baseline,rules.snapshot(n));assert.equal(rules.applySheetJob(n,reply),n);
assert.throws(()=>rules.applySheetJob({...p,version:99},reply));
n=rules.editSheet(n,rules.groupItems(n,['a1','h1','htext']));let moved=rules.moveItems(n,['h1'],12,10);assert(moved);assert.equal(moved.texts[0].x,36);assert(moved.strokes.find(s=>s.id==='a1').humanEdited);assert.equal(rules.moveItems(n,['h1'],500,0),null);
moved=rules.editSheet(n,moved);const original=JSON.stringify(moved);assert.throws(()=>rules.applySheetJob(moved,job(moved,{remove:['a1']})));assert.equal(JSON.stringify(moved),original);
assert.throws(()=>rules.applySheetJob(moved,job(moved,{remove:['htext']})));
let erased=rules.editSheet(moved,rules.eraseItems(moved,['a1'],false));const edits=rules.requestSheet(erased,'').context.changes;assert.deepEqual(edits.find(e=>e.type==='erase').before.points,[[240,160],[320,160]]);assert(edits.some(e=>e.type==='change'&&e.before.x===24&&e.after.x===36));
let pause=job(erased,{decision:'pause'}),paused=rules.applySheetJob(erased,pause);assert.equal(paused.turns.length,2);assert.deepEqual(rules.snapshot(paused),rules.snapshot(erased));assert.equal(needsHandoff(paused,{lastQueued:{paperId:paused.id,userRevision:paused.userRevision}}),false);
const undo=rules.undoSheet(paused,erased);assert.equal(undo.turns.length,2);assert(undo.appliedJobs.includes(pause.jobId));
const atomic=job(erased,{remove:['atext'],texts:[{id:'bad',author:'ai',humanEdited:false,text:'不能越界',x:570,y:560,w:100}]});assert.throws(()=>rules.applySheetJob(erased,atomic));assert(erased.texts.some(t=>t.id==='atext'));
assert.throws(()=>rules.applySheetJob(erased,job(erased,{decision:'pause',remove:['atext']})));
assert.equal(rules.textLines({text:'ab你好',w:44}).length,2);assert.equal(rules.bounds({text:'ab你好',x:12,y:12,w:88}).b,40);
assert.throws(()=>rules.validateSnapshot({...rules.snapshot(p),texts:[{...p.texts[0],id:undefined}]}));
assert.throws(()=>rules.validateSnapshot({...rules.snapshot(p),groups:[{id:undefined,itemIds:['h1']}]}));
const collision=job(p,{texts:[{id:'colliding',author:'ai',humanEdited:false,text:'相撞',x:24,y:24,w:88}]});assert.throws(()=>rules.applySheetJob(p,collision));assert.equal(rules.previewSheetJob(collision).texts.length,2,'historical previews remain readable after a stricter layout rule');
console.log('PASS: mixed groups, move protection, atomic rejection, complete before/after, presented-only history, pause, whole-reply undo');

const document={body:{dataset:{}},activeElement:null,listeners:{},addEventListener(k,fn){const previous=this.listeners[k];this.listeners[k]=previous?e=>{previous(e);fn(e);}:fn;}};
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.style={setProperty(){}};this.offsetHeight=510;this.dataset={};this.attrs={};this.value='';this.hidden=false;}
 set textContent(s){this.text=s;this.children=[];}get textContent(){return this.text;}
 append(...els){this.children.push(...els);}setAttribute(k,v){this.attrs[k]=v;}focus(){document.activeElement=this;}
 setSelectionRange(){}setPointerCapture(){}getBoundingClientRect(){return {left:0,top:0,width:612,height:612};}getContext(){return context;}contains(){return false;}toDataURL(){return 'data:image/png;base64,TEST';}
}
const context=new Proxy({isPointInStroke(p,x,y){const xs=p.points.map(p=>p[0]),ys=p.points.map(p=>p[1]);return x>=Math.min(...xs)-7&&x<=Math.max(...xs)+7&&y>=Math.min(...ys)-7&&y<=Math.max(...ys)+7;}},{get(o,k){return k in o?o[k]:()=>{};}});
class Path2D{constructor(){this.points=[];}moveTo(...p){this.points.push(p);}lineTo(...p){this.points.push(p);}quadraticCurveTo(...p){this.points.push(p.slice(-2));}bezierCurveTo(...p){this.points.push(p.slice(-2));}}
const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const tools=['text','draw','select','erase'].map(t=>{const e=new Element('button');e.dataset.tool=t;return e;});
el('paper-stack').hidden=true;document.activeElement=new Element();document.getElementById=el;document.createElement=t=>new Element(t);document.querySelectorAll=()=>tools;
let writes=[],closed=0,receiver,releaseGate=null,claimGate=null,claims=0;const initial=rules.newSheet();initial.strokes=[100,200,300].map((x,i)=>({id:'h'+i,author:'human',humanEdited:false,points:[[x,80],[x,120]]}));initial.texts=[{id:'a-text',author:'ai',humanEdited:false,text:'原来的回应',x:24,y:24,w:352}];initial.groups=[{id:'g1',itemIds:['h0','h1']}];
const source=readFileSync('extension/popup.mjs','utf8').replace(/^import .*\n/gm,'');
const fakeWindow={listeners:{},parent:null,addEventListener(k,f){this.listeners[k]=f;}};fakeWindow.parent=fakeWindow;let fakeLease='test',mockEntry={paper:initial,undo:null,draft:null,lastText:'a-text',recipient:'builtin',lease:fakeLease,view:'test'};
const ui=await vm.runInNewContext('(async()=>{'+source+';await openPaper();return {paper:()=>paper,gesture:()=>gesture,finishEditor,startEditor,fold,openPaper,collapse,lease:()=>lease,expanded:()=>expanded};})()',{...rules,validatePaper,previewJob,emptyOutbox,needsHandoff,receiptFor,lastHandoffFor,isExtension:false,window:fakeWindow,location:{search:''},matchMedia:()=>({matches:true}),getComputedStyle:()=>({getPropertyValue:()=>1}),cancelAnimationFrame(){},setTimeout(fn){fn();return 1;},document,Path2D,ResizeObserver:class{observe(){}},structuredClone,crypto,performance,console:{info(){}},storage:{async get(){return {paper2:initial,lastText2:'a-text'};},async set(d){writes.push(structuredClone(d));}},rpc:async(type,v)=>{if(type==='paper-claim'){if(claimGate)await claimGate;return {...structuredClone(mockEntry),lease:'lease-'+(++claims)};}if(type==='paper-save'){mockEntry={...mockEntry,...structuredClone(v.value)};writes.push({paper2:mockEntry.paper,editorDraft2:mockEntry.draft});return {saved:true};}if(type==='surface'&&!v.expanded)closed++;if(type==='paper-release'){if(releaseGate)await releaseGate;return {};}return emptyOutbox();},watchPending(fn){receiver=fn;},closeView(){closed++;},requestAnimationFrame(fn){fn();}});
ui.finishEditor();assert.equal(ui.paper().version,0,'opening AI text is not a human edit');assert.equal(ui.paper().texts[0].humanEdited,false);
ui.startEditor(ui.paper().texts[0]);el('text-editor').value='我改后的原话';el('text-editor').oninput();assert.equal(ui.paper().texts[0].humanEdited,true);assert.equal(writes.at(-1).editorDraft2,null);
el('text-width').value=440;el('text-width').oninput();assert.equal(ui.paper().texts[0].w,440);assert.equal(writes.at(-1).paper2.texts[0].w,440);assert.equal(ui.paper().texts[0].text,'我改后的原话');
el('text-editor').value='长'.repeat(2000);el('text-editor').oninput();assert.equal(ui.paper().texts[0].text,'我改后的原话');assert.equal(writes.at(-1).editorDraft2.text.length,2000);assert.equal(ui.finishEditor(),false);
el('text-editor').value='我改后的原话';el('text-editor').oninput();assert.equal(ui.finishEditor(),true);
const event=(x,y=100)=>({button:0,ctrlKey:false,pointerId:1,clientX:x,clientY:y});
ui.startEditor(ui.paper().texts[0]);const beforeComposition=ui.paper().texts[0].text;el('text-editor').oncompositionstart();el('text-editor').value='输入法候选';el('text-editor').oninput();assert.equal(ui.paper().texts[0].text,beforeComposition);assert.equal(writes.at(-1).editorDraft2.text,'输入法候选');await ui.fold();assert.equal(closed,0,'IME composition cannot hand off an unfinished phrase');el('text-editor').oncompositionend();assert.equal(ui.paper().texts[0].text,'输入法候选');el('finish-text').onclick();assert(el('edit-actions').hidden);
el('roll-handle').onpointerdown(event(300,500));el('roll-handle').onpointermove(event(300,465));el('roll-handle').onpointerup(event(300,465));assert.equal(closed,0,'short roll gesture does not send');
el('roll-handle').onpointerdown(event(300,500));el('roll-handle').onpointermove(event(300,400));assert.equal(el('curtain').dataset.armed,'true');el('roll-handle').onpointercancel();el('roll-handle').onclick();assert.equal(el('curtain').dataset.armed,'false');assert.equal(closed,0,'cancelled roll and trailing click do not send');
el('mode-draw').onclick();assert.equal(el('mode-draw').attrs['aria-pressed'],true);el('mode-text').onclick();assert.equal(el('mode-text').attrs['aria-pressed'],true);
for(const key of ['t','p','v','e'])document.listeners.keydown({key,target:{closest:()=>true},preventDefault(){}});assert.equal(el('mode-text').attrs['aria-pressed'],true,'connection fields must not trigger paper shortcuts');
el('mode-edge').onpointerdown(event(20,580));el('mode-edge').onpointerup(event(90,580));assert.equal(el('mode-word').textContent,'画画');
el('paper').onpointerdown(event(80,250));el('paper').onpointermove(event(300,250));el('paper').onpointerup();assert.equal(el('mode-word').textContent,'画画','horizontal drawing never switches mode');el('undo').onclick();assert.equal(ui.paper().strokes.length,3);
tools[3].onclick();
const version=ui.paper().version;el('paper').onpointerdown(event(100));el('paper').onpointermove(event(220));assert.equal(ui.paper().strokes.length,3);el('paper').onpointerup();assert.equal(ui.paper().strokes.length,1);assert.equal(ui.paper().version,version+1);el('undo').onclick();assert.deepEqual(ui.paper().strokes,initial.strokes);assert.deepEqual(ui.paper().groups,initial.groups);
const restored=JSON.stringify(ui.paper());el('paper').onpointerdown(event(300));el('paper').onpointercancel();assert.equal(JSON.stringify(ui.paper()),restored);
const incoming=job(ui.paper(),{decision:'pause'});receiver({...emptyOutbox(),latest:incoming,history:[{jobId:incoming.jobId,seen:false}]});assert.equal(JSON.stringify(ui.paper()),restored,'incoming reply must not write while editor is open');assert.match(el('status').textContent,/下次打开/);
el('paper').onpointerdown(event(100));document.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(ui.gesture(),null);assert.equal(closed,0);
el('more').hidden=false;document.listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(el('more').hidden,true);assert.equal(closed,0);
document.listeners.keydown({key:'Escape',preventDefault(){}});await new Promise(setImmediate);assert.equal(closed,1);
console.log('PASS: actual popup text editing, overflow draft recovery, drag erase/undo, no surprise reply, Escape-only save');

// Rendering a valid quadratic reply must finish, including its text.
let printed=[];rules.paintSheet({getContext:()=>new Proxy({fillText(t){printed.push(t);}}, {get:(o,k)=>k in o?o[k]:(...args)=>{assert(args.every(v=>Array.isArray(v)||Number.isFinite(v)));}})}, {...rules.newSheet(),strokes:[{id:'q',author:'ai',points:[[100,100],[120,80],[140,100]],curves:[[[100,100],[120,80],[140,100]]]}],texts:[{id:'t',author:'ai',text:'回应',x:200,y:200,w:88}]});assert.equal(printed.join(''),'回应');

// A delayed close must never release the newly reopened editor's lease.
await ui.openPaper();let releaseDone;releaseGate=new Promise(r=>releaseDone=r);
const closing=ui.collapse();assert.equal(ui.lease(),null);await ui.openPaper();const reopened=ui.lease();
releaseDone();releaseGate=null;await closing;assert.equal(ui.lease(),reopened);assert(ui.expanded());
await ui.collapse();let claimDone;claimGate=new Promise(r=>claimDone=r);
const openingAgain=ui.openPaper();await new Promise(setImmediate);await ui.collapse();claimDone();claimGate=null;await openingAgain;
assert.equal(ui.lease(),null);assert(!ui.expanded(),'late claim cannot resurrect a closed paper');
console.log('PASS: interrupted opening and reversed close preserve the current editing lease');
