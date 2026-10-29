"""Small editable co-drawing study adapted from SketchAgent's grid drawing format.

Run: .venv/bin/python study.py — localhost only; no API key is copied here.
"""
import ast
import base64
import hashlib
import hmac
import io
import json
import math
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET

from flask import Flask, g, jsonify, render_template, request, send_from_directory
from PIL import Image
import numpy as np
import utils
from ink import ink_curves, check_new_layout
import nebius
import external

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "evidence"
EVIDENCE.mkdir(exist_ok=True)
nebius.load_settings()
PROVIDER = os.environ.get('SKETCH_PROVIDER', 'ollama')
if PROVIDER not in ('ollama', 'nebius'):
    raise ValueError('SKETCH_PROVIDER must be ollama or nebius')
MODEL = nebius.MODEL if PROVIDER == 'nebius' else os.environ.get("SKETCH_MODEL", "kimi-k3:cloud")
THINK = os.environ.get("SKETCH_THINK", "low")
if THINK.lower() in ("true", "false"):
    THINK = THINK.lower() == "true"
PORT = int(os.environ.get("SKETCH_PORT", "5331"))
PUBLIC = os.environ.get('JIEBI_PUBLIC_URL', '').rstrip('/')
if PUBLIC and (not PUBLIC.startswith('https://') or len(os.environ.get('JIEBI_REVIEW_TOKEN','')) < 32):
    raise ValueError('Public service requires HTTPS and a review access token of at least 32 characters')
