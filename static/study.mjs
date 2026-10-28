import {SCENARIOS} from './scenarios.mjs';
import {acceptsReply,applyContribution,translateStroke,decodePaper,flowPoints,needsReply} from '../extension/paper.mjs';
export {acceptsReply,applyContribution,translateStroke,decodePaper,flowPoints,needsReply};

if (typeof document !== 'undefined') boot();
function boot() {
 const $=id=>document.getElementById(id), canvas=$('paper'), ctx=canvas.getContext('2d');
 const O=[54,74], W=612, HUMAN='#316c67', AI='#9d5c6e';
 const state={strokes:[],version:0,gesture:null,paperText:'',paperNotes:[],answeredVersion:-1}, undo=[], changes=[], results=[], events=[];
 const sceneMode=new URLSearchParams(location.search).has('scenarios');
 const storageKey=sceneMode?'sketchagent-study.scenes.v1':'sketchagent-study.paper.v2';
 for(const scene of SCENARIOS){const option=document.createElement('option');option.value=scene.id;option.textContent=scene.title;$('scenario').append(option);}
 if(sceneMode)$('study').open=true;
 let canPersist=true,isOpen=true,unread=false;
 let mode='draw',selected=null,pending=false,waitingAt=0,caption='先留下一笔',note='',cursor=null,demo=false,recording=false,recordStart=0,model='';
 let reveal=null,stepStart=performance.now(),recorder=null,chunks=[];
 const clone=v=>structuredClone(v),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const notice=t=>{$('status').textContent=t;};
 const log=(type,data={})=>events.push({type,atMs:Math.round(performance.now()-stepStart),version:state.version,...data});
 const snapshot=()=>({strokes:clone(state.strokes),paperText:state.paperText,paperNotes:clone(state.paperNotes),answeredVersion:state.answeredVersion});
 const save=()=>{undo.push(snapshot());if(undo.length>40)undo.shift();};
 function persist(){if(!canPersist)return;try{localStorage.setItem(storageKey,JSON.stringify({schema:2,version:state.version,...snapshot()}));$('saved').textContent='已保存';}catch{$('saved').textContent='本机保存失败，请暂时保留页面';}}
 function renderNotes(){ $('margins').textContent='';for(const n of state.paperNotes){const li=document.createElement('li'),t=document.createElement('span'),b=document.createElement('button');t.textContent=n.text;b.textContent='×';b.setAttribute('aria-label','删除批注：'+n.text);b.onclick=()=>{save();state.paperNotes=state.paperNotes.filter(x=>x.id!==n.id);changed('erase-note',{id:n.id});renderNotes();};li.append(t,b);$('margins').append(li);}requestAnimationFrame(()=>{$('margins').scrollTop=$('margins').scrollHeight;});}
 function changed(type,detail={}) { state.version++;changes.push({type,...detail});if(changes.length>50)changes.shift();log(type,detail);persist(); }

 function thumbnail(){const c=$('mini'),x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);x.save();x.scale(c.width/720,c.height/820);x.fillStyle='#fafbf7';x.fillRect(0,0,720,820);x.translate(...O);for(const stroke of state.strokes)drawStroke(stroke,x);x.restore();}
 function foldedStatus(text,kind){$('fold-status').textContent=text;$('unfold').dataset.state=kind;thumbnail();}
 function setOpen(open){isOpen=open;$('memo').dataset.open=String(open);$('memo').inert=!open;$('unfold').hidden=open;$('unfold').setAttribute('aria-expanded',String(open));if(open){if(unread)reveal=null;unread=false;setTimeout(()=>{if(isOpen)$('paper-text').focus({preventScroll:true});},280);}else{foldedStatus(pending?'正在接笔…':unread?'有新回应':'这一页还在',pending?'waiting':unread?'ready':'idle');$('unfold').focus({preventScroll:true});}log(open?'unfold':'fold');}
 $('fold').onclick=()=>{if(!demo)setOpen(false);};$('unfold').onclick=()=>setOpen(true);
 $('fold-send').onclick=()=>{if(demo||state.gesture)return;if(pending){setOpen(false);return;}if(!needsReply(state)){setOpen(false);return;}const task=next();setOpen(false);task.catch(()=>foldedStatus('这次没接上 · 点开重试','error'));};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen&&!demo){e.preventDefault();setOpen(false);}});
 // ponytail: folding keeps this page alive; durable extension jobs come with real assistant integration.
 window.addEventListener('beforeunload',e=>{if(pending){e.preventDefault();e.returnValue='';}});
 let lastTextEdit=-Infinity;
 $('paper-text').oninput=()=>{const now=performance.now();if(now-lastTextEdit>800)save();lastTextEdit=now;state.paperText=$('paper-text').value;changed('edit-text');};
 function setMode(next){mode=next;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===mode));}
 function path(stroke,context) {
  context.beginPath();
  if(stroke.curves){for(const c of stroke.curves){context.moveTo(...c[0]);if(c.length===4)context.bezierCurveTo(...c[1],...c[2],...c[3]);else if(c.length===3)context.quadraticCurveTo(...c[1],...c[2]);else if(c.length===2)context.lineTo(...c[1]);}}
  else {const ps=stroke.points;context.moveTo(...ps[0]);if(ps.length===1)context.lineTo(ps[0][0]+.1,ps[0][1]+.1);else if(ps.length===2)context.lineTo(...ps[1]);else{for(let i=1;i<ps.length-1;i++){const end=i===ps.length-2?ps.at(-1):ps[i].map((x,k)=>(x+ps[i+1][k])/2);context.quadraticCurveTo(...ps[i],...end);}}}
 }
 function drawStroke(s,context,alpha=1){context.save();context.strokeStyle=s.author==='human'?HUMAN:AI;context.globalAlpha=alpha;context.lineWidth=3.1;context.lineCap='round';context.lineJoin='round';path(s,context);context.stroke();context.restore();}
 function paperImage(){const c=document.createElement('canvas');c.width=c.height=W;const x=c.getContext('2d');x.fillStyle='#ffffff';x.fillRect(0,0,W,W);x.font='10px sans-serif';for(let n=5;n<=50;n+=5){const px=n*12+6,py=606-n*12;x.strokeStyle='#e3e9e6';x.lineWidth=.5;x.beginPath();x.moveTo(px,0);x.lineTo(px,600);x.moveTo(12,py);x.lineTo(612,py);x.stroke();x.fillStyle='#77847d';x.fillText(String(n),px-4,609);x.fillText(String(n),0,py+3);}for(const s of state.strokes)drawStroke(s,x);return c.toDataURL('image/png').split(',')[1];}
 function render(now){
  if(!isOpen&&!recording){requestAnimationFrame(render);return;}
  ctx.fillStyle='#fafbf7';ctx.fillRect(0,0,720,820);ctx.fillStyle='#243e44';ctx.font='17px -apple-system, sans-serif';if(recording)ctx.fillText(caption,40,39);
  ctx.textAlign='right';ctx.fillStyle='#6a7777';ctx.font='12px -apple-system, sans-serif';if(recording)ctx.fillText(`实录 ${((now-recordStart)/1000).toFixed(1)} s`,680,37);ctx.textAlign='left';
  ctx.fillStyle=HUMAN;ctx.font='18px "Kaiti SC",serif';let written='',line=0;for(const ch of (recording?state.paperText:'')){if(ch==='\n'||ctx.measureText(written+ch).width>640){ctx.fillText(written,40,66+line*22);written='';line++;if(line===4)break;if(ch==='\n')continue;}written+=ch;}if(line<4)ctx.fillText(written,40,66+line*22);
  ctx.save();ctx.translate(...O);for(const s of state.strokes){if(reveal&&reveal.ids.has(s.id)){const f=Math.min(1,(now-reveal.started)/450);const n=Math.max(2,Math.floor(s.points.length*f));drawStroke({...s,curves:null,points:s.points.slice(0,n)},ctx);}else drawStroke(s,ctx);}
  if(reveal&&now-reveal.started>=450)reveal=null;
  if(state.gesture?.type==='draw')drawStroke({points:state.gesture.points,author:'human'},ctx);
  if(selected){const s=state.strokes.find(s=>s.id===selected);if(s){const xs=s.points.map(p=>p[0]),ys=s.points.map(p=>p[1]);ctx.strokeStyle='#9eafa7';ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.strokeRect(Math.min(...xs)-8,Math.min(...ys)-8,Math.max(...xs)-Math.min(...xs)+16,Math.max(...ys)-Math.min(...ys)+16);ctx.setLineDash([]);}}
  if(cursor){ctx.strokeStyle=mode==='erase'?'#6a7777':HUMAN;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cursor[0],cursor[1],mode==='erase'?12:5,0,Math.PI*2);ctx.stroke();}ctx.restore();
  ctx.strokeStyle='#e4e9e5';ctx.beginPath();ctx.moveTo(40,714);ctx.lineTo(680,714);ctx.stroke();ctx.font='13px -apple-system, sans-serif';ctx.fillStyle='#536866';
  const status=pending?`AI 正在接笔 · 已等待 ${((now-waitingAt)/1000).toFixed(1)} 秒`:(results.length?`第 ${results.length} 轮 · 点击到笔画出现 ${((results.at(-1).visibleMs??results.at(-1).receivedMs)/1000).toFixed(2)} 秒`:'人的笔画 · 绿色     AI 的笔画 · 玫红');
  if(recording){ctx.fillText(status,40,745);ctx.font='14px "Songti SC",serif';ctx.fillStyle=AI;ctx.fillText((state.paperNotes.at(-1)?.text||'').slice(0,43),40,772);}
  if(demo){ctx.fillStyle='#6a7777';ctx.fillText('人的操作：自动演示　｜　AI 笔画：实时模型生成　｜　原速记录',40,799);}
  requestAnimationFrame(render);
 }
 requestAnimationFrame(render);
 function addStroke(points){if(state.strokes.length>=100)return notice('这张纸的笔画已满，请先整理再画。');save();const s={id:'human-'+crypto.randomUUID().slice(0,8),author:'human',points:clone(points)};state.strokes.push(s);changed('add',{id:s.id});return s.id;}
 function erase(id){const i=state.strokes.findIndex(s=>s.id===id);if(i<0)return;save();state.strokes.splice(i,1);changed('erase',{id});if(selected===id)selected=null;}
 function rotate(id,angle=Math.PI/2){const s=state.strokes.find(s=>s.id===id);if(!s)return;const xs=s.points.map(p=>p[0]),ys=s.points.map(p=>p[1]);const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;const turn=([x,y])=>[cx+(x-cx)*Math.cos(angle)-(y-cy)*Math.sin(angle),cy+(x-cx)*Math.sin(angle)+(y-cy)*Math.cos(angle)];const points=s.points.map(turn);if(points.some(([x,y])=>x<12||x>611||y<0||y>599))return notice('旋转后会超出纸面。');save();s.points=points;if(s.curves)s.curves=s.curves.map(c=>c.map(turn));changed('rotate',{id,degrees:angle*180/Math.PI});}
 function hit(p){let best=null,d=14;for(const s of state.strokes){for(let i=0;i<s.points.length;i++){const a=s.points[Math.max(0,i-1)],b=s.points[i],vx=b[0]-a[0],vy=b[1]-a[1],n=vx*vx+vy*vy,t=n?Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/n)):0;const dist=Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy);if(dist<d){d=dist;best=s.id;}}}return best;}
 const position=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*720/r.width-O[0],(e.clientY-r.top)*820/r.height-O[1]];};
 const inside=p=>p[0]>=12&&p[0]<=611&&p[1]>=0&&p[1]<=599;
 canvas.onpointerdown=e=>{if(demo)return;const p=position(e);if(!inside(p))return;canvas.focus();canvas.setPointerCapture(e.pointerId);cursor=p;selected=null;if(mode==='draw')state.gesture={type:'draw',points:[p]};else{const id=hit(p);selected=id;if(mode==='erase'){if(id)erase(id);}else if(id)state.gesture={type:'move',id,start:p,original:clone(state.strokes.find(s=>s.id===id)),saved:false};}};
 canvas.onpointermove=e=>{if(demo)return;const p=position(e);cursor=inside(p)?p:null;const g=state.gesture;if(!g||!inside(p))return;if(g.type==='draw'){if(Math.hypot(p[0]-g.points.at(-1)[0],p[1]-g.points.at(-1)[1])>2&&g.points.length<900)g.points.push(p);}else{const dx=p[0]-g.start[0],dy=p[1]-g.start[1],next=translateStroke(g.original,dx,dy);if(next&&Math.hypot(dx,dy)>2){if(!g.saved){save();changed('move',{id:g.id});g.saved=true;}state.strokes[state.strokes.findIndex(s=>s.id===g.id)]=next;}}};
 canvas.onpointerup=()=>{if(demo)return;const g=state.gesture;state.gesture=null;if(g?.type==='draw')addStroke(g.points);if(g?.type==='move')persist();cursor=null;};
 canvas.onpointercancel=()=>{const g=state.gesture;if(g?.type==='move'&&g.saved){Object.assign(state,undo.pop());changed('cancel-move');}state.gesture=null;cursor=null;};
 canvas.onpointerleave=()=>{if(!state.gesture)cursor=null;};
 const doUndo=()=>{if(!undo.length||demo)return;Object.assign(state,undo.pop());$('paper-text').value=state.paperText;renderNotes();selected=null;changed('undo');};
 $('undo').onclick=doUndo;$('rotate').onclick=()=>rotate(selected);
 function reset(){state.strokes=[];state.version++;state.gesture=null;state.paperText='';state.paperNotes=[];state.answeredVersion=-1;$('paper-text').value='';renderNotes();selected=null;changes.length=0;results.length=0;events.length=0;stepStart=performance.now();$('history').textContent='';$('result').textContent='';caption='先留下一笔';note='';}
 $('clear').onclick=()=>{if(!demo){save();reset();changed('clear');notice('新的一张纸；上一张可以撤销。');}};
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
 canvas.onkeydown=e=>{if(demo)return;if((e.metaKey||e.ctrlKey)&&e.key==='z'){e.preventDefault();doUndo();}else if(e.key==='Enter'){e.preventDefault();const i=state.strokes.findIndex(s=>s.id===selected);selected=state.strokes[(i+1)%state.strokes.length]?.id;}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();erase(selected);}else if(e.key.toLowerCase()==='r')rotate(selected);else if(e.key.startsWith('Arrow')&&selected){e.preventDefault();const s=state.strokes.find(s=>s.id===selected),step=e.shiftKey?12:3;const n=translateStroke(s,(e.key==='ArrowRight'?step:0)-(e.key==='ArrowLeft'?step:0),(e.key==='ArrowDown'?step:0)-(e.key==='ArrowUp'?step:0));if(n){save();state.strokes[state.strokes.indexOf(s)]=n;changed('move',{id:s.id});}}};
 async function next(){
  let requestId=null;
  if(pending||state.gesture||(!state.strokes.length&&!state.paperText.trim()))return notice('先写一点，或留下一笔。');
  if(state.paperNotes.length>=200)return notice('这张纸的批注已满，请先保存或整理后继续。');
  if(!needsReply(state)){notice('这一版已经回应过；改一点，再留给它。');return false;}
  pending=true;waitingAt=performance.now();$('next').disabled=true;note=$('cue').value;caption='AI 回应';notice('正在接笔，可以先收起。');foldedStatus('正在接笔…','waiting');
  const v=state.version,sentChanges=clone(changes),snapshot=clone(state.strokes);log('request',{cue:note,strokeIds:snapshot.map(s=>s.id)});
  try{
   const response=await fetch('/api/next',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:v,strokes:snapshot,cue:note,changes:sentChanges,paperText:state.paperText,paperNotes:state.paperNotes.slice(-20).map(n=>n.text),image:paperImage()})});
   const reply=await response.json();requestId=reply.requestId;if(!response.ok)throw Error(reply.error);
   if(!acceptsReply(state,v,reply.version)){log('stale-reply',{requestId:reply.requestId});caption='纸面已修改 · 保留你的新笔画';notice('保留了你刚改的这一版；准备好再交给它。');foldedStatus('纸面已改 · 点开继续','idle');return false;}
   const nextStrokes=applyContribution(state.strokes,reply);
   save();state.strokes=nextStrokes;if(reply.note){state.paperNotes.push({id:reply.requestId,text:reply.note});}state.version++;state.answeredVersion=state.version;if($('cue').value===note)$('cue').value='';changes.length=0;selected=null;persist();renderNotes();unread=!isOpen;foldedStatus('有新回应','ready');
   reveal={ids:new Set(reply.strokes.map(s=>s.id)),started:performance.now()};
   const receivedMs=+(performance.now()-waitingAt).toFixed(1);
   if(isOpen)await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const result={requestId:reply.requestId,model:reply.model,version:v,modelMs:reply.modelMs,draftMs:reply.draftMs,reviewMs:reply.reviewMs,repairMs:reply.repairMs,serverMs:reply.serverMs,receivedMs,visibleMs:isOpen?+(performance.now()-waitingAt).toFixed(1):null,doneReason:reply.doneReason,revisionMode:reply.revisionMode,strokeIds:reply.strokes.map(s=>s.id),removed:reply.remove??[],labels:reply.strokes.map(s=>s.label),note:reply.note};
   results.push(result);log('applied',result);const li=document.createElement('li');li.textContent=`第 ${results.length} 轮　${((result.visibleMs??result.receivedMs)/1000).toFixed(2)} s　·　${reply.strokes.length} 笔${result.visibleMs===null?' · 收起时完成':''}`; $('history').append(li);caption='接着画，也可以改掉';notice('回应到了。你可以接着写，也可以改掉。');return true;
  }catch(e){log('error',{requestId,message:e.message,waitMs:+(performance.now()-waitingAt).toFixed(1)});notice(e.message);foldedStatus('这次没接上 · 点开重试','error');caption='这一轮没有生成';return false;}
  finally{pending=false;$('next').disabled=false;}
 }
 $('next').onclick=()=>{if(!demo)next();};
 async function humanDraw(points,smooth=true){
  let dense=flowPoints(points);
  if(!smooth){dense=[];for(let i=0;i<points.length-1;i++)for(let j=0;j<10;j++)dense.push(points[i].map((x,k)=>x+(points[i+1][k]-x)*j/10));dense.push(points.at(-1));}
  state.gesture={type:'draw',points:[dense[0]]};for(const p of dense){state.gesture.points.push(p);cursor=p;await sleep(10);}state.gesture=null;cursor=null;return addStroke(dense);
 }
 async function upload(run,kind,data){const r=await fetch(`/api/evidence/${run}/${kind}`,{method:'POST',body:data});if(!r.ok)throw Error('录像保存失败，请保留页面');}
 async function capture(run){await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const image=await new Promise(resolve=>canvas.toBlob(resolve));await upload(run,'png',image);}
 async function runDemo(){
  if(pending||demo)return;
  if(!sceneMode){window.open('/?scenarios=1','_blank');return;}
  const scene=SCENARIOS.find(x=>x.id===$('scenario').value);if(!scene)return;
  setOpen(true);save();reset();state.paperText=scene.text;$('paper-text').value=state.paperText;changed('edit-text');$('cue').value='';
  demo=true;$('paper-text').disabled=true;$('scenario').disabled=true;recording=true;recordStart=performance.now();chunks=[];const run='scene-'+scene.id+'-'+Date.now(),ids={},stages=[];
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  const stream=canvas.captureStream(30);recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1800000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.start(1000);
  let success=false;
  async function turn(number){
   caption=scene.title+' · 第 '+number+' 轮';const input=snapshot();await capture(run+'-r'+number+'-input');
   const ok=Boolean(await next());await sleep(700);caption=scene.title+(ok?' · 回应到了':' · 本轮失败');
   await capture(run+'-r'+number+'-output');stages.push({number,ok,input,output:snapshot(),result:ok?clone(results.at(-1)):null,error:ok?null:clone(events.filter(e=>e.type==='error'||e.type==='stale-reply').at(-1))});await sleep(1600);
  }
  try{
   caption=scene.title+' · 人的输入';await sleep(700);
   for(const stroke of scene.strokes)ids[stroke.name]=await humanDraw(stroke.points,Boolean(stroke.smooth));
   await turn(1);caption='人修改 · '+scene.title;
   for(const action of scene.actions){
    if(action.type==='erase'){selected=ids[action.name];await sleep(350);erase(selected);}
    if(action.type==='draw')await humanDraw(action.points,Boolean(action.smooth));
    if(action.type==='move'){
     save();const originals=action.names.map(name=>clone(state.strokes.find(s=>s.id===ids[name])));
     for(let i=1;i<=24;i++){for(const original of originals){const moved=translateStroke(original,action.dx*i/24,action.dy*i/24);if(!moved)throw Error('测试移动超出纸面');state.strokes[state.strokes.findIndex(s=>s.id===original.id)]=moved;}await sleep(20);}
     changed('move',{ids:originals.map(s=>s.id),dx:action.dx,dy:action.dy});
    }
   }
   selected=null;state.paperText+='\n'+scene.correction;$('paper-text').value=state.paperText;changed('edit-text');$('cue').value='';await sleep(600);
   await turn(2);success=stages.every(stage=>stage.ok);await sleep(1600);
  }finally{
   recording=false;await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});stream.getTracks().forEach(t=>t.stop());
   const report={run,scenario:scene,model,success,method:'Fixed synthetic everyday situations; scripted human edits; live model responses, one generation plus at most one format repair; no target drawing specified.',stages,results,events,finalStrokes:state.strokes,paperText:state.paperText,paperNotes:state.paperNotes,recordingMs:performance.now()-recordStart};
   try{await upload(run,'webm',new Blob(chunks,{type:'video/webm'}));await upload(run,'json',JSON.stringify(report,null,2));$('result').textContent='';const a=document.createElement('a');a.href='/evidence/'+run+'.webm';a.textContent='观看本场原速实录';a.target='_blank';$('result').append(a);const text=document.createElement('p');text.textContent=success?'两轮已返回；图形与回应质量另行评估。':'保留了本场失败与等待。';$('result').append(text);}catch(e){notice(e.message);}
   demo=false;$('paper-text').disabled=false;$('scenario').disabled=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('next').disabled=pending;
  }
 }
 $('demo').onclick=runDemo;
 try{const raw=localStorage.getItem(storageKey);if(raw){Object.assign(state,decodePaper(raw));$('paper-text').value=state.paperText;renderNotes();caption='接着这张纸';notice('上次的文字和笔画已恢复。');}}catch{canPersist=false;$('saved').textContent='原存档读取失败，已保留；新内容暂存当前页面，请勿关闭';}
 fetch('/api/status').then(r=>r.json()).then(d=>model=d.model).catch(()=>notice('服务未连接。'));
}
