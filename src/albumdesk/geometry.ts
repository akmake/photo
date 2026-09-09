/* הזזה, שינוי גודל, והצמדה.
 *
 * למה הצמדה היא לא נוחות אלא העיצוב עצמו
 * --------------------------------------
 * מה שגורם לכפולה להיראות מעוצבת ולא מודבקת הוא ש**משהו מתיישר לרוחב
 * הקיפול** — קו אופק, גובה עיניים, הקצה העליון של שתי תמונות משני עמודים
 * שונים. אלה הבדלים של שני מילימטרים שהעין קולטת מיד ואי אפשר לכוון ביד.
 *
 * לכן ההצמדה כאן עובדת על **הכפולה כולה** ולא על העמוד: מלבן בעמוד השמאלי
 * נצמד לקצה של מלבן בעמוד הימני. זה בדיוק המקרה שאי אפשר לעשות ידנית וזה
 * בדיוק המקרה שקובע אם הכפולה נראית מקצועית.
 *
 * מרחבי קואורדינטות
 * -----------------
 * מלבן של משבצת נשמר ב**שברים של העמוד** (0..1), כי הוא שייך לעמוד ותבנית
 * מוגדרת כך. ההצמדה מחשבת ב**שברים של הכפולה**, כי שם היא רואה את שני
 * העמודים יחד. `toSpread`/`toPage` הן הגשר, והן היחידות שיודעות שהעמוד
 * הראשון הוא הימני.
 */

import type { Rect } from './templates';

export type Side = 'first' | 'second';

/** סף ההצמדה, בשברים של רוחב הכפולה. ~0.4% ≈ 4 פיקסלים על מסך רגיל. */
export const SNAP = 0.004;

/** הגודל המזערי של משבצת, בשברים של העמוד. מתחת לזה זו טעות, לא כוונה. */
export const MIN_SIZE = 0.04;

/** העמוד הראשון הוא הימני (כריכה עברית), ולכן הוא החצי הימני של הכפולה. */
export function pageOrigin(side: Side): number {
  return side === 'first' ? 0.5 : 0;
}

export function toSpread(rect: Rect, side: Side): Rect {
  return {
    x: pageOrigin(side) + rect.x * 0.5,
    y: rect.y,
    w: rect.w * 0.5,
    h: rect.h,
  };
}

export function toPage(rect: Rect, side: Side): Rect {
  return {
    x: (rect.x - pageOrigin(side)) * 2,
    y: rect.y,
    w: rect.w * 2,
    h: rect.h,
  };
}

/** ידיות שינוי הגודל, בשמות שמתארים אילו קצוות זזים. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** קו הצמדה שנמצא — מוחזר כדי שאפשר יהיה לצייר אותו בזמן הגרירה.
 *  הצלם חייב לראות *למה* זה קפץ, אחרת ההצמדה מרגישה כמו תקלה. */
export interface SnapLine {
  axis: 'x' | 'y';
  /** בשברים של הכפולה. */
  at: number;
}

export interface SnapResult {
  rect: Rect;
  lines: SnapLine[];
}

/** כל הקווים שאליהם כדאי להיצמד, בשברים של הכפולה.
 *
 *  `others` הם המלבנים של כל שאר המשבצות בכפולה — משני העמודים. זו כל
 *  הנקודה: יישור לרוחב הקיפול. */
export function snapTargets(
  others: Rect[],
  safeX: number,
  safeY: number,
): { xs: number[]; ys: number[] } {
  const xs = [
    0, 1,          // קצות הכפולה
    0.5,           // הקיפול
    safeX, 1 - safeX,
    0.5 - safeX, 0.5 + safeX, // התחום השקט משני צדי הקיפול
  ];
  const ys = [0, 1, safeY, 1 - safeY, 0.5];

  for (const r of others) {
    xs.push(r.x, r.x + r.w, r.x + r.w / 2);
    ys.push(r.y, r.y + r.h, r.y + r.h / 2);
  }
  return { xs, ys };
}

