import { useEffect, useRef } from 'react';
import { hoverObjectAtPath } from '../../api';

export type ObjectBox = [number, number, number, number];

/** A drag shorter than this (screen px) is a click. */
const DRAG_MIN = 6;

/** The click surface for object selection, shared by both editing screens.
 *
 *  While the pointer moves, a hairline shows what a click here would select —
 *  the outline only, never a fill over the picture. A click selects; a click
 *  again at the same spot takes the next size (post, then the pipe on it).
 *  Dragging draws a rectangle around the object instead, and the object inside
 *  it is taken — the bear with its feet, the bicycle without the girl
 *  (engine/box_select.py). No keys to remember. One hover question is
 *  in flight at a time: the engine holds the picture after the first one
 *  (object_remove._hold), so each answer is tens of milliseconds, and the
 *  pointer's latest position is asked next.
 */
export default function ObjectPickLayer({ path, width, height, className, busy, onPick }: {
  path: string; width: number; height: number; className: string; busy: boolean;
  onPick: (x: number, y: number, box?: ObjectBox) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const want = useRef<[number, number] | null>(null);
  const asking = useRef(false);
  const live = useRef(true);
  // where the button went down, and whether this press became a drag
  const press = useRef<{ x: number; y: number; cx: number; cy: number; drag: boolean } | null>(null);
  const swallowClick = useRef(false);

  const clear = () => {
    const c = canvasRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  // The canvas is drawn at the screen's own pixel density, so the line is one
  // real pixel and not a blurred 1.5px one.
  const sized = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(width * dpr));
    const h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { canvas, ctx, w, h };
  };

  const draw = (maskPng: string) => {
    const image = new Image();
    image.onload = () => {
      if (!live.current || !want.current || press.current?.drag) return;
      const s = sized();
      if (!s) return;
      const { ctx, w, h } = s;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      if (!octx) return;
      octx.drawImage(image, 0, 0, w, h);
      const src = octx.getImageData(0, 0, w, h).data;
      const out = ctx.createImageData(w, h);
      const inside = (x: number, y: number) => src[(y * w + x) * 4] > 127;
      const put = (i: number, v: number, a: number) => {
        out.data[i] = v; out.data[i + 1] = v; out.data[i + 2] = v; out.data[i + 3] = a;
      };
      // white on the edge, a dark pixel just outside it: the line reads on a
      // white wall and on a dark coat alike
      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          if (inside(x, y)) {
            if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) put((y * w + x) * 4, 255, 255);
          } else if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) {
            put((y * w + x) * 4, 0, 200);
          }
        }
      }
      ctx.putImageData(out, 0, 0);
    };
    image.src = maskPng;
  };

  const drawBox = (x0: number, y0: number, x1: number, y1: number) => {
    const s = sized();
    if (!s) return;
    const { ctx, w, h } = s;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, w, h);
    const r = [Math.min(x0, x1) * w, Math.min(y0, y1) * h, Math.abs(x1 - x0) * w, Math.abs(y1 - y0) * h];
    ctx.lineWidth = dpr;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2], r[3]);
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2], r[3]);
  };

  const ask = async () => {
    if (asking.current || !want.current) return;
    asking.current = true;
    const [x, y] = want.current;
    try {
      const r = await hoverObjectAtPath(path, x, y);
      const now = want.current;
      if (live.current && now && now[0] === x && now[1] === y) draw(r.maskPng);
    } catch { /* a missed hover outline is not an error the photographer needs to see */ }
    asking.current = false;
    const now = want.current;
    if (live.current && now && (now[0] !== x || now[1] !== y)) void ask();
  };

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => { want.current = null; press.current = null; clear(); }, [path, busy]);

  const at = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ] as const;
  };

  return (
    <div className={className} style={{ width, height }} role="button" tabIndex={0}
      aria-label="בחר אובייקט בתמונה: לחיצה עליו, או גרירת מלבן סביבו"
      onMouseDown={(event) => {
        if (busy || event.button !== 0) return;
        const [x, y] = at(event);
        press.current = { x, y, cx: event.clientX, cy: event.clientY, drag: false };
      }}
      onMouseMove={(event) => {
        if (busy) return;
        const [x, y] = at(event);
        const p = press.current;
        if (p && (event.buttons & 1)) {
          if (!p.drag && Math.hypot(event.clientX - p.cx, event.clientY - p.cy) >= DRAG_MIN) {
            p.drag = true;
            want.current = null;
          }
          if (p.drag) { drawBox(p.x, p.y, x, y); return; }
        }
        want.current = [x, y];
        void ask();
      }}
      onMouseUp={(event) => {
        const p = press.current;
        press.current = null;
        if (busy || !p || !p.drag) return;
        swallowClick.current = true;
        clear();
        const [x, y] = at(event);
        const box: ObjectBox = [Math.min(p.x, x), Math.min(p.y, y), Math.max(p.x, x), Math.max(p.y, y)];
        onPick((box[0] + box[2]) / 2, (box[1] + box[3]) / 2, box);
      }}
      onMouseLeave={() => {
        want.current = null;
        if (!press.current?.drag) clear();
      }}
      onClick={(event) => {
        if (swallowClick.current) { swallowClick.current = false; return; }
        if (busy) return;
        const [x, y] = at(event);
        want.current = null; clear();
        onPick(x, y);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(0.5, 0.5); }
      }}>
      <canvas ref={canvasRef} style={{ width, height, pointerEvents: 'none', display: 'block' }} aria-hidden="true" />
    </div>
  );
}
