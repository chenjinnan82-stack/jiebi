// Current paper is the source of truth. A delayed reply never replaces user work.
export function acceptsReply(state, requestedVersion, replyVersion) {
  return !state.gesture && state.version === requestedVersion && replyVersion === requestedVersion;
}
export function applyContribution(strokes, reply) {
  const ids=reply.remove??[], allowed=new Set(strokes.filter(s=>s.author==='ai').map(s=>s.id));
  if(!Array.isArray(ids)||ids.length>12||new Set(ids).size!==ids.length||ids.some(id=>!allowed.has(id)))throw Error('助手只能撤回自己的笔画，原纸面已保留。');
  const next=[...strokes.filter(s=>!ids.includes(s.id)),...reply.strokes];
  if(next.length>100)throw Error('这张纸的笔画已满，本次返回未加入，原内容已保留。');
  return next;
}
export function translateStroke(stroke, dx, dy) {
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return null;
  const points = stroke.points.map(([x,y]) => [x+dx,y+dy]);
  const curves=stroke.curves?.map(c=>c.map(([x,y])=>[x+dx,y+dy]));
  if ([...points,...(curves?.flat()??[])].some(([x,y]) => x<12 || x>611 || y<0 || y>599)) return null;
  return {...stroke, points, curves};
}

export function decodePaper(raw) {
  if(typeof raw!=='string'||raw.length>3000000)throw Error('存档大小无效');
  const p=JSON.parse(raw), finitePoint=q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite)&&q[0]>=12&&q[0]<=611&&q[1]>=0&&q[1]<=599;
  if(p.schema!==2||!Number.isSafeInteger(p.version)||p.version<0||!Array.isArray(p.strokes)||p.strokes.length>100||typeof p.paperText!=='string'||p.paperText.length>2000||!Array.isArray(p.paperNotes)||p.paperNotes.length>200)throw Error('存档格式无效');
  const ids=new Set();
  for(const s of p.strokes){if(typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)||ids.has(s.id)||!['human','ai'].includes(s.author)||!Array.isArray(s.points)||s.points.length<1||s.points.length>1000||!s.points.every(finitePoint))throw Error('存档笔画无效');ids.add(s.id);if(s.curves&&(!Array.isArray(s.curves)||s.curves.length>64||!s.curves.every(c=>Array.isArray(c)&&c.length>=2&&c.length<=4&&c.every(finitePoint))))throw Error('存档曲线无效');}
  if(!p.paperNotes.every(n=>typeof n.id==='string'&&typeof n.text==='string'&&n.text.length<=80))throw Error('存档文字无效');
  return {strokes:p.strokes,version:p.version,paperText:p.paperText,paperNotes:p.paperNotes,answeredVersion:Number.isSafeInteger(p.answeredVersion)&&p.answeredVersion<=p.version?p.answeredVersion:-1};
}

export function flowPoints(points) {
 const ps=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);
 if(ps.length<3)return ps;
 const mid=(a,b)=>a.map((x,k)=>(x+b[k])/2), closed=ps[0].every((x,k)=>x===ps.at(-1)[k]);
 if(closed)ps.pop();if(ps.length<3)return closed?[ps[0],ps.at(-1),ps[0]]:[ps[0],ps.at(-1)];
 const curves=[];
 if(closed){for(let i=0;i<ps.length;i++)curves.push([mid(ps[(i+ps.length-1)%ps.length],ps[i]),ps[i],mid(ps[i],ps[(i+1)%ps.length])]);}
 else{let start=ps[0];for(let i=1;i<ps.length-1;i++){const end=i===ps.length-2?ps.at(-1):mid(ps[i],ps[i+1]);curves.push([start,ps[i],end]);start=end;}}
 const out=[];for(const [a,b,c] of curves)for(let j=0;j<10;j++){const t=j/10;out.push(a.map((x,k)=>(1-t)**2*x+2*t*(1-t)*b[k]+t*t*c[k]));}out.push(curves.at(-1)[2]);return out;
}

export const needsReply = state => Boolean(state.strokes.length || state.paperText.trim()) && state.answeredVersion !== state.version;