function nearest(value: number, candidates: number[], tol: number): number | null {
  let best: number | null = null;
  let bestD = tol;
  for (const c of candidates) {
    const d = Math.abs(value - c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** הזזה: המלבן שומר על גודלו, ושלושת הקווים שלו בכל ציר מחפשים הצמדה.
 *  הקצה שנמצא הכי קרוב מנצח, כדי שהמלבן לא ייקרע לשני כיוונים. */
export function snapMove(
  rect: Rect,
  targets: { xs: number[]; ys: number[] },
  tol = SNAP,
): SnapResult {
  const lines: SnapLine[] = [];
  const out = { ...rect };

  const edgesX: [number, number][] = [
    [rect.x, 0],
    [rect.x + rect.w / 2, rect.w / 2],
    [rect.x + rect.w, rect.w],
  ];
  let bestX: { at: number; shift: number; d: number } | null = null;
  for (const [pos, off] of edgesX) {
    const hit = nearest(pos, targets.xs, tol);
    if (hit === null) continue;
    const d = Math.abs(pos - hit);
    if (!bestX || d < bestX.d) bestX = { at: hit, shift: hit - off, d };
  }
  if (bestX) {
    out.x = bestX.shift;
    lines.push({ axis: 'x', at: bestX.at });
  }

  const edgesY: [number, number][] = [
    [rect.y, 0],
    [rect.y + rect.h / 2, rect.h / 2],
    [rect.y + rect.h, rect.h],
  ];
  let bestY: { at: number; shift: number; d: number } | null = null;
  for (const [pos, off] of edgesY) {
    const hit = nearest(pos, targets.ys, tol);
    if (hit === null) continue;
    const d = Math.abs(pos - hit);
    if (!bestY || d < bestY.d) bestY = { at: hit, shift: hit - off, d };
  }
  if (bestY) {
    out.y = bestY.shift;
    lines.push({ axis: 'y', at: bestY.at });
  }

  return { rect: out, lines };
}

/** שינוי גודל: רק הקצוות שהידית מזיזה מחפשים הצמדה. הקצה הנגדי קבוע. */
export function snapResize(
  rect: Rect,
  handle: Handle,
  targets: { xs: number[]; ys: number[] },
  tol = SNAP,
  minW = MIN_SIZE / 2,
  minH = MIN_SIZE,
): SnapResult {
  const lines: SnapLine[] = [];
  let { x, y, w, h } = rect;

  const movesW = handle.includes('w');
  const movesE = handle.includes('e');
  const movesN = handle.includes('n');
  const movesS = handle.includes('s');

  if (movesW) {
    const hit = nearest(x, targets.xs, tol);
    if (hit !== null) {
      const right = x + w;
      x = Math.min(hit, right - minW);
      w = right - x;
      lines.push({ axis: 'x', at: hit });
    }
  }
  if (movesE) {
    const hit = nearest(x + w, targets.xs, tol);
    if (hit !== null) {
      w = Math.max(minW, hit - x);
      lines.push({ axis: 'x', at: hit });
    }
  }
  if (movesN) {
    const hit = nearest(y, targets.ys, tol);
    if (hit !== null) {
      const bottom = y + h;
      y = Math.min(hit, bottom - minH);
      h = bottom - y;
      lines.push({ axis: 'y', at: hit });
    }
  }
  if (movesS) {
    const hit = nearest(y + h, targets.ys, tol);
    if (hit !== null) {
      h = Math.max(minH, hit - y);
      lines.push({ axis: 'y', at: hit });
    }
  }

  return { rect: { x, y, w, h }, lines };
}

/** מלבן חדש אחרי גרירת ידית, לפני הצמדה. בשברים של הכפולה.
 *
 *  הקצה הנגדי לידית אינו זז — זו ההתנהגות שכולם מצפים לה, וכל סטייה
 *  ממנה מרגישה כמו באג. */
export function resizeBy(
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
): Rect {
  let { x, y, w, h } = rect;

  if (handle.includes('w')) {
    const right = x + w;
    x = Math.min(x + dx, right - minW);
    w = right - x;
  }
  if (handle.includes('e')) {
    w = Math.max(minW, w + dx);
  }
  if (handle.includes('n')) {
    const bottom = y + h;
    y = Math.min(y + dy, bottom - minH);
    h = bottom - y;
  }
  if (handle.includes('s')) {
    h = Math.max(minH, h + dy);
  }
  return { x, y, w, h };
}

/** מחזיק את המלבן בתוך העמוד שלו. מלבן שברח מהעמוד לא ניתן לתיקון בעכבר.
 *  בשברים של הכפולה, בהינתן הצד שאליו הוא שייך. */
export function clampToPage(rect: Rect, side: Side): Rect {
  const lo = pageOrigin(side);
  const hi = lo + 0.5;
  const w = Math.min(rect.w, 0.5);
  const h = Math.min(rect.h, 1);
  return {
    x: Math.max(lo, Math.min(rect.x, hi - w)),
    y: Math.max(0, Math.min(rect.y, 1 - h)),
    w,
    h,
  };
}
