import {storage,rpc,watchPending,closeView,isExtension} from './platform.mjs';
import {validatePaper,previewJob} from './paper.mjs';
import {newSheet,validateSheet,items,bounds,textLines,layoutWarnings,editSheet,selectedMembers,moveItems,eraseItems,groupItems,undoSheet,applySheetJob,previewSheetJob,requestSheet,strokePath,paintSheet} from './sheet.mjs';
import {emptyOutbox,needsHandoff,receiptFor,lastHandoffFor} from './outbox.mjs';
const $=id=>document.getElementById(id),canvas=$('paper'),editor=$('text-editor'),clone=structuredClone;
let paper=newSheet(),undo=null,selection=[],tool='text',gesture=null,outbox=emptyOutbox(),folding=false,saving=Promise.resolve(),canSave=true,ready=false,paintQueued=false,foldSamples=[],editing=null,editDirty=false,draft=null,lastText=null,viewed=null;
let hitVersion=-1,hitPaths=new Map();
let lease=null,view=null,recipient='builtin',expanded=false,composing=false,reveal=null,revealFrame=0,opening=0,inputMode='text',presentedNow=false;
const embedded=isExtension&&window.parent!==window,curtain=$('curtain'),body=$('paper-body');
document.body.dataset.embedded=String(embedded);document.body.dataset.preview=String(!isExtension);
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const notice=t=>$('status').textContent=t;
// Each edit starts its storage write now, rather than waiting in a popup-owned queue.
function persist(){if(!lease)return Promise.resolve();const pending=draft?.text.trim()&&!paper.texts.some(t=>t.id===draft.id&&t.text===draft.text&&t.x===draft.x&&t.y===draft.y&&t.w===draft.w)?draft:null;
 const value=clone({paper,undo,draft:pending,lastText,recipient});saving=rpc('paper-save',{lease,value}).catch(e=>{canSave=false;notice(e.message||'本机存储未成功，请保留窗口。');controls();});return saving;}

