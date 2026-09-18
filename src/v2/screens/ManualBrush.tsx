/* The manual cleaning brush: the layer the photographer paints on.
 *
 * It draws nothing into the photograph. It collects strokes — in FRACTIONS of
 * the frame, never pixels — hands each finished one to the parent, and shows
 * what it collected until the engine's answer comes back with the mark gone.
 * The rebuilding is the engine's (engine/manual_clean.py); this file's whole
 * job is that what he sees under the cursor is what the engine will treat.
 *
 * It measures itself against the <img>'s own box rather than the viewport: the
 * picture is centred inside a padded stage, so the stage's coordinates are not
 * the photograph's, and a brush that is off by the padding is a brush that
 * cleans the wrong place.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { ManualStroke } from '../../types';

/** Brush radius, as a fraction of the frame's width. A stroke keeps its size
 *  relative to the PHOTOGRAPH, so the same pass means the same thing on a
 *  preview and on the delivered file. */
export const MIN_R = 0.002;
export const MAX_R = 0.12;
export const DEFAULT_R = 0.012;

/** How far the pointer travels before another point is recorded, as a fraction
 *  of the brush radius. Every point costs geometry the engine rasterises;
 *  a quarter of a radius is closer than the stroke's own round joints. */
const STEP_OF_RADIUS = 0.25;

type Props = {
  /** The picture being painted on. Its box IS the coordinate system. */
  imgRef: React.RefObject<HTMLImageElement | null>;
  /** Strokes to show: the ones painted but not yet rebuilt by the engine. */
  pending: ManualStroke[];
  radius: number;
  onRadius: (r: number) => void;
  erasing: boolean;
  onStroke: (s: ManualStroke) => void;
  /** Erase mode: the point he clicked, in fractions. The parent decides which
   *  stroke that lands on — it is the one holding the list. */
  onErase: (x: number, y: number) => void;
  /** "r, g, b" for the marks. The default red means "this is coming out of the
   *  picture" — the cleaning brush. A region being painted passes its own,
   *  because the two brushes share the pointer and must never share a colour. */
  tint?: string;
};

export default function ManualBrush({
  imgRef, pending, radius, onRadius, erasing, onStroke, onErase, tint = '239, 68, 68',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  const drawing = useRef<[number, number][] | null>(null);
  const cursor = useRef<[number, number] | null>(null);
  const [, force] = useState(0);

  /* WHERE THE PICTURE ACTUALLY IS. It moves when the window resizes, when the
   * panels change width, and when a frame with a different shape loads — so it
   * is measured from the element, continuously, and never assumed. */
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const parent = img.parentElement;
    const measure = () => {
      const r = img.getBoundingClientRect();
      const p = parent?.getBoundingClientRect();
      if (!p || !r.width || !r.height) return;
      setBox({ left: r.left - p.left, top: r.top - p.top, w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    if (parent) ro.observe(parent);
    img.addEventListener('load', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      img.removeEventListener('load', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [imgRef]);

  /* WHAT IS ON THE OVERLAY. Two things, and they say different things:
   *   the strokes he painted that the engine has not answered for yet — filled,
   *     so "I have this, it is coming";
   *   the cursor — an outline only, so it never hides the skin he is judging. */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !box) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(box.w * dpr) || c.height !== Math.round(box.h * dpr)) {
      c.width = Math.round(box.w * dpr);
      c.height = Math.round(box.h * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    const path = (pts: [number, number][], r: number) => {
      ctx.lineWidth = r * 2 * box.w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const px = x * box.w;
        const py = y * box.h;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      if (pts.length === 1) {
        ctx.arc(pts[0][0] * box.w, pts[0][1] * box.h, r * box.w, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle as string;
        ctx.fill();
      } else {
        ctx.stroke();
      }
    };

    ctx.strokeStyle = `rgba(${tint}, 0.45)`;
    for (const s of pending) path(s.points, s.r);
    if (drawing.current) path(drawing.current, radius);

    const at = cursor.current;
    if (at) {
      ctx.beginPath();
      ctx.arc(at[0] * box.w, at[1] * box.h, radius * box.w, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = erasing ? 'rgba(250, 250, 250, 0.9)' : `rgba(${tint}, 0.95)`;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.stroke();
    }
  });

  const at = useCallback((e: React.PointerEvent): [number, number] => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }, []);

  const down = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const p = at(e);
    if (erasing) {
      onErase(p[0], p[1]);
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = [p];
    force((n) => n + 1);
  }, [at, erasing, onErase]);

  const move = useCallback((e: React.PointerEvent) => {
    const p = at(e);
    cursor.current = p;
    const pts = drawing.current;
    if (pts) {
      const [lx, ly] = pts[pts.length - 1];
      // Distance in the frame's own proportions: x and y are fractions of
      // different lengths, so comparing them raw would make a tall frame
      // record points at a different rate vertically.
      const box2 = canvasRef.current!.getBoundingClientRect();
      const dx = (p[0] - lx) * box2.width;
      const dy = (p[1] - ly) * box2.height;
      if (Math.hypot(dx, dy) >= Math.max(1, radius * box2.width * STEP_OF_RADIUS)) {
        pts.push(p);
      }
    }
    force((n) => n + 1);
  }, [at, radius]);

  const up = useCallback((e: React.PointerEvent) => {
    const pts = drawing.current;
    drawing.current = null;
    if (!pts) return;
    const p = at(e);
    const [lx, ly] = pts[pts.length - 1];
    if (lx !== p[0] || ly !== p[1]) pts.push(p);
    onStroke({ id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      points: pts, r: radius });
    force((n) => n + 1);
  }, [at, onStroke, radius]);

  const leave = useCallback(() => {
    cursor.current = null;
    force((n) => n + 1);
  }, []);

  /* The wheel sizes the brush. This is the one gesture every retoucher already
   * has in their hands, and it has to reach the brush rather than the page. */
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = radius * Math.exp(-e.deltaY * 0.0015);
      onRadius(Math.min(MAX_R, Math.max(MIN_R, next)));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [radius, onRadius]);

  if (!box) return null;
  return (
    <canvas
      ref={canvasRef}
      className="tz-ge-brush-layer"
      style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={leave}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
