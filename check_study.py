"""One small runnable check: .venv/bin/python check_study.py"""
import json
import subprocess
import study
from unittest.mock import Mock
# Never inherit a paid provider from the developer's local .env in an offline check.
study.PROVIDER = 'ollama'
study.nebius.chat = Mock(side_effect=AssertionError('Paid model calls are forbidden in this check'))

def must_reject(fn):
    try:
        fn()
    except (ValueError, SyntaxError):
        return
    raise AssertionError("invalid input accepted")

stroke={"id":"human-a","author":"human","points":[[200,200],[300,250]]}
assert study.encode_strokes(study.validate_strokes([stroke]))[0]["id"]=="human-a"
assert study.encode_strokes([])==[]  # erased geometry is not reconstructed from history
must_reject(lambda:study.validate_strokes([stroke,stroke]))
must_reject(lambda:study.validate_strokes([{**stroke,"points":[[float('nan'),10]]}]))
valid="<strokes><s1><points>'x10y20','x20y20'</points><t_values>0,1</t_values><id>line</id></s1></strokes>"
result=study.parse_reply(valid)
assert len(result)==1 and result[0]["curves"][0][0]==[126.0,366.0]
assert study.parse_reply(valid.replace("'",''))[0]['cells']==result[0]['cells']
assert study.grid_point('x24y31.5')==[294,228]
must_reject(lambda:study.grid_point('x24y50.5'))
must_reject(lambda:study.grid_point('xNaNy20'))
must_reject(lambda:study.parse_reply(valid.replace('x10y20','x999y20')))
must_reject(lambda:study.parse_reply(valid.replace('0,1','0.8,0.2')))
subprocess.run(['node','--input-type=module','-e',"""
import assert from 'node:assert/strict';
import {acceptsReply,applyContribution,translateStroke,decodePaper,flowPoints,needsReply} from './static/study.mjs';
assert(acceptsReply({version:3,gesture:null},3,3));
assert(!acceptsReply({version:4,gesture:null},3,3));
assert(!acceptsReply({version:3,gesture:{}},3,3));
assert(!acceptsReply({version:3,gesture:null},3,2));
const marks=[{id:'h',author:'human'},{id:'a',author:'ai'}], before=structuredClone(marks);
assert.deepEqual(applyContribution(marks,{remove:['a'],strokes:[]}),[marks[0]]);
assert.throws(()=>applyContribution(marks,{remove:['h'],strokes:[]}));
assert.throws(()=>applyContribution(marks,{remove:['missing'],strokes:[]}));
assert.deepEqual(marks,before); // Validated before one undoable state replacement.
assert.equal(translateStroke({points:[[20,10]]},-30,0),null);
assert.deepEqual(translateStroke({points:[[20,10]]},5,5).points,[[25,15]]);
const paper={schema:2,version:3,strokes:[],paperText:'保留我的原话',paperNotes:[{id:'a',text:'一笔新的回应'}]};
assert(needsReply({...paper,answeredVersion:-1}));
assert(!needsReply({...paper,answeredVersion:3}));
assert(!needsReply({strokes:[],paperText:' ',version:1,answeredVersion:-1}));
const flowed=flowPoints([[20,20],[40,10],[60,20],[40,40],[20,20]]);
assert.deepEqual(flowed[0],flowed.at(-1));
assert(flowed.every(([x,y])=>x>=20&&x<=60&&y>=10&&y<=40));
assert.equal(decodePaper(JSON.stringify(paper)).paperText,'保留我的原话');
assert.equal(decodePaper(JSON.stringify(paper)).paperNotes[0].text,'一笔新的回应');
assert.throws(()=>decodePaper(JSON.stringify({...paper,paperNotes:[{id:'a',text:'x'.repeat(81)}]})));
assert.throws(()=>decodePaper(JSON.stringify({...paper,strokes:[{id:'a',author:'ai',points:[[Infinity,10]]}]})));

"""],check=True,cwd=study.ROOT)
# A closed triangle must stay within its model-provided control hull.
triangle=[[366,258],[402,282],[402,234],[366,258]]
curves=study.shape_curves(triangle)
flat=study.np.concatenate(curves)
assert flat[:,0].min()>=366 and flat[:,0].max()<=402
assert flat[:,1].min()>=234 and flat[:,1].max()<=282
assert study.np.allclose(curves[0][0],curves[-1][-1])
assert study.parse_note('<strokes></strokes><note>接着这一笔。</note>')=='接着这一笔。'
assert study.parse_reply('<strokes></strokes>')==[]
print('PASS: local corner bounds and closure, paper text persistence validation, short notes;  input bounds, duplicate IDs, deleted geometry, upstream grid coordinates, invalid model output, stale/in-progress edit rejection, move bounds')

# Smooth curves are tangent-continuous and stay inside the specified control hull.
loop=[[100,100],[200,80],[230,170],[140,220],[100,100]]
flow=study.flow_curves(loop)
for a,b in zip(flow,flow[1:]+flow[:1]):
    assert study.np.allclose(a[-1],b[0])
    assert study.np.allclose(a[-1]-a[-2],b[1]-b[0])
