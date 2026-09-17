import type { LayerBox } from './types';

/* Smart guides for moving and resizing a block on a spread — the measuring
 * system of Canva, PowerPoint and Figma, not a bare snap-to-grid.
 *
 *   · alignment: an edge or centre of the block locks onto an edge or centre of
 *     any other block on the page, the page edges, the fold, each page's middle
 *     and the safe margins — and a line shows what it aligned to;
 *   · equal spacing: a gap next to the block locks to a gap that already exists
 *     between two other blocks in the same row or column, or centres the block
 *     between its two neighbours — every equal gap is marked with its size;
 *   · equal size: while resizing, width or height locks to another photo
 *     block's, and says so;
 *   · measurements: the block's size and its distance to the nearest block or
 *     page edge on each side, in centimetres.
 *
 * Distances are measured in page heights so both axes share one unit; the snap
 * tolerance arrives in screen pixels, so it feels the same at every zoom.
 * Pure — tested in tests/albumTemplates.test.ts. */

export type GuideMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface GuideContext {
  /** Spread width ÷ height. */
  aspect: number;
  /** Spread height in mm — turns distances into centimetres. */
  heightMm: number;
  /** Safe margin from the trim and from the fold, in mm. */
  safeMarginMm: number;
  /** Snap tolerance in screen pixels, and the spread's height on screen. */
  tolerancePx: number;
  screenHeightPx: number;
  /** Other blocks on the spread, as fractions. */
  others: LayerBox[];
  /** Blocks whose size a resize may match (photo places). */
  sizeReferences: LayerBox[];
}

/** A guide line or gap marker, in spread fractions. */
export interface GuideSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GapMarker extends GuideSegment {
  label: string;
  /** True when this gap equals another gap on the page. */
  equal: boolean;
}

export interface GuideResult {
  box: LayerBox;
  lines: GuideSegment[];
  gaps: GapMarker[];
  /** e.g. "רוחב זהה". */
  badges: string[];
  /** The block's size, e.g. "12.4 × 8.1 ס״מ". */
  size: string;
}

interface Rect { l: number; t: number; r: number; b: number }

const EPS = 1e-6;

const toRect = (box: LayerBox, aspect: number): Rect => ({
  l: box.x * aspect, t: box.y, r: (box.x + box.width) * aspect, b: box.y + box.height,
});
const toBox = (rect: Rect, aspect: number): LayerBox => ({
  x: rect.l / aspect, y: rect.t, width: (rect.r - rect.l) / aspect, height: rect.b - rect.t,
});

function cm(heights: number, heightMm: number): string {
  const value = (heights * heightMm) / 10;
  return `${value.toFixed(value < 10 ? 1 : 0)} ס״מ`;
}

interface Target { value: number; lo: number; hi: number }

/** Best shift (within tolerance) bringing one of `edges` onto one of `targets`. */
function nearest(edges: number[], targets: Target[], tol: number): { delta: number; value: number } | null {
  let best: { delta: number; value: number } | null = null;
  for (const target of targets) {
    for (const edge of edges) {
      const delta = target.value - edge;
      if (Math.abs(delta) <= tol && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, value: target.value };
      }
    }
  }
  return best;
}

const overlapsV = (a: Rect, b: Rect) => a.t < b.b - EPS && a.b > b.t + EPS;
const overlapsH = (a: Rect, b: Rect) => a.l < b.r - EPS && a.r > b.l + EPS;

/** Gaps between neighbouring blocks along one axis, from the other blocks alone. */
function existingGaps(rects: Rect[], axis: 'x' | 'y'): number[] {
  const gaps: number[] = [];
  rects.forEach((a) => rects.forEach((b) => {
    if (a === b) return;
    const lined = axis === 'x' ? overlapsV(a, b) : overlapsH(a, b);
    const gap = axis === 'x' ? b.l - a.r : b.t - a.b;
    if (!lined || gap <= EPS) return;
    const between = rects.some((c) => c !== a && c !== b
      && (axis === 'x' ? overlapsV(c, a) && c.l >= a.r - EPS && c.r <= b.l + EPS
        : overlapsH(c, a) && c.t >= a.b - EPS && c.b <= b.t + EPS));
    if (!between) gaps.push(gap);
  }));
  return gaps;
}

