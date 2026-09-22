/* The justified layout — the one Google Photos uses (Antin Harasymiv,
 * "Building the Google Photos Web UI", 2018): every photograph keeps its own
 * proportions, rows fill the width exactly, and the gap between photographs is
 * the same everywhere. Only the row HEIGHT gives.
 *
 * Where to break the rows is chosen for the whole run at once, the way
 * Knuth–Plass breaks the lines of a paragraph: every possible break is
 * weighed, and the set whose rows stay closest to the target height wins. A
 * greedy "fill until full" leaves the odd row of two panoramas three times
 * taller than its neighbours; this does not.
 *
 * The last row is not stretched to the edge — a lone portrait blown up to the
 * full width is the tell of a cheap gallery. It keeps the target height and
 * sits at the start of the line.
 */

export interface JustifiedBox {
  /** Index into the input. */
  i: number;
  /** From the START edge of the row (right in RTL, left in LTR). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface JustifiedLayout {
  boxes: JustifiedBox[];
  /** Row by row, the index range [from, to) and its top/height. */
  rows: { from: number; to: number; y: number; h: number }[];
  height: number;
}

export interface JustifyOptions {
  width: number;
  targetHeight: number;
  gap?: number;
  /** A row may shrink to this share of the target… */
  minRatio?: number;
  /** …or grow to this share, before the break is considered bad. */
  maxRatio?: number;
  /** Longest row considered — keeps the search linear. */
  maxPerRow?: number;
}

/** aspects: width / height of each photograph, in order. */
export function justify(aspects: number[], opts: JustifyOptions): JustifiedLayout {
  const width = Math.max(1, opts.width);
  const T = Math.max(20, opts.targetHeight);
  const gap = opts.gap ?? 4;
  const minH = T * (opts.minRatio ?? 0.72);
  const maxH = T * (opts.maxRatio ?? 1.45);
  const K = opts.maxPerRow ?? 14;
  const n = aspects.length;
  const a = aspects.map((v) => (Number.isFinite(v) && v > 0.05 ? Math.min(v, 12) : 1.5));

  if (!n) return { boxes: [], rows: [], height: 0 };

  const rowHeight = (from: number, to: number) => {
    let sum = 0;
    for (let k = from; k < to; k += 1) sum += a[k];
    return (width - gap * (to - from - 1)) / sum;
  };
  const cost = (from: number, to: number, last: boolean) => {
    const h = rowHeight(from, to);
    // The last row may be short (it will not be stretched); it only must not
    // be too tall, which means it could have held fewer.
    if (last && h >= T) return 0;
    const d = (h - T) / T;
    let c = d * d * 100;
    if (h < minH) c += ((minH - h) / T) ** 2 * 4000;
    if (h > maxH) c += ((h - maxH) / T) ** 2 * 4000;
    return c;
  };

  // best[j]: cheapest layout of photographs [0, j); from[j]: where its last row starts.
  const best = new Float64Array(n + 1).fill(Infinity);
  const from = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  for (let j = 1; j <= n; j += 1) {
    const last = j === n;
    for (let i = Math.max(0, j - K); i < j; i += 1) {
      if (!Number.isFinite(best[i])) continue;
      const c = best[i] + cost(i, j, last);
      if (c < best[j]) { best[j] = c; from[j] = i; }
    }
  }

  const breaks: [number, number][] = [];
  for (let j = n; j > 0; j = from[j]) breaks.push([from[j], j]);
  breaks.reverse();

  const boxes: JustifiedBox[] = [];
  const rows: JustifiedLayout['rows'] = [];
  let y = 0;
  breaks.forEach(([i0, j0], r) => {
    const last = r === breaks.length - 1;
    let h = rowHeight(i0, j0);
    if (last && h > T) h = T;          // do not stretch the last row
    h = Math.round(h);
    let x = 0;
    for (let k = i0; k < j0; k += 1) {
      // The row's final photograph takes the rounding, so the edge is exact.
      const w = !last && k === j0 - 1 ? Math.max(1, width - x) : Math.max(1, Math.round(a[k] * h));
      boxes.push({ i: k, x, y, w, h });
      x += w + gap;
    }
    rows.push({ from: i0, to: j0, y, h });
    y += h + gap;
  });
  return { boxes, rows, height: Math.max(0, y - gap) };
}
