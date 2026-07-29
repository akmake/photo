import type { AlbumLayoutTemplate, FrameRole, LayoutSlot, PhotoOrientation } from './model';

/* A BROWSABLE library of layouts.
 *
 * The generated candidates in layoutEngine answer "given these photos, how
 * could they sit?" — useful, but it means no photos, no layouts, and no way to
 * decide the shape of a page before filling it. These are the other direction:
 * pick the page you want, then drop photos into it.
 *
 * Geometry is in spread coordinates: x runs 0..2 across the open spread (1.0 is
 * the fold), y runs 0..1 down the page. Everything is expressed as a fraction
 * so a template fits any product size. */

const M = 0.06;   // outer margin, in page units
const G = 0.025;  // gap between frames

const slot = (
  id: string, x: number, y: number, width: number, height: number,
  role: FrameRole = 'support', preferred: PhotoOrientation[] = [],
): LayoutSlot => ({ id, x, y, width, height, role, preferred });

/** Split a box into `count` columns, respecting the standard gap. */
function columns(
  box: { x: number; y: number; w: number; h: number },
  count: number,
  prefix: string,
  role: FrameRole = 'support',
): LayoutSlot[] {
  const width = (box.w - G * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => (
    slot(`${prefix}${i + 1}`, box.x + i * (width + G), box.y, width, box.h, role)
  ));
}

/** Split a box into `count` rows, respecting the standard gap. */
function rows(
  box: { x: number; y: number; w: number; h: number },
  count: number,
  prefix: string,
  role: FrameRole = 'support',
): LayoutSlot[] {
  const height = (box.h - G * (count - 1)) / count;
  return Array.from({ length: count }, (_, i) => (
    slot(`${prefix}${i + 1}`, box.x, box.y + i * (height + G), box.w, height, role)
  ));
}

// the usable box of each page, and of the spread as a whole
const LEFT = { x: M, y: M, w: 1 - M * 2, h: 1 - M * 2 };
const RIGHT = { x: 1 + M, y: M, w: 1 - M * 2, h: 1 - M * 2 };
const FULL = { x: M, y: M, w: 2 - M * 2, h: 1 - M * 2 };

/* The geometry above is written across the OPEN spread (x runs 0..2, fold at
 * 1.0) because that is how you think about a two-page layout. The renderer and
 * layoutEngine both work in 0..1 of the spread width, so collapse to that on
 * the way out — writing the tables pre-halved is where mistakes hide. */
const template = (
  id: string, name: string, density: AlbumLayoutTemplate['density'], slots: LayoutSlot[],
): AlbumLayoutTemplate => ({
  id,
  name,
  family: 'library',
  density,
  photoCount: slots.length,
  slots: slots.map((frame) => ({ ...frame, x: frame.x / 2, width: frame.width / 2 })),
});

