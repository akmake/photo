"""Convert the Vault (הכספת) InDesign source (.idml) into album templates.

Usage:
    python tools/album_templates/idml_to_templates.py <file.idml> [out.ts]

Every page becomes an AlbumTemplate (src/album/templates/types.ts) built from
separate layers — photo places, colour fields, strokes, lines, vector artwork
and live text — never a flattened picture. Geometry is written as fractions of
the page; vector artwork as SVG paths in a viewBox whose height is 1000.

What InDesign stores that the templates cannot carry yet is counted and printed
at the end, so nothing is dropped silently.
"""
import collections
import json
import math
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

VIEW_HEIGHT = 1000
PHOTO_TAGS = ('Image', 'EPS', 'PDF', 'ImportedPage')
TEXTURE_HINT = re.compile(r'texture|backgr|concrete|cement', re.I)
SCRIPT_FONT_HINT = re.compile(r'signature|script|hand|brush', re.I)

unsupported = collections.Counter()


# ---------------------------------------------------------------- geometry
def parse_matrix(text):
    a, b, c, d, tx, ty = (float(v) for v in (text or '1 0 0 1 0 0').split())
    return (a, b, c, d, tx, ty)


def compose(child, parent):
    """Apply `child` first, then `parent`."""
    a1, b1, c1, d1, e1, f1 = child
    a2, b2, c2, d2, e2, f2 = parent
    return (
        a1 * a2 + b1 * c2, a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2, c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2,
    )


def apply(m, x, y):
    a, b, c, d, tx, ty = m
    return (a * x + c * y + tx, b * x + d * y + ty)


def point(text):
    x, y = (float(v) for v in text.split())
    return (x, y)


def subpaths(el):
    out = []
    for geo in el.iter('GeometryPathType'):
        pts = [(point(p.get('Anchor')), point(p.get('LeftDirection')), point(p.get('RightDirection')))
               for p in geo.iter('PathPointType')]
        if pts:
            out.append((pts, geo.get('PathOpen') == 'true'))
    return out


def is_curved(paths):
    return any(anchor != left or anchor != right for pts, _ in paths for anchor, left, right in pts)


# ---------------------------------------------------------------- colours
def load_colors(z):
    xml = z.read('Resources/Graphic.xml').decode('utf-8')
    colors = {'Color/Paper': '#ffffff', 'Color/Black': '#000000', 'Swatch/None': None}
    for m in re.finditer(r'<Color Self="([^"]+)"([^>]*)>', xml):
        attrs = m.group(2)
        space = re.search(r'Space="(\w+)"', attrs)
        value = re.search(r'ColorValue="([^"]+)"', attrs)
        if not (space and value):
            continue
        v = [float(x) for x in value.group(1).split()]
        if space.group(1) == 'RGB':
            rgb = v
        elif space.group(1) == 'CMYK':
            c, mg, yl, k = (x / 100 for x in v)
            # The PDF InDesign exported from this file uses exactly this conversion
            # (page 4 background: CMYK 55/66/79/68 → #251c11 in both).
            rgb = [255 * (1 - c) * (1 - k), 255 * (1 - mg) * (1 - k), 255 * (1 - yl) * (1 - k)]
        else:
            unsupported[f'colour space {space.group(1)}'] += 1
            continue
        if m.group(1) != 'Color/Paper':
            colors[m.group(1)] = '#%02x%02x%02x' % tuple(max(0, min(255, round(x))) for x in rgb)
    return colors


# ---------------------------------------------------------------- stories
def story_of(z, story_id):
    try:
        root = ET.fromstring(z.read(f'Stories/Story_{story_id}.xml'))
    except KeyError:
        return None
    story = root.find('Story')
    text = ''.join(c.text or '' for c in story.iter('Content'))
    csr = story.find('.//CharacterStyleRange')
    psr = story.find('.//ParagraphStyleRange')
    font = csr.find('./Properties/AppliedFont') if csr is not None else None
    return {
        'text': text,
        'font': (font.text if font is not None else '') or '',
        'size': float(csr.get('PointSize', '12')) if csr is not None else 12.0,
        'fill': csr.get('FillColor', 'Color/Black') if csr is not None else 'Color/Black',
        'justification': psr.get('Justification', 'LeftAlign') if psr is not None else 'LeftAlign',
    }