flat=study.np.concatenate(flow)
assert flat[:,0].min()>=100 and flat[:,0].max()<=230
assert flat[:,1].min()>=80 and flat[:,1].max()<=220
assert len(study.parse_reply(valid.replace('<id>line','<line>corner</line><id>line')))==1
study.require_finished({'done':True,'done_reason':'stop'})
must_reject(lambda:study.require_finished({'done':True,'done_reason':'length'}))
must_reject(lambda:study.require_finished({'done':False}))
many='<strokes>'+''.join(valid.split('<strokes>')[1].split('</strokes>')[0].replace('s1',f's{i}') for i in range(1,13))+'</strokes>'
assert len(study.parse_reply(many))==12
must_reject(lambda:study.parse_reply(many.replace('</strokes>',valid.split('<strokes>')[1])))
print('PASS: smooth tangent joins, geometry bounds, complete transport, 12-stroke limit, folded version deduplication')

# One bounded format-repair call; no live model or fabricated artwork in this check.
import io, base64, tempfile
from unittest.mock import patch
from pathlib import Path
buf=io.BytesIO();study.Image.new('RGB',(612,612),'white').save(buf,format='PNG')
body={'version':1,'strokes':[stroke],'paperText':'test','image':base64.b64encode(buf.getvalue()).decode()}
answers=[{'done':True,'done_reason':'stop','model':'test-only','message':{'content':'{"strokes":['}}, {'done':True,'done_reason':'stop','model':'test-only','message':{'content':json.dumps({'strokes':[{'points':['x10y20','x20y20'],'line':'flow'}],'note':'测试。'})}}]
old_calls=study.recent_calls[:];study.recent_calls.clear()
try:
 with tempfile.TemporaryDirectory() as tmp, patch.object(study,'EVIDENCE',Path(tmp)), patch.object(study.urllib.request,'urlopen',side_effect=[io.BytesIO(json.dumps(a).encode()) for a in answers]) as call:
  response=study.app.test_client().post('/api/next',base_url='http://127.0.0.1:5331',json=body)
  assert response.status_code==200,response.json
  assert response.json['revisionMode']=='format-repair' and call.call_count==2
  assert len(study.recent_calls)==2 and response.json['strokes'][0]['cells']==['x10y20','x20y20']
  study.recent_calls[:]=[study.time.monotonic()]*7
  blocked=study.app.test_client().post('/api/next',base_url='http://127.0.0.1:5331',json=body)
  assert blocked.status_code==422 and call.call_count==2
finally:study.recent_calls[:]=old_calls
print('PASS: malformed draft repaired once by a second model response; both calls budgeted; rate limit blocks before network')

compact=json.dumps({'strokes':[{'points':['x10y20','x20y20'],'line':'flow','label':'line'}],'note':'一起出去走走。'})
assert study.parse_reply(compact)[0]['cells']==study.parse_reply(valid)[0]['cells']
assert study.parse_note(compact)=='一起出去走走。'
assert study.parse_reply('```json\n'+compact+'\n```')[0]['cells']==['x10y20','x20y20']
must_reject(lambda:study.parse_reply('{"strokes":[{"points":[12,24]}]}'))
must_reject(lambda:study.parse_reply('{"strokes":[{"points":["x999y12"]}]}'))
print('PASS: compact JSON preserves exact grid points; malformed and out-of-range coordinates rejected')

own={**stroke,'id':'ai-old','author':'ai'}
assert study.parse_removals('{"remove":["ai-old"]}',[stroke,own])==['ai-old']
for ids in (['human-a'],['gone'],['ai-old','ai-old'],[{}]):
 must_reject(lambda:study.parse_removals(json.dumps({'remove':ids}),[stroke,own]))
# A valid answer is applied after ONE call, with its original points intact.
exact=json.dumps({'strokes':[{'points':['x12y20','x14y31','x22y27','x12y20'],'line':'corner','label':'outline'}],'remove':['ai-old'],'note':'测试。'})
answer={'done':True,'done_reason':'stop','model':'test-only','message':{'content':exact}}
study.recent_calls.clear()
try:
 with tempfile.TemporaryDirectory() as tmp, patch.object(study,'EVIDENCE',Path(tmp)), patch.object(study.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(answer).encode())) as call:
  response=study.app.test_client().post('/api/next',base_url='http://127.0.0.1:5331',json={**body,'strokes':[stroke,own]})
  assert response.status_code==200,response.json
  assert response.json['revisionMode']=='single-pass' and response.json['reviewMs']==0
  assert response.json['strokes'][0]['cells']==json.loads(exact)['strokes'][0]['points']
  assert response.json['remove']==['ai-old'] and call.call_count==1
finally:study.recent_calls[:]=old_calls
print('PASS: AI-only retraction, stale ID rejection, one successful call without resampling or self-review')
