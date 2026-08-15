/* תבניות כפולה — the album's actual design vocabulary.
 *
 * This replaces the use of `src/album/layoutEngine` for the auto-album, and the
 * reason is worth writing down so nobody wires it back.
 *
 * That engine sizes each photo to its own aspect ratio, lays the results out in
 * rows, and CENTRES them inside a box. The output is a contact sheet: every
 * picture floating in an even white surround, every spread weighing the same,
 * no image ever touching an edge. It is a fine way to show a set of photos and
 * it is not album design.
 *
 * What separates a designed book from a grid is three things, and all three are
 * structural — no model produces them by taste:
 *
 *   1. FULL BLEED. Real albums let images run off the page. A spread where the
 *      photograph reaches the trim edge reads as printed; one with a white
 *      border on all four sides reads as a slide.
 *   2. ALIGNMENT. Images share edges. Two pictures on a page line up on the
 *      same top and bottom margin; nothing is optically centred on its own.
 *   3. DELIBERATE ASYMMETRY. A hero and a support, not two equals. Uniform
 *      padding everywhere is the visual signature of a template.
 *
 * So the templates below are drawn, not generated. Geometry is in fractions of
 * the TRIM spread: x runs 0..1 across the open spread with the fold at 0.5, y
 * runs 0..1 down the page. A slot whose edge lands exactly on 0 or 1 is a bleed
 * edge, and the renderer extends it into the bleed automatically.
 *
 * Margins are expressed in PAGE-HEIGHT units and converted, so a margin is the
 * same number of millimetres at the top of the page as at its side — on a 2:1
 * spread an equal fraction of x and y is not an equal margin, and that error is
 * visible in the printed book as a squashed frame.
 */

import type { AlbumPhoto } from '../album/model';

export type SlotRole = 'hero' | 'support' | 'detail';
export type Want = 'portrait' | 'landscape' | 'any';

export interface TemplateSlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  role: SlotRole;
  want: Want;
}

export interface SpreadTemplate {
  id: string;
  name: string;
  count: number;
  /** Full-bleed templates carry the book; a run of insets reads as a brochure. */
  bleed: boolean;
  slots: TemplateSlot[];
}

interface Geo {
  /** Outer margin and inner gap, already converted to each axis. */
  mx: number;
  my: number;
  gx: number;
  gy: number;
}

/* The margin is generous on purpose. A narrow even border is the single most
 * template-looking thing a page can do; a wide one reads as a decision. */
const MARGIN_UNITS = 0.085;

/* The gap between two images that both bleed off the spread's outer edges.
 *
 * This is the number that decides whether a multi-image spread reads as
 * designed or as a printing fault, and it has no middle ground. Wide enough and
 * it is a white gutter you chose; narrow enough and the pictures are a strip.
 * In between — a pale stripe a few millimetres across — looks like the press
 * misregistered. Kept tight and used consistently, so every seam in the book is
 * the same seam. */
const GAP_UNITS = 0.011;

function geometry(pageAspect: number): Geo {
  // pageAspect = pageWidth / pageHeight. The spread is two pages wide, so a
  // margin of `u` page-heights is u / (2 * pageAspect) of the spread's width.
  const toX = (u: number) => u / (2 * Math.max(0.2, pageAspect));
  return {
    mx: toX(MARGIN_UNITS),
    my: MARGIN_UNITS,
    gx: toX(GAP_UNITS),
    gy: GAP_UNITS,
  };
}

const slot = (
  id: string, x: number, y: number, width: number, height: number,
  role: SlotRole = 'support', want: Want = 'any',
): TemplateSlot => ({ id, x, y, width, height, role, want });

/** Stack `n` frames down a box, sharing its edges and a single gap value. */
function stack(
  box: { x: number; y: number; w: number; h: number },
  n: number, gap: number, prefix: string, role: SlotRole = 'support',
): TemplateSlot[] {
  const h = (box.h - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => (
    slot(`${prefix}${i + 1}`, box.x, box.y + i * (h + gap), box.w, h, role, 'landscape')
  ));
}

/** Lay `n` frames across a box, sharing its edges and a single gap value. */
function row(
  box: { x: number; y: number; w: number; h: number },
  n: number, gap: number, prefix: string, role: SlotRole = 'support',
  want: Want = 'any',
): TemplateSlot[] {
  const w = (box.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => (
    slot(`${prefix}${i + 1}`, box.x + i * (w + gap), box.y, w, box.h, role, want)
  ));
}