RES, CELL = 50, 12
POSITIONS = utils.cells_to_pixels(RES, CELL)
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 3 * 1024 * 1024 if PUBLIC else 32 * 1024 * 1024
# ponytail: one generation at a time fits the $1 judging budget; no multi-worker deployment.
model_lock = threading.Lock()
recent_calls = []
EXTENSION_ID = ''.join(chr(97 + int(c, 16)) for c in hashlib.sha256(base64.b64decode(
    json.loads((ROOT / 'extension/manifest.json').read_text())['key'])).hexdigest()[:32])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_strokes(strokes, shared=False):
    require(isinstance(strokes, list) and len(strokes) <= 100, "笔画数量无效")
    ids = set()
    clean = []
    for stroke in strokes:
        require(isinstance(stroke, dict), "笔画格式无效")
        sid = stroke.get("id", "")
        require(isinstance(sid, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", sid) and sid not in ids, "笔画 ID 无效")
        ids.add(sid)
        points = stroke.get("points")
        require(isinstance(points, list) and 1 <= len(points) <= 1000, "笔画点数无效")
        for p in points:
            require(isinstance(p, list) and len(p) == 2 and all(type(n) in (int, float) and math.isfinite(n) for n in p), "坐标无效")
            require(12 <= p[0] <= (600 if shared else 611) and (12 if shared else 0) <= p[1] <= (600 if shared else 599), "笔画超出纸面")
        author = stroke.get("author")
        require(author in ("human", "ai"), "笔画来源无效")
        item = {"id": sid, "author": author, "points": points}
        if 'curves' in stroke:
            curves = stroke['curves']
            require(isinstance(curves, list) and len(curves) <= 64, '曲线数量无效')
            for curve in curves:
                require(isinstance(curve, list) and 2 <= len(curve) <= 4, '曲线格式无效')
                for p in curve:
                    require(isinstance(p, list) and len(p) == 2 and all(type(v) in (int, float) and math.isfinite(v) for v in p)
                            and 12 <= p[0] <= (600 if shared else 611) and (12 if shared else 0) <= p[1] <= (600 if shared else 599), '曲线坐标无效')
            item['curves'] = curves
        clean.append(item)
    return clean


def validate_groups(groups, strokes, limit=100):
    require(isinstance(groups, list) and len(groups) <= limit, '编组数量无效')
    allowed = {s['id'] for s in strokes}
    names, members = set(), set()
    for group in groups:
        require(isinstance(group, dict), '编组格式无效')
        gid, ids = group.get('id'), group.get('strokeIds')
        require(isinstance(gid, str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', gid) and gid not in names, '编组ID无效')
        require(isinstance(ids, list) and 1 <= len(ids) <= limit and all(isinstance(s, str) and s in allowed for s in ids), '编组笔画无效')
        require(len(set(ids)) == len(ids) and not members.intersection(ids), '笔画不能重复编组')
        names.add(gid); members.update(ids)
    return [{'id': g['id'], 'strokeIds': g['strokeIds']} for g in groups]


def validate_image(image):
    require(isinstance(image,str) and len(image)<=2000000,'画布快照无效')
    try:
        with Image.open(io.BytesIO(base64.b64decode(image,validate=True))) as im:
            require(im.size==(612,612) and im.format=='PNG','画布快照尺寸无效')
            im.verify()
    except (OSError, SyntaxError, Image.DecompressionBombError):
        raise ValueError('画布快照无效') from None
    return image


def validate_input(data):
    require(isinstance(data, dict), '请求格式无效')
    if data.get('protocol') == 'paper.v2':
        return validate_sheet_input(data)
    version = data.get('version')
    require(type(version) is int and 0 <= version < 100000, '版本无效')
    strokes = validate_strokes(data.get('strokes'), shared=True)
    groups = validate_groups(data.get('groups', []), strokes)
    cue, changes = data.get('cue', ''), data.get('changes', [])
    require(isinstance(cue, str) and len(cue) <= 500, '提示过长')
    require(isinstance(changes, list) and len(json.dumps(changes)) <= 12000, '修改记录过长')
    paper_text, paper_notes = data.get('paperText', ''), data.get('paperNotes', [])
    require(isinstance(paper_text, str) and len(paper_text) <= 2000, '纸上文字过长')
    require(isinstance(paper_notes, list) and len(paper_notes) <= 20 and all(isinstance(n, str) and len(n) <= 80 for n in paper_notes), '纸边批注无效')
    image = validate_image(data.get('image', ''))
    return dict(version=version, strokes=strokes, groups=groups, cue=cue, changes=changes,
                paperText=paper_text, paperNotes=paper_notes, image=image)


def sheet_text_height(text, width):
    lines, used = 1, 0
    for char in text:
        step = 11 if ord(char) <= 255 else 22
        if char == '\n': lines, used = lines + 1, 0; continue
        if used + step > width: lines, used = lines + 1, 0
        used += step
    return lines * 28


def validate_sheet_objects(data):
    strokes = validate_strokes(data.get('strokes'), shared=True)
    for clean, raw in zip(strokes, data['strokes']):
        require(type(raw.get('humanEdited')) is bool, '缺少修改保护标记')
        clean['humanEdited'] = raw['humanEdited']
        if 'brush' in raw:
            require(raw['brush']=='didan-v1' and raw.get('line') in ('auto','flow','corner'),'画笔格式无效')
            clean.update(brush=raw['brush'],line=raw['line'])
        require(all(12 <= q[0] <= 600 and 12 <= q[1] <= 600 for q in clean['points'] + [p for c in clean.get('curves', []) for p in c]), '笔画超出纸面')
    texts = data.get('texts')
    require(isinstance(texts, list) and len(texts) <= 24, '文字对象数量无效')
    ids = {s['id'] for s in strokes}; clean_texts = []
    for t in texts:
        require(isinstance(t, dict) and isinstance(t.get('id'), str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', t['id']) and t['id'] not in ids, '文字编号无效')
        ids.add(t['id'])
        require(t.get('author') in ('human', 'ai') and type(t.get('humanEdited')) is bool, '文字身份无效')
        require(isinstance(t.get('text'), str) and t['text'].strip() and len(t['text']) <= 2000, '文字内容无效')
        require(all(type(t.get(k)) in (int, float) and math.isfinite(t[k]) for k in ('x', 'y', 'w')), '文字位置无效')
        require(t['x'] >= 12 and t['y'] >= 12 and t['w'] >= 88 and t['x'] + t['w'] <= 600 and t['y'] + sheet_text_height(t['text'], t['w']) <= 600, '文字放不下，请调整位置或缩短')
        clean_texts.append({k:t[k] for k in ('id','author','humanEdited','text','x','y','w')})
    require(sum(len(t['text']) for t in texts) <= 4000, '这一页文字太多')
    raw_groups = data.get('groups', [])
    require(isinstance(raw_groups, list), '编组无效')
    groups = validate_groups([{'id':g.get('id'),'strokeIds':g.get('itemIds')} for g in raw_groups if isinstance(g,dict)], strokes+clean_texts, limit=124)
    require(len(groups)==len(raw_groups), '编组无效')
    return strokes, clean_texts, [{'id':g['id'],'itemIds':g['strokeIds']} for g in groups]


def validate_sheet_input(data):
    require(type(data.get('version')) is int and 0 <= data['version'] < 100000, '版本无效')
    strokes, texts, groups = validate_sheet_objects(data)
    context = data.get('context', {})
    require(isinstance(context, dict) and isinstance(context.get('turns'), list) and len(context['turns']) <= 2 and isinstance(context.get('changes'), list) and len(context['changes']) <= 250 and len(json.dumps(context)) <= 1500000, '交流记录过长或无效')
    for turn in context['turns']:
        require(isinstance(turn,dict) and isinstance(turn.get('jobId'),str) and isinstance(turn.get('human'),dict) and isinstance(turn.get('assistant'),dict), '往来记录无效')
    for change in context['changes']:
        require(isinstance(change,dict) and change.get('type') in ('add','erase','change','groups') and 'before' in change and 'after' in change, '修改前后记录无效')
    image = validate_image(data.get('image'))
    return dict(protocol='paper.v2',version=data['version'],strokes=strokes,texts=texts,groups=groups,context=context,image=image)


def parse_sheet_reply(raw, data):
    r=json_content(raw)
    require(isinstance(r,dict) and r.get('decision') in ('contribute','pause'),'缺少 contribute 或 pause 决定')
    require(isinstance(r.get('strokes'),list) and len(r['strokes'])<=12 and isinstance(r.get('texts'),list) and len(r['texts'])<=3 and isinstance(r.get('remove'),list) and len(r['remove'])<=24,'回应数量无效')
    require(all(isinstance(key,str) for key in r['remove']) and len(set(r['remove']))==len(r['remove']),'撤回编号无效')
    allowed={s['id'] for s in data['strokes']+data['texts'] if s['author']=='ai' and not s['humanEdited']}
    require(all(key in allowed for key in r['remove']),'你写过或改过的内容不能被助手撤回')
    additions=[];texts=[];gids={g['id'] for g in data['groups'] if any(i not in r['remove'] for i in g['itemIds'])}
    for s in r['strokes']:
        require(isinstance(s,dict) and isinstance(s.get('points'),list) and 1<=len(s['points'])<=32,'笔画采样无效')
        item={'id':'ai-'+uuid.uuid4().hex[:16],'author':'ai','humanEdited':False,'points':s['points']}
        validate_sheet_objects({'strokes':[item],'texts':[]})
        require(s.get('line','auto') in ('auto','flow','corner'),'线型无效')
        item.update(brush='didan-v1',line=s.get('line','auto'))
        item['curves']=ink_curves(s['points'],item['line'])
        attachment=s.get('attachTo','');require(isinstance(attachment,str) and (not attachment or attachment in gids),'附着编组无效')
        if attachment:item['attachTo']=attachment
        additions.append(item)
    for t in r['texts']:
        require(isinstance(t,dict),'文字回应无效')
        item={**{k:t.get(k) for k in ('text','x','y','w')},'id':'ai-text-'+uuid.uuid4().hex[:12],'author':'ai','humanEdited':False}
        validate_sheet_objects({'strokes':[],'texts':[item]})
        attachment=t.get('attachTo','');require(isinstance(attachment,str) and (not attachment or attachment in gids),'附着编组无效')
        if attachment:item['attachTo']=attachment
        texts.append(item)
    require(sum(len(t['text']) for t in texts)<=80,'每轮文字最多80字')
    check_new_layout(data,additions,texts,r['remove'])
    if r['decision']=='pause':require(not additions and not texts and not r['remove'],'停笔不能修改纸面')
    else:require(additions or texts or r['remove'],'回应为空；停笔请明确返回pause')
    remaining_strokes=[s for s in data['strokes'] if s['id'] not in r['remove']]+additions
    remaining_texts=[s for s in data['texts'] if s['id'] not in r['remove']]+texts
    validate_sheet_objects({'strokes':remaining_strokes,'texts':remaining_texts})
    return dict(decision=r['decision'],strokes=additions,texts=texts,remove=r['remove'],note='')


def read_contribution(raw,data):
    if data.get('protocol')=='paper.v2':return parse_sheet_reply(raw,data)
    strokes=parse_reply(raw);validate_attachments(strokes,data['groups']);note=parse_note(raw);removed=parse_removals(raw,data['strokes'])
    require(strokes or note or removed,'模型没有留下图形或文字')
    return dict(strokes=strokes,note=note,remove=removed)


def validate_attachments(strokes, groups):
    allowed = {g['id'] for g in groups}
    require(all(not s.get('attachTo') or s['attachTo'] in allowed for s in strokes), '只能附着到当前纸面已有的编组')


def encode_strokes(strokes):
    """SketchAgent's xNyN grid vocabulary; current geometry replaces old history."""
    parts = []
    for stroke in strokes:
        points = stroke["points"]
        # ponytail: bounded arc-length sampling, not an editable graphics framework.
        lengths = [0.0]
        for a, b in zip(points, points[1:]):
            lengths.append(lengths[-1] + math.dist(a, b))
        count = min(24, max(2, math.ceil(lengths[-1] / 22)))
        samples = []
        for distance in np.linspace(0, lengths[-1], count):
            j = min(len(points) - 1, int(np.searchsorted(lengths, distance)))
            a, b = points[max(0, j - 1)], points[j]
            size = lengths[j] - lengths[max(0, j - 1)]
            f = (distance - lengths[max(0, j - 1)]) / size if size else 0
            x, y = [a[k] + f * (b[k] - a[k]) for k in range(2)]
            grid = f"x{min(50, max(1, round((x-6)/12, 2))):g}y{min(50, max(1, round((606-y)/12, 2))):g}"
            if not samples or grid != samples[-1]:
                samples.append(grid)
        parts.append({"id": stroke["id"], "author": stroke["author"], "points": samples})
    return parts


def grid_point(address):
    match = re.fullmatch(r'x(\d+(?:\.\d+)?)y(\d+(?:\.\d+)?)', address)
    require(match is not None, '模型坐标格式无效')
    x,y=map(float,match.groups())
    require(1<=x<=50 and 1<=y<=50,'模型坐标超出网格')
    return [12*x+6,606-12*y]


def shape_curves(points):
    """Local rounded polyline; every control stays inside the model's point hull.

    ponytail: small corner rounding replaces whole-stroke least-squares fitting;
    no learned cleanup, figure templates, or hidden replacement of model points.
    """
    ps = []
    for point in points:
        p = np.asarray(point, dtype=float)
        if not ps or not np.array_equal(p, ps[-1]):
            ps.append(p)
    if len(ps) == 1:
        return [np.array([ps[0], ps[0]])]
    closed = len(ps) > 2 and np.array_equal(ps[0], ps[-1])
    if closed:
        ps.pop()
    if len(ps) == 2:
        return [np.array(ps)]
    corners = {}
    indices = range(len(ps)) if closed else range(1, len(ps) - 1)
    for i in indices:
        prev, p, nxt = ps[(i - 1) % len(ps)], ps[i], ps[(i + 1) % len(ps)]
        a, b = np.linalg.norm(p - prev), np.linalg.norm(nxt - p)
        turn = math.acos(float(np.clip(np.dot((p - prev) / a, (nxt - p) / b), -1, 1)))
        cut = min(a * .42, b * .42, 24) if turn < math.pi / 3 else min(a * .15, b * .15, 4)
        corners[i] = (p + (prev - p) * cut / a, p + (nxt - p) * cut / b)
    start = corners[0][1] if closed else ps[0]
    curves = []
    order = list(range(1, len(ps))) + [0] if closed else range(1, len(ps) - 1)
    for i in order:
        before, after = corners[i]
        curves.extend([np.array([start, before]), np.array([before, ps[i], after])])
        start = after
    if not closed:
        curves.append(np.array([start, ps[-1]]))
    return curves


def flow_curves(points):
    """Midpoint quadratic spline: continuous tangents, no control outside the hull."""
    ps=[]
    for p in points:
        q=np.asarray(p,dtype=float)
        if not ps or not np.array_equal(q,ps[-1]):ps.append(q)
    if len(ps)<3:return [np.array([ps[0],ps[-1]])]
    closed=np.array_equal(ps[0],ps[-1])
    if closed:ps.pop()
    if len(ps)<3:return [np.array([ps[0],ps[-1]]),np.array([ps[-1],ps[0]])]
    if closed:
        return [np.array([(ps[i-1]+p)/2,p,(p+ps[(i+1)%len(ps)])/2]) for i,p in enumerate(ps)]
    curves=[];start=ps[0]
    for i in range(1,len(ps)-1):
        end=(ps[i]+ps[i+1])/2 if i<len(ps)-2 else ps[-1]
        curves.append(np.array([start,ps[i],end]));start=end
    return curves


def require_finished(answer):
    # A normal model stop proves transport completion, never artistic completeness.
    require(answer.get('done') is True and answer.get('done_reason') != 'length',
            '这次回应没有完整生成，原字画已保留，请重试。')


def json_content(raw):
    require(isinstance(raw,str) and len(raw)<=24000,"模型输出过长")
    text=raw.strip()
    fenced=re.fullmatch(r"```(?:json)?\s*(\{.*\})\s*```",text,re.S)
    if fenced:text=fenced.group(1)
    if not text.startswith('{'):return None  # Legacy saved SketchAgent XML remains readable.
    data=json.loads(text)
    require(isinstance(data,dict),"回应格式无效")
    return data


def parse_note(raw):
    data=json_content(raw)
    if data is not None:
        note=data.get('note','')
        require(isinstance(note,str),"回应文字格式无效")
        note=note.strip()
    else:
        match=re.search(r"<note>.*?</note>",raw,re.S)
        require('<note>' not in raw or match is not None,'助手批注未完整返回')
        note=''.join(ET.fromstring(match.group()).itertext()).strip() if match else ''
    require(len(note)<=80,"助手的纸边批注过长")
    return note


def parse_removals(raw, strokes):
    data = json_content(raw)
    ids = data.get('remove', []) if data is not None else []
    require(isinstance(ids, list) and len(ids) <= 12 and all(isinstance(sid, str) for sid in ids), '撤回笔画格式无效')
    allowed = {s['id'] for s in strokes if s['author'] == 'ai'}
    require(len(set(ids)) == len(ids) and all(sid in allowed for sid in ids), '只能撤回当前纸上助手自己的笔画')
    return ids


def parse_reply(raw):
    data=json_content(raw)
    specs=[]
    if data is not None:
        strokes=data.get('strokes')
        require(isinstance(strokes,list) and len(strokes)<=12,"模型一次最多返回12笔")
        for stroke in strokes:
            require(isinstance(stroke,dict),"笔画格式无效")
            points=stroke.get('points')
            require(isinstance(points,list) and 1<=len(points)<=32 and all(isinstance(p,str) for p in points),"笔画采样数量无效")
            specs.append((points,np.linspace(0,1,len(points)).tolist(),stroke.get('line','flow'),stroke.get('label',''),stroke.get('attachTo','')))
    else:
        match=re.search(r"<strokes>.*?</strokes>",raw,re.S)
        require(match is not None,"模型未返回完整笔画；原始输出已保留")
        root=ET.fromstring(match.group())
        require(len(root)<=12,"模型一次最多返回12笔")
        for node in root:
            points=[p.strip().strip("'\"") for p in (node.findtext('points') or '').split(',')]
            ts=ast.literal_eval('['+(node.findtext('t_values') or '')+']')
            specs.append((points,ts,node.findtext('line','flow').strip(),node.findtext('id') or '', ''))
    result=[]
    for points,ts,style,label,attachment in specs:
        require(isinstance(attachment, str) and (not attachment or re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', attachment)), '附着对象无效')
        require(1<=len(points)<=32 and len(points)==len(ts),"笔画采样数量无效")
        pixel_points=[grid_point(p) for p in points]
        require(all(type(t) in (int,float) and math.isfinite(t) and 0<=t<=1 for t in ts),"曲线参数无效")
        if len(ts)>1:require(ts[0]==0 and ts[-1]==1 and all(b>a for a,b in zip(ts,ts[1:])),"曲线参数必须从0递增到1")
        require(style in ('flow','corner') and isinstance(label,str),"笔触类型无效")
        curves=flow_curves(pixel_points) if style=='flow' else shape_curves(pixel_points)
        geometry=[]
        for curve in curves:
            require(np.isfinite(curve).all(),"拟合结果无效")
            for t in np.linspace(0,1,2 if len(curve)==2 else 12):
                q=np.array(curve,dtype=float)
                while len(q)>1:q=(1-t)*q[:-1]+t*q[1:]
                point=q[0].tolist()
                require(12<=point[0]<=611 and 0<=point[1]<=599,"拟合笔画超出纸面")
                geometry.append(point)
        result.append({'id':'ai-'+uuid.uuid4().hex[:12],'author':'ai','points':geometry,
                       'curves':[c.tolist() for c in curves],'paths':[utils.create_svg_path_data(c) for c in curves],
                       'label':label[:120],'cells':points,'t_values':ts,'line':style,'attachTo':attachment})
    return result


# Adapted from SketchAgent's grid vocabulary; no contradictory legacy examples.
SYSTEM = """You share a small paper notebook with a person. Respond to their words and marks
with ONE complete, modest visual thought. You are a co-author, not a drawing tutor.
The paper may continue for many turns, but your contribution this turn must stand
on its own: recognizable contours, connected parts, and enough defining detail.
White space is welcome. An unfinished fragment is not the same as leaving room.
Choose a small subject you can draw well within 12 strokes; finish that subject.
Do not use a note to explain a shape that the drawing itself fails to communicate.

Read the CURRENT image and exact stroke list first. Teal belongs to the person,
rose to you. Grey grid lines/numbers are measurement guides, never content.
Edits are real: erased marks stay erased, moved marks are at their new position.
Preserve the human's strokes and words. Add strokes, and optionally retract up to
12 of YOUR OWN existing strokes using their exact IDs in "remove". Never remove a
human stroke. When a person moves a contour, check whether your old attachments
are now floating; you may replace those stale marks at the current position.
The strokes array contains ONLY new marks. Existing marks remain automatically;
do not return them again unless their old IDs are explicitly in remove.
The human may explicitly GROUP several strokes. To attach a new stroke to one
existing group, set its optional attachTo to that group's exact ID. The paper will
then move those marks together. Use an empty string for a mark placed on the paper
independently. Do not invent group IDs or infer a hidden group from proximity.
Reuse their contour when it fits; do not trace a duplicate inside it. Connect an
attached part at the existing contour, not nearby. Relate to their current words,
including corrections; do not automatically repeat the previous idea.
Integrate nearby marks into a coherent small composition where possible.
The latest human sentence takes priority over your earlier interpretation. Respond
to its actual concern, not just to a noun in the scene. Do not invent a task or
decide what the person should do. Your response may acknowledge uncertainty.

Drawing language (adapted from SketchAgent): a 50 by 50 grid, x increases right,
y increases upward. x1y1 is bottom-left, x50y50 top-right. Fractions are allowed.
Each stroke lists points along its intended path in order, NOT Bezier handles.
The default line="flow" joins them with a smooth bounded quadratic spline.
For flowing contours use 6-20 well spaced points. A repeated first point closes a
loop. For deliberate sharp corners use line="corner". Two points form a line.
Use varying contour length and clean joins, not many tiny disconnected fragments.
Keep the drawing between y6 and y44, clear of the writing and reply bands.
Make a new subject readable at notebook size, usually at least 8 grid units across.
A tiny fragment cannot carry your whole response.
Choose a clear view and the distinguishing features that make the subject readable
WITHOUT its label. A generic oval or trapezoid is not a finished object. Preserve
meaningful indentations and tips; use corner strokes where smoothing would erase
them. Do not scatter decorative symbols to fill space.

Return ONLY one JSON object with "strokes", "remove" and "note". Format example (not an answer):
{"strokes":[{"points":["x12y20","x14y21"],"line":"flow","label":"part name"}],"remove":[],"note":""}
Generate your OWN points for the actual paper. Use at most 12 strokes, at most 32
points per stroke. "line" is "flow" or "corner". "label" is a short part name.
Coordinates are 1-50. At least one stroke, retraction or nonempty note is required.
No XML, t_values, code fences, or planning text.

The optional Chinese note is a small personal reply, usually 6-28 characters,
maximum 80. Address what the person said, or add a fresh thought beside it.
Never caption your image, announce what you drew, list additions, or use wording
like 'I added', 'now it looks like', '留白', or '添了几笔'. Avoid generic reassurance,
therapy language, invented memories, and automatic questions. It can be quiet,
concrete, playful, or omitted. It must not claim to know the person's private life.
Prefer an ordinary, specific reply to a forced poetic object metaphor. Do not
recount a visible move or offer advice when the person has only shared a feeling.
Before returning, check that the visual thought is finished and the note adds
something beyond naming the drawing. Do not output your planning or self-review.
"""

SHEET_SYSTEM = """You and a person take turns sharing one small paper. Read their current words,
marks, and actual edits; leave one complete, modest response of your own choosing.
You are a co-author, not a drawing tutor. No fixed icon library or prescribed story.
You can draw, write a short reply, reorganize your untouched marks, or leave the paper alone.
Respond to the person's meaning, not just a noun in their drawing. Do not explain what you drew,
invent private memories, prescribe what they must do, or automatically offer reassurance.

CURRENT PAPER is the only current truth. The last two PRESENTED exchanges and before/after edits
are factual context. Erased things no longer exist. Read the actual removed object, not only its ID.
An earlier response that the person corrected is not their current intention. Do not redraw rejected
content unless the latest human words ask for it. A moved object now belongs at its new position.
Every human object and every object with humanEdited=true is protected: never remove or relocate it.
You may retract only current ai objects with humanEdited=false using their exact IDs.
If your remaining attachments float after the person's edit, replace only your unprotected parts.
Do not repeat existing strokes or text as new additions. Existing objects remain automatically.

The attached PNG and structured objects are the SAME 612x612 paper, including all visible text.
Coordinates are pixel numbers: origin TOP LEFT, x right, y DOWN. All ink must stay within 12..600.
Grey coordinate grid is a measurement guide, not content. Human ink is teal; yours is rose.
Choose one coherent visual idea, not a token decoration. The paper is normally shown only 420px
wide: a tiny square or isolated arc can be invisible or ambiguous at that size. Use a readable
silhouette and the few distinguishing features the idea needs; leave breathing room. A useful
addition may take 80-200px of this 612px paper. Small details are fine when attached to a legible
whole. This is scale guidance, not a required icon, subject, mood, or number of strokes.
If a visual response cannot clearly carry your meaning, a specific short sentence is a complete
response too. Do not mechanically stamp, circle, underline, or decorate a noun just to add ink.
Leave room around existing text.
Strokes list points along the line, NOT Bezier handles. The pen passes through these points.
Use auto to preserve sharp turns while smoothing gentle bends, flow for deliberately smooth contours, corner for
deliberate corners. 6-20 spaced points usually work; a repeated first point closes a contour.
Never use a text caption to compensate for an unrecognizable drawing.

Return ONLY JSON with decision, strokes, texts, remove. No Markdown or planning.
decision is contribute or pause. pause MUST have all three arrays empty; it is valid when the
person asks to leave things as they are or no addition would help. Do not add a goodbye for pause.
contribute must contain at least one addition or retraction.
strokes: at most 12 objects, each with points (1-32 [x,y] numeric pairs), line (auto, flow or corner; default auto),
and optional attachTo (an existing group's ID, only when these marks should move together).
texts: at most 3 objects, with text, x, y, w, and optional attachTo. At most 80 characters total;
usually one ordinary, specific short sentence. Choose its position near relevant ink without covering
existing words or drawings. Neither new ink nor new text may cross existing words; new words must also avoid all ink. Leave at least 4px clear space. Do not shrink or hide parts to fake clearance. Text advances 22px for non-Latin and 11px for Latin, lines are 28px high.
w must be at least 88; x+w <=600 and y+wrapped text height <=600. Text and drawing can combine.
remove: at most 24 exact IDs of your unprotected current objects. Do not invent IDs.
Before returning, check completion, the latest correction, placement, and permissions.
"""

@app.before_request
def local_only():
    if request.host not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
        return jsonify(error="仅限本机访问"), 403
    origin = request.headers.get("Origin")
    allowed = (f"chrome-extension://{EXTENSION_ID}",) if PUBLIC else (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}", f"chrome-extension://{EXTENSION_ID}")
    if origin and origin not in allowed:
        return jsonify(error="来源不允许"), 403
    if not PUBLIC:
        return
    if not (request.path == '/api/status' or request.path.startswith(('/api/jobs', '/api/external/'))):
        return jsonify(error='Not found'), 404
    if request.method == 'OPTIONS':
        return '', 204
    if request.path.startswith('/api/external/'):
        return  # This endpoint has its own per-task capability, not the review token.
    token = request.headers.get('Authorization', '').removeprefix('Bearer ')
    review = os.environ.get('JIEBI_REVIEW_TOKEN', '')
    test = os.environ.get('JIEBI_TEST_TOKEN', '')
    is_test = len(test) >= 32 and hmac.compare_digest(token.encode(), test.encode())
    if not (is_test or (review and hmac.compare_digest(token.encode(), review.encode()))):
        return jsonify(error='请先在助手连接中填写评审访问码。'), 401
    session = request.headers.get('X-Jiebi-Session', '')
    try:
        require(str(uuid.UUID(session)) == session, '会话无效')
    except (ValueError, AttributeError):
        return jsonify(error='会话无效'), 403
    g.owner = hashlib.sha256((('test:' if is_test else 'review:')+session).encode()).hexdigest()
    g.allow_external = bool(is_test)


@app.after_request
def extension_origin(response):
    if request.headers.get('Origin') == f'chrome-extension://{EXTENSION_ID}':
        response.headers['Access-Control-Allow-Origin'] = f'chrome-extension://{EXTENSION_ID}'
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Jiebi-Session'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.get("/")
def index():
    return render_template("study.html", model=MODEL)


@app.get('/extension-preview/')
def extension_preview():
    html = (ROOT / 'extension/popup.html').read_text()
    return html.replace('<h1>接笔</h1>', '<h1>接笔 <small style="font:11px sans-serif;letter-spacing:0;color:#60777c">网页预览</small></h1>')


@app.get('/extension-preview/closed')
def preview_closed():
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>接笔 · 开发预览已收起</title><body style="background:#dce6e8;color:#243e44;font:18px sans-serif;padding:60px"><p>开发预览已收起。</p><p>本页模拟后台交接。关闭本页会暂停尚未交出的任务；已受理的生成继续。</p><a href="/extension-preview/">重新打开接笔</a><p style="font-size:13px">实际插件由 Chrome 后台交接，无需保留网页。</p><script type="module" src="closed.mjs"></script></body></html>'


@app.get('/extension-preview/<name>')
def preview_asset(name):
    if name not in ('popup.css', 'popup.mjs', 'paper.mjs', 'sheet.mjs', 'ink.mjs', 'platform.mjs', 'outbox.mjs', 'closed.mjs', 'library.mjs'):
        return 'Not found', 404
    return send_from_directory(ROOT / 'extension', name)


@app.get("/extension/paper.mjs")
def shared_paper():
    return send_from_directory(ROOT / "extension", "paper.mjs")


@app.get("/api/status")
def status():
    return jsonify(service="jiebi", model=MODEL, provider=PROVIDER,
                   configured=bool(os.environ.get('NEBIUS_API_KEY')) if PROVIDER=='nebius' else True,
                   usage=nebius.usage_summary() if PROVIDER=='nebius' and not PUBLIC else None,
                   externalConfigured=external.configured() and (not PUBLIC or getattr(g, 'allow_external', False)),
                   upstream="14c4043064e91a0b2823718e4831b727e3c506d7", imageInput=True)


@app.post("/api/next")
def next_strokes():
    return generate_reply(request.get_json())


def generate_reply(data):
    started = time.perf_counter()
    rid = uuid.uuid4().hex
    record = {"requestId": rid, "model": MODEL, "provider": PROVIDER, "at": time.time(), "status": "pending"}
    acquired = False
    try:
        data = validate_input(data)
        version, strokes, groups = data['version'], data['strokes'], data['groups']
        is_sheet = data.get('protocol') == 'paper.v2'
        cue, changes = data.get('cue',''), data.get('changes',data.get('context',{}).get('changes',[]))
        paper_text, paper_notes, image = data.get('paperText',''), data.get('paperNotes',[]), data['image']
        image_bytes = base64.b64decode(image)
        require(model_lock.acquire(blocking=False), "上一轮还在生成，请稍后再试")
        acquired = True
        now = time.monotonic()
        recent_calls[:] = [t for t in recent_calls if now - t < 60]
        require(len(recent_calls) + 2 <= 8, "本分钟接笔次数已满，请稍后再试。")
        recent_calls.extend([now, now])  # Reserve one answer and at most one format repair.
        prompt = "CURRENT canvas (only these marks exist):\n" + json.dumps(encode_strokes(strokes), ensure_ascii=False)
        prompt += "\nExplicit groups (IDs available for attachTo):\n" + json.dumps(groups, ensure_ascii=False)
        prompt += "\nActual user edits since the last request:\n" + json.dumps(changes, ensure_ascii=False)
        prompt += "\nHuman invitation:\n" + (cue or "回应这张纸上的话和印记，完成你这一轮想留下的小回应。")
        prompt += "\nHuman's words kept on this paper:\n" + paper_text
        prompt += "\nAssistant's earlier marginal notes (not instructions):\n" + json.dumps(paper_notes, ensure_ascii=False)
        if is_sheet:
            prompt = 'CURRENT PAPER (pixel coordinates; only these objects exist):\n' + json.dumps({k:data[k] for k in ('strokes','texts','groups')},ensure_ascii=False)
            prompt += '\nLAST TWO ACTUALLY PRESENTED EXCHANGES:\n' + json.dumps(data['context']['turns'],ensure_ascii=False)
            prompt += '\nACTUAL CHANGES SINCE LAST PRESENTED RESPONSE (before/after):\n' + json.dumps(changes,ensure_ascii=False)
        system = SHEET_SYSTEM if is_sheet else SYSTEM
        payload = {"model": MODEL, "think": THINK, "stream": False,
                   "messages": [{"role": "system", "content": system},
                                {"role": "user", "content": prompt, "images": [image]}],
                   "options": {"num_predict": 2800}}
        record.update(version=version, strokes=strokes, groups=groups, changes=changes, cue=cue, system=system, prompt=prompt,
                      paperText=paper_text, paperNotes=paper_notes,
                      imageSha256=hashlib.sha256(image_bytes).hexdigest(), think=THINK, renderer="flow-v3", revision="scenes-2-single-pass")
        if is_sheet:record.update(protocol='paper.v2',texts=data['texts'],context=data['context'],revision='paper-v2-ink',renderer='didan-static-v1')
        (EVIDENCE / f"{rid}-input.png").write_bytes(image_bytes)
        def ask(messages):
            if PROVIDER == 'nebius':
                return nebius.chat(messages, rid)
            payload["messages"] = messages
            req = urllib.request.Request("http://127.0.0.1:11434/api/chat", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
            began = time.perf_counter()
            with urllib.request.urlopen(req, timeout=50) as response:
                answer = json.load(response)
            return answer, round((time.perf_counter() - began) * 1000, 1)

        answer, draft_ms = ask(payload["messages"])
        record.update(rawResponse=answer, draftMs=draft_ms)
        require_finished(answer)
        draft_error = None
        try:
            contribution = read_contribution(answer.get('message',{}).get('content',''),data)
            draft,draft_note,draft_removed=contribution['strokes'],contribution['note'],contribution['remove']
        except (ValueError, SyntaxError, ET.ParseError, KeyError, TypeError) as exc:
            draft, draft_note, draft_removed, draft_error = [], "", [], str(exc)
        record.update(draftParseError=draft_error, revisionMode="format-repair" if draft_error else "single-pass",
                      draftResponse=answer, draftGenerated=draft, draftNote=draft_note, draftRemoved=draft_removed)
        repair_ms = 0
        # The single Nebius verification uses one call per turn, with no paid repair/re-roll.
        if draft_error and PROVIDER == 'nebius':
            raise ValueError('这次回应未通过纸面校验，原稿已保留；本轮不追加模型调用。')
        # ponytail: self-review duplicated marks and added delay in real trials; repair format only.
        if draft_error:
            repair = """Your response could not be applied. Correct its format once. The image
is still the ORIGINAL paper. Preserve the person's marks and words. Return JSON
with strokes (only NEW points/line/label), remove (existing AI IDs only), and note.
Do not re-emit existing strokes. Finish the same small reply, not a different scene.
Parser error: """ + draft_error
            if is_sheet:repair='Correct this paper.v2 response once. Return decision/strokes/texts/remove; use pixel coordinates and preserve all protected objects. The image is still the original paper. Error: '+draft_error
            messages = payload["messages"] + [
                {"role": "assistant", "content": answer["message"]["content"]},
                {"role": "user", "content": repair, "images": [image]}]
            answer, repair_ms = ask(messages)
            record.update(repairResponse=answer, rawResponse=answer)
            require_finished(answer)
        contribution=read_contribution(answer.get('message',{}).get('content',''),data)
        generated,note,removed=contribution['strokes'],contribution['note'],contribution['remove']
        record.update(repairMs=repair_ms, reviewMs=0, modelMs=round(draft_ms+repair_ms, 1))
        record.update(status="ok", generated=generated, removed=removed, note=note, serverMs=round((time.perf_counter() - started) * 1000, 1))
        if is_sheet:record.update(decision=contribution['decision'],textsGenerated=contribution['texts'])
        return jsonify(requestId=rid, version=version, **contribution, model=answer.get("model", MODEL), provider=PROVIDER,
                       doneReason=answer.get("done_reason"), revisionMode=record["revisionMode"], draftMs=draft_ms, reviewMs=0, repairMs=repair_ms, modelMs=record["modelMs"], serverMs=record["serverMs"])
    except (ValueError, SyntaxError, ET.ParseError, KeyError, TypeError) as exc:
        record.update(status="rejected", error=str(exc))
        message = str(exc) if re.search(r'[\u4e00-\u9fff]',str(exc)) else '这次笔画格式不完整，文字和画面已保留，可以重试。'
        return jsonify(error=message, requestId=rid), 422
    except Exception as exc:
        record.update(status="failed", error=type(exc).__name__)
        return jsonify(error="模型调用失败或超时，可保留画面后重试", requestId=rid), 502
    finally:
        record["elapsedMs"] = round((time.perf_counter() - started) * 1000, 1)
        (EVIDENCE / f"{rid}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2))
        if acquired:
            model_lock.release()


@app.post("/api/evidence/<run>/<kind>")
def save_evidence(run, kind):
    require(re.fullmatch(r"[a-z0-9-]{1,70}", run) is not None, "文件名无效")
    require(kind in ("webm", "json", "png"), "文件类型无效")
    target = EVIDENCE / f"{run}.{kind}"
    with target.open("xb") as f:
        f.write(request.get_data())
    return jsonify(saved=target.name)


@app.get("/evidence/<path:name>")
def evidence(name):
    return send_from_directory(EVIDENCE, name)


# The transport owns durable jobs; the existing generator is just its current adapter.
from handoff import Jobs, install as install_handoff

def model_job(data):
    with app.app_context():
        response = app.make_response(generate_reply(data))
        return response.get_json(), response.status_code

jobs = Jobs(ROOT / 'data/handoff.sqlite3', validate_input, model_job, external.dispatch if external.configured() else None)
install_handoff(app, jobs)
external.install(app, jobs, parse_sheet_reply, SHEET_SYSTEM)

if __name__ == "__main__":
    jobs.start()
    app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False, load_dotenv=False)
