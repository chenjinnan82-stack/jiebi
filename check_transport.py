"""Offline checks for reviewer isolation and the external paper capability. No model calls."""
import base64
import io
import json
import os
from pathlib import Path
import tempfile
import time
import uuid
from unittest.mock import Mock, patch
import study
from handoff import Jobs, Busy

study.nebius.chat = Mock(side_effect=AssertionError('Live model forbidden'))
png=io.BytesIO(); study.Image.new('RGB',(612,612),'white').save(png,format='PNG')
body=dict(protocol='paper.v2',jobId=str(uuid.uuid4()),paperId=str(uuid.uuid4()),version=1,
          strokes=[],texts=[dict(id='human-1',author='human',humanEdited=False,text='测试',x=24,y=24,w=352)],
          groups=[],context={'turns':[],'changes':[]},image=base64.b64encode(png.getvalue()).decode())
pause=dict(decision='pause',strokes=[],texts=[],remove=[])
def rejected(fn):
    try: fn()
    except ValueError: return
    raise AssertionError('Invalid request accepted')

rejected(lambda:study.validate_input({**body,'image':base64.b64encode(b'not a PNG').decode()}))

with tempfile.TemporaryDirectory() as tmp:
    dispatched=[]
    jobs=Jobs(Path(tmp)/'jobs.sqlite3',study.validate_input,lambda _: (_ for _ in ()).throw(AssertionError('Wrong recipient')),dispatched.append)
    first={**body,'recipient':'external'}
    jobs.submit(first,'owner-a')
    deadline=time.monotonic()+2
    while not dispatched and time.monotonic()<deadline: time.sleep(.005)
    assert len(dispatched)==1 and jobs.get(first['jobId'],'owner-b') is None
    rejected(lambda:jobs.submit(first,'owner-b'))
    assert jobs.submit(first,'owner-a')['status']=='running' and len(dispatched)==1
    rejected(lambda:jobs.contribute(first['jobId'],{**pause,'remove':['human-1']},study.parse_sheet_reply))
    assert jobs.get(first['jobId'])['status']=='running'
    done=jobs.contribute(first['jobId'],pause,study.parse_sheet_reply)
    assert done['status']=='ready' and done['result']['decision']=='pause'
    assert jobs.contribute(first['jobId'],pause,study.parse_sheet_reply)==done
    rejected(lambda:jobs.contribute(first['jobId'],{**pause,'decision':'contribute'},study.parse_sheet_reply))
    rejected(lambda:jobs.submit({**body,'jobId':str(uuid.uuid4()),'recipient':'external'},'review',False))
    with jobs.db() as db: db.execute('UPDATE jobs SET started=? WHERE id=?',(time.time()-901,first['jobId']))
    rejected(lambda:jobs.external_data(first['jobId']))
    jobs.executor.shutdown(wait=True)

client=study.app.test_client(); origin='chrome-extension://'+study.EXTENSION_ID
base='http://127.0.0.1:5331';headers={'Origin':origin,'Authorization':'Bearer '+'r'*40,'X-Jiebi-Session':str(uuid.uuid4())}
with patch.object(study,'PUBLIC','https://sanliang.online/jiebi'), patch.dict(os.environ,{'JIEBI_REVIEW_TOKEN':'r'*40,'JIEBI_TEST_TOKEN':'t'*40,'JIEBI_EXTERNAL_SECRET':'s'*40}), patch.object(study.jobs,'submit',return_value={'status':'queued'}) as submit:
    assert client.get('/api/status',base_url=base).status_code==401
    assert client.get('/api/status',base_url=base,headers={**headers,'Authorization':'Bearer 无效'}).status_code==401
    assert client.get('/api/external/'+body['jobId'],base_url=base,headers={**headers,'Authorization':'Bearer 无效'}).status_code==403
    assert client.get('/api/status',base_url=base,headers={**headers,'Origin':'https://evil.example'}).status_code==403
    assert client.post('/api/jobs',base_url=base,headers={**headers,'X-Jiebi-Session':'not-a-session'},json=body).status_code==403
    assert not submit.called
    assert client.post('/api/jobs',base_url=base,headers=headers,json=body).status_code==202
    owner_a=submit.call_args.args[1];assert submit.call_args.args[2] is False
    assert client.post('/api/jobs',base_url=base,headers={**headers,'X-Jiebi-Session':str(uuid.uuid4())},json=body).status_code==202
    assert submit.call_args.args[1]!=owner_a
    assert client.post('/api/jobs',base_url=base,headers={**headers,'Authorization':'Bearer '+'t'*40},json=body).status_code==202
    assert submit.call_args.args[2] is True
    for path in ['/','/api/next','/api/evidence/test/json','/evidence/test.json','/extension-preview/']:
        assert client.get(path,base_url=base,headers=headers).status_code==404
    assert client.get('/api/external/'+body['jobId'],base_url=base,headers=headers).status_code==403
    preflight=client.options('/api/jobs',base_url=base,headers={'Origin':origin})
    assert preflight.status_code==204 and 'Authorization' in preflight.headers['Access-Control-Allow-Headers']
    assert client.get('/api/status',base_url=base,headers=headers).json['usage'] is None
assert not study.nebius.chat.called
print('PASS: session isolation, reviewer cannot invoke private Bot, request source, dev routes closed, atomic external callback, duplicate/late callback, no live model')
