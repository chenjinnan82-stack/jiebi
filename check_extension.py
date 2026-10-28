"""One local extension check: .venv/bin/python check_extension.py (no real model)."""
import base64, io, json, subprocess, tempfile, threading, time, uuid
from pathlib import Path
from unittest.mock import patch
from PIL import Image
import study
from handoff import Jobs


def rejected(fn):
    try: fn()
    except ValueError: return
    raise AssertionError('invalid operation accepted')

human={'id':'human-1','author':'human','points':[[100,100],[200,200]],'curves':[[[100,100],[200,200]]]}
group={'id':'group-1','strokeIds':['human-1']}
assert study.validate_strokes([human])[0]['curves']==human['curves']
assert study.validate_groups([group],[human])==[group]
rejected(lambda:study.validate_groups([group,{'id':'g2','strokeIds':['human-1']}],[human]))
rejected(lambda:study.validate_groups([{'id':'g2','strokeIds':['missing']}],[human]))
reply=study.parse_reply(json.dumps({'strokes':[{'points':['x10y20','x12y22'],'attachTo':'group-1'}],'note':''}))
study.validate_attachments(reply,[group]);rejected(lambda:study.validate_attachments(reply,[]))

subprocess.run(['node','--input-type=module','-e',r'''
import assert from 'node:assert/strict';
import {newPaper,groupSelection,moveSelection,eraseSelection,applyJob,undoPaper,validatePaper,previewJob} from './extension/paper.mjs';
let p=newPaper();p.version=4;p.paperText='保留原话';p.strokes=[{id:'h1',author:'human',points:[[100,100],[200,100]]},{id:'h2',author:'human',points:[[100,120],[200,120]]}];
p=groupSelection(p,['h1','h2']);const gid=p.groups[0].id;
const job={protocol:'paper.v1',status:'ready',jobId:crypto.randomUUID(),paperId:p.id,baseVersion:4,paper:{paperText:p.paperText,paperNotes:[],strokes:p.strokes,groups:p.groups},result:{version:4,remove:[],note:'测试批注',strokes:[{id:'a1',author:'ai',attachTo:gid,points:[[150,80],[160,70]],curves:[[[150,80],[160,70]]]}]}};
const n=applyJob(p,job);assert.equal(n.version,5);assert.equal(n.groups[0].strokeIds.length,3);assert.equal(n.paperText,p.paperText);assert.equal(applyJob(n,job),n);
assert.deepEqual(previewJob(job).strokes,n.strokes);
const moved=moveSelection(n,['h1'],30,15);assert.deepEqual(moved.strokes[2].points,[[180,95],[190,85]]);assert.deepEqual(moved.strokes[2].curves,[[[180,95],[190,85]]]);
assert.equal(moveSelection(n,['h1'],600,0),null);assert.equal(eraseSelection(n,['h1']).strokes.length,0);assert.equal(eraseSelection(n,['h1'],false).strokes.length,2);
assert.equal(moveSelection(n,['h1'],NaN,0),null);
const edge=structuredClone(n);edge.strokes[2].curves=[[[150,80],[600,70]]];assert.equal(moveSelection(edge,['h1'],20,0),null);
assert.throws(()=>applyJob({...p,version:5},job));assert.throws(()=>applyJob(p,{...job,paperId:crypto.randomUUID()}));assert.throws(()=>applyJob(p,{...job,result:{...job.result,remove:['h1']}}));
assert.throws(()=>applyJob(p,{...job,result:{...job.result,strokes:[{...job.result.strokes[0],attachTo:'missing'}]}}));
const restored=undoPaper(n,p);assert.equal(restored.version,6);assert.deepEqual(restored.strokes,p.strokes);assert(restored.appliedJobs.includes(job.jobId));validatePaper(restored);
console.log('PASS: group/attachment movement, boundaries, per-stroke erase, human protection, stale reply, idempotent apply, full response undo');
'''],check=True)

buffer=io.BytesIO();Image.new('RGB',(612,612),'white').save(buffer,format='PNG')
body={'protocol':'paper.v1','jobId':str(uuid.uuid4()),'paperId':str(uuid.uuid4()),'version':1,'strokes':[human],'groups':[group],'paperText':'测试','paperNotes':[],'image':base64.b64encode(buffer.getvalue()).decode()}
entered,release=threading.Event(),threading.Event();calls=[]
def fake(data):
    calls.append(data['jobId']);entered.set();assert release.wait(3)
    return {'version':data['version'],'strokes':[],'remove':[],'note':'程序检查，不是真实模型'},200

def terminal(jobs,jid):
    deadline=time.monotonic()+3
    while time.monotonic()<deadline:
        result=jobs.get(jid)
        if result['status'] in ('ready','failed'):return result
        time.sleep(.01)
    raise AssertionError('job never completed')

