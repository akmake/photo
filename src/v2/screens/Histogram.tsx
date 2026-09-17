/* The histogram, over the picture actually on screen.
 *
 * Why it belongs here: every professional editor puts one at the top of the
 * panel, and for one reason — it is the only control that says something the
 * photograph itself cannot show on a screen whose brightness nobody trusts.
 * The two squares beside it light up when the frame has pure white or pure
 * black areas, which is the thing that is unrecoverable in a delivered file.
 *
 * It reads the DISPLAYED frame, at a small size. The frame is already decoded
 * by the browser to show it, so this costs a draw and a pass over ~40k pixels,
 * not a request to the engine.
 */
import React, { useEffect, useRef, useState } from 'react';

const W = 256;   // one column per level
const SAMPLE = 220; // long edge the frame is sampled at
/** A channel needs more than this share of its pixels at the very end of the
 *  scale before it counts as clipped — a few specular pixels on an eye are
 *  not a blown frame. */
const CLIP_SHARE = 0.002;

export default function Histogram({ src }: { src: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [clip, setClip] = useState<{ black: boolean; white: boolean }>({
    black: false, white: false,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) {
      setReady(false);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const scale = SAMPLE / Math.max(img.width, img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return;
      octx.drawImage(img, 0, 0, w, h);
      let data: Uint8ClampedArray;
      try {
        data = octx.getImageData(0, 0, w, h).data;
      } catch {
        // A frame from another origin taints the canvas. Say nothing rather
        // than draw a histogram of something else.
        setReady(false);
        return;
      }

      const r = new Uint32Array(W);
      const g = new Uint32Array(W);
      const b = new Uint32Array(W);
      for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++;
        g[data[i + 1]]++;
        b[data[i + 2]]++;
      }
      const total = w * h;
      setClip({
        black: (r[0] + g[0] + b[0]) / (total * 3) > CLIP_SHARE,
        white: (r[255] + g[255] + b[255]) / (total * 3) > CLIP_SHARE,
      });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth || 300;
      const ch = canvas.clientHeight || 92;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      // The tallest column decides the scale, but the very ends are ignored
      // when doing so: a large flat background at one level would otherwise
      // squash the whole curve into the floor.
      let peak = 1;
      for (let i = 2; i < W - 2; i++) peak = Math.max(peak, r[i], g[i], b[i]);

      const draw = (arr: Uint32Array, colour: string) => {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(0, ch);
        for (let i = 0; i < W; i++) {
          const x = (i / (W - 1)) * cw;
          const y = ch - Math.min(1, arr[i] / peak) * (ch - 2);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(cw, ch);
        ctx.closePath();
        ctx.fill();
      };
      // Additive: where all three overlap the result reads as grey, which is
      // how a neutral frame should look.
      ctx.globalCompositeOperation = 'lighter';
      draw(r, 'rgba(226, 84, 74, 0.55)');
      draw(g, 'rgba(96, 200, 110, 0.55)');
      draw(b, 'rgba(90, 140, 240, 0.55)');
      ctx.globalCompositeOperation = 'source-over';
      setReady(true);
    };
    img.onerror = () => alive && setReady(false);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);

  return (
    <div className="tz-hist-wrap">
      <div className="tz-hist">
        <canvas ref={canvasRef} />
        <span
          className={`tz-hist-clip left ${clip.black ? 'on' : ''}`}
          title="יש אזורים שחורים לגמרי — פרטים שלא יחזרו"
        />
        <span
          className={`tz-hist-clip right ${clip.white ? 'on' : ''}`}
          title="יש אזורים שרופים — פרטים שלא יחזרו"
        />
      </div>
      <div className="tz-hist-meta">
        <span>{ready ? 'היסטוגרמה' : 'אין עדיין תמונה'}</span>
        <span>
          {clip.black && 'שחור חתוך'}
          {clip.black && clip.white && ' · '}
          {clip.white && 'לבן שרוף'}
        </span>
      </div>
    </div>
  );
}
