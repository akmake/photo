"""Rasterise one page of a simple PDF 1.4 (fills, strokes, rect clips, DCT/Flate images) with PIL.
Usage: python pdfrender.py <pdf> <page> <out.png> [widthPx]
Reuses the parser in pdfpage.py by importing its helpers.
"""
import io, math, re, sys
from PIL import Image, ImageDraw, ImageChops

sys.argv = [sys.argv[0], sys.argv[1], sys.argv[2], sys.argv[3], *(sys.argv[4:] or ['2400'])]
PDF, PAGE, OUT, WPX = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])

import importlib.util, os
spec = importlib.util.spec_from_file_location('pp', os.path.join(os.path.dirname(__file__), 'pdfpage.py'))
# pdfpage.py runs on import; feed it argv and swallow its stdout
_argv, _stdout = sys.argv, sys.stdout
sys.argv = ['pdfpage.py', PDF, str(PAGE)]
sys.stdout = io.StringIO()
pp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pp)
sys.stdout = _stdout

W, H = pp.W, pp.H
S = WPX / W
HPX = round(H * S)
canvas = Image.new('RGB', (WPX, HPX), 'white')

def dev(pt):
    return (pt[0] * S, (H - pt[1]) * S)

def hexrgb(vals):
    h = pp.color_hex(vals)
    return tuple(int(h[i:i+2], 16) for i in (1, 3, 5)) if h.startswith('#') else (255, 0, 255)

def bez(p0, p1, p2, p3, n=10):
    return [((1-t)**3*p0[0] + 3*(1-t)**2*t*p1[0] + 3*(1-t)*t*t*p2[0] + t**3*p3[0],
             (1-t)**3*p0[1] + 3*(1-t)**2*t*p1[1] + 3*(1-t)*t*t*p2[1] + t**3*p3[1]) for t in [i/n for i in range(1, n+1)]]

def raw_image(num):
    body = pp.raw_obj(num)
    d = pp.obj(num)
    s = body.find(b'stream') + 6
    if body[s:s+2] == b'\r\n': s += 2
    elif body[s:s+1] in (b'\n', b'\r'): s += 1
    length = pp.resolve(d.get('/Length'))
    raw = body[s:s+int(length)]
    filt = pp.resolve(d.get('/Filter'))
    filt = filt if isinstance(filt, list) else [filt]
    if '/DCTDecode' in filt:
        return Image.open(io.BytesIO(raw)).convert('RGB')
    if '/FlateDecode' in filt:
        import zlib
        raw = zlib.decompress(raw)
        w, h = int(pp.resolve(d['/Width'])), int(pp.resolve(d['/Height']))
        cs = pp.resolve(d.get('/ColorSpace'))
        mode = 'L' if cs == '/DeviceGray' else 'CMYK' if cs == '/DeviceCMYK' else 'RGB'
        try:
            return Image.frombytes(mode, (w, h), raw).convert('RGB')
        except Exception:
            return None
    return None