export function smartGuides(
  start: LayerBox,
  raw: LayerBox,
  mode: GuideMode,
  ctx: GuideContext,
  options: { snap: boolean; keepRatio: boolean },
): GuideResult {
  const A = ctx.aspect;
  const tol = ctx.tolerancePx / Math.max(1, ctx.screenHeightPx);
  const safe = ctx.safeMarginMm / ctx.heightMm;
  const others = ctx.others.map((box) => toRect(box, A))
    .filter((rect) => rect.r - rect.l < A * 0.98 || rect.b - rect.t < 0.98);
  let rect = toRect(raw, A);
  const badges: string[] = [];
  const lines: GuideSegment[] = [];
  const equalGaps: GapMarker[] = [];

  const xTargets: Target[] = [
    ...[0, A / 4, A / 2, (3 * A) / 4, A, safe, A / 2 - safe, A / 2 + safe, A - safe]
      .map((value) => ({ value, lo: 0, hi: 1 })),
    ...others.flatMap((o) => [o.l, (o.l + o.r) / 2, o.r].map((value) => ({ value, lo: o.t, hi: o.b }))),
  ];
  const yTargets: Target[] = [
    ...[0, 0.5, 1, safe, 1 - safe].map((value) => ({ value, lo: 0, hi: A })),
    ...others.flatMap((o) => [o.t, (o.t + o.b) / 2, o.b].map((value) => ({ value, lo: o.l, hi: o.r }))),
  ];

  const moving = mode === 'move';
  const east = !moving && mode.endsWith('e');
  const west = !moving && mode.endsWith('w');
  const south = !moving && mode.startsWith('s');
  const north = !moving && mode.startsWith('n');

  if (options.snap) {
    /* ---- horizontal ---- */
    const xEdges = moving ? [rect.l, (rect.l + rect.r) / 2, rect.r] : [east ? rect.r : west ? rect.l : NaN];
    let xSnap = xEdges.every(Number.isNaN) ? null : nearest(xEdges.filter((v) => !Number.isNaN(v)), xTargets, tol);
    let xSpacing: { delta: number; markers: GapMarker[] } | null = null;
    if (moving) xSpacing = spacingSnap(rect, others, 'x', tol, ctx.heightMm, A);
    // on a tie spacing wins: the alignment line still shows, since it holds too
    if (xSpacing && (!xSnap || Math.abs(xSpacing.delta) <= Math.abs(xSnap.delta) + EPS)) {
      rect = { ...rect, l: rect.l + xSpacing.delta, r: rect.r + xSpacing.delta };
      equalGaps.push(...xSpacing.markers);
      xSnap = null;
    } else if (xSnap) {
      if (moving) rect = { ...rect, l: rect.l + xSnap.delta, r: rect.r + xSnap.delta };
      else if (east) rect = { ...rect, r: rect.r + xSnap.delta };
      else rect = { ...rect, l: rect.l + xSnap.delta };
    }

    /* ---- vertical ---- */
    const yEdges = moving ? [rect.t, (rect.t + rect.b) / 2, rect.b] : [south ? rect.b : north ? rect.t : NaN];
    let ySnap = yEdges.every(Number.isNaN) ? null : nearest(yEdges.filter((v) => !Number.isNaN(v)), yTargets, tol);
    let ySpacing: { delta: number; markers: GapMarker[] } | null = null;
    if (moving) ySpacing = spacingSnap(rect, others, 'y', tol, ctx.heightMm, A);
    if (ySpacing && (!ySnap || Math.abs(ySpacing.delta) <= Math.abs(ySnap.delta) + EPS)) {
      rect = { ...rect, t: rect.t + ySpacing.delta, b: rect.b + ySpacing.delta };
      equalGaps.push(...ySpacing.markers);
      ySnap = null;
    } else if (ySnap) {
      if (moving) rect = { ...rect, t: rect.t + ySnap.delta, b: rect.b + ySnap.delta };
      else if (south) rect = { ...rect, b: rect.b + ySnap.delta };
      else rect = { ...rect, t: rect.t + ySnap.delta };
    }

    /* ---- equal size (resize only) ---- */
    if (!moving && !options.keepRatio) {
      const refs = ctx.sizeReferences.map((box) => toRect(box, A));
      if (east || west) {
        const width = rect.r - rect.l;
        const match = refs.map((o) => o.r - o.l).find((w) => Math.abs(w - width) <= tol);
        if (match !== undefined) {
          if (east) rect = { ...rect, r: rect.l + match }; else rect = { ...rect, l: rect.r - match };
          badges.push('רוחב זהה');
        }
      }
      if (north || south) {
        const height = rect.b - rect.t;
        const match = refs.map((o) => o.b - o.t).find((h) => Math.abs(h - height) <= tol);
        if (match !== undefined) {
          if (south) rect = { ...rect, b: rect.t + match }; else rect = { ...rect, t: rect.b - match };
          badges.push('גובה זהה');
        }
      }
    }

    /* ---- lines for every alignment that now holds exactly ---- */
    const xNow = moving ? [rect.l, (rect.l + rect.r) / 2, rect.r] : [east ? rect.r : rect.l];
    for (const target of xTargets) {
      if (!xNow.some((edge) => Math.abs(edge - target.value) < 1e-5)) continue;
      if (!moving && !east && !west) continue;
      lines.push({
        x1: target.value / A, x2: target.value / A,
        y1: Math.min(rect.t, target.lo), y2: Math.max(rect.b, target.hi),
      });
    }
    const yNow = moving ? [rect.t, (rect.t + rect.b) / 2, rect.b] : [south ? rect.b : rect.t];
    for (const target of yTargets) {
      if (!yNow.some((edge) => Math.abs(edge - target.value) < 1e-5)) continue;
      if (!moving && !north && !south) continue;
      lines.push({
        y1: target.value, y2: target.value,
        x1: Math.min(rect.l, target.lo) / A, x2: Math.max(rect.r, target.hi) / A,
      });
    }
  }

  /* ---- measurements: distance to the nearest block or page edge per side ---- */
  const gaps: GapMarker[] = [...equalGaps];
  const midY = (rect.t + rect.b) / 2;
  const midX = (rect.l + rect.r) / 2;
  const left = Math.max(0, ...others.filter((o) => overlapsV(o, rect) && o.r <= rect.l + EPS).map((o) => o.r));
  const right = Math.min(A, ...others.filter((o) => overlapsV(o, rect) && o.l >= rect.r - EPS).map((o) => o.l));
  const top = Math.max(0, ...others.filter((o) => overlapsH(o, rect) && o.b <= rect.t + EPS).map((o) => o.b));
  const bottom = Math.min(1, ...others.filter((o) => overlapsH(o, rect) && o.t >= rect.b - EPS).map((o) => o.t));
  const measure = (x1: number, y1: number, x2: number, y2: number, length: number) => {
    if (length <= 0.004) return;
    const exists = gaps.some((g) => Math.abs(g.x1 - x1 / A) < 1e-4 && Math.abs(g.x2 - x2 / A) < 1e-4
      && Math.abs(g.y1 - y1) < 1e-4 && Math.abs(g.y2 - y2) < 1e-4);
    if (!exists) gaps.push({ x1: x1 / A, y1, x2: x2 / A, y2, label: cm(length, ctx.heightMm), equal: false });
  };
  measure(left, midY, rect.l, midY, rect.l - left);
  measure(rect.r, midY, right, midY, right - rect.r);
  measure(midX, top, midX, rect.t, rect.t - top);
  measure(midX, rect.b, midX, bottom, bottom - rect.b);

  const box = toBox(rect, A);
  return {
    box,
    lines,
    gaps,
    badges,
    size: `${((rect.r - rect.l) * ctx.heightMm / 10).toFixed(1)} × ${((rect.b - rect.t) * ctx.heightMm / 10).toFixed(1)} ס״מ`,
  };
}