// The extension and the legacy study share these geometry and paper rules.
export const newPaper = () => ({schema:3,id:crypto.randomUUID(),version:0,userRevision:0,strokes:[],groups:[],paperText:'',paperNotes:[],appliedJobs:[],changes:[]});
export function validatePaper(p) {
 if(!p||p.schema!==3||typeof p.id!=='string'||!/^[a-f0-9-]{36}$/.test(p.id))throw Error('纸面存档无法读取，原记录已保留。');
 decodePaper(JSON.stringify({...p,schema:2}));
 const gids=new Set(),members=new Set(),ids=new Set(p.strokes.map(s=>s.id));
 if(!Array.isArray(p.groups)||p.groups.length>100)throw Error('编组无效');
 for(const g of p.groups){if(!g||typeof g.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(g.id)||gids.has(g.id)||!Array.isArray(g.strokeIds)||!g.strokeIds.length)throw Error('编组无效');gids.add(g.id);for(const id of g.strokeIds){if(!ids.has(id)||members.has(id))throw Error('编组笔画无效');members.add(id);}}
 if(!Array.isArray(p.appliedJobs)||p.appliedJobs.length>64||!p.appliedJobs.every(x=>typeof x==='string'))throw Error('回应记录无效');
 if(!Array.isArray(p.changes)||JSON.stringify(p.changes).length>12000)throw Error('修改记录无效');
 if(p.userRevision!==undefined&&(!Number.isSafeInteger(p.userRevision)||p.userRevision<0||p.userRevision>p.version))throw Error('编辑记录无效');
 return p;
}
export function selectionMembers(p,selected) {
 const ids=new Set(selected);
 for(const g of p.groups)if(g.strokeIds.some(id=>ids.has(id)))for(const id of g.strokeIds)ids.add(id);
 return [...ids].filter(id=>p.strokes.some(s=>s.id===id));
}
export function groupSelection(p,selected) {
 const ids=selectionMembers(p,selected);if(ids.length<2)throw Error('先选中至少两笔。');
 const n=structuredClone(p);n.groups=n.groups.filter(g=>!g.strokeIds.some(id=>ids.includes(id)));
 n.groups.push({id:'g-'+crypto.randomUUID(),strokeIds:ids});return n;
}
export function ungroupSelection(p,selected) {
 const n=structuredClone(p);n.groups=n.groups.filter(g=>!g.strokeIds.some(id=>selected.includes(id)));return n;
}
export function moveSelection(p,selected,dx,dy) {
 const ids=new Set(selectionMembers(p,selected)),n=structuredClone(p);
 n.strokes=n.strokes.map(s=>ids.has(s.id)?translateStroke(s,dx,dy):s);
 if(n.strokes.some(s=>s===null))return null;
 return n;
}
export function eraseSelection(p,selected,expand=true) {
 const ids=new Set(expand?selectionMembers(p,selected):selected),n=structuredClone(p);
 n.strokes=n.strokes.filter(s=>!ids.has(s.id));n.groups=n.groups.map(g=>({...g,strokeIds:g.strokeIds.filter(id=>!ids.has(id))})).filter(g=>g.strokeIds.length);return n;
}
export function applyJob(p,job) {
 if(job.protocol!=='paper.v1'||job.status!=='ready'||job.paperId!==p.id)throw Error('这条回应不属于当前纸面。');
 if(p.appliedJobs.includes(job.jobId))return p;
 if(job.baseVersion!==p.version)throw Error('你后来改过这一页，回应保留在交出时的版本。');
 const r=job.result,n=structuredClone(p),groups=new Map(p.groups.map(g=>[g.id,{...g,strokeIds:[...g.strokeIds]}]));
 if(!r||r.version!==p.version||!Array.isArray(r.strokes)||r.strokes.length>12||!r.strokes.every(s=>s.author==='ai')||typeof r.note!=='string'||r.note.length>80)throw Error('回应格式无效，原纸面保留。');
 for(const s of r.strokes)if(s.attachTo&&!groups.has(s.attachTo))throw Error('回应依附的编组已不存在。');
 n.strokes=applyContribution(n.strokes,r);const kept=new Set(n.strokes.map(s=>s.id));
 for(const g of groups.values())g.strokeIds=g.strokeIds.filter(id=>kept.has(id));
 const free=[];for(const s of r.strokes){if(s.attachTo)groups.get(s.attachTo).strokeIds.push(s.id);else free.push(s.id);}
 n.groups=[...groups.values()].filter(g=>g.strokeIds.length);if(free.length)n.groups.push({id:'reply-'+job.jobId,strokeIds:free});
 if(r.note)n.paperNotes.push({id:job.jobId,text:r.note});
 n.version++;n.appliedJobs.push(job.jobId);n.changes=[];return validatePaper(n);
}
export function previewJob(job) {
 const p=job.paper;
 return applyJob({schema:3,id:job.paperId,version:job.baseVersion,strokes:p.strokes,groups:p.groups,paperText:p.paperText,paperNotes:p.paperNotes.map((text,i)=>({id:'old-'+i,text})),appliedJobs:[],changes:[]},job);
}
export function undoPaper(current,previous) {
 return validatePaper({...structuredClone(previous),version:current.version+1,userRevision:current.version+1,appliedJobs:[...new Set([...previous.appliedJobs,...current.appliedJobs])],changes:[{type:'undo'}]});
}
