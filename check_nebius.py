"""Offline adapter and money-boundary check; never uses a live key or model."""
import io
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch
import nebius

def rejects(fn):
    try: fn()
    except ValueError: return
    raise AssertionError('invalid call accepted')

with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'NEBIUS_API_KEY':'test-only', 'NEBIUS_BUDGET_USD':'1.00','NEBIUS_PHASE':'judging'}):
    os.environ.pop('NEBIUS_MAX_CALLS', None)
    path = Path(tmp)/'usage.sqlite3'
    raw = dict(id='test-id', model=nebius.MODEL, usage={'prompt_tokens':1000,'completion_tokens':100},
               choices=[{'finish_reason':'stop','message':{'content':'{"decision":"pause","strokes":[],"texts":[],"remove":[]}'}}])
    with patch.object(nebius.urllib.request, 'build_opener') as opener:
        opener.return_value.open.return_value = io.BytesIO(json.dumps(raw).encode())
        answer, ms = nebius.chat([{'role':'user','content':'JSON please','images':['png-test']}], 'paper-job', path)
        assert answer['done'] and answer['provider']=='nebius' and answer['usage']==raw['usage']
        request = opener.return_value.open.call_args.args[0]
        data=json.loads(request.data)
        assert data['messages'][0]['content'][1]['image_url']['url']=='data:image/png;base64,png-test'
        assert data['max_tokens']==nebius.MAX_OUTPUT and data['response_format']['type']=='json_object'
        assert request.full_url.startswith('https://api.tokenfactory.nebius.com/')
        assert nebius.usage_summary(path)==dict(calls=1,reportedUsd=.00039,heldUsd=0,limitUsd=1)
    # Failed/unknown calls retain reservations; opening the same DB does not reset them.
    with patch.object(nebius.urllib.request,'build_opener') as opener:
        opener.return_value.open.side_effect=TimeoutError()
        try:nebius.chat([{'role':'user','content':'x'}], 'timeout', path)
        except TimeoutError:pass
        else:raise AssertionError('timeout hidden')
    assert nebius.usage_summary(path)['heldUsd']==nebius.RESERVE_MICRO_USD/1e6
    nebius.reserve('second',path);nebius.reserve('third',path)
    rejects(lambda:nebius.reserve('over-limit',path))
    with patch.dict(os.environ, {'NEBIUS_PHASE':'development'}):
        dev_path=Path(tmp)/'dev.sqlite3'
        nebius.reserve('first',dev_path)
        rejects(lambda:nebius.reserve('would-spend-judge-reserve',dev_path))
    with patch.dict(os.environ, {'NEBIUS_MAX_CALLS':'1'}):
        call_path = Path(tmp)/'call-limit.sqlite3'
        nebius.reserve('first', call_path)
        rejects(lambda:nebius.reserve('over', call_path))
    with patch.dict(os.environ, {'NEBIUS_BUDGET_USD':'NaN'}):rejects(nebius.allowance)
    with patch.dict(os.environ, {'NEBIUS_BUDGET_USD':'1.01'}):rejects(nebius.allowance)
    with patch.dict(os.environ, {'NEBIUS_API_KEY':''}):
        rejects(lambda:nebius.chat([{'role':'user','content':'x'}], 'missing-key', path))
    rejects(lambda:nebius.NoRedirect().redirect_request(None,None,302,'',{},'https://example.com'))
print('PASS: image payload, response normalization, durable usage, unknown-charge holds, budget stop, no credential redirect')