export function templatesFor(pageAspect: number): SpreadTemplate[] {
  const g = geometry(pageAspect);

  // The usable box of each page and of the whole spread, inside the margins.
  const LEFT = { x: g.mx, y: g.my, w: 0.5 - g.mx * 2, h: 1 - g.my * 2 };
  const RIGHT = { x: 0.5 + g.mx, y: g.my, w: 0.5 - g.mx * 2, h: 1 - g.my * 2 };
  const FULL = { x: g.mx, y: g.my, w: 1 - g.mx * 2, h: 1 - g.my * 2 };

  return [
    // ---------------------------------------------------------------- 1 photo
    {
      id: 'bleed-spread', name: 'תמונה על כפולה מלאה', count: 1, bleed: true,
      slots: [slot('a', 0, 0, 1, 1, 'hero', 'landscape')],
    },
    {
      id: 'bleed-page-right', name: 'עמוד מלא מימין, עמוד ריק משמאל', count: 1, bleed: true,
      slots: [slot('a', 0.5, 0, 0.5, 1, 'hero', 'portrait')],
    },
    {
      id: 'bleed-page-left', name: 'עמוד מלא משמאל, עמוד ריק מימין', count: 1, bleed: true,
      slots: [slot('a', 0, 0, 0.5, 1, 'hero', 'portrait')],
    },
    {
      // HALF BLEED: off the outer edge and off the top and bottom, with a white
      // gutter strip left standing on the inner side. The picture is still a
      // printed edge on three sides, so the spread keeps its weight, and the one
      // white band is unmistakably a decision rather than leftover paper.
      id: 'half-bleed-right', name: 'חצי-בליד מימין', count: 1, bleed: true,
      slots: [slot('a', 0.5 + g.mx, 0, 0.5 - g.mx, 1, 'hero', 'portrait')],
    },
    {
      id: 'half-bleed-left', name: 'חצי-בליד משמאל', count: 1, bleed: true,
      slots: [slot('a', 0, 0, 0.5 - g.mx, 1, 'hero', 'portrait')],
    },
    {
      // The book's one breath. A small picture with a lot of paper is a real
      // album move, but only when it is ANCHORED — here to the bottom-outer
      // corner of the margin grid. Floating it in the middle of the page is
      // what a slide does, and it is the look this whole file exists to avoid.
      id: 'quiet-right', name: 'כפולה שקטה', count: 1, bleed: false,
      slots: [slot(
        'a',
        RIGHT.x + RIGHT.w * 0.30, RIGHT.y + RIGHT.h * 0.42,
        RIGHT.w * 0.70, RIGHT.h * 0.58,
        'hero', 'landscape',
      )],
    },

    // --------------------------------------------------------------- 2 photos
    {
      id: 'bleed-pages', name: 'עמוד מלא בכל צד', count: 2, bleed: true,
      slots: [
        slot('a', 0, 0, 0.5, 1, 'hero', 'portrait'),
        slot('b', 0.5, 0, 0.5, 1, 'hero', 'portrait'),
      ],
    },
    {
      // The facing picture is anchored to the BOTTOM of the margin box and runs
      // the full width of it. Hung from the top with white underneath it read as
      // an unfinished page; sitting on the baseline it reads as a caption to the
      // bleed opposite, which is what it is.
      id: 'bleed-left-inset-right', name: 'מלאה משמאל, קטנה מימין', count: 2, bleed: true,
      slots: [
        slot('a', 0, 0, 0.5, 1, 'hero', 'portrait'),
        slot('b', RIGHT.x, RIGHT.y + RIGHT.h * 0.28, RIGHT.w, RIGHT.h * 0.72,
          'support', 'landscape'),
      ],
    },
    {
      id: 'bleed-right-inset-left', name: 'מלאה מימין, קטנה משמאל', count: 2, bleed: true,
      slots: [
        slot('a', LEFT.x, LEFT.y + LEFT.h * 0.28, LEFT.w, LEFT.h * 0.72,
          'support', 'landscape'),
        slot('b', 0.5, 0, 0.5, 1, 'hero', 'portrait'),
      ],
    },
    {
      id: 'band-two', name: 'שתי רצועות רוחב', count: 2, bleed: true,
      slots: [
        slot('a', 0, 0, 1, 0.5 - g.gy / 2, 'hero', 'landscape'),
        slot('b', 0, 0.5 + g.gy / 2, 1, 0.5 - g.gy / 2, 'support', 'landscape'),
      ],
    },

    // --------------------------------------------------------------- 3 photos
    {
      id: 'triptych', name: 'שלוש רצועות מלאות', count: 3, bleed: true,
      slots: row({ x: 0, y: 0, w: 1, h: 1 }, 3, g.gx, 'c', 'support', 'portrait'),
    },
    {
      id: 'bleed-left-stack-right', name: 'מלאה משמאל, שתיים מימין', count: 3, bleed: true,
      slots: [
        slot('a', 0, 0, 0.5, 1, 'hero', 'portrait'),
        ...stack(RIGHT, 2, g.gy, 'b'),
      ],
    },
    {
      id: 'bleed-right-stack-left', name: 'מלאה מימין, שתיים משמאל', count: 3, bleed: true,
      slots: [
        ...stack(LEFT, 2, g.gy, 'a'),
        slot('b', 0.5, 0, 0.5, 1, 'hero', 'portrait'),
      ],
    },
    {
      // A pair over a wide band, all three running off the spread's edges. The
      // inset version of this was the single most template-looking page in the
      // vocabulary — four white margins around a tidy arrangement — so the
      // whole figure was pushed to the edges instead.
      id: 'pair-over-wide', name: 'זוג מעל רצועה רחבה', count: 3, bleed: true,
      slots: [
        ...row({ x: 0, y: 0, w: 1, h: 0.42 }, 2, g.gx, 'top'),
        slot('wide', 0, 0.42 + g.gy, 1, 1 - 0.42 - g.gy, 'hero', 'landscape'),
      ],
    },

    // --------------------------------------------------------------- 4 photos
    {
      id: 'bleed-left-three-right', name: 'מלאה משמאל, שלוש מימין', count: 4, bleed: true,
      slots: [
        slot('a', 0, 0, 0.5, 1, 'hero', 'portrait'),
        ...stack(RIGHT, 3, g.gy, 'b'),
      ],
    },
    {
      id: 'quad-bleed', name: 'ארבע מלאות', count: 4, bleed: true,
      slots: [
        ...row({ x: 0, y: 0, w: 1, h: 0.5 - g.gy / 2 }, 2, g.gx, 'top'),
        ...row({ x: 0, y: 0.5 + g.gy / 2, w: 1, h: 0.5 - g.gy / 2 }, 2, g.gx, 'bottom'),
      ],
    },
    {
      // Asymmetric four: a tall picture holding the left page against three
      // stacked on the right, everything bleeding off the outer edges. The
      // symmetrical inset grid it replaced was a contact sheet with margins.
      id: 'tall-and-three', name: 'גבוהה מול שלוש', count: 4, bleed: true,
      slots: [
        slot('a', 0, 0, 0.5 - g.gx / 2, 1, 'hero', 'portrait'),
        ...stack({ x: 0.5 + g.gx / 2, y: 0, w: 0.5 - g.gx / 2, h: 1 }, 3, g.gy, 'b'),
      ],
    },

    // ------------------------------------------------------------- 5–6 photos
    {
      id: 'bleed-hero-quad', name: 'מלאה משמאל, ארבע מימין', count: 5, bleed: true,
      slots: [
        slot('a', 0, 0, 0.5, 1, 'hero', 'portrait'),
        ...row({ x: RIGHT.x, y: RIGHT.y, w: RIGHT.w, h: (RIGHT.h - g.gy) / 2 }, 2, g.gx, 'top'),
        ...row({
          x: RIGHT.x, y: RIGHT.y + (RIGHT.h - g.gy) / 2 + g.gy,
          w: RIGHT.w, h: (RIGHT.h - g.gy) / 2,
        }, 2, g.gx, 'bottom'),
      ],
    },
    {
      id: 'band-over-three', name: 'רצועה מלאה מעל שלוש', count: 4, bleed: true,
      slots: [
        slot('a', 0, 0, 1, 0.56, 'hero', 'landscape'),
        ...row({ x: 0, y: 0.56 + g.gy, w: 1, h: 1 - 0.56 - g.gy }, 3, g.gx, 'b'),
      ],
    },
    {
      id: 'six-bleed', name: 'שש מלאות', count: 6, bleed: true,
      slots: [
        ...row({ x: 0, y: 0, w: 1, h: 0.5 - g.gy / 2 }, 3, g.gx, 'top'),
        ...row({ x: 0, y: 0.5 + g.gy / 2, w: 1, h: 0.5 - g.gy / 2 }, 3, g.gx, 'bottom'),
      ],
    },
  ];
}

