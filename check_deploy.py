"""Local production-mode smoke check. No model calls; keys are intentionally empty."""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import statistics
import subprocess
import time
import urllib.request
import urllib.error
import uuid

root=Path(__file__).resolve().parent
token=secrets.token_urlsafe(32); port=5342
env={**os.environ,'SKETCH_PORT':str(port),'JIEBI_PUBLIC_URL':'https://sanliang.online/jiebi',
     'JIEBI_REVIEW_TOKEN':token,'SKETCH_PROVIDER':'nebius','NEBIUS_API_KEY':'','JIEBI_TEST_TOKEN':'',
     'GROK_WEBHOOK_URL':'','GROK_WEBHOOK_KEY':''}
key=json.loads((root/'extension/manifest.json').read_text())['key']
eid=''.join(chr(97+int(c,16)) for c in hashlib.sha256(base64.b64decode(key)).hexdigest()[:32])
headers={'Authorization':'Bearer '+token,'X-Jiebi-Session':str(uuid.uuid4()),'Origin':'chrome-extension://'+eid}
log=root/'evidence/curtain-release-20261029/gunicorn-local.log';log.parent.mkdir(parents=True,exist_ok=True)
with log.open('a') as output:
    process=subprocess.Popen([str(root/'.venv/bin/gunicorn'),'--workers','1','--threads','2','--bind',f'127.0.0.1:{port}','--timeout','90','study:app'],cwd=root,env=env,stdout=output,stderr=output)
    try:
        start=time.monotonic()
        while True:
            try:
                with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/api/status',headers=headers),timeout=1) as r:
                    data=json.load(r)
                break
            except urllib.error.URLError:
                if time.monotonic()-start>10: raise
                time.sleep(.1)
        assert not data['configured'] and data['usage'] is None
        samples=[]
        for _ in range(20):
            began=time.perf_counter()
            with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/api/status',headers=headers),timeout=2) as r: r.read()
            samples.append((time.perf_counter()-began)*1000)
        try: urllib.request.urlopen(f'http://127.0.0.1:{port}/api/jobs',timeout=2)
        except urllib.error.HTTPError as e: assert e.code==401
        else: raise AssertionError('Unauthenticated request accepted')
        processes=[tuple(map(int,line.split())) for line in subprocess.check_output(['ps','-axo','pid=,ppid=,rss='],text=True).splitlines()]
        owned={process.pid}
        while True:
            extra={pid for pid,parent,rss in processes if parent in owned}-owned
            if not extra:break
            owned.update(extra)
        rss=sum(rss for pid,parent,rss in processes if pid in owned)
        report={'kind':'Local production-mode smoke, not remote deployment or inference','requests':20,'medianMs':round(statistics.median(samples),2),'maxMs':round(max(samples),2),'idleProcessCount':len(owned),'idleSummedRssKB':rss,'rssNote':'Master and worker RSS summed; shared pages may be counted twice. Not peak or production load.','modelCalls':0}
        (root/'evidence/curtain-release-20261029/gunicorn-local.json').write_text(json.dumps(report,indent=2))
        print(json.dumps(report))
    finally:
        process.terminate();process.wait(timeout=10)