def run(content, res, ctm, clip=None):
    res = pp.resolve(res) or {}
    xobjs = pp.resolve(res.get('/XObject', {})) or {}
    gstates = pp.resolve(res.get('/ExtGState', {})) or {}
    stack = []
    fill, stroke, lw, alpha = [0.0], [0.0], 1.0, 1.0
    subpaths, cur = [], None
    clip_pending = False
    operands = []
    for m in pp.OPS.finditer(content):
        tok = m.group(1)
        if tok.startswith(b'%'): continue
        if re.fullmatch(rb'[-+]?\d*\.?\d+\.?', tok):
            operands.append(float(tok.rstrip(b'.') or 0)); continue
        if tok.startswith((b'/', b'(', b'<')) or tok in (b'[', b']'):
            operands.append(tok.decode('latin1')); continue
        op = tok.decode('latin1')
        n = [o for o in operands if isinstance(o, float)]
        if op == 'q': stack.append((ctm, fill, stroke, lw, alpha, clip))
        elif op == 'Q' and stack: ctm, fill, stroke, lw, alpha, clip = stack.pop()
        elif op == 'cm' and len(n) >= 6: ctm = pp.mul(n[-6:], ctm)
        elif op == 'rg' and len(n) >= 3: fill = n[-3:]
        elif op == 'g' and n: fill = n[-1:]
        elif op == 'k' and len(n) >= 4: fill = n[-4:]
        elif op in ('sc', 'scn') and n: fill = n
        elif op == 'RG' and len(n) >= 3: stroke = n[-3:]
        elif op == 'G' and n: stroke = n[-1:]
        elif op == 'K' and len(n) >= 4: stroke = n[-4:]
        elif op in ('SC', 'SCN') and n: stroke = n
        elif op == 'w' and n: lw = n[-1]
        elif op == 'gs' and operands:
            g = pp.resolve(gstates.get(operands[-1], {})) or {}
            if '/ca' in g: alpha = pp.resolve(g['/ca'])
        elif op == 're' and len(n) >= 4:
            x, y, w, h = n[-4:]
            subpaths.append([pp.apply(ctm, x, y), pp.apply(ctm, x+w, y), pp.apply(ctm, x+w, y+h), pp.apply(ctm, x, y+h), pp.apply(ctm, x, y)])
            cur = None
        elif op == 'm' and len(n) >= 2:
            cur = [pp.apply(ctm, *n[-2:])]; subpaths.append(cur)
        elif op == 'l' and len(n) >= 2 and cur is not None: cur.append(pp.apply(ctm, *n[-2:]))
        elif op in ('c', 'v', 'y') and cur is not None:
            p0 = cur[-1]
            if op == 'c' and len(n) >= 6: p1, p2, p3 = pp.apply(ctm, *n[-6:-4]), pp.apply(ctm, *n[-4:-2]), pp.apply(ctm, *n[-2:])
            elif op == 'v' and len(n) >= 4: p1, p2, p3 = p0, pp.apply(ctm, *n[-4:-2]), pp.apply(ctm, *n[-2:])
            elif op == 'y' and len(n) >= 4: p1, p2, p3 = pp.apply(ctm, *n[-4:-2]), pp.apply(ctm, *n[-2:]), pp.apply(ctm, *n[-2:])
            else: operands = []; continue
            cur.extend(bez(p0, p1, p2, p3))
        elif op == 'h' and cur: cur.append(cur[0])
        elif op in ('W', 'W*'): clip_pending = True
        elif op in ('f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*', 'n'):
            if subpaths:
                if clip_pending:
                    pts = [p for sp in subpaths for p in sp]
                    xs = [dev(p)[0] for p in pts]; ys = [dev(p)[1] for p in pts]
                    clip = (min(xs), min(ys), max(xs), max(ys))
                if op in ('f', 'F', 'f*', 'B', 'B*', 'b', 'b*'):
                    mask = Image.new('1', canvas.size, 0)
                    for sp in subpaths:
                        if len(sp) < 3: continue
                        one = Image.new('1', canvas.size, 0)
                        ImageDraw.Draw(one).polygon([dev(p) for p in sp], fill=1)
                        mask = ImageChops.logical_xor(mask, one)
                    if clip:
                        cm_ = Image.new('1', canvas.size, 0); ImageDraw.Draw(cm_).rectangle(clip, fill=1)
                        mask = ImageChops.logical_and(mask, cm_)
                    layer = Image.new('RGB', canvas.size, hexrgb(fill))
                    m8 = mask.convert('L').point(lambda v: int(v * alpha))
                    canvas.paste(layer, (0, 0), m8)
                if op in ('S', 's', 'B', 'B*', 'b', 'b*'):
                    d = ImageDraw.Draw(canvas)
                    width = max(1, round(lw * math.hypot(ctm[0], ctm[1]) * S))
                    for sp in subpaths:
                        if len(sp) >= 2: d.line([dev(p) for p in sp], fill=hexrgb(stroke), width=width, joint='curve')
            subpaths, cur, clip_pending = [], None, False
        elif op == 'Do' and operands:
            ref = xobjs.get(operands[-1])
            if isinstance(ref, pp.Ref):
                d = pp.obj(ref.n)
                if d.get('/Subtype') == '/Image':
                    img = raw_image(ref.n)
                    if img is not None:
                        corners = [dev(pp.apply(ctm, *c)) for c in ((0, 0), (1, 0), (0, 1), (1, 1))]
                        xs = [c[0] for c in corners]; ys = [c[1] for c in corners]
                        box = (round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys)))
                        angle = math.degrees(math.atan2(ctm[1], ctm[0]))
                        if abs(angle) > 0.05:
                            w0 = math.hypot(ctm[0], ctm[1]) * S; h0 = math.hypot(ctm[2], ctm[3]) * S
                            tile = img.resize((max(1, round(w0)), max(1, round(h0)))).convert('RGBA').rotate(angle, expand=True)
                            cx = (box[0] + box[2]) / 2; cy = (box[1] + box[3]) / 2
                            pos = (round(cx - tile.width / 2), round(cy - tile.height / 2))
                            m_ = tile.split()[3]
                            tile = tile.convert('RGB')
                        else:
                            tile = img.resize((max(1, box[2]-box[0]), max(1, box[3]-box[1])))
                            pos = box[:2]; m_ = Image.new('L', tile.size, 255)
                        full = Image.new('L', canvas.size, 0); full.paste(m_, pos)
                        if clip:
                            cm_ = Image.new('L', canvas.size, 0); ImageDraw.Draw(cm_).rectangle(clip, fill=255)
                            full = ImageChops.multiply(full, cm_)
                        big = Image.new('RGB', canvas.size); big.paste(tile, pos)
                        canvas.paste(big, (0, 0), full.point(lambda v: int(v * alpha)))
                elif d.get('/Subtype') == '/Form':
                    fd, fc = pp.stream(ref.n)
                    fm = [pp.resolve(x) for x in pp.resolve(fd.get('/Matrix', [1, 0, 0, 1, 0, 0]))]
                    run(fc, fd.get('/Resources', res), pp.mul(fm, ctm), clip)
        operands = []

contents = pp.resolve(pp.page['/Contents'])
refs = contents if isinstance(contents, list) else [pp.page['/Contents']]
buf = b''.join(pp.stream(r.n if isinstance(r, pp.Ref) else r)[1] + b'\n' for r in refs)
run(buf, pp.resources, [1, 0, 0, 1, -pp.mediabox[0], -pp.mediabox[1]])
canvas.save(OUT)
print('saved', OUT, canvas.size)
