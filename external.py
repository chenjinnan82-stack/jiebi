"""One authorized paper task in, one validated contribution out; never execute Bot code."""
import hashlib
import hmac
import json
import os
import urllib.parse
import urllib.request
from nebius import NoRedirect


def configured():
    return all(os.environ.get(k) for k in ('GROK_WEBHOOK_URL', 'GROK_WEBHOOK_KEY', 'JIEBI_EXTERNAL_SECRET', 'JIEBI_PUBLIC_URL'))


def task_token(jid):
    secret = os.environ.get('JIEBI_EXTERNAL_SECRET', '')
    if len(secret) < 32:
        raise ValueError('External task secret is not configured')
    return hmac.new(secret.encode(), jid.encode(), hashlib.sha256).hexdigest()


def dispatch(data):
    if not configured():
        raise ValueError('External assistant is not connected')
    url = os.environ['GROK_WEBHOOK_URL']
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Webhook requires HTTPS')
    public = os.environ['JIEBI_PUBLIC_URL'].rstrip('/')
    if not public.startswith('https://'):
        raise ValueError('Callback requires HTTPS')
    # The short-lived capability is limited to this job. No other paper or private history.
    body = {'taskUrl': public+'/api/external/'+data['jobId'], 'taskToken': task_token(data['jobId']),
            'jobId': data['jobId'], 'protocol': 'paper.v2',
            'instruction': 'Use the Jiebi paper skill. Read this task, inspect its PNG and edits, then POST a complete contribute or pause JSON to the same URL. Do not read any other files or apps.'}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        'Content-Type': 'application/json', 'Authorization': 'Bearer '+os.environ['GROK_WEBHOOK_KEY']})
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as response:
        if response.status != 200:
            raise ValueError('Webhook did not accept this task')


def install(app, jobs, parse, instructions):
    from flask import jsonify, request

    @app.route('/api/external/<jid>', methods=['GET', 'POST'])
    def external_task(jid):
        supplied = request.headers.get('Authorization', '')
        try:
            if not hmac.compare_digest(supplied.encode(), ('Bearer '+task_token(jid)).encode()):
                return jsonify(error='Task access denied'), 403
            row, data = jobs.external_data(jid)
            if request.method == 'GET':
                return jsonify(task={k:v for k,v in data.items() if not k.startswith('_')}, instructions=instructions,
                               expiresAt=row['started']+900)
            return jsonify(jobs.contribute(jid, request.get_json(), parse))
        except (ValueError, TypeError, KeyError) as error:
            return jsonify(error=str(error)), 422