function commit(next,keepUndo=false){if(!canSave)return;next=editSheet(paper,next);if(!keepUndo)undo=clone(paper);paper=next;persist();render();notice(layoutWarnings(paper).length?'有文字相撞，调整宽度或挪开即可。':'');}
function paint(){paintSheet(canvas,gesture?.preview??paper,{selection,gesture,hideText:editing?.id,reveal});}
function stopReveal(){if(reveal){reveal=null;cancelAnimationFrame(revealFrame);queuePaint();}}
function queuePaint(){if(paintQueued)return;paintQueued=true;requestAnimationFrame(()=>{paintQueued=false;paint();});}
function isOneGroup(){return paper.groups.some(g=>g.itemIds.length===selection.length&&g.itemIds.every(id=>selection.includes(id)));}
function controls(){
 $('group').hidden=selection.length<2;$('group').textContent=isOneGroup()?'拆组':'编组';$('group').disabled=folding||!canSave;
 $('undo').disabled=!undo||folding||!canSave;$('close').disabled=!ready||!canSave||Boolean(gesture)||folding;editor.disabled=folding||!canSave;
 $('retry').hidden=receiptFor(outbox,paper.id)?.status!=='failed'||[outbox.active,outbox.waiting,...outbox.pending].some(t=>t?.paperId===paper.id);
 const unread=outbox.history.some(t=>!t.seen);$('more-toggle').dataset.unread=unread;$('more-toggle').setAttribute('aria-label',unread?'更多，有未读回应':'更多');
 updatePhase();canvas.dataset.tool=tool;document.querySelectorAll('nav [data-tool]').forEach(b=>{b.disabled=!ready||folding||!canSave;b.setAttribute('aria-pressed',b.dataset.tool===tool);});
}
function render(){$('paper-reading').textContent=paper.texts.map(t=>(t.author==='human'?'你：':t.humanEdited?'你改过的助手文字：':'助手：')+t.text).join('。');selection=selection.filter(id=>items(paper).some(s=>s.id===id));controls();queuePaint();}
function placeEditor(){if(!editing)return;const scale=canvas.getBoundingClientRect().width/612,t={...editing,text:editor.value||' '};Object.assign(editor.style,{left:t.x*scale+'px',top:t.y*scale+'px',width:t.w*scale+'px',height:Math.max(28,textLines(t).length*28)*scale+3+'px',fontSize:22*scale+'px',lineHeight:28*scale+'px',maxHeight:(612-t.y)*scale+'px'});$('text-sizing').hidden=false;$('text-width').max=600-t.x;$('text-width').value=t.w;}
function startEditor(t){
 if(!finishEditor())return;stopReveal();selection=[];editing=clone(t);editDirty=false;lastText=t.id;editor.value=t.text;editor.hidden=false;placeEditor();queuePaint();editor.focus({preventScroll:true});editor.setSelectionRange(t.text.length,t.text.length);
}
function updateText(){
 if(!editing)return true;draft={...editing,text:editor.value};const next=clone(paper),existing=next.texts.find(t=>t.id===editing.id);
 if(!draft.text.trim()){if(existing){const removed=eraseItems(next,[existing.id],false);commit(removed,editDirty);editDirty=true;}persist();placeEditor();return true;}
 if(existing&&existing.text===draft.text&&existing.x===draft.x&&existing.y===draft.y&&existing.w===draft.w){persist();return true;}
 const value={...draft,humanEdited:existing?.author==='ai'||draft.humanEdited};
 if(existing&&JSON.stringify(existing)===JSON.stringify(value)){persist();return true;}
 next.texts=next.texts.filter(t=>t.id!==value.id);next.texts.push(value);
 try{validateSheet(next);commit(next,editDirty);editDirty=true;}catch(e){notice(e.message);persist();placeEditor();return false;}
 placeEditor();return true;
}
function finishEditor(){if(!editing)return true;if(!updateText())return false;editing=null;draft=null;editor.hidden=true;$('text-sizing').hidden=true;persist();queuePaint();return true;}
editor.oncompositionstart=()=>composing=true;editor.oncompositionend=()=>{composing=false;updateText();};
editor.oninput=()=>{try{updateText();}catch(e){notice(e.message);}};
$('text-width').oninput=()=>{if(editing){editing.w=Math.max(88,Math.min(600-editing.x,Number($('text-width').value)));updateText();}};
editor.onkeydown=e=>{if(!e.isComposing&&(e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(finishEditor())canvas.focus();}};
new ResizeObserver(placeEditor).observe(canvas);
function hit(point,doc=paper){
 for(const t of [...doc.texts].reverse()){const b=bounds(t);if(point[0]>=b.x&&point[0]<=b.r&&point[1]>=b.y&&point[1]<=b.b)return t.id;}
 const x=canvas.getContext('2d');x.save();x.lineCap=x.lineJoin='round';x.lineWidth=14*612/canvas.getBoundingClientRect().width;
 // ponytail: at most 100 paths; native hit-testing follows the ink actually drawn.
 if(hitVersion!==paper.version){hitPaths.clear();hitVersion=paper.version;}
 try{for(const s of [...doc.strokes].reverse()){if(!hitPaths.has(s.id)){const path=new Path2D();strokePath(path,s);hitPaths.set(s.id,path);}if(x.isPointInStroke(hitPaths.get(s.id),...point))return s.id;}}finally{x.restore();}return null;
}
const position=e=>{const r=canvas.getBoundingClientRect();return [Math.max(12,Math.min(600,(e.clientX-r.left)*612/r.width)),Math.max(12,Math.min(600,(e.clientY-r.top)*612/r.height))];};
function eraseAt(p){const id=hit(p,gesture.preview);if(id){gesture.ids.push(id);gesture.preview=eraseItems(gesture.preview,[id],false);}}
canvas.onpointerdown=e=>{
 if(e.button!==0||e.ctrlKey||!ready||!canSave||folding||!finishEditor())return;stopReveal();const p=position(e);canvas.focus();
 if(tool==='text'){const old=paper.texts.find(t=>t.id===hit(p));if(old)startEditor(old);else startEditor({id:'human-'+crypto.randomUUID(),author:'human',humanEdited:false,text:'',x:Math.min(500,p[0]),y:Math.min(572,p[1]),w:Math.min(520,600-Math.min(500,p[0]))});return;}
 canvas.setPointerCapture(e.pointerId);
 if(tool==='draw'){if(paper.strokes.length>=100)return notice('纸面已满，请先整理几笔。');selection=[];gesture={type:'draw',points:[p]};}
 else if(tool==='erase'){selection=[];gesture={type:'erase',preview:clone(paper),ids:[],last:p};eraseAt(p);}
 else{const id=hit(p);if(id){const members=selectedMembers(paper,[id]);if(e.shiftKey)selection=members.every(i=>selection.includes(i))?selection.filter(i=>!members.includes(i)):[...new Set([...selection,...members])];else if(!selection.includes(id))selection=members;gesture={type:'move',start:p,original:clone(paper),ids:[...selection]};}else{if(!e.shiftKey)selection=[];gesture={type:'marquee',start:p,current:p,previous:[...selection]};}}
 controls();queuePaint();
};
canvas.ondblclick=e=>{if(tool!=='select')return;const t=paper.texts.find(t=>t.id===hit(position(e)));if(t)startEditor(t);};
canvas.onpointermove=e=>{if(!gesture)return;const p=position(e),g=gesture;if(g.type==='draw'){if(Math.hypot(p[0]-g.points.at(-1)[0],p[1]-g.points.at(-1)[1])>2&&g.points.length<300)g.points.push(p);}else if(g.type==='erase'){const steps=Math.ceil(Math.hypot(p[0]-g.last[0],p[1]-g.last[1])/5);for(let i=1;i<=steps;i++)eraseAt(g.last.map((v,k)=>v+(p[k]-v)*i/steps));g.last=p;}else if(g.type==='marquee')g.current=p;else{g.dx=p[0]-g.start[0];g.dy=p[1]-g.start[1];if(Math.hypot(g.dx,g.dy)>2)g.preview=moveItems(g.original,g.ids,g.dx,g.dy);}queuePaint();};
canvas.onpointerup=()=>{const g=gesture;gesture=null;if(!g)return;try{
 if(g.type==='draw'){const n=clone(paper);n.strokes.push({id:'human-'+crypto.randomUUID(),author:'human',humanEdited:false,brush:'didan-v1',line:'auto',points:g.points});commit(n);}
 else if(g.type==='erase'&&g.ids.length)commit(g.preview);
 else if(g.type==='move'&&g.preview)commit(g.preview);
 else if(g.type==='marquee'){const r={x:Math.min(g.start[0],g.current[0]),y:Math.min(g.start[1],g.current[1]),r:Math.max(g.start[0],g.current[0]),b:Math.max(g.start[1],g.current[1])};selection=selectedMembers(paper,[...g.previous,...items(paper).filter(s=>{const b=bounds(s);return b.x>=r.x&&b.r<=r.r&&b.y>=r.y&&b.b<=r.b;}).map(s=>s.id)]);}
 }catch(e){notice(e.message);}render();};
canvas.onpointercancel=canvas.oncontextmenu=()=>{gesture=null;render();};
function group(){if(selection.length<2||!finishEditor())return;const ungroup=isOneGroup();commit(groupItems(paper,selection,ungroup));notice(ungroup?'已拆组。':'已编组，可以一起移动。');}
function undoOnce(){if(!undo||!canSave||!finishEditor())return;paper=undoSheet(paper,undo);undo=null;selection=[];persist();render();notice('已撤销。');}
canvas.onkeydown=e=>{if(gesture)return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='g'){e.preventDefault();group();}else if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undoOnce();}else if(e.key==='Enter'){e.preventDefault();const all=items(paper);if(e.shiftKey){const t=paper.texts.find(t=>selection.includes(t.id));if(t)startEditor(t);}else{const i=all.findIndex(s=>s.id===selection.at(-1));selection=selectedMembers(paper,[all[(i+1)%all.length]?.id]);render();}}else if(['Delete','Backspace'].includes(e.key)&&selection.length){e.preventDefault();commit(eraseItems(paper,selection));selection=[];render();}else if(e.key.startsWith('Arrow')&&selection.length){e.preventDefault();const step=e.shiftKey?12:3,dx=(e.key==='ArrowRight'?step:0)-(e.key==='ArrowLeft'?step:0),dy=(e.key==='ArrowDown'?step:0)-(e.key==='ArrowUp'?step:0),next=moveItems(paper,selection,dx,dy);if(next)commit(next);}};
document.querySelectorAll('nav [data-tool]').forEach(b=>b.onclick=()=>{if(!finishEditor())return;tool=tool===b.dataset.tool?inputMode:b.dataset.tool;render();canvas.focus();});$('group').onclick=group;$('undo').onclick=undoOnce;
document.addEventListener('keydown',e=>{
 if(e.isComposing||composing)return;
 if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();fold();return;}
 if(e.key!=='Escape'||$('reply').open)return;e.preventDefault();
 if(gesture){gesture=null;render();return;}
 if(!$('paper-stack').hidden){$('paper-stack').hidden=true;return;}
 if(!$('more').hidden){$('more').hidden=true;$('more-toggle').setAttribute('aria-expanded','false');return;}
 temporaryHide();
});
function image(){const c=document.createElement('canvas');c.width=c.height=612;paintSheet(c,paper,{grid:true});return c.toDataURL('image/png').split(',')[1];}
async function fold(force=false){
 const began=performance.now();if(folding||!ready||!canSave||composing||!finishEditor())return;folding=true;controls();
 try{await saving;if(!canSave)return;outbox=await rpc('state');if(force||needsHandoff(paper,outbox))outbox=await rpc('enqueue',{lease,request:{...requestSheet(paper,image()),recipient},userRevision:paper.userRevision,force});
  const sample={at:new Date().toISOString(),readyToCloseMs:Math.round((performance.now()-began)*10)/10,version:paper.version,userRevision:paper.userRevision,jobId:[outbox.active,outbox.waiting,...outbox.pending].find(t=>t?.paperId===paper.id&&t.baseVersion===paper.version)?.jobId||null};
  foldSamples=[...foldSamples,sample].slice(-12);storage.set({foldSamples}).catch(()=>{});console.info('jiebi.fold',JSON.stringify(sample));closeView();
 }catch(e){notice(e.message);}finally{folding=false;controls();}
}
$('close').onclick=()=>fold();$('retry').onclick=()=>fold(true);
function receive(state){if(state?.schema!==3)return;outbox=state;const latest=receiptFor(state,paper.id);if(state.active&&state.connection==='offline')notice('已收好，恢复连接后交出。');else if(latest?.status==='ready'&&!paper.appliedJobs.includes(latest.jobId)&&state.history.some(t=>t.jobId===latest.jobId&&!t.seen))notice(latest.paperId===paper.id&&latest.baseVersion===paper.version?'回应已收好，下次打开取回。':'旧页的回应留在往来里。');controls();}
async function takeAtOpen(state){
 outbox=state;const task=receiptFor(state,paper.id);if(task?.status==='failed'){outbox=await rpc('seen',{jobId:task.jobId});notice(task.error||'回应未完成，原纸面已保留；可在更多中重试。');return;}if(task?.protocol!=='paper.v2'||task.status!=='ready')return;
 if(paper.appliedJobs.includes(task.jobId)){outbox=await rpc('seen',{jobId:task.jobId});return;}
 if(task.paperId===paper.id&&task.baseVersion===paper.version&&!draft){const next=applySheetJob(paper,task),test=document.createElement('canvas');test.width=test.height=612;paintSheet(test,next);undo=clone(paper);paper=next;presentedNow=true;reveal=task.result.strokes.length?{ids:task.result.strokes.map(s=>s.id),progress:0}:null;await persist();if(!canSave)return;outbox=await rpc('seen',{jobId:task.jobId});notice(task.result.decision==='pause'?'已看过，未添内容。':'');}else receive(state);
}
function showDocument(doc,label,job=null){viewed={doc,job};$('reply-title').textContent=label;$('reply-words').textContent=doc.paperText||'';$('reply-note').textContent=(doc.paperNotes||[]).map(n=>typeof n==='string'?n:n.text).join('\n');paintSheet($('reply-paper'),doc.schema===4?doc:{...doc,texts:[]});$('reply-status').textContent=job?.result.decision==='pause'?'已看过，未添内容。':'只读记录';$('reply').showModal();}
async function showReply(jobId){const job=await rpc('read',{jobId});outbox=await rpc('seen',{jobId});controls();if(job.status!=='ready'){notice(job.error||'还在生成。');return;}showDocument(job.protocol==='paper.v2'?previewSheetJob(job):previewJob(job),'交出时的那一页',job);}
$('legacy').onclick=async()=>{const {paper:old}=await storage.get('paper');if(old)showDocument(validatePaper(old),'旧版纸面');else notice('这里没有旧版纸面。');};
$('close-reply').onclick=$('collect').onclick=()=>$('reply').close();
function exportPaper(p,name){const c=document.createElement('canvas');c.width=c.height=612;if(p.schema===4)paintSheet(c,p);else{const image=document.createElement('canvas');image.width=image.height=612;paintSheet(image,{...p,texts:[]});const lines=t=>t.split('\n').flatMap(s=>s.match(/.{1,27}/gu)||['']),words=lines(p.paperText),notes=lines(p.paperNotes.map(n=>n.text).join('\n'));c.width=660;c.height=690+(words.length+notes.length)*25;const x=c.getContext('2d');x.fillStyle='#fafbf7';x.fillRect(0,0,c.width,c.height);x.font='19px Kaiti SC,serif';x.fillStyle='#316c67';words.forEach((s,i)=>x.fillText(s,24,30+i*25));x.drawImage(image,24,45+words.length*25);x.fillStyle='#9d5c6e';notes.forEach((s,i)=>x.fillText(s,24,680+(words.length+i)*25));}const a=document.createElement('a');a.href=c.toDataURL();a.download=name+'.png';a.click();}
$('export').onclick=()=>{if(finishEditor())exportPaper(paper,'接笔');};$('save-reply').onclick=()=>{if(viewed)exportPaper(viewed.doc,'接笔-往来');};
$('more-toggle').onclick=()=>{const open=$('more').hidden;$('more').hidden=!open;$('more-toggle').setAttribute('aria-expanded',open);};
document.addEventListener('pointerdown',e=>{if(!$('more').contains(e.target)&&!$('more-toggle').contains(e.target)){$('more').hidden=true;$('more-toggle').setAttribute('aria-expanded',false);}});
$('history-toggle').onclick=async()=>{const open=$('history').hidden;$('history').hidden=!open;$('history-toggle').setAttribute('aria-expanded',open);if(!open)return;outbox=await rpc('state');$('receipts').textContent='';for(const item of outbox.history.filter(t=>t.paperId===paper.id).slice().reverse()){const li=document.createElement('li'),text=document.createElement('span'),button=document.createElement('button');text.textContent=new Date(item.createdAt*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · '+(item.status==='ready'?'回应':'未完成');button.textContent='查看';button.onclick=()=>showReply(item.jobId).catch(e=>notice(e.message));li.append(text,button);$('receipts').append(li);}if(!outbox.history.some(t=>t.paperId===paper.id))$('receipts').textContent='还没有往来。';};
$('check-connection').onclick=async()=>{const b=$('check-connection');b.disabled=true;try{const s=await rpc('health');$('connection').textContent=s.configured===false?'服务已连接，尚未配置模型。':'已连接 · '+(s.provider==='nebius'?'Nebius · ':'')+s.model+(s.provider==='nebius'||s.model.includes(':cloud')?'（云端推理）':'');}catch{$('connection').textContent='连接尚未就绪；纸面已保存在这里。';}finally{b.disabled=false;}};
$('save-connection').onclick=async()=>{try{await rpc('connection-save',{base:$('service-location').value,code:$('access-code').value.trim()});$('access-code').value='';$('connection').textContent='连接已保存；已交出的任务仍使用原连接。';}catch(e){$('connection').textContent=e.message;}};
rpc('connection-read').then(c=>{$('service-location').value=c.base;$('access-code').placeholder=c.configured?'已保存，留空保留':'';}).catch(()=>{});
function updatePhase(){
 const unread=outbox.history?.some(t=>!t.seen&&t.status==='ready'),waiting=Boolean(outbox.active),failed=outbox.history?.some(t=>!t.seen&&t.status==='failed');
 curtain.dataset.phase=waiting?(outbox.connection==='offline'?'offline':'waiting'):unread?'ready':failed?'failed':'idle';
 const labels={waiting:'助手正在回应，可以继续写画',ready:'有新回应，拉开查看',failed:'回应未完成，展开查看',offline:'连接中断，纸面已保存',idle:'拉开接笔'};
 $('roll-handle').setAttribute('aria-label',expanded?'向上收卷并交给助手':labels[curtain.dataset.phase]);
}
function setOpening(p,drag=false){curtain.dataset.dragging=String(drag);curtain.style.setProperty('--open',String(Math.max(0,Math.min(1,p))));}
new ResizeObserver(()=>{curtain.style.setProperty('--paper-height',body.offsetHeight+'px');placeEditor();}).observe(body);
async function loadPaper(id,ticket=opening){
 ready=false;presentedNow=false;notice('');tool=inputMode;const loaded=await rpc('paper-claim',id===undefined?{}:{paperId:id});
 if(ticket!==opening||!expanded){await rpc('paper-release',{lease:loaded.lease}).catch(()=>{});return;}
 lease=loaded.lease;view=loaded.view;
 paper=validateSheet(loaded.paper);undo=loaded.undo?validateSheet(loaded.undo):null;draft=loaded.draft||null;lastText=loaded.lastText;recipient=loaded.recipient||'builtin';$('recipient').value=recipient;selection=[];gesture=null;editing=null;editor.hidden=true;$('text-sizing').hidden=true;canSave=true;hitVersion=-1;
 try{const state=await rpc('check');if(ticket!==opening||!expanded)return;await takeAtOpen(state);}catch(e){notice(e.message);}
 if(ticket!==opening||!expanded)return;
 ready=true;render();
 if(reveal&&!reduced()){const began=performance.now();const animate=now=>{if(!reveal)return;reveal.progress=Math.min(1,(now-began)/1000);paint();if(reveal.progress<1)revealFrame=requestAnimationFrame(animate);else{reveal=null;paint();}};revealFrame=requestAnimationFrame(animate);}
 else{reveal=null;if(draft)startEditor(draft);else if(!presentedNow&&inputMode==='text'&&paper.texts.some(t=>t.id===lastText))startEditor(paper.texts.find(t=>t.id===lastText));else if(!items(paper).length&&inputMode==='text')startEditor({id:'human-'+crypto.randomUUID(),author:'human',humanEdited:false,text:'',x:24,y:24,w:552});}
}
async function openPaper(settle=true){
 if(expanded){if(settle)setOpening(1);return;}expanded=true;const ticket=++opening;body.inert=false;curtain.dataset.expanded='true';await rpc('surface',{expanded:true});
 if(ticket!==opening||!expanded)return;
 if(settle)setOpening(1);try{await loadPaper(undefined,ticket);}catch(e){if(ticket!==opening)return;canSave=false;notice(e.message);controls();}updatePhase();
}
async function collapse(){
 const ticket=++opening;stopReveal();expanded=false;ready=false;body.inert=true;curtain.dataset.expanded='false';setOpening(0);updatePhase();
 const oldLease=lease;lease=null;if(oldLease)await rpc('paper-release',{lease:oldLease}).catch(()=>{});
 setTimeout(()=>{if(ticket===opening&&!expanded){rpc('surface',{expanded:false}).catch(()=>{});if(isExtension&&!embedded)window.close();}},reduced()?0:450);
}
async function temporaryHide(){
 if(!expanded||folding)return;gesture=null;stopReveal();if(!composing)finishEditor();await persist();if(canSave)await collapse();
}
window.addEventListener('jiebi-close',()=>{collapse().catch(e=>notice(e.message));});
window.addEventListener('pagehide',()=>{persist();});
document.addEventListener('visibilitychange',()=>{document.body.dataset.hidden=String(document.hidden);if(document.hidden)temporaryHide();});
$('recipient').onchange=()=>{recipient=$('recipient').value;persist();};
function chooseInput(mode){if(!finishEditor())return;inputMode=tool=mode;$('mode-word').textContent=mode==='text'?'写字':'画画';$('mode-edge').dataset.mode=mode;selection=[];stopReveal();render();canvas.focus();}
let modeStart=null;const edge=$('mode-edge');
function settleMode(){modeStart=null;edge.dataset.dragging='false';edge.style.setProperty('--slip','0px');}
edge.onpointerdown=e=>{if(e.button!==0)return;modeStart=[e.clientX,e.clientY];edge.dataset.dragging='true';edge.setPointerCapture(e.pointerId);};
edge.onpointermove=e=>{if(modeStart)edge.style.setProperty('--slip',Math.max(-18,Math.min(18,(e.clientX-modeStart[0])*.35))+'px');};
edge.onpointerup=e=>{if(!modeStart)return;const dx=e.clientX-modeStart[0],dy=e.clientY-modeStart[1];settleMode();if(Math.abs(dx)>24&&Math.abs(dx)>Math.abs(dy))chooseInput(dx>0?'draw':'text');};edge.onpointercancel=settleMode;
edge.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();chooseInput(e.key==='ArrowRight'?'draw':'text');}};
document.addEventListener('keydown',e=>{if(e.target===editor||e.isComposing||e.metaKey||e.ctrlKey||e.altKey||!expanded)return;if(e.key.toLowerCase()==='t')chooseInput('text');if(e.key.toLowerCase()==='p')chooseInput('draw');if(['v','e'].includes(e.key.toLowerCase())){finishEditor();tool=e.key.toLowerCase()==='v'?'select':'erase';render();canvas.focus();}});
let rollDrag=null,skipClick=false;const handle=$('roll-handle');
handle.onpointerdown=e=>{if(e.button!==0)return;stopReveal();const p=parseFloat(getComputedStyle(curtain).getPropertyValue('--open'))||0;rollDrag={y:e.clientY,p,wasOpen:expanded};skipClick=false;handle.setPointerCapture(e.pointerId);setOpening(p,true);};
handle.onpointermove=e=>{if(!rollDrag)return;const dy=e.clientY-rollDrag.y;if(Math.abs(dy)>4){skipClick=true;if(!expanded&&dy>0)openPaper(false);setOpening(rollDrag.p+dy/Math.max(200,body.offsetHeight-16),true);}};
handle.onpointerup=e=>{if(!rollDrag)return;const d=rollDrag,dy=e.clientY-d.y;rollDrag=null;if(d.wasOpen&&dy<-64){curtain.dataset.dragging='false';fold().finally(()=>{if(expanded)setOpening(1);});}else if(skipClick&&!d.wasOpen&&dy>16){openPaper();setOpening(1);}else setOpening(expanded?1:0);};
handle.onpointercancel=()=>{rollDrag=null;setOpening(expanded?1:0);};handle.onclick=()=>{if(skipClick){skipClick=false;return;}if(expanded)fold();else openPaper();};
handle.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();openPaper();}else if(e.key==='ArrowUp'&&expanded){e.preventDefault();fold();}};
async function changePaper(id){if(!finishEditor())return;await saving;if(!canSave)return;stopReveal();$('paper-stack').hidden=true;await loadPaper(id,++opening);}
async function showStack(){
 if(!finishEditor())return;await saving;if(!canSave)return;stopReveal();const data=await rpc('paper-list'),cards=$('paper-cards');cards.textContent='';
 const blank=document.createElement('button');blank.className='paper-card blank';blank.innerHTML='<b aria-hidden="true">＋</b><span>一张空白纸</span>';blank.setAttribute('aria-label','拉出一张空白纸');let start=null,pulled=false;
 blank.onpointerdown=e=>{start=[e.clientX,e.clientY];pulled=false;blank.setPointerCapture(e.pointerId);};blank.onpointerup=e=>{if(start&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>24){pulled=true;changePaper(null).catch(e=>notice(e.message));}start=null;};blank.onclick=()=>{if(!pulled)changePaper(null).catch(e=>notice(e.message));};cards.append(blank);
 for(const p of data.papers){const b=document.createElement('button'),c=document.createElement('canvas'),label=document.createElement('span');b.className='paper-card';b.setAttribute('aria-current',p.id===paper.id?'true':'false');const pending=[outbox.active,outbox.waiting,...outbox.pending].some(t=>t?.paperId===p.id),fresh=outbox.history.some(t=>t.paperId===p.id&&!t.seen&&t.status==='ready');b.dataset.phase=pending?'waiting':fresh?'ready':'idle';b.setAttribute('aria-label',(p.text||(p.strokes.length?'有涂画的纸':'空白纸'))+(pending?'，已交出':fresh?'，有新回应':''));c.width=c.height=612;paintSheet(c,{...p,groups:[]});label.textContent=p.text||(p.strokes.length?'一张涂画':'空白纸');b.append(c,label);b.onclick=()=>changePaper(p.id).catch(e=>notice(e.message));cards.append(b);}
 $('paper-stack').hidden=false;
}
let cornerStart=null;$('paper-corner').onpointerdown=e=>{cornerStart=[e.clientX,e.clientY];$('paper-corner').setPointerCapture(e.pointerId);};$('paper-corner').onpointerup=e=>{if(cornerStart&&Math.hypot(e.clientX-cornerStart[0],e.clientY-cornerStart[1])>18)showStack();cornerStart=null;};$('paper-corner').onclick=showStack;$('stack-close').onclick=()=>$('paper-stack').hidden=true;
watchPending(receive);
if(isExtension)chrome.runtime.onMessage.addListener(m=>{if(m.type==='lease-revoked'&&m.view===view){lease=null;canSave=false;collapse();}});
if(embedded){
 let boundNonce=null;
 window.addEventListener('message',async e=>{
  if(e.source!==window.parent||!e.data?.type?.startsWith('jiebi-'))return;
  if(e.data.type==='jiebi-bind'){try{await rpc('bind',{nonce:e.data.nonce});boundNonce=e.data.nonce;receive(await rpc('state'));}catch{}}
  else if(boundNonce&&e.data.nonce===boundNonce){if(e.data.type==='jiebi-hide')temporaryHide();if(e.data.type==='jiebi-toggle')expanded?temporaryHide():openPaper();}
 });
}else{try{receive(await rpc('state'));if(isExtension)await openPaper();}catch(e){notice(e.message);}}