/** The frame counts the vocabulary covers — the rhythm may not ask for others. */
export function availableCounts(pageAspect: number): number[] {
  return [...new Set(templatesFor(pageAspect).map((t) => t.count))].sort((a, b) => a - b);
}

/* How much of a photograph is thrown away to fill a slot.
 *
 * 0 when the shapes match, approaching 1 as they diverge. This is the number
 * that stops a standing portrait being jammed into a letterbox: the slot always
 * gets filled edge to edge, so the only question is how much of the picture
 * survives, and a template that answers badly must lose. */
export function cropLoss(
  photo: AlbumPhoto,
  slotWidth: number,
  slotHeight: number,
  spreadWidthMm: number,
  pageHeightMm: number,
): number {
  const slotMmW = slotWidth * spreadWidthMm;
  const slotMmH = slotHeight * pageHeightMm;
  if (slotMmW <= 0 || slotMmH <= 0 || !photo.widthPx || !photo.heightPx) return 1;
  const slotAspect = slotMmW / slotMmH;
  const photoAspect = photo.widthPx / photo.heightPx;
  const lo = Math.min(slotAspect, photoAspect);
  const hi = Math.max(slotAspect, photoAspect);
  return 1 - lo / hi;
}

/** Does the slot's shape want what this photo is? */
export function wantsMatch(photo: AlbumPhoto, want: Want): boolean {
  if (want === 'any') return true;
  return photo.orientation === want
    || (want === 'landscape' && photo.orientation === 'square');
}
