"""Called by check_extension.py: rendering geometry and placement must agree on both sides."""
import json
import math
import subprocess
import ink

cases = [
    {'points':[[120,240],[210,230],[210,330],[120,340],[120,240]],'brush':'didan-v1','line':'auto'},
    {'points':[[150,200],[145,185],[155,170],[148,155]],'brush':'didan-v1','line':'flow'},
    {'points':[[400,330],[435,380],[475,380]],'brush':'didan-v1','line':'corner'},
    {'points':[[12,12],[300,600],[600,12]],'brush':'didan-v1','line':'flow'},
    {'points':[[300,300],[300,300]],'brush':'didan-v1','line':'auto'},
]
js = '''import {inkCurves,pathPoints,pressure,checkNewLayout} from './extension/ink.mjs';
const cases=JSON.parse(process.argv[1]);console.log(JSON.stringify(cases.map(s=>({curves:inkCurves(s.points,s.line),points:pathPoints(s)}))));'''
other = json.loads(subprocess.check_output(['node','--input-type=module','-e',js,json.dumps(cases)],text=True))
for s, got in zip(cases,other):
    assert got['curves'] == ink.ink_curves(s['points'],s['line'])
    expected = ink.path_points(s)
    assert len(got['points']) == len(expected)
    assert all(math.dist(a,b)<1e-9 for a,b in zip(got['points'],expected))
    assert got['points'][0] == s['points'][0] and got['points'][-1] == s['points'][-1]
book = other[0]['points']
assert all(any(math.dist(p,q)<1e-9 for q in book) for p in cases[0]['points']), 'corners must survive'
text={'id':'human-text','text':'保留原话','x':200,'y':200,'w':220}
cross={'points':[[100,210],[400,210]],'brush':'didan-v1','line':'corner'}
data={'texts':[text],'strokes':[]}
try: ink.check_new_layout(data,[cross],[])
except ValueError: pass
else: raise AssertionError('crossing ink accepted')
ink.check_new_layout(data,[{**cross,'points':[[100,235],[400,235]]}],[])
subprocess.run(['node','--input-type=module','-e',r'''
import assert from 'node:assert/strict';
import {inkCurves,drawInk,pressure,checkNewLayout,layoutWarnings} from './extension/ink.mjs';
import {newSheet,bounds,moveItems} from './extension/sheet.mjs';
const text={id:'t',text:'保留原话',x:200,y:200,w:220},cross={points:[[100,210],[400,210]],brush:'didan-v1',line:'corner'};
assert.throws(()=>checkNewLayout({texts:[text],strokes:[]},[cross],[]));
assert.throws(()=>checkNewLayout({texts:[],strokes:[cross]},[],[text]));
checkNewLayout({texts:[text],strokes:[]},[{...cross,points:[[100,235],[400,235]]}],[]);
assert.deepEqual(layoutWarnings({texts:[text],strokes:[cross]}),['t']);
const shapes=[];const ctx=new Proxy({moveTo(...p){shapes.push(p)},lineTo(...p){shapes.push(p)}},{get:(o,k)=>k in o?o[k]:()=>{}});
drawInk(ctx,cross);assert.deepEqual(shapes[0],cross.points[0]);assert.deepEqual(shapes.at(-1),cross.points.at(-1));
const original=JSON.stringify(cross);drawInk(ctx,cross,.4);drawInk(ctx,cross,.4,true);assert.equal(JSON.stringify(cross),original);
const reference=[[0,1.042957210604833],[10,1.041458350240241],[40,1.0219731655005442],[100,.9492784378178294],[250,.9843960730828051],[600,1.058675203408349],[1000,1.0501523290412638]];
for(const [d,w] of reference)assert(Math.abs(pressure(d)-w)<1e-12);
const bent={id:'curved',author:'human',humanEdited:false,points:[[100,200],[140,200],[180,230]],brush:'didan-v1',line:'flow'},paper={...newSheet(),strokes:[bent]};
assert(bounds(bent).y<200,'selection includes the curve beyond raw points');
const moved=moveItems(paper,['curved'],20,10);assert(Math.abs(bounds(moved.strokes[0]).y-bounds(bent).y-10)<1e-9);
shapes.length=0;drawInk(ctx,cross,0);assert.equal(shapes.length,0);
shapes.length=0;drawInk(ctx,cross,1,true);assert.equal(shapes.length,0);
let dots=0;const dotCtx=new Proxy({arc(){dots++;}},{get:(o,k)=>k in o?o[k]:()=>{}}),dot={points:[[40,40]],brush:'didan-v1',line:'auto'};
drawInk(dotCtx,dot,0,true);assert.equal(dots,1);drawInk(dotCtx,dot,1,true);assert.equal(dots,1);
console.log('PASS: preserved corners/closure, frontend/backend geometry parity, ink/text collision, rendered selection bounds, immutable draw/retract, original-engine pressure');
'''],check=True)
