/* Instruments. What the picture IS, and what a tool actually did to it.
 *
 * Lifted out of `src/lab/Lab.tsx` unchanged, because the editing workbench now
 * needs the same answers and a second copy would drift from this one. The lab
 * was the only place these existed, and that was the problem: the lab is where
 * tools are calibrated, and the person who has to trust the result is on the
 * other screen.
 *
 * The reason any of this belongs in a photographer's editor and not only in a
 * developer's bench: a tool that runs and changes nothing looks exactly like a
 * tool set too weak. So you push the slider, and the slider was never the
 * problem. A number that says "zero pixels moved" ends that in one glance.
 */

import { useEffect, useRef } from 'react';

/** How far apart two versions of the same frame are. */
export interface Delta {
  /** Mean absolute change per channel, 0..255. */
  mean: number;
  /** The largest change anywhere in the frame. */
  max: number;
  /** Percentage of pixels that moved by more than 3 levels — i.e. visibly. */
  p3: number;
}

/** Comparison runs on a downscale: the answer does not change and a 20MP
 *  double-decode on every slider move does. */
const DIFF_CAP = 2400;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode failed'));
    i.src = src;
  });
}

/** |a - b| amplified into `canvas`, plus the numbers behind it. */
export async function computeDiff(
  aSrc: string,
  bSrc: string,
  canvas: HTMLCanvasElement | null,
  gain: number,
): Promise<Delta | null> {
  const [a, b] = await Promise.all([loadImage(aSrc), loadImage(bSrc)]);
  if (a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight) return null;

  const s = Math.min(1, DIFF_CAP / Math.max(a.naturalWidth, a.naturalHeight));
  const w = Math.max(1, Math.round(a.naturalWidth * s));
  const h = Math.max(1, Math.round(a.naturalHeight * s));

  const grab = (im: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(im, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };

  const pa = grab(a);
  const pb = grab(b);

  /* The canvas is optional. The NUMBERS are wanted on every render — "did this
   * change anything" is not a question you should have to open a view to ask —
   * while the amplified picture is only drawn when someone is looking at it. */
  const paint = canvas
    ? (() => {
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        return { ctx, img: ctx.createImageData(w, h) };
      })()
    : null;
  const out = paint?.img.data;

  let sum = 0;
  let max = 0;
  let over3 = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const dr = Math.abs(pa[j] - pb[j]);
    const dg = Math.abs(pa[j + 1] - pb[j + 1]);
    const db = Math.abs(pa[j + 2] - pb[j + 2]);
    const d = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
    sum += (dr + dg + db) / 3;
    if (d > max) max = d;
    if (d > 3) over3++;
    if (out) {
      const v = d * gain;
      const c = v > 255 ? 255 : v;
      out[j] = c;
      out[j + 1] = c;
      out[j + 2] = c;
      out[j + 3] = 255;
    }
  }
  if (paint && out) paint.ctx.putImageData(paint.img, 0, 0);
  return { mean: sum / n, max, p3: (over3 / n) * 100 };
}

/** Luminance filled, R/G/B as thin lines, on a square-root scale so the
 *  shadows are readable next to a spike in the midtones. */
export function Histogram({
  src,
  className = 'lab-hist',
  width = 232,
  height = 74,
}: {
  src: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!src) return;
    let alive = true;
    loadImage(src).then((im) => {
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const s = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * s));
      c.height = Math.max(1, Math.round(im.naturalHeight * s));
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(im, 0, 0, c.width, c.height);
      const px = cx.getImageData(0, 0, c.width, c.height).data;

      const hist = [
        new Uint32Array(256), new Uint32Array(256),
        new Uint32Array(256), new Uint32Array(256),
      ];
      for (let i = 0; i < px.length; i += 4) {
        hist[0][px[i]]++;
        hist[1][px[i + 1]]++;
        hist[2][px[i + 2]]++;
        hist[3][Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++;
      }
      let peak = 0;
      for (const h of hist) for (let v = 0; v < 256; v++) if (h[v] > peak) peak = h[v];
      if (peak === 0) return;

      const W = canvas.width;
      const H = canvas.height;
      const g = canvas.getContext('2d')!;
      g.clearRect(0, 0, W, H);
      const y = (n: number) => H - Math.sqrt(n / peak) * (H - 2);

      // luminance: filled
      g.beginPath();
      g.moveTo(0, H);
      for (let v = 0; v < 256; v++) g.lineTo((v / 255) * W, y(hist[3][v]));
      g.lineTo(W, H);
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.30)';
      g.fill();

      // channels: thin lines
      const colors = ['rgba(255,90,80,0.9)', 'rgba(90,220,110,0.9)', 'rgba(90,150,255,0.9)'];
      for (let ch = 0; ch < 3; ch++) {
        g.beginPath();
        for (let v = 0; v < 256; v++) {
          const X = (v / 255) * W;
          const Y = y(hist[ch][v]);
          if (v === 0) g.moveTo(X, Y);
          else g.lineTo(X, Y);
        }
        g.strokeStyle = colors[ch];
        g.lineWidth = 1;
        g.stroke();
      }
    });
    return () => {
      alive = false;
    };
  }, [src]);

  return <canvas ref={ref} className={className} width={width} height={height} />;
}
