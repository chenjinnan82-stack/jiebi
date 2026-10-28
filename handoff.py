"""Durable local paper jobs. No provider assumptions; one in-flight job for this study."""
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor


class Busy(ValueError):
    pass


class Jobs:
    def __init__(self, path, validate, generate, external=None):
        self.path = Path(path)
        self.validate = validate
        self.generate = generate
        self.external = external
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='paper-job')
        self.lock = threading.Lock()
        self.started = False

    def db(self):
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def start(self):
        with self.lock:
            if self.started:
                return
            self.path.parent.mkdir(exist_ok=True)
            with self.db() as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('''CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
                    request TEXT NOT NULL, result TEXT, error TEXT, created REAL NOT NULL,
                    started REAL, finished REAL)''')
                # Never silently retry an interrupted model call and charge it twice.
                db.execute("UPDATE jobs SET status='failed', error=?, finished=? WHERE status='running'",
                           ('本机服务在生成时中断，原纸面已保留。请重新交出。', time.time()))
                queued = [r['id'] for r in db.execute("SELECT id FROM jobs WHERE status='queued'")]
            self.started = True
            for jid in queued:
                self.executor.submit(self.run, jid)

    def submit(self, body, owner='local', allow_external=True):
        self.start()
        if not isinstance(body, dict) or body.get('protocol') not in ('paper.v1','paper.v2'):
            raise ValueError('不支持的纸面协议')
        jid, pid = body.get('jobId'), body.get('paperId')
        try:
            assert str(uuid.UUID(jid)) == jid and str(uuid.UUID(pid)) == pid
        except (ValueError, TypeError, AttributeError, AssertionError):
            raise ValueError('纸面或任务编号无效') from None
        recipient = body.get('recipient', 'builtin')
        if recipient not in ('builtin', 'external') or (recipient == 'external' and not allow_external):
            raise ValueError('这张纸不能交给这个助手')
        if recipient == 'external' and not self.external:
            raise ValueError('外部助手尚未连接；没有改用其他模型，纸面已保留。')
        data = {**self.validate(body), 'paperId': pid, 'jobId': jid, 'protocol': body['protocol'],
                'recipient': recipient, '_owner': owner}
        encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        if len(encoded.encode()) > 3000000:
            raise ValueError('这一页过大，尚未交出')
        fingerprint = hashlib.sha256(encoded.encode()).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            old = db.execute('SELECT fingerprint,request FROM jobs WHERE id=?', (jid,)).fetchone()
            if old:
                if old['fingerprint'] != fingerprint:
                    legacy = json.loads(old['request'])
                    legacy.setdefault('recipient', 'builtin'); legacy.setdefault('_owner', 'local')
                    if json.dumps(legacy, ensure_ascii=False, sort_keys=True, separators=(',', ':')) != encoded:
                        raise ValueError('同一任务编号不能交出不同纸面')
                return self.get(jid, owner)
            if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1").fetchone():
                raise Busy('上一页还在处理；纸面已保存，稍后自动交出。')
            if db.execute('SELECT COUNT(*) FROM jobs WHERE created>?', (time.time()-60,)).fetchone()[0] >= 4:
                raise Busy('本分钟交接已满，纸面已保存，稍后自动交出。')
            # ponytail: bounded single-worker judging service; no silent deletion of drawings.
            if db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0] >= 256:
                raise ValueError('服务存档已满，纸面仍在浏览器中；请联系作品作者。')
            if owner != 'local' and db.execute("SELECT COUNT(*) FROM jobs WHERE json_extract(request,'$._owner')=?", (owner,)).fetchone()[0] >= 24:
                raise ValueError('本评审会话的24次交接已用完；纸面仍可编辑。')
            db.execute('INSERT INTO jobs(id,fingerprint,status,request,created) VALUES(?,?,?,?,?)',
                       (jid, fingerprint, 'queued', encoded, time.time()))
        self.executor.submit(self.run, jid)
        return self.get(jid, owner)

    def run(self, jid):
        with self.db() as db:
            changed = db.execute("UPDATE jobs SET status='running', started=? WHERE id=? AND status='queued'",
                                 (time.time(), jid)).rowcount
            if not changed:
                return
            data = json.loads(db.execute('SELECT request FROM jobs WHERE id=?', (jid,)).fetchone()[0])
        try:
            if data.get('recipient') == 'external':
                if not self.external:
                    raise ValueError('External assistant is not configured')
                self.external(data)
                return  # The scoped callback finishes this job; webhook acceptance is not a reply.
            result, status = self.generate(data)
            error = (result.get('error') or '这次交接未完成，原纸面已保留。') if status != 200 else None
            with self.db() as db:
                db.execute('UPDATE jobs SET status=?,result=?,error=?,finished=? WHERE id=?',
                           ('failed' if error else 'ready', json.dumps(result, ensure_ascii=False), error, time.time(), jid))
        except Exception:
            with self.db() as db:
                db.execute("UPDATE jobs SET status='failed',error=?,finished=? WHERE id=?",
                           ('这次交接未完成，原纸面已保留。', time.time(), jid))

    def get(self, jid, owner=None):
        self.start()
        with self.db() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone()
            if row and row['status'] == 'running' and row['started'] < time.time()-900:
                db.execute("UPDATE jobs SET status='failed',error=?,finished=? WHERE id=? AND status='running'",
                           ('助手回应超时；没有自动重发，原纸面已保留。', time.time(), jid))
                row = db.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone()
        if row is None:
            return None
        data = json.loads(row['request'])
        if owner is not None and data.get('_owner', 'local') != owner:
            return None
        reply = dict(protocol=data['protocol'], jobId=jid, paperId=data['paperId'], baseVersion=data['version'],
                     status=row['status'], createdAt=row['created'], startedAt=row['started'], finishedAt=row['finished'])
        if row['status'] in ('ready', 'failed'):
            reply['result'] = json.loads(row['result']) if row['result'] else None
            reply['error'] = row['error']
            fields=('paperId','version','strokes','groups','texts') if data['protocol']=='paper.v2' else ('paperId','version','strokes','groups','paperText','paperNotes')
            reply['paper'] = {k: data[k] for k in fields}
            if data['protocol']=='paper.v2':reply['context']=data['context']
        return reply

    def external_data(self, jid):
        self.get(jid)  # Apply the same expiry before reads and callbacks.
        with self.db() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone()
        if not row:
            raise ValueError('Task not found')
        data = json.loads(row['request'])
        if data.get('recipient') != 'external' or row['status'] not in ('running', 'ready') or row['started'] < time.time()-900:
            raise ValueError('Task is no longer accepting a response')
        return row, data

    def contribute(self, jid, raw, parse):
        row, data = self.external_data(jid)
        digest = hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT status,result FROM jobs WHERE id=?', (jid,)).fetchone()
            if current['status'] == 'ready':
                if json.loads(current['result']).get('callbackHash') != digest:
                    raise ValueError('This task already has a different response')
                return self.get(jid)
            if current['status'] != 'running':
                raise ValueError('Task is no longer accepting a response')
            result = dict(version=data['version'], **parse(json.dumps(raw, ensure_ascii=False), data),
                          provider='external', model='Grok Bot', callbackHash=digest,
                          serverMs=round((time.time()-row['started'])*1000, 1))
            db.execute("UPDATE jobs SET status='ready',result=?,finished=? WHERE id=?",
                       (json.dumps(result, ensure_ascii=False), time.time(), jid))
        return self.get(jid)


def install(app, jobs):
    from flask import g, jsonify, request

    @app.post('/api/jobs')
    def submit_job():
        try:
            return jsonify(jobs.submit(request.get_json(), getattr(g, 'owner', 'local'), getattr(g, 'allow_external', True))), 202
        except Busy as error:
            return jsonify(error=str(error)), 429
        except (ValueError, TypeError) as error:
            return jsonify(error=str(error)), 422

    @app.get('/api/jobs/<jid>')
    def read_job(jid):
        result = jobs.get(jid, getattr(g, 'owner', 'local'))
        if result is None:
            return jsonify(error='本机没有这次交接，请保留纸面后重新交出。'), 404
        return jsonify(result)