with tempfile.TemporaryDirectory() as tmp:
    jobs=Jobs(Path(tmp)/'jobs.sqlite',study.validate_input,fake)
    try:
        began=time.perf_counter();first=jobs.submit(body);assert time.perf_counter()-began<1
        assert entered.wait(2);assert jobs.submit(body)['jobId']==first['jobId'];assert len(calls)==1
        rejected(lambda:jobs.submit({**body,'paperText':'changed'}))
        rejected(lambda:jobs.submit({**body,'jobId':str(uuid.uuid4())}))
        release.set();done=terminal(jobs,body['jobId']);assert done['status']=='ready'
        assert done['paper']['strokes'][0]['curves']==human['curves']
        assert jobs.submit(body)['status']=='ready' and len(calls)==1
    finally:release.set();jobs.executor.shutdown(wait=True)
    reopened=Jobs(jobs.path,study.validate_input,fake);reopened.start()
    assert reopened.get(body['jobId'])['result']==done['result']
    # Simulate a process that died while a call was in progress, never auto-charge again.
    with reopened.db() as db:db.execute("UPDATE jobs SET status='running' WHERE id=?",(body['jobId'],))
    reopened.executor.shutdown(wait=True)
    recovered=Jobs(jobs.path,study.validate_input,fake);recovered.start()
    assert recovered.get(body['jobId'])['status']=='failed' and len(calls)==1
    recovered.executor.shutdown(wait=True)

client=study.app.test_client()
with patch.object(study.jobs,'submit',return_value={'status':'queued'}) as submit:
    assert client.post('/api/jobs',base_url='http://127.0.0.1:5331',headers={'Origin':'https://example.com'},json=body).status_code==403
    assert not submit.called
    origin='chrome-extension://'+study.EXTENSION_ID
    accepted=client.post('/api/jobs',base_url='http://127.0.0.1:5331',headers={'Origin':origin},json=body)
    assert accepted.status_code==202 and accepted.headers['Access-Control-Allow-Origin']==origin
manifest=json.loads(Path('extension/manifest.json').read_text())
assert set(manifest['permissions'])=={'storage','alarms'}
assert 'externally_connectable' not in manifest
assert manifest['content_scripts'][0]['all_frames'] is False
assert manifest['web_accessible_resources'][0]['resources']==['popup.html']
print('PASS: durable acknowledgement, idempotent submission, one active task, restart retention, interrupted-call safety, exact extension origin, minimal permissions')

# The shared queue and actual worker wiring are tested with mock Chrome APIs.
subprocess.run(['node','check_outbox.mjs'],check=True)

# Shared-paper rules and real popup handlers, with a bounded DOM double.
subprocess.run(['node','check_sheet.mjs'],check=True)
subprocess.run([__import__('sys').executable,'check_ink.py'],check=True)

# v2 uses the same persisted job lane, without migrating or rewriting v1.
v2={**body,'protocol':'paper.v2','jobId':str(uuid.uuid4()),'paperId':str(uuid.uuid4()),'strokes':[{**human,'humanEdited':False}],
    'texts':[{'id':'t1','author':'human','humanEdited':False,'text':'保留原话','x':24,'y':24,'w':352}],
    'groups':[{'id':'g1','itemIds':['human-1','t1']}], 'context':{'turns':[],'changes':[{'type':'add','before':None,'after':{**human,'humanEdited':False}}]}}
clean=study.validate_input(v2);assert clean['texts']==v2['texts'] and clean['groups']==v2['groups']
clean['strokes'].append({'id':'ai-old','author':'ai','humanEdited':True,'points':[[250,180],[300,180]]})
paused={'decision':'pause','strokes':[],'texts':[],'remove':[]}
assert study.parse_sheet_reply(json.dumps(paused),clean)['decision']=='pause'
rejected(lambda:study.parse_sheet_reply(json.dumps({**paused,'remove':['ai-old']}),clean))
rejected(lambda:study.parse_sheet_reply(json.dumps({**paused,'decision':'contribute','remove':['t1']}),clean))
rejected(lambda:study.parse_sheet_reply(json.dumps({**paused,'decision':'contribute','texts':[{'text':'越界','x':570,'y':24,'w':88}]}),clean))
r=study.parse_sheet_reply(json.dumps({**paused,'decision':'contribute','strokes':[{'points':[[100,600],[200,600]],'attachTo':'g1'}],'texts':[{'text':'就在这里。','x':300,'y':400,'w':220}]}),clean)
assert len(r['texts'])==1 and r['strokes'][0]['attachTo']=='g1'
with tempfile.TemporaryDirectory() as tmp:
    jobs=Jobs(Path(tmp)/'v2.sqlite',study.validate_input,lambda data:({'version':data['version'],**paused},200))
    jobs.submit(v2);done=terminal(jobs,v2['jobId']);assert done['protocol']=='paper.v2' and done['result']['decision']=='pause'
    assert done['paper']['texts']==v2['texts'] and done['context']==v2['context']
    jobs.executor.shutdown(wait=True)
print('PASS: v2 backend bounds, protected AI and human objects, explicit pause, mixed attachment, durable context')

rejected(lambda:study.parse_sheet_reply(json.dumps({**paused,'decision':'contribute','texts':[{'text':'重叠','x':24,'y':24,'w':88}]}),clean))

subprocess.run(['node','check_library.mjs'],check=True)
subprocess.run([__import__('sys').executable,'check_transport.py'],check=True)
subprocess.run([__import__('sys').executable,'check_nebius.py'],check=True)