/** Equal-spacing snap along one axis while moving. */
function spacingSnap(
  rect: Rect,
  others: Rect[],
  axis: 'x' | 'y',
  tol: number,
  heightMm: number,
  aspect: number,
): { delta: number; markers: GapMarker[] } | null {
  const lined = others.filter((o) => (axis === 'x' ? overlapsV(o, rect) : overlapsH(o, rect)));
  const lo = axis === 'x' ? 'l' : 't';
  const hi = axis === 'x' ? 'r' : 'b';
  const before = lined.filter((o) => o[hi] <= rect[lo] + tol).sort((a, b) => b[hi] - a[hi])[0];
  const after = lined.filter((o) => o[lo] >= rect[hi] - tol).sort((a, b) => a[lo] - b[lo])[0];
  const gaps = existingGaps(others, axis);

  const options: { delta: number; gap: number; ref?: number }[] = [];
  if (before) gaps.forEach((gap) => options.push({ delta: before[hi] + gap - rect[lo], gap, ref: gap }));
  if (after) gaps.forEach((gap) => options.push({ delta: after[lo] - gap - rect[hi], gap, ref: gap }));
  if (before && after) {
    const gap = (after[lo] - before[hi] - (rect[hi] - rect[lo])) / 2;
    if (gap > EPS) options.push({ delta: before[hi] + gap - rect[lo], gap });
  }
  const best = options
    .filter((option) => Math.abs(option.delta) <= tol)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  if (!best) return null;

  const moved = { ...rect, [lo]: rect[lo] + best.delta, [hi]: rect[hi] + best.delta } as Rect;
  const label = cm(best.gap, heightMm);
  const markers: GapMarker[] = [];
  // markers leave in spread fractions: x divided by the aspect
  const mark = (a: number, b: number, across: number) => markers.push(axis === 'x'
    ? { x1: a / aspect, x2: b / aspect, y1: across, y2: across, label, equal: true }
    : { y1: a, y2: b, x1: across / aspect, x2: across / aspect, label, equal: true });
  const acrossOf = (r: Rect) => (axis === 'x' ? (r.t + r.b) / 2 : (r.l + r.r) / 2);
  if (before && Math.abs(moved[lo] - before[hi] - best.gap) < 1e-5) mark(before[hi], moved[lo], acrossOf(moved));
  if (after && Math.abs(after[lo] - moved[hi] - best.gap) < 1e-5) mark(moved[hi], after[lo], acrossOf(moved));
  // the existing gap(s) it matched
  others.forEach((a) => others.forEach((b) => {
    if (a === b) return;
    const inLine = axis === 'x' ? overlapsV(a, b) : overlapsH(a, b);
    const gap = b[lo] - a[hi];
    if (inLine && Math.abs(gap - best.gap) < 1e-5) {
      const across = axis === 'x'
        ? (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2
        : (Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2;
      mark(a[hi], b[lo], across);
    }
  }));
  return { delta: best.delta, markers };
}
