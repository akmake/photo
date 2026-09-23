import { useEffect, useRef } from 'react';
import { hoverObjectAtPath } from '../../api';

/** The click surface for object selection, shared by both editing screens.
 *
 *  While the pointer moves, a hairline shows what a click here would select —
 *  the outline only, never a fill over the picture. A click selects; Alt+click
 *  says "not this" and corrects the current selection. One hover question is
 *  in flight at a time: the engine holds the picture after the first one
 *  (object_remove._hold), so each answer is tens of milliseconds, and the
 *  pointer's latest position is asked next.
 */
export default function ObjectPickLayer({ path, width, height, className, busy, onPick }: {
  path: string; width: number; height: number; className: string; busy: boolean;
  onPick: (x: number, y: number, exclude: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const want = useRef<[number, number] | null>(null);
  const asking = useRef(false);
  const live = useRef(true);

  const clear = () => {
    const c = canvasRef.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  };

  const draw = (maskPng: string) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const image = new Image();
    image.onload = () => {
      if (!live.current || !want.current) return;
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      canvas.width = w; canvas.height = h;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      if (!octx) return;
      octx.drawImage(image, 0, 0, w, h);
      const src = octx.getImageData(0, 0, w, h).data;
      const out = ctx.createImageData(w, h);
      const inside = (x: number, y: number) => src[(y * w + x) * 4] > 127;
      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          if (inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) {
            const i = (y * w + x) * 4;
            out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = 255;
          }
        }
      }
      ctx.putImageData(out, 0, 0);
    };
    image.src = maskPng;
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
  useEffect(() => { want.current = null; clear(); }, [path, busy]);

  return (
    <div className={className} style={{ width, height }} role="button" tabIndex={0}
      aria-label="בחר אובייקט בתמונה. Alt ולחיצה: לא את זה"
      onMouseMove={(event) => {
        if (busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        want.current = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
        void ask();
      }}
      onMouseLeave={() => { want.current = null; clear(); }}
      onClick={(event) => {
        if (busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        want.current = null; clear();
        onPick((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, event.altKey);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(0.5, 0.5, false); }
      }}>
      <canvas ref={canvasRef} style={{ width, height, pointerEvents: 'none', display: 'block' }} aria-hidden="true" />
    </div>
  );
}