# ---------------------------------------------------------------- one page
class Page:
    def __init__(self, z, colors, spread, index):
        self.z = z
        self.colors = colors
        page = spread.find('Page')
        top, left, bottom, right = (float(v) for v in page.get('GeometricBounds').split())
        self.W = right - left
        self.H = bottom - top
        self.px, self.py = apply(parse_matrix(page.get('ItemTransform')), left, top)
        self.aspect = self.W / self.H
        self.name = page.get('Name') or str(index + 1)
        self.index = index
        self.layers = []
        self.background = None
        self.tokens = {}          # hex -> token id
        self.token_labels = {}    # token id -> label
        self.z_order = 0

    # coordinates
    def frac(self, x, y):
        return ((x - self.px) / self.W, (y - self.py) / self.H)

    def view(self, x, y):
        fx, fy = self.frac(x, y)
        return (fx * self.aspect * VIEW_HEIGHT, fy * VIEW_HEIGHT)

    def token(self, color_ref, label):
        hex_ = self.colors.get(color_ref)
        if hex_ is None:
            return None
        if self.background and hex_ == self.background:
            return 'background'
        if hex_ not in self.tokens:
            tid = f'c{len(self.tokens) + 1}'
            self.tokens[hex_] = tid
            self.token_labels[tid] = label
        return self.tokens[hex_]

    def next_z(self):
        self.z_order += 1
        return self.z_order

    # item helpers
    @staticmethod
    def opacity_of(el, inherited):
        bs = el.find('./TransparencySetting/BlendingSetting')
        op = inherited
        blend = None
        if bs is not None:
            op *= float(bs.get('Opacity', '100')) / 100
            mode = bs.get('BlendMode', 'Normal')
            if mode != 'Normal':
                blend = re.sub(r'(?<!^)([A-Z])', r'-\1', mode).lower()
        return op, blend

    def bounds(self, paths, m):
        pts = [apply(m, *anchor) for pts, _ in paths for anchor, _, _ in pts]
        fx = [self.frac(*p)[0] for p in pts]
        fy = [self.frac(*p)[1] for p in pts]
        return min(fx), min(fy), max(fx), max(fy)

    def path_d(self, paths, m):
        parts = []
        r = lambda v: f'{v:.1f}'.rstrip('0').rstrip('.')
        for pts, is_open in paths:
            ax, ay = self.view(*apply(m, *pts[0][0]))
            parts.append(f'M{r(ax)} {r(ay)}')
            seq = list(range(1, len(pts))) + ([0] if not is_open else [])
            prev = 0
            for i in seq:
                c1 = self.view(*apply(m, *pts[prev][2]))
                c2 = self.view(*apply(m, *pts[i][1]))
                an = self.view(*apply(m, *pts[i][0]))
                if pts[prev][2] == pts[prev][0] and pts[i][1] == pts[i][0]:
                    parts.append(f'L{r(an[0])} {r(an[1])}')
                else:
                    parts.append(f'C{r(c1[0])} {r(c1[1])} {r(c2[0])} {r(c2[1])} {r(an[0])} {r(an[1])}')
                prev = i
            if not is_open:
                parts.append('Z')
        return ''.join(parts)

    def stroke(self, el):
        weight = float(el.get('StrokeWeight', '0') or 0)
        ref = el.get('StrokeColor', 'Swatch/None')
        if weight <= 0 or ref == 'Swatch/None' or self.colors.get(ref) is None:
            return None
        return weight, ref, el.get('StrokeAlignment', 'CenterAlignment')

    # walk
    def walk(self, el, m, opacity):
        if el.get('Visible') == 'false':
            return
        tag = el.tag
        if tag == 'Group':
            gm = compose(parse_matrix(el.get('ItemTransform')), m)
            op, blend = self.opacity_of(el, opacity)
            if blend:
                unsupported['blend mode on a group'] += 1
            for child in el:
                self.walk(child, gm, op)
            return
        if tag not in ('Rectangle', 'Polygon', 'Oval', 'GraphicLine', 'TextFrame'):
            if tag not in ('Page', 'FlattenerPreference', 'Properties', 'TextWrapPreference',
                           'ObjectExportOption', 'InCopyExportOption', 'FrameFittingOption',
                           'TransparencySetting', 'StrokeTransparencySetting', 'FillTransparencySetting',
                           'ContentTransparencySetting', 'ContourOption', 'AnchoredObjectSetting',
                           'TextFramePreference', 'BaselineFrameGridOption'):
                unsupported[f'element {tag}'] += 1
            return
        im = compose(parse_matrix(el.get('ItemTransform')), m)
        op, blend = self.opacity_of(el, opacity)
        paths = subpaths(el)
        if tag == 'TextFrame':
            self.text(el, im, paths, op)
            return
        if not paths:
            return
        image = next((c for c in el if c.tag in PHOTO_TAGS), None)
        if image is not None:
            link = image.find('Link')
            uri = link.get('LinkResourceURI', '') if link is not None else ''
            if TEXTURE_HINT.search(uri):
                unsupported['texture image (kept as a colour field)'] += 1
                self.shape_rect(el, im, paths, op, blend, fill_hex='#8a8279', label='טקסטורה')
                return
            self.photo(el, im, paths, op, blend)
            return
        if el.find('.//GradientFeatherSetting[@Applied="true"]') is not None:
            unsupported['fade on a non-photo shape'] += 1
        if tag == 'GraphicLine':
            self.line(el, im, paths, op, blend)
        elif tag == 'Oval':
            self.vector(el, im, paths, op, blend, shape='ellipse')
        elif tag == 'Rectangle' and not is_curved(paths) and abs(im[1]) < 1e-6 and abs(im[2]) < 1e-6:
            self.shape_rect(el, im, paths, op, blend)
        else:
            self.vector(el, im, paths, op, blend, shape='path')

    def base(self, kind, name, box, op, blend):
        layer = {'type': kind, 'id': f'{kind[0]}{len(self.layers) + 1}', 'name': name,
                 'zIndex': self.next_z(), 'box': box}
        if op < 0.999:
            layer['opacity'] = round(op, 3)
        if blend:
            layer['blendMode'] = blend
        return layer

    def photo(self, el, im, paths, op, blend):
        xs = [a[0] for pts, _ in paths for a, _, _ in pts]
        ys = [a[1] for pts, _ in paths for a, _, _ in pts]
        ix0, ix1, iy0, iy1 = min(xs), max(xs), min(ys), max(ys)
        a, b, c, d = im[:4]
        rotation = math.degrees(math.atan2(b, a))
        cx, cy = self.frac(*apply(im, (ix0 + ix1) / 2, (iy0 + iy1) / 2))
        w = (ix1 - ix0) * math.hypot(a, b) / self.W
        h = (iy1 - iy0) * math.hypot(c, d) / self.H
        x0, y0 = cx - w / 2, cy - h / 2
        if abs(rotation) < 0.05:
            rotation = 0
            x1, y1 = min(1, x0 + w), min(1, y0 + h)
            x0, y0 = max(0, x0), max(0, y0)
            w, h = x1 - x0, y1 - y0
        if w <= 0.002 or h <= 0.002:
            unsupported['photo frame outside the page'] += 1
            return
        box = {'x': round(x0, 5), 'y': round(y0, 5), 'width': round(w, 5), 'height': round(h, 5)}
        layer = self.base('photo', 'תמונה', box, op, blend)
        ratio = w * self.aspect / h
        layer.update({
            'role': 'support',
            'preferred': ['landscape'] if ratio > 1.1 else ['portrait'] if ratio < 0.9 else ['square'],
        })
        if rotation:
            layer['rotation'] = round(rotation, 3)
        if x0 < 0.5 < x0 + w:
            layer['allowCrossGutter'] = True
        if el.tag == 'Polygon':
            unsupported['photo in a non-rectangular frame (kept rectangular)'] += 1

        feather = el.find('.//GradientFeatherSetting[@Applied="true"]')
        if feather is not None:
            layer['feather'] = self.feather(feather, ix0, iy0, ix1 - ix0, iy1 - iy0)
        self.layers.append(layer)

        st = self.stroke(el)
        if st:
            self.stroke_rect(st, box, rotation, op, 'מסגרת תמונה')

    def feather(self, fs, ix, iy, iw, ih):
        sx, sy = point(fs.get('GradientStart', '0 0'))
        length = float(fs.get('Length', '0') or 0) or max(iw, ih)
        angle = math.radians(float(fs.get('Angle', '0')))
        ex, ey = sx + math.cos(angle) * length, sy - math.sin(angle) * length
        stops = [{'offset': round(float(s.get('Location', '0')) / 100, 4),
                  'opacity': round(float(s.get('Opacity', '100')) / 100, 4)}
                 for s in fs.findall('OpacityGradientStop')]
        if not stops:
            stops = [{'offset': 0, 'opacity': 1}, {'offset': 1, 'opacity': 0}]
        if fs.get('Type', 'Linear') != 'Linear':
            unsupported['radial fade (drawn linear)'] += 1
        local = lambda x, y: (round((x - ix) / iw, 4), round((y - iy) / ih, 4))
        (x1, y1), (x2, y2) = local(sx, sy), local(ex, ey)
        return {'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2, 'stops': stops}

    def stroke_rect(self, st, box, rotation, op, name):
        weight, ref, align = st
        dx, dy = weight / 2 / self.W, weight / 2 / self.H
        grow = -1 if align == 'InsideAlignment' else 1 if align == 'OutsideAlignment' else 0
        sbox = {'x': round(box['x'] - grow * dx, 5), 'y': round(box['y'] - grow * dy, 5),
                'width': round(box['width'] + 2 * grow * dx, 5), 'height': round(box['height'] + 2 * grow * dy, 5)}
        layer = self.base('shape', name, sbox, op, None)
        layer.update({'shape': 'rect', 'strokeToken': self.token(ref, 'קווים ומסגרות'),
                      'strokeWidth': round(weight / self.H, 5)})
        if rotation:
            layer['rotation'] = round(rotation, 3)
        self.layers.append(layer)

    def shape_rect(self, el, im, paths, op, blend, fill_hex=None, label='משטח צבע'):
        x0, y0, x1, y1 = self.bounds(paths, im)
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(1, x1), min(1, y1)
        if x1 - x0 <= 0 or y1 - y0 <= 0:
            return
        fill_ref = el.get('FillColor', 'Swatch/None')
        fill = fill_hex or self.colors.get(fill_ref)
        full = x0 <= 0.002 and y0 <= 0.002 and x1 >= 0.998 and y1 >= 0.998
        if full and fill and op >= 0.999 and not blend and not self.layers and not self.stroke(el):
            self.background = fill
            return
        box = {'x': round(x0, 5), 'y': round(y0, 5), 'width': round(x1 - x0, 5), 'height': round(y1 - y0, 5)}
        st = self.stroke(el)
        if fill:
            layer = self.base('shape', 'משטח צבע' if not fill_hex else label, box, op, blend)
            if fill_hex:
                self.colors[f'#hex{fill_hex}'] = fill_hex
                fill_ref = f'#hex{fill_hex}'
            layer.update({'shape': 'rect', 'fillToken': self.token(fill_ref, label)})
            self.layers.append(layer)
        if st:
            self.stroke_rect(st, box, 0, op, 'מסגרת')

    def line(self, el, im, paths, op, blend):
        st = self.stroke(el)
        if not st:
            return
        pts = [self.frac(*apply(im, *a)) for pts, _ in paths for a, _, _ in pts]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        box = {'x': round(min(xs), 5), 'y': round(min(ys), 5),
               'width': round(max(1e-4, max(xs) - min(xs)), 5), 'height': round(max(1e-4, max(ys) - min(ys)), 5)}
        layer = self.base('shape', 'קו', box, op, blend)
        layer.update({'shape': 'polyline', 'points': [[round(x, 5), round(y, 5)] for x, y in pts],
                      'strokeToken': self.token(st[1], 'קווים ומסגרות'), 'strokeWidth': round(st[0] / self.H, 5)})
        self.layers.append(layer)

    def vector(self, el, im, paths, op, blend, shape):
        fill_ref = el.get('FillColor', 'Swatch/None')
        st = self.stroke(el)
        if self.colors.get(fill_ref) is None and not st:
            return
        x0, y0, x1, y1 = self.bounds(paths, im)
        box = {'x': round(x0, 5), 'y': round(y0, 5), 'width': round(max(1e-4, x1 - x0), 5),
               'height': round(max(1e-4, y1 - y0), 5)}
        fill_token = self.token(fill_ref, 'כיתוב וקישוט') if self.colors.get(fill_ref) else None
        stroke_token = self.token(st[1], 'קווים ומסגרות') if st else None
        d = self.path_d(paths, im)

        # Consecutive artwork of one style — the letters of one title, the
        # petals of one ornament — is one layer, not dozens.
        prev = self.layers[-1] if self.layers else None
        key = (fill_token, stroke_token, st and st[0], layer_op := round(op, 3), blend)
        if (prev and prev.get('_key') == key and prev['type'] == 'shape' and prev['shape'] == 'path'):
            b = prev['box']
            nx0, ny0 = min(b['x'], box['x']), min(b['y'], box['y'])
            nx1 = max(b['x'] + b['width'], box['x'] + box['width'])
            ny1 = max(b['y'] + b['height'], box['y'] + box['height'])
            prev['box'] = {'x': round(nx0, 5), 'y': round(ny0, 5), 'width': round(nx1 - nx0, 5), 'height': round(ny1 - ny0, 5)}
            prev['outline']['d'] += d
            return
        layer = self.base('shape', 'קישוט' if fill_token else 'קו', box, layer_op, blend)
        layer.update({'shape': 'path', 'outline': {'d': d, 'fillRule': 'nonzero'}, '_key': key})
        if fill_token:
            layer['fillToken'] = fill_token
        if stroke_token:
            layer['strokeToken'] = stroke_token
            layer['strokeWidth'] = round(st[0] / self.H, 5)
        if shape == 'ellipse':
            layer['name'] = 'אליפסה'
        self.layers.append(layer)

    def text(self, el, im, paths, op):
        story = story_of(self.z, el.get('ParentStory'))
        if not story or not story['text'].strip():
            return
        x0, y0, x1, y1 = self.bounds(paths, im)
        box = {'x': round(x0, 5), 'y': round(y0, 5), 'width': round(x1 - x0, 5), 'height': round(y1 - y0, 5)}
        hebrew = bool(re.search('[֐-׿]', story['text']))
        just = story['justification']
        align = 'center' if 'Center' in just else ('end' if ('Right' in just) != hebrew else 'start')
        if 'Right' not in just and 'Left' not in just and 'Center' not in just:
            align = 'start'
        pref = el.find('TextFramePreference')
        vj = pref.get('VerticalJustification', 'TopAlign') if pref is not None else 'TopAlign'
        script = bool(SCRIPT_FONT_HINT.search(story['font']))
        layer = self.base('text', 'טקסט', box, op, None)
        layer.update({
            'defaultText': story['text'],
            'direction': 'rtl' if hebrew else 'ltr',
            'fontFamily': "'Great Vibes', 'Segoe Script', cursive" if script else "'Rubik', 'Segoe UI', sans-serif",
            'fontWeight': 400,
            'fontSize': round(story['size'] / self.H, 5),
            'lineHeight': 1.1,
            'align': align,
            'verticalAlign': 'middle' if 'Center' in vj else 'bottom' if 'Bottom' in vj else 'top',
            'colorToken': self.token(story['fill'], 'טקסט') or 'background',
            'sourceFont': story['font'],
        })
        self.layers.append(layer)

    def template(self):
        photos = [l for l in self.layers if l['type'] == 'photo']
        if photos:
            hero = max(photos, key=lambda l: l['box']['width'] * l['box']['height'])
            hero['role'] = 'hero'
        for l in self.layers:
            l.pop('_key', None)
        colors = [{'id': 'background', 'label': 'רקע', 'value': self.background or '#ffffff'}]
        colors += [{'id': tid, 'label': self.token_labels[tid], 'value': hex_} for hex_, tid in self.tokens.items()]
        # identical labels read as duplicates in the panel — number them
        seen = collections.Counter(c['label'] for c in colors)
        count = collections.Counter()
        for c in colors:
            if seen[c['label']] > 1:
                count[c['label']] += 1
                c['label'] = f"{c['label']} {count[c['label']]}"
        return {
            'schemaVersion': 1,
            'id': f'vault-p{int(self.name):03d}' if self.name.isdigit() else f'vault-{self.index + 1:03d}',
            'version': 1,
            'name': f'הכספת · עמוד {self.name}',
            'source': 'vault-idml',
            'sourcePage': int(self.name) if self.name.isdigit() else self.index + 1,
            'nativeAspect': round(self.aspect, 6),
            'photoCount': len(photos),
            'backgroundToken': 'background',
            'colors': colors,
            'layers': self.layers,
        }


def convert(path):
    z = zipfile.ZipFile(path)
    colors = load_colors(z)
    design = z.read('designmap.xml').decode('utf-8')
    templates = []
    for index, src in enumerate(re.findall(r'<idPkg:Spread src="([^"]+)"', design)):
        spread = ET.fromstring(z.read(src)).find('Spread')
        page = Page(z, colors, spread, index)
        for child in spread:
            page.walk(child, (1, 0, 0, 1, 0, 0), 1.0)
        templates.append(page.template())
    return templates


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        os.path.dirname(__file__), '..', '..', 'src', 'album', 'templates', 'vaultLibrary.ts')
    templates = convert(src)
    kept = [t for t in templates if t['layers']]
    payload = json.dumps(kept, ensure_ascii=False, separators=(',', ':'))
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* Generated from the Vault (הכספת) InDesign source by\n')
        f.write(' * tools/album_templates/idml_to_templates.py — do not edit by hand. */\n\n')
        f.write("import type { AlbumTemplate } from './types';\n\n")
        f.write('export const VAULT_TEMPLATES: AlbumTemplate[] = JSON.parse(')
        f.write(json.dumps(payload, ensure_ascii=False))
        f.write(');\n')
    counts = collections.Counter(t['photoCount'] for t in kept)
    print(f'pages read: {len(templates)} · templates written: {len(kept)} · {os.path.getsize(out) // 1024} KB')
    print('by photo count:', dict(sorted(counts.items())))
    print('layers:', dict(collections.Counter(l['type'] + ('/' + l.get('shape', '') if l['type'] == 'shape' else '')
                                               for t in kept for l in t['layers'])))
    print('empty pages skipped:', [t['sourcePage'] for t in templates if not t['layers']])
    print('not carried yet:', dict(unsupported) or 'nothing')


if __name__ == '__main__':
    main()
