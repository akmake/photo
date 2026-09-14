"""Minimal PDF 1.4 page inspector: image placements, filled/stroked paths, clips, colors.
Usage: python pdfpage.py <pdf> <page-number-1-based>
"""
import re, sys, zlib, json

data = open(sys.argv[1], 'rb').read()
PAGE = int(sys.argv[2])

offsets = {}
for m in re.finditer(rb'(\d+)\s+(\d+)\s+obj\b', data):
    offsets[int(m.group(1))] = m.end()

def raw_obj(num):
    start = offsets[num]
    end = data.find(b'endobj', start)
    return data[start:end]

# ---------- tiny object parser ----------
TOKEN = re.compile(rb'\s*(<<|>>|\[|\]|/[^\s/\[\]<>()]*|\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|[-+]?\d*\.\d+|[-+]?\d+|[A-Za-z_\'"*]+)')

class Ref:
    def __init__(self, n): self.n = n
    def __repr__(self): return f'R{self.n}'

def tokenize(buf):
    pos = 0
    out = []
    while pos < len(buf):
        m = TOKEN.match(buf, pos)
        if not m:
            pos += 1
            continue
        out.append(m.group(1))
        pos = m.end()
        if m.group(1) == b'stream':
            break
    return out

def parse(tokens, i=0):
    t = tokens[i]
    if t == b'<<':
        d = {}
        i += 1
        while tokens[i] != b'>>':
            key = tokens[i].decode('latin1')
            val, i = parse(tokens, i + 1)
            d[key] = val
        return d, i + 1
    if t == b'[':
        arr = []
        i += 1
        while tokens[i] != b']':
            val, i = parse(tokens, i)
            arr.append(val)
        return arr, i + 1
    if re.fullmatch(rb'[-+]?\d+', t) and i + 2 < len(tokens) and re.fullmatch(rb'\d+', tokens[i+1]) and tokens[i+2] == b'R':
        return Ref(int(t)), i + 3
    if re.fullmatch(rb'[-+]?\d*\.?\d+', t):
        return float(t), i + 1
    return t.decode('latin1'), i + 1

def obj(num):
    body = raw_obj(num)
    toks = tokenize(body)
    val, _ = parse(toks)
    return val

def resolve(v):
    while isinstance(v, Ref):
        v = obj(v.n)
    return v

def stream(num):
    body = raw_obj(num)
    d = obj(num)
    s = body.find(b'stream')
    s += 6
    if body[s:s+2] == b'\r\n': s += 2
    elif body[s:s+1] in (b'\n', b'\r'): s += 1
    length = resolve(d.get('/Length'))
    raw = body[s:s+int(length)] if isinstance(length, float) else body[s:body.rfind(b'endstream')]
    filt = resolve(d.get('/Filter'))
    if filt == '/FlateDecode' or (isinstance(filt, list) and '/FlateDecode' in filt):
        try: raw = zlib.decompress(raw)
        except Exception: pass
    return d, raw

# ---------- pages ----------
root = None
for n in offsets:
    head = raw_obj(n)[:400]
    if b'/Type' in head and re.search(rb'/Type\s*/Catalog', head):
        root = obj(n); break
pages = []
def walk(node_ref, inherited):
    node = resolve(node_ref)
    res = node.get('/Resources', inherited)
    if node.get('/Type') == '/Pages':
        for k in resolve(node['/Kids']): walk(k, res)
    else:
        pages.append((node_ref, node, res))
walk(root['/Pages'], None)
page_ref, page, resources = pages[PAGE - 1]
mediabox = [resolve(x) for x in resolve(page['/MediaBox'])]
W, H = mediabox[2] - mediabox[0], mediabox[3] - mediabox[1]

def mul(a, b):
    return [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
            a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5]]

def apply(m, x, y):
    return m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]

def bbox(points):
    xs = [p[0] for p in points]; ys = [p[1] for p in points]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return {'x': round(x0 / W, 4), 'y': round(1 - y1 / H, 4), 'w': round((x1 - x0) / W, 4), 'h': round((y1 - y0) / H, 4)}

def color_hex(vals):
    if len(vals) == 1: vals = vals * 3
    if len(vals) == 3: r, g, b = vals
    elif len(vals) == 4:
        c, m_, y, k = vals; r, g, b = (1-c)*(1-k), (1-m_)*(1-k), (1-y)*(1-k)
    else: return str(vals)
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(v * 255))) for v in (r, g, b))

OPS = re.compile(rb'\s*(\((?:\\.|[^\\)])*\)|<<.*?>>|<[0-9A-Fa-f\s]*>|\[|\]|/[^\s/\[\]<>()]+|[-+]?\d*\.\d+|[-+]?\d+\.?|[A-Za-z\'"*]+\d?\*?|%[^\n]*)', re.S)

events = []