export const LAYOUT_TEMPLATES: AlbumLayoutTemplate[] = [
  // ---- 1 photo
  template('lib-1-full', 'תמונה על כפולה שלמה', 'airy', [
    slot('a', 0, 0, 2, 1, 'hero'),
  ]),
  template('lib-1-right', 'תמונה בעמוד ימין', 'airy', [
    slot('a', RIGHT.x, RIGHT.y, RIGHT.w, RIGHT.h, 'hero'),
  ]),
  template('lib-1-center', 'תמונה ממורכזת', 'airy', [
    slot('a', 0.5, 0.16, 1, 0.68, 'hero'),
  ]),

  // ---- 2 photos
  template('lib-2-pages', 'תמונה בכל עמוד', 'airy', [
    slot('a', LEFT.x, LEFT.y, LEFT.w, LEFT.h, 'hero'),
    slot('b', RIGHT.x, RIGHT.y, RIGHT.w, RIGHT.h, 'hero'),
  ]),
  template('lib-2-bleed-left', 'מלאה משמאל, קטנה מימין', 'balanced', [
    slot('a', 0, 0, 1, 1, 'hero'),
    slot('b', 1 + 0.14, 0.2, 1 - 0.28, 0.6),
  ]),
  template('lib-2-bleed-right', 'מלאה מימין, קטנה משמאל', 'balanced', [
    slot('a', 0.14, 0.2, 1 - 0.28, 0.6),
    slot('b', 1, 0, 1, 1, 'hero'),
  ]),
  template('lib-2-stack', 'שתיים זו מעל זו', 'balanced', rows(FULL, 2, 's')),

  // ---- 3 photos
  template('lib-3-strip', 'שלוש ברצף', 'balanced', columns(FULL, 3, 'c')),
  template('lib-3-hero-right', 'מובילה מימין, שתיים משמאל', 'balanced', [
    slot('a', 1, 0, 1, 1, 'hero'),
    ...rows(LEFT, 2, 'b'),
  ]),
  template('lib-3-hero-left', 'מובילה משמאל, שתיים מימין', 'balanced', [
    slot('a', 0, 0, 1, 1, 'hero'),
    ...rows(RIGHT, 2, 'b'),
  ]),
  template('lib-3-band', 'רצועה עליונה ותמונה רחבה', 'balanced', [
    ...columns({ ...FULL, h: 0.34 }, 2, 'top'),
    slot('wide', FULL.x, M + 0.34 + G, FULL.w, FULL.h - 0.34 - G, 'hero'),
  ]),

  // ---- 4 photos
  template('lib-4-grid', 'רשת של ארבע', 'balanced', [
    ...columns({ ...FULL, h: (FULL.h - G) / 2 }, 2, 'top'),
    ...columns({ ...FULL, y: M + (FULL.h - G) / 2 + G, h: (FULL.h - G) / 2 }, 2, 'bottom'),
  ]),
  template('lib-4-strip', 'ארבע ברצף', 'rich', columns(FULL, 4, 'c')),
  template('lib-4-hero-right', 'מובילה מימין, שלוש משמאל', 'rich', [
    slot('a', 1, 0, 1, 1, 'hero'),
    ...rows(LEFT, 3, 'b'),
  ]),
  template('lib-4-hero-left', 'מובילה משמאל, שלוש מימין', 'rich', [
    slot('a', 0, 0, 1, 1, 'hero'),
    ...rows(RIGHT, 3, 'b'),
  ]),

  // ---- 5 photos
  template('lib-5-hero-band', 'מובילה ורצועת ארבע', 'rich', [
    slot('hero', FULL.x, FULL.y, FULL.w, 0.52, 'hero'),
    ...columns({ ...FULL, y: M + 0.52 + G, h: FULL.h - 0.52 - G }, 4, 'b'),
  ]),
  template('lib-5-two-three', 'שתיים משמאל, שלוש מימין', 'rich', [
    ...rows(LEFT, 2, 'l'),
    ...rows(RIGHT, 3, 'r'),
  ]),
  template('lib-5-hero-left', 'מובילה משמאל, ארבע מימין', 'rich', [
    slot('a', 0, 0, 1, 1, 'hero'),
    ...columns({ ...RIGHT, h: (RIGHT.h - G) / 2 }, 2, 'top'),
    ...columns({ ...RIGHT, y: M + (RIGHT.h - G) / 2 + G, h: (RIGHT.h - G) / 2 }, 2, 'bottom'),
  ]),

  // ---- 6 photos
  template('lib-6-grid', 'רשת של שש', 'rich', [
    ...columns({ ...FULL, h: (FULL.h - G) / 2 }, 3, 'top'),
    ...columns({ ...FULL, y: M + (FULL.h - G) / 2 + G, h: (FULL.h - G) / 2 }, 3, 'bottom'),
  ]),
  template('lib-6-pages', 'שלוש בכל עמוד', 'rich', [
    ...rows(LEFT, 3, 'l'),
    ...rows(RIGHT, 3, 'r'),
  ]),

  // ---- 8 photos
  template('lib-8-grid', 'רשת של שמונה', 'rich', [
    ...columns({ ...FULL, h: (FULL.h - G) / 2 }, 4, 'top'),
    ...columns({ ...FULL, y: M + (FULL.h - G) / 2 + G, h: (FULL.h - G) / 2 }, 4, 'bottom'),
  ]),
];

/** The frame counts the library actually covers, for the filter chips. */
export const TEMPLATE_PHOTO_COUNTS = [...new Set(
  LAYOUT_TEMPLATES.map((item) => item.photoCount),
)].sort((a, b) => a - b);

const half = (frames: LayoutSlot[]): LayoutSlot[] =>
  frames.map((frame) => ({ ...frame, x: frame.x / 2, width: frame.width / 2 }));

/** A fresh, evenly divided layout with `count` frames — the base for drawing your own. */
export function blankLayout(count: number): LayoutSlot[] {
  if (count <= 1) return half([slot('a', 0, 0, 2, 1, 'hero')]);
  if (count === 2) return half(columns(FULL, 2, 'c'));
  if (count <= 4) {
    const perRow = Math.ceil(count / 2);
    const rowH = (FULL.h - G) / 2;
    const top = columns({ ...FULL, h: rowH }, perRow, 'top');
    const bottom = columns(
      { ...FULL, y: M + rowH + G, h: rowH }, count - perRow, 'bottom',
    );
    return half([...top, ...bottom]);
  }
  const perRow = Math.ceil(count / 2);
  const rowH = (FULL.h - G) / 2;
  return half([
    ...columns({ ...FULL, h: rowH }, perRow, 'top'),
    ...columns({ ...FULL, y: M + rowH + G, h: rowH }, count - perRow, 'bottom'),
  ]);
}
