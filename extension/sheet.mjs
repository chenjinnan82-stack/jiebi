// One shared, bounded paper. History records only replies actually put on it.
import {pathPoints,drawInk,checkNewLayout} from './ink.mjs';
export {inkCurves,layoutWarnings} from './ink.mjs';
const copy=structuredClone,ok=(v,m)=>{if(!v)throw Error(m);},id=/^[a-zA-Z0-9_-]{1,80}$/;
export const newSheet=()=>({schema:4,id:crypto.randomUUID(),version:0,userRevision:0,strokes:[],texts:[],groups:[],baseline:{strokes:[],texts:[],groups:[]},turns:[],appliedJobs:[]});
export const snapshot=p=>copy({strokes:p.strokes,texts:p.texts,groups:p.groups});
export const items=p=>[...p.strokes,...p.texts];
export function textLines(t){
 const lines=[''];let width=0;
 // Fixed advances make the editable paper, PNG, and server bounds agree across fonts.
 for(const ch of t.text){const step=ch.codePointAt(0)<=255?11:22;if(ch==='\n'){lines.push('');width=0;continue;}if(width+step>t.w){lines.push('');width=0;}lines[lines.length-1]+=ch;width+=step;}
 return lines;
}
export function bounds(s){
 if('text' in s)return {x:s.x,y:s.y,r:s.x+s.w,b:s.y+textLines(s).length*28};
 const ps=s.brush==='didan-v1'?pathPoints(s):[...s.points,...(s.curves?.flat()||[])];return {x:Math.min(...ps.map(p=>p[0])),y:Math.min(...ps.map(p=>p[1])),r:Math.max(...ps.map(p=>p[0])),b:Math.max(...ps.map(p=>p[1]))};
}
export function validateSnapshot(p){
 ok(Array.isArray(p.strokes)&&p.strokes.length<=100&&Array.isArray(p.texts)&&p.texts.length<=24&&Array.isArray(p.groups)&&p.groups.length<=124,'纸面内容超过限制。');
 const ids=new Set(),point=q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite)&&q[0]>=12&&q[0]<=600&&q[1]>=12&&q[1]<=600;
 for(const s of items(p)){ok(typeof s.id==='string'&&id.test(s.id)&&!ids.has(s.id)&&['human','ai'].includes(s.author)&&typeof s.humanEdited==='boolean','纸面对象无效。');ids.add(s.id);
  if('text' in s){ok(typeof s.text==='string'&&s.text.trim()&&s.text.length<=2000&&[s.x,s.y,s.w].every(Number.isFinite)&&s.w>=88,'文字无效。');}
  else{ok(Array.isArray(s.points)&&s.points.length>=1&&s.points.length<=1000&&s.points.every(point),'笔画坐标无效。');if(s.brush!==undefined)ok(s.brush==='didan-v1'&&['auto','flow','corner'].includes(s.line),'画笔格式无效。');if(s.curves)ok(Array.isArray(s.curves)&&s.curves.length<=64&&s.curves.every(c=>Array.isArray(c)&&c.length>=2&&c.length<=4&&c.every(point)),'曲线无效。');}
  const b=bounds(s);ok(b.x>=12&&b.y>=12&&b.r<=600&&b.b<=600,'内容放不下，请缩短文字或调整位置。');
 }
 ok(p.texts.reduce((n,t)=>n+t.text.length,0)<=4000,'这一页文字太多，请先整理。');
 const members=new Set(),gids=new Set();for(const g of p.groups){ok(typeof g.id==='string'&&id.test(g.id)&&!gids.has(g.id)&&Array.isArray(g.itemIds)&&g.itemIds.length>0,'编组无效。');gids.add(g.id);for(const key of g.itemIds){ok(ids.has(key)&&!members.has(key),'编组对象无效。');members.add(key);}}
 return p;
}
export function validateSheet(p){
 ok(p?.schema===4&&/^[a-f0-9-]{36}$/.test(p.id)&&Number.isSafeInteger(p.version)&&p.version>=0&&Number.isSafeInteger(p.userRevision)&&p.userRevision>=0&&p.userRevision<=p.version,'纸面存档无法读取，原记录已保留。');validateSnapshot(p);validateSnapshot(p.baseline);
 ok(Array.isArray(p.turns)&&p.turns.length<=2&&JSON.stringify(p.turns).length<=600000&&Array.isArray(p.appliedJobs)&&p.appliedJobs.length<=64,'往来记录无效。');return p;
}
export function differences(before,after){
 const a=new Map(items(before).map(s=>[s.id,s])),b=new Map(items(after).map(s=>[s.id,s])),out=[];
 for(const [key,value] of a){if(!b.has(key))out.push({type:'erase',before:value,after:null});else if(JSON.stringify(value)!==JSON.stringify(b.get(key)))out.push({type:'change',before:value,after:b.get(key)});}
 for(const [key,value] of b)if(!a.has(key))out.push({type:'add',before:null,after:value});
 if(JSON.stringify(before.groups)!==JSON.stringify(after.groups))out.push({type:'groups',before:before.groups,after:after.groups});return copy(out);
}
export function editSheet(p,next){next=copy(next);next.version=p.version+1;next.userRevision=next.version;return validateSheet(next);}
export function selectedMembers(p,selected){const ids=new Set(selected);for(const g of p.groups)if(g.itemIds.some(i=>ids.has(i)))g.itemIds.forEach(i=>ids.add(i));return [...ids].filter(i=>items(p).some(s=>s.id===i));}
export function moveItems(p,selected,dx,dy){
 if(![dx,dy].every(Number.isFinite))return null;const ids=new Set(selectedMembers(p,selected)),n=copy(p);
 n.strokes=n.strokes.map(s=>ids.has(s.id)?{...s,points:s.points.map(p=>[p[0]+dx,p[1]+dy]),...(s.curves?{curves:s.curves.map(c=>c.map(p=>[p[0]+dx,p[1]+dy]))}:{}),humanEdited:true}:s);n.texts=n.texts.map(t=>ids.has(t.id)?{...t,x:t.x+dx,y:t.y+dy,humanEdited:true}:t);
 try{return validateSheet(n);}catch{return null;}
}
export function eraseItems(p,selected,expand=true){const ids=new Set(expand?selectedMembers(p,selected):selected),n=copy(p);n.strokes=n.strokes.filter(s=>!ids.has(s.id));n.texts=n.texts.filter(s=>!ids.has(s.id));n.groups=n.groups.map(g=>({...g,itemIds:g.itemIds.filter(i=>!ids.has(i))})).filter(g=>g.itemIds.length);return n;}
export function groupItems(p,selected,ungroup=false){const ids=selectedMembers(p,selected),n=copy(p);n.groups=n.groups.filter(g=>!g.itemIds.some(i=>ids.includes(i)));if(!ungroup&&ids.length>1)n.groups.push({id:'g-'+crypto.randomUUID(),itemIds:ids});for(const s of items(n))if(ids.includes(s.id))s.humanEdited=true;return n;}
export function undoSheet(p,previous){const n=copy(previous);for(const s of items(n))if(s.author==='ai'&&JSON.stringify(s)!==JSON.stringify(items(p).find(v=>v.id===s.id)))s.humanEdited=true;n.version=p.version+1;n.userRevision=n.version;n.appliedJobs=[...new Set([...previous.appliedJobs,...p.appliedJobs])];n.turns=copy(p.turns);n.baseline=copy(p.baseline);return validateSheet(n);}
export function applySheetJob(p,job){
 ok(job.protocol==='paper.v2'&&job.status==='ready'&&job.paperId===p.id,'回应不属于这张纸。');if(p.appliedJobs.includes(job.jobId))return p;ok(job.baseVersion===p.version,'旧回应留在往来里。');
 const r=job.result;ok(r&&r.version===p.version&&['contribute','pause'].includes(r.decision)&&Array.isArray(r.strokes)&&r.strokes.length<=12&&Array.isArray(r.texts)&&r.texts.length<=3&&Array.isArray(r.remove)&&r.remove.length<=24,'回应格式无效。');
 if(r.decision==='pause')ok(!r.strokes.length&&!r.texts.length&&!r.remove.length,'停笔回应不能修改纸面。');else ok(r.strokes.length+r.texts.length+r.remove.length>0,'回应为空。');
 ok(r.texts.reduce((n,t)=>n+(typeof t.text==='string'?[...t.text].length:81),0)<=80,'回应文字过长。');
 const current=new Map(items(p).map(s=>[s.id,s]));ok(new Set(r.remove).size===r.remove.length,'撤回对象重复。');for(const key of r.remove){const s=current.get(key);ok(s?.author==='ai'&&!s.humanEdited,'你写过或改过的内容不能被助手撤回。');}
 const n=eraseItems(p,r.remove,false),groups=new Map(n.groups.map(g=>[g.id,g])),free=[];
 for(const s of [...r.strokes,...r.texts]){ok(s.author==='ai'&&s.humanEdited===false&&!current.has(s.id),'新内容身份无效。');if(s.attachTo){ok(groups.has(s.attachTo),'附着的编组已不存在。');groups.get(s.attachTo).itemIds.push(s.id);}else free.push(s.id);}
 n.strokes.push(...copy(r.strokes));n.texts.push(...copy(r.texts));if(free.length)n.groups.push({id:'reply-'+job.jobId,itemIds:free});n.version++;n.appliedJobs.push(job.jobId);
 const prior=job.paper||snapshot(p),changes=job.context?.changes??differences(p.baseline,prior);
 n.turns=[...p.turns,{jobId:job.jobId,human:{texts:copy(prior.texts),changes:copy(changes)},assistant:copy(r)}].slice(-2);n.baseline=snapshot(n);validateSheet(n);checkNewLayout(p,r.strokes,r.texts,r.remove);return n;
}
export function requestSheet(p,image){return {protocol:'paper.v2',jobId:crypto.randomUUID(),paperId:p.id,version:p.version,...snapshot(p),context:{turns:copy(p.turns),changes:differences(p.baseline,p)},image};}
export function previewSheetJob(job){const p={...newSheet(),...copy(job.paper),id:job.paperId,version:job.baseVersion};const n=eraseItems(p,job.result.remove,false);n.strokes.push(...copy(job.result.strokes));n.texts.push(...copy(job.result.texts));validateSnapshot(n);return n;}
export function strokePath(x,s){x.beginPath?.();if(s.brush==='didan-v1'){const p=pathPoints(s);x.moveTo(...p[0]);p.slice(1).forEach(q=>x.lineTo(...q));return;}if(s.curves)for(const c of s.curves){x.moveTo(...c[0]);if(c.length===4)x.bezierCurveTo(...c[1],...c[2],...c[3]);else if(c.length===3)x.quadraticCurveTo(...c[1],...c[2]);else x.lineTo(...c[1]);}else{const p=s.points;x.moveTo(...p[0]);if(p.length<3)x.lineTo(...p.at(-1));else for(let i=1;i<p.length-1;i++){const end=i===p.length-2?p.at(-1):p[i].map((v,k)=>(v+p[i+1][k])/2);x.quadraticCurveTo(...p[i],...end);}}}
export function paintSheet(canvas,p,{selection=[],gesture=null,hideText=null,grid=false,reveal=null}={}){
 const x=canvas.getContext('2d');x.clearRect(0,0,612,612);x.fillStyle='#fafbf7';x.fillRect(0,0,612,612);x.lineCap=x.lineJoin='round';x.lineWidth=3.1;
 if(grid){x.font='10px sans-serif';for(let n=5;n<=50;n+=5){x.strokeStyle='#e3e9e6';x.lineWidth=.5;x.beginPath();x.moveTo(n*12,0);x.lineTo(n*12,612);x.moveTo(0,n*12);x.lineTo(612,n*12);x.stroke();x.fillStyle='#77847d';x.fillText(String(n*12),n*12-8,10);x.fillText(String(n*12),0,n*12);}x.lineWidth=3.1;}
 for(const s of p.strokes){x.strokeStyle=s.author==='human'?'#316c67':'#9d5c6e';if(s.brush==='didan-v1')drawInk(x,s,reveal?.ids.includes(s.id)?reveal.progress:1);else{x.lineWidth=3.1;strokePath(x,s);x.stroke();}}
 x.font='22px "Kaiti SC","STKaiti",serif';x.textBaseline='top';for(const t of p.texts){if(t.id===hideText)continue;x.fillStyle=t.author==='human'?'#316c67':'#814556';textLines(t).forEach((line,i)=>{let dx=t.x;for(const ch of line){const step=ch.codePointAt(0)<=255?11:22;x.fillText(ch,dx,t.y+i*28,step);dx+=step;}});}
 if(gesture?.type==='draw'){x.strokeStyle='#316c67';drawInk(x,{points:gesture.points,brush:'didan-v1',line:'auto'});}
 const bs=items(p).filter(s=>selection.includes(s.id)).map(bounds);let b=bs.length?{x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),r:Math.max(...bs.map(b=>b.r)),b:Math.max(...bs.map(b=>b.b))}:null;
 if(gesture?.type==='marquee')b={x:Math.min(gesture.start[0],gesture.current[0]),y:Math.min(gesture.start[1],gesture.current[1]),r:Math.max(gesture.start[0],gesture.current[0]),b:Math.max(gesture.start[1],gesture.current[1])};
 if(b){x.strokeStyle='#789f97';x.lineWidth=1.5;x.setLineDash([5,5]);x.strokeRect(b.x-5,b.y-5,b.r-b.x+10,b.b-b.y+10);x.setLineDash([]);}
}
