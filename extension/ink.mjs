// Drawing adapter: didan engine.py Catmull-Rom and Canvas.stroke pressure; see ENGINE_SOURCE.md.
const knots=[0.4863814040322208,-0.47739197855012133,0.6693396196541893,-1.387294544591779,1.6658884296583851,-0.19093151720215018,0.534348860275093,0.7765517856706156,0.24475036791230823,0.17981042193094302,-1.3415846894089138,-0.181981246675258,-0.5421608675325712,0.0019796348329694513,-2.699809129792159,-1.5572260671045501,-0.29279262765162656,0.25906337944939367,-0.20108882150547897,-1.101499051061835,-0.5928336521004042,-0.42900735134868023,-3.0577086479032256,-0.7867013871002495,-0.7617730258994465,-0.6711413999247611,0.3184136926254216,-1.130970827184007,0.44536713452699267,0.3188168001902454,0.4385849039594994,0.25383156431474924,1.050175773879821,2.004460527114579,-0.19763568569087878,-0.8121394342727389,0.31682200611584804,2.0925269080115636,0.038608782529182595,-0.22249460235917928,-0.6398447180352261,-1.0741599708512688,-1.0951687335885425,2.8628395009144314,-0.709622665366715,-1.194224579785924,-0.25084332245145724,0.7393905655295224,-1.087997024360067,-0.7324326342243159,-0.07320457410159735,0.8200350961498665,-1.241126633645425,0.1955502880609766,1.8080516683110188,-0.9678441637296709,-1.1795215294750072,0.3346216819488625,0.7237116709142651,-0.3769257879770835,0.0015658497137481437,0.5647298218448799,0.785718147141622,0.052514849151286576];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
export function inkCurves(points,line='auto'){
 const p=points.filter((q,i)=>!i||!same(q,points[i-1]));if(p.length<2)return [[p[0],p[0]]];
 const closed=p.length>2&&same(p[0],p.at(-1));if(closed)p.pop();const n=p.length;
 const at=i=>p[closed?(i+n)%n:clamp(i,0,n-1)];
 const tangent=i=>{const a=at(i-1),b=at(i),c=at(i+1),u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-b[k]);const den=Math.hypot(...u)*Math.hypot(...v);
  if(line==='corner'||(line==='auto'&&den&&(u[0]*v[0]+u[1]*v[1])/den<.35))return [0,0];return c.map((x,k)=>(x-a[k])/6);};
 return Array.from({length:closed?n:n-1},(_,i)=>{const a=at(i),b=at(i+1),u=tangent(i),v=tangent((i+1)%n);return [a,a.map((x,k)=>clamp(x+u[k],12,600)),b.map((x,k)=>clamp(x-v[k],12,600)),b];});
}
export function pathPoints(s){
 let curves=s.curves||(s.brush==='didan-v1'?inkCurves(s.points,s.line):null);if(!curves){const p=s.points;if(p.length<3)return p;curves=[];let start=p[0];for(let i=1;i<p.length-1;i++){const end=i===p.length-2?p.at(-1):p[i].map((v,k)=>(v+p[i+1][k])/2);curves.push([start,p[i],end]);start=end;}}
 const out=[];for(const c of curves){const span=c.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-c[i][0],p[1]-c[i][1]),0),count=c.length===2?1:clamp(Math.ceil(span/4),2,128);for(let i=out.length?1:0;i<=count;i++){let a=c.map(p=>[...p]);const t=i/count;while(a.length>1)a=a.slice(1).map((p,j)=>p.map((v,k)=>a[j][k]*(1-t)+v*t));out.push(a[0]);}}return out;
}
export function pressure(distance){const x=distance*.006,idx=Math.floor(x)%63,t=x-Math.floor(x),f=t*t*(3-2*t);return .82+.3*(.5+.5*(knots[idx]*(1-f)+knots[idx+1]*f));}
// ponytail: <=100 stored strokes, a 128-entry cache; no animation loop for a resting paper.
const cache=new Map();
export function inkSegments(s){
 const key=JSON.stringify([s.points,s.curves,s.line]);if(cache.has(key))return cache.get(key);
 const p=pathPoints(s),out=[];let d=0;
 for(let i=1;i<p.length;i++){const length=Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]),steps=Math.max(1,Math.ceil(length/4));
  for(let j=0;j<steps;j++){const a=p[i-1].map((v,k)=>v+(p[i][k]-v)*j/steps),b=p[i-1].map((v,k)=>v+(p[i][k]-v)*(j+1)/steps);out.push({a,b,w:3.1*pressure(d+length*j/steps),start:d+length*j/steps,end:d+length*(j+1)/steps});}d+=length;}
 const value={segments:out,length:d};cache.set(key,value);if(cache.size>128)cache.delete(cache.keys().next().value);return value;
}
export function drawInk(x,s,progress=1,retract=false){
 const {segments,length}=inkSegments(s),limit=length*clamp(progress,0,1);if(!length){if(retract?progress<1:progress>0){x.beginPath();x.arc(...s.points[0],1.55,0,Math.PI*2);x.fillStyle=x.strokeStyle;x.fill();}return;}
 for(const seg of segments){if((!retract&&seg.start>=limit)||(retract&&seg.end<=limit))continue;let a=seg.a,b=seg.b;if(!retract&&seg.end>limit)b=a.map((v,k)=>v+(b[k]-v)*(limit-seg.start)/(seg.end-seg.start));if(retract&&seg.start<limit)a=a.map((v,k)=>v+(b[k]-v)*(limit-seg.start)/(seg.end-seg.start));x.lineWidth=seg.w;x.beginPath();x.moveTo(...a);x.lineTo(...b);x.stroke();}
}
export function textRects(t,pad=3){
 const lines=[{width:0}];for(const ch of t.text){const step=ch.codePointAt(0)<=255?11:22;if(ch==='\n'){lines.push({width:0});continue;}if(lines.at(-1).width+step>t.w)lines.push({width:0});lines.at(-1).width+=step;}
 return lines.flatMap((l,i)=>l.width?[{x:t.x-pad,y:t.y+i*28-pad,r:t.x+l.width+pad,b:t.y+i*28+24+pad}]:[]);
}
export const overlap=(a,b)=>a.x<b.r&&b.x<a.r&&a.y<b.b&&b.y<a.b;
function segmentBox(a,b,r){let lo=0,hi=1;const d=b.map((v,k)=>v-a[k]);for(const [p,q] of [[-d[0],a[0]-r.x],[d[0],r.r-a[0]],[-d[1],a[1]-r.y],[d[1],r.b-a[1]]]){if(!p){if(q<0)return false;}else{const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;}}return true;}
export function strokeTouchesText(s,t){const p=pathPoints(s);return textRects(t).some(r=>p.length===1?p[0][0]>=r.x&&p[0][0]<=r.r&&p[0][1]>=r.y&&p[0][1]<=r.b:p.slice(1).some((v,i)=>segmentBox(p[i],v,r)));}
export function layoutWarnings(p,ids=null){const wanted=ids?new Set(ids):null,out=[];for(const t of p.texts){if(wanted&&!wanted.has(t.id))continue;if(p.texts.some(o=>o.id!==t.id&&textRects(t).some(a=>textRects(o).some(b=>overlap(a,b))))||p.strokes.some(s=>strokeTouchesText(s,t)))out.push(t.id);}return out;}
export function checkNewLayout(p,strokes,texts,remove=[]){
 const keepText=p.texts.filter(t=>!remove.includes(t.id)),keepStrokes=p.strokes.filter(s=>!remove.includes(s.id));
 for(const t of texts){if([...keepText,...texts.filter(o=>o!==t)].some(o=>textRects(t).some(a=>textRects(o).some(b=>overlap(a,b)))))throw Error('新增文字与已有文字重叠。');if([...keepStrokes,...strokes].some(s=>strokeTouchesText(s,t)))throw Error('新增文字压住了笔画，请换到空白位置。');}
 for(const s of strokes)if([...keepText,...texts].some(t=>strokeTouchesText(s,t)))throw Error('新增笔画穿过文字，请避开原字。');
}
