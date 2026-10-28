"""Bounded paper geometry. Catmull-Rom derives from didan engine.py; no renderer dependency."""
import math


def ink_curves(points, line='auto'):
    p = [q for i, q in enumerate(points) if not i or q != points[i-1]]
    if len(p) < 2: return [[p[0], p[0]]]
    closed = len(p) > 2 and p[0] == p[-1]
    if closed: p.pop()
    n = len(p)
    def at(i): return p[i % n if closed else max(0, min(n-1, i))]
    def tangent(i):
        a, b, c = at(i-1), at(i), at(i+1)
        u, v = [b[k]-a[k] for k in range(2)], [c[k]-b[k] for k in range(2)]
        den = math.hypot(*u) * math.hypot(*v)
        if line == 'corner' or (line == 'auto' and den and sum(u[k]*v[k] for k in range(2))/den < .35): return [0, 0]
        return [(c[k]-a[k])/6 for k in range(2)]
    out = []
    for i in range(n if closed else n-1):
        a, b, u, v = at(i), at(i+1), tangent(i), tangent((i+1) % n)
        out.append([a, [max(12, min(600, a[k]+u[k])) for k in range(2)], [max(12, min(600, b[k]-v[k])) for k in range(2)], b])
    return out


def path_points(s):
    curves = s.get('curves')
    if curves is None and s.get('brush') == 'didan-v1': curves = ink_curves(s['points'], s.get('line', 'auto'))
    if curves is None:
        p = s['points']
        if len(p) < 3: return p
        curves = []
        start = p[0]
        for i in range(1, len(p)-1):
            end = p[-1] if i == len(p)-2 else [(p[i][k]+p[i+1][k])/2 for k in range(2)]
            curves.append([start, p[i], end]); start = end
    out = []
    for c in curves:
        span = sum(math.dist(a, b) for a, b in zip(c, c[1:]))
        count = 1 if len(c) == 2 else max(2, min(128, math.ceil(span/4)))
        for i in range(1 if out else 0, count+1):
            a, t = c, i/count
            while len(a) > 1: a = [[a[j][k]*(1-t)+a[j+1][k]*t for k in range(2)] for j in range(len(a)-1)]
            out.append(a[0])
    return out


def text_rects(t, pad=3):
    widths = [0]
    for ch in t['text']:
        step = 11 if ord(ch) <= 255 else 22
        if ch == '\n': widths.append(0); continue
        if widths[-1]+step > t['w']: widths.append(0)
        widths[-1] += step
    return [(t['x']-pad, t['y']+i*28-pad, t['x']+w+pad, t['y']+i*28+24+pad) for i, w in enumerate(widths) if w]


def overlap(a, b): return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def segment_box(a, b, r):
    lo, hi = 0, 1
    dx, dy = b[0]-a[0], b[1]-a[1]
    for p, q in ((-dx, a[0]-r[0]), (dx, r[2]-a[0]), (-dy, a[1]-r[1]), (dy, r[3]-a[1])):
        if p == 0:
            if q < 0: return False
        else:
            t = q/p
            if p < 0: lo = max(lo, t)
            else: hi = min(hi, t)
            if lo > hi: return False
    return True


def stroke_touches_text(s, t):
    p = path_points(s)
    for r in text_rects(t):
        if len(p) == 1 and r[0] <= p[0][0] <= r[2] and r[1] <= p[0][1] <= r[3]: return True
        if any(segment_box(a, b, r) for a, b in zip(p, p[1:])): return True
    return False


def check_new_layout(data, strokes, texts, remove=()):
    keep_text = [t for t in data['texts'] if t['id'] not in remove]
    keep_strokes = [s for s in data['strokes'] if s['id'] not in remove]
    for t in texts:
        if any(overlap(a, b) for o in keep_text+texts if o is not t for a in text_rects(t) for b in text_rects(o)):
            raise ValueError('新增文字与已有文字重叠，请换到空白位置')
        if any(stroke_touches_text(s, t) for s in keep_strokes+strokes):
            raise ValueError('新增文字压住了笔画，请换到空白位置')
    for s in strokes:
        if any(stroke_touches_text(s, t) for t in keep_text+texts):
            raise ValueError('新增笔画穿过文字，请避开原字')
