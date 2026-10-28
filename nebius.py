"""One server-side Nebius adapter and a conservative, durable USD allowance."""
import json
import os
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
MODEL = 'nvidia/Nemotron-3.5-Super-VL'
BASE = 'https://api.tokenfactory.nebius.com/v1'
MAX_OUTPUT = 8192
# Official public catalog checked 2026-10-28: $0.30 input / $0.90 output per 1M.
# Reserve even the FULL 1,048,576-token context, not an optimistic image estimate.
RESERVE_MICRO_USD = (1048576 * 3 + MAX_OUTPUT * 9 + 9) // 10


def load_settings():
    """Read only our literal settings; never evaluate a user's .env as shell code."""
    file = ROOT / '.env'
    allowed = {'SKETCH_PROVIDER', 'NEBIUS_API_KEY', 'NEBIUS_BUDGET_USD', 'NEBIUS_MAX_CALLS', 'NEBIUS_PHASE',
               'JIEBI_PUBLIC_URL', 'JIEBI_REVIEW_TOKEN', 'JIEBI_TEST_TOKEN', 'JIEBI_EXTERNAL_SECRET',
               'GROK_WEBHOOK_URL', 'GROK_WEBHOOK_KEY', 'SKETCH_PORT'}
    if file.exists():
        for line in file.read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and key.strip() in allowed:
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
                    value = value[1:-1]
                os.environ.setdefault(key.strip(), value)


def allowance():
    from decimal import Decimal, InvalidOperation
    try:
        value = Decimal(os.environ.get('NEBIUS_BUDGET_USD', '1.00'))
        # ponytail: this release stays within the verified $1 trial, no top-up workflow.
        if not value.is_finite() or not 0 < value <= 1:
            raise ValueError()
        return int(value * 1000000)
    except (ValueError, InvalidOperation):
        raise ValueError('Nebius 本轮总额度须在 0–1 美元内；没有自动充值。') from None


def ledger(path=None):
    path = Path(path or ROOT / 'data/nebius-usage.sqlite3')
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=5)
    db.execute('''CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL, created REAL NOT NULL,
        state TEXT NOT NULL, reserved INTEGER NOT NULL, charged INTEGER,
        prompt_tokens INTEGER, completion_tokens INTEGER, elapsed_ms REAL,
        http_status INTEGER)''')
    return db


def reserve(request_id, path=None):
    with ledger(path) as db:
        db.execute('BEGIN IMMEDIATE')
        call_limit = os.environ.get('NEBIUS_MAX_CALLS')
        if call_limit is not None and db.execute('SELECT COUNT(*) FROM calls').fetchone()[0] >= int(call_limit):
            raise ValueError('本轮模型测试次数已用完，生成已暂停；纸面仍可编辑。')
        used = db.execute('SELECT COALESCE(SUM(COALESCE(charged,reserved)),0) FROM calls').fetchone()[0]
        phase = os.environ.get('NEBIUS_PHASE', 'development')
        if phase not in ('development', 'judging'):
            raise ValueError('费用阶段配置无效，未调用模型。')
        limit = min(allowance(), 500000) if phase == 'development' else allowance()
        if used + RESERVE_MICRO_USD > limit:
            raise ValueError('Nebius 剩余额度不足以安全预留本次调用，纸面已保留。')
        call_id = uuid.uuid4().hex
        db.execute('INSERT INTO calls(id,request_id,created,state,reserved) VALUES(?,?,?,?,?)',
                   (call_id, request_id, time.time(), 'reserved', RESERVE_MICRO_USD))
    return call_id


def settle(call_id, usage, elapsed_ms, http_status=200, path=None):
    incoming, outgoing = usage.get('prompt_tokens'), usage.get('completion_tokens')
    known = all(type(v) is int and v >= 0 for v in (incoming, outgoing))
    # Count cached input at full price: conservative and independent of caching policy.
    charge = (incoming * 3 + outgoing * 9 + 9) // 10 if known else None
    with ledger(path) as db:
        db.execute('UPDATE calls SET state=?,charged=?,prompt_tokens=?,completion_tokens=?,elapsed_ms=?,http_status=? WHERE id=?',
                   ('reported' if known else 'unconfirmed', charge, incoming if known else None,
                    outgoing if known else None, elapsed_ms, http_status, call_id))


def usage_summary(path=None):
    with ledger(path) as db:
        row = db.execute('SELECT COUNT(*),COALESCE(SUM(charged),0),COALESCE(SUM(CASE WHEN charged IS NULL THEN reserved ELSE 0 END),0) FROM calls').fetchone()
    summary = dict(calls=row[0], reportedUsd=row[1]/1000000, heldUsd=row[2]/1000000,
                   limitUsd=allowance()/1000000)
    if os.environ.get('NEBIUS_MAX_CALLS') is not None:
        summary['callLimit'] = int(os.environ['NEBIUS_MAX_CALLS'])
    return summary


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Nebius 返回意外跳转，未转发密钥。')


def chat(messages, request_id, path=None):
    key = os.environ.get('NEBIUS_API_KEY', '').strip()
    if not key:
        raise ValueError('服务端尚未配置 Nebius Key；纸面已保留。')
    converted = []
    for message in messages:
        content = message['content']
        if message.get('images'):
            content = [{'type':'text', 'text':content}] + [
                {'type':'image_url', 'image_url':{'url':'data:image/png;base64,'+image}}
                for image in message['images']]
        converted.append({'role':message['role'], 'content':content})
    payload = dict(model=MODEL, messages=converted, max_tokens=MAX_OUTPUT, stream=False,
                   reasoning_effort='low', response_format={'type':'json_object'})
    req = urllib.request.Request(BASE + '/chat/completions', data=json.dumps(payload).encode(),
                                 headers={'Content-Type':'application/json', 'Authorization':'Bearer '+key})
    call_id = reserve(request_id, path)
    started = time.perf_counter()
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=50) as response:
            raw = json.load(response)
    except Exception as exc:
        # Unknown acceptance may have incurred cost. Keep the full reservation across restarts.
        settle(call_id, {}, round((time.perf_counter()-started)*1000,1),
               exc.code if isinstance(exc, urllib.error.HTTPError) else None, path)
        if isinstance(exc, urllib.error.HTTPError):
            raise ValueError(f'Nebius 请求未完成（HTTP {exc.code}），纸面保留；未自动重试。') from None
        raise
    elapsed = round((time.perf_counter()-started)*1000, 1)
    usage = raw.get('usage') or {}
    settle(call_id, usage, elapsed, path=path)
    choice = (raw.get('choices') or [{}])[0]
    content = choice.get('message', {}).get('content')
    if content is None:
        content = ''  # Preserve finish_reason/usage in the caller's evidence, even on empty output.
    if not isinstance(content, str):
        raise ValueError('Nebius 没有返回可用的纸面回应，原稿已保留。')
    return dict(model=raw.get('model', MODEL), provider='nebius',
                message={'content':content}, done=choice.get('finish_reason')=='stop',
                done_reason=choice.get('finish_reason'), usage=usage,
                upstreamId=raw.get('id'), billingCallId=call_id), elapsed