def run(content, res, ctm, depth=0, label='page'):
    res = resolve(res) or {}
    xobjs = resolve(res.get('/XObject', {})) or {}
    gstates = resolve(res.get('/ExtGState', {})) or {}
    stack = []
    fill = [0.0]; stroke = [0.0]; lw = 1.0; alpha = 1.0
    path = []; cur = None
    clip_pending = False
    clip = None
    operands = []
    for m in OPS.finditer(content):
        tok = m.group(1)
        if tok.startswith(b'%'): continue
        if re.fullmatch(rb'[-+]?\d*\.?\d+\.?', tok):
            operands.append(float(tok.rstrip(b'.') or 0)); continue
        if tok.startswith(b'/') or tok.startswith(b'(') or tok.startswith(b'<') or tok in (b'[', b']'):
            operands.append(tok.decode('latin1')); continue
        op = tok.decode('latin1')
        nums = [o for o in operands if isinstance(o, float)]
        if op == 'q': stack.append((ctm, fill, stroke, lw, alpha, clip))
        elif op == 'Q' and stack: ctm, fill, stroke, lw, alpha, clip = stack.pop()
        elif op == 'cm' and len(nums) >= 6: ctm = mul(nums[-6:], ctm)
        elif op in ('rg', 'g', 'k', 'sc', 'scn') and nums: fill = nums[-(3 if op in ('rg',) else 1 if op == 'g' else 4 if op == 'k' else len(nums)):]
        elif op in ('RG', 'G', 'K', 'SC', 'SCN') and nums: stroke = nums[-(3 if op == 'RG' else 1 if op == 'G' else 4 if op == 'K' else len(nums)):]
        elif op == 'w' and nums: lw = nums[-1]
        elif op == 'gs' and operands:
            g = resolve(gstates.get(operands[-1], {})) or {}
            if '/ca' in g: alpha = resolve(g['/ca'])
        elif op == 're' and len(nums) >= 4:
            x, y, w, h = nums[-4:]
            path += [apply(ctm, x, y), apply(ctm, x+w, y), apply(ctm, x, y+h), apply(ctm, x+w, y+h)]
        elif op in ('m', 'l') and len(nums) >= 2: path.append(apply(ctm, *nums[-2:]))
        elif op in ('c', 'v', 'y') and len(nums) >= 2:
            for i in range(0, len(nums) - 1, 2): path.append(apply(ctm, nums[i], nums[i+1]))
        elif op in ('W', 'W*'): clip_pending = True
        elif op in ('f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*', 'n'):
            if path:
                if clip_pending:
                    clip = bbox(path)
                if op != 'n':
                    ev = {'kind': 'path', 'op': op, 'bbox': bbox(path), 'points': len(path), 'depth': depth, 'in': label}
                    if op in ('f', 'F', 'f*', 'B', 'B*', 'b', 'b*'): ev['fill'] = color_hex(fill)
                    if op in ('S', 's', 'B', 'B*', 'b', 'b*'): ev['stroke'] = color_hex(stroke); ev['lineWidthPt'] = round(lw * abs(ctm[0]), 3)
                    if alpha != 1.0: ev['alpha'] = alpha
                    if clip: ev['clip'] = clip
                    events.append(ev)
            path = []; clip_pending = False
        elif op == 'Do' and operands:
            name = operands[-1]
            ref = xobjs.get(name)
            if isinstance(ref, Ref):
                d = obj(ref.n)
                sub = d.get('/Subtype')
                corners = [apply(ctm, 0, 0), apply(ctm, 1, 0), apply(ctm, 0, 1), apply(ctm, 1, 1)]
                if sub == '/Image':
                    events.append({'kind': 'image', 'name': name, 'obj': ref.n, 'px': [resolve(d.get('/Width')), resolve(d.get('/Height'))],
                                   'bbox': bbox(corners), 'rotation_deg': round(__import__('math').degrees(__import__('math').atan2(ctm[1], ctm[0])), 2),
                                   'clip': clip, 'depth': depth, 'in': label, 'alpha': alpha})
                elif sub == '/Form':
                    fd, fcontent = stream(ref.n)
                    fm = [resolve(x) for x in resolve(fd.get('/Matrix', [1, 0, 0, 1, 0, 0]))]
                    events.append({'kind': 'form', 'name': name, 'obj': ref.n, 'depth': depth, 'in': label})
                    run(fcontent, fd.get('/Resources', res), mul(fm, ctm), depth + 1, f'form{ref.n}')
        elif op in ('Tj', 'TJ', "'", '"'):
            events.append({'kind': 'text', 'in': label, 'raw': ' '.join(str(o) for o in operands)[:80]})
        operands = []

contents = resolve(page['/Contents'])
refs = contents if isinstance(contents, list) else [page['/Contents']]
buf = b''
for r in refs:
    buf += stream(r.n if isinstance(r, Ref) else r)[1] + b'\n'
run(buf, resources, [1, 0, 0, 1, -mediabox[0], -mediabox[1]])

summary = {'page': PAGE, 'size_pt': [W, H], 'events': events}
json.dump(summary, sys.stdout, ensure_ascii=False, indent=1)
