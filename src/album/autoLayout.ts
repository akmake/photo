import type { AlbumPhoto, LayoutSlot } from './model';
import type { AlbumTemplate } from './templates/types';
import { assessCrop } from './cropEngine.ts';
import { fittedTemplate } from './templates/adapt.ts';
import { photoLayers, templatesFor } from './templates/library.ts';

/* Automatic album layout — which photos share a spread, on which Vault page,
 * and which photo takes which place. See docs/ALBUM-LAYOUT-ALGORITHM.md.
 *
 * The photographer has already chosen the photos and their order. This only
 * stands them up. Three passes:
 *
 *   1. PAGE FIT — a run of photos on one Vault page is scored by how much of
 *      every photo survives its place, weighted by the place's size; the
 *      strongest photo is pushed to the largest place. Two things are not
 *      scored but forbidden: a face the crop would cut, and a face that would
 *      land on the fold of the book.
 *   2. PAGINATION — the cuts between spreads are chosen for the whole chapter
 *      at once, by dynamic programming (as Knuth–Plass breaks the lines of a
 *      paragraph). The cost of a run IS its best page fit, so a group is only
 *      formed when the Vault has a page that carries it well.
 *   3. SEQUENCE — of each spread's best few pages, the one that does not repeat
 *      a page used on the last few spreads.
 *
 * Pure: no React, no engine — tested in tests/autoLayout.test.ts. */

/** Faces stay this far from the fold, as a share of the open spread's width,
 *  on each side. 15 mm on a 56 cm spread: past the binding's own risk zone
 *  (`gutterRiskMm`) with room to spare, as album designers ask for ~2 cm. */
export const FOLD_CLEARANCE = 15 / 560;

/** The most photos one automatic spread may hold. The Vault has pages for up
 *  to ten, but a designer reaches for those by hand, not by default. */
const MAX_RUN = 6;
const EXHAUSTIVE_LIMIT = 6;
/** How many of a spread's best pages the sequence pass may choose between. */
const KEEP_PAGES = 3;
const RECENT_WINDOW = 3;
const REPEAT_PENALTY = 0.35;
/** Every earlier use of a page anywhere in the book costs a little, so the
 *  album does not lean on three favourite pages. */
const REUSE_PENALTY = 0.06;
/** Pace: how hard a spread is pulled towards the style's photos-per-spread. */
const PACE_WEIGHT = 0.5;
/** Two spreads in a row with the same number of photos read as a grid. */
const SAME_COUNT_PENALTY = 0.5;
/** Weight of "the strongest photo takes the largest place". */
const HERO_WEIGHT = 0.25;
/** A place that asks for another orientation than the photo's. */
const ORIENTATION_PENALTY = 0.03;
/** Below this share of a photo kept, the page is not offered. Every one-photo
 *  page in the Vault is a landscape place: a portrait there keeps 44% of
 *  itself (measured on the newborn set, 08.10) — that is not a layout, it is a
 *  different photograph. */
const MIN_KEPT = 0.6;

export interface PageFit {
  template: AlbumTemplate;
  /** Photo ids in the order of the page's photo places. */
  photoIds: string[];
  /** 0..1 (plus a small hero bonus): share of the page's photo area that shows
   *  photograph rather than crop loss. */
  score: number;
}

export interface PlannedSpread {
  sessionId: string | undefined;
  fit: PageFit | null;
  /** The run of photos, in the photographer's order, when no page fits. */
  photoIds: string[];
}

export interface LayoutOptions {
  /** Target photos per spread for this style. */
  pace: number;
  foldClearance?: number;
}

function strength(photo: AlbumPhoto | undefined): number {
  return photo?.analysis?.qualityScore ?? 0.7;
}

/** Does any face, after this crop, sit inside the fold band of the spread? */
export function faceOnFold(photo: AlbumPhoto, slot: LayoutSlot, crop: { x: number; width: number }, clearance: number): boolean {
  const faces = photo.analysis?.faces ?? [];
  const lo = 0.5 - clearance;
  const hi = 0.5 + clearance;
  if (slot.x >= hi || slot.x + slot.width <= lo) return false;
  return faces.some((face) => {
    const a = Math.max(face.x, crop.x);
    const b = Math.min(face.x + face.width, crop.x + crop.width);
    if (b <= a) return false; // this face is cropped away entirely
    const x0 = slot.x + ((a - crop.x) / crop.width) * slot.width;
    const x1 = slot.x + ((b - crop.x) / crop.width) * slot.width;
    return x1 > lo && x0 < hi;
  });
}

function permutations(count: number): number[][] {
  if (count <= 1) return [[0]];
  const out: number[][] = [];
  permutations(count - 1).forEach((rest) => {
    for (let at = 0; at <= rest.length; at += 1) out.push([...rest.slice(0, at), count - 1, ...rest.slice(at)]);
  });
  return out;
}
const ORDERS = new Map<number, number[][]>();
const ordersOf = (count: number) => {
  if (!ORDERS.has(count)) ORDERS.set(count, permutations(count));
  return ORDERS.get(count)!;
};

/** The best way to put these photos on this page, or null when every way cuts
 *  a face, puts one on the fold, or crops a photo to a sliver. */
export function fitPage(
  photos: AlbumPhoto[],
  designed: AlbumTemplate,
  spreadAspect: number,
  clearance = FOLD_CLEARANCE,
): PageFit | null {
  const k = photos.length;
  const template = fittedTemplate(designed, spreadAspect);
  const layers = photoLayers(template);
  if (layers.length !== k) return null;
  const areas = layers.map((layer) => layer.box.width * layer.box.height);
  const total = areas.reduce((sum, area) => sum + area, 0) || 1;
  const share = areas.map((area) => area / total);
  const strengths = photos.map(strength);
  const meanStrength = strengths.reduce((sum, value) => sum + value, 0) / k;

  // cell[place][photo]: the value of that photo in that place, or null = forbidden
  const cell: Array<Array<number | null>> = layers.map((layer, place) => {
    const slot: LayoutSlot = {
      id: layer.id, ...layer.box, role: layer.role, preferred: layer.preferred,
      allowCrossGutter: layer.allowCrossGutter,
    };
    return photos.map((photo, index) => {
      const crop = assessCrop(photo, slot, { fit: 'smart', positionX: 50, positionY: 50 }, spreadAspect);
      const kept = crop.crop.width * crop.crop.height;
      if (!crop.safe && photo.analysis?.status === 'ready') return null;
      if (kept < MIN_KEPT) return null;
      if (faceOnFold(photo, slot, crop.crop, clearance)) return null;
      let value = share[place] * kept;
      if (layer.preferred.length && !layer.preferred.includes(photo.orientation)) {
        value -= ORIENTATION_PENALTY * share[place];
      }
      value += HERO_WEIGHT * share[place] * (strengths[index] - meanStrength);
      return value;
    });
  });

  const scoreOf = (order: number[]): number | null => {
    let sum = 0;
    for (let place = 0; place < k; place += 1) {
      const value = cell[place][order[place]];
      if (value === null) return null;
      sum += value;
    }
    return sum;
  };

  let best: number[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  if (k <= EXHAUSTIVE_LIMIT) {
    for (const order of ordersOf(k)) {
      const score = scoreOf(order);
      if (score !== null && score > bestScore) {
        best = order;
        bestScore = score;
      }
    }
  } else {
    // biggest place first, each takes the photo worth most in it
    const free = new Set(photos.map((_, index) => index));
    const order = Array<number>(k).fill(-1);
    [...areas.keys()].sort((a, b) => areas[b] - areas[a]).forEach((place) => {
      let pick = -1;
      free.forEach((index) => {
        const value = cell[place][index];
        if (value !== null && (pick < 0 || value > (cell[place][pick] ?? -1))) pick = index;
      });
      if (pick >= 0) {
        order[place] = pick;
        free.delete(pick);
      }
    });
    const score = order.includes(-1) ? null : scoreOf(order);
    if (score !== null) {
      best = order;
      bestScore = score;
    }
  }
  if (!best) return null;
  return { template: designed, photoIds: best.map((index) => photos[index].id), score: bestScore };
}

/** Every Vault page that can carry this run, best first. */
export function rankPages(
  photoIds: string[],
  byId: Map<string, AlbumPhoto>,
  spreadAspect: number,
  clearance = FOLD_CLEARANCE,
): PageFit[] {
  const photos = photoIds.map((id) => byId.get(id)).filter((photo): photo is AlbumPhoto => Boolean(photo));
  if (photos.length !== photoIds.length || !photos.length) return [];
  const out: PageFit[] = [];
  for (const designed of templatesFor(photos.length)) {
    const fit = fitPage(photos, designed, spreadAspect, clearance);
    if (fit) out.push(fit);
  }
  return out.sort((a, b) => b.score - a.score || a.template.sourcePage - b.template.sourcePage);
}

interface RunChoice {
  value: number;
  pages: PageFit[];
}

/** A book opens on one photograph, and so does a long chapter: designers give
 *  the opening a spread of its own. (A short chapter is one beat, not a story.) */
const OPENING_BONUS = 2.5;
const CHAPTER_OPENING_BONUS = 1.5;
const LONG_CHAPTER = 6;
/** A single-photo spread elsewhere is a breath, earned by a photo stronger than
 *  its chapter's middle — measured within the chapter, because the quality
 *  score is only comparable between frames of one light and one set. */
const BREATH_WEIGHT = 6;

interface RunContext {
  pace: number;
  opensAlbum: boolean;
  opensChapter: boolean;
  chapterLength: number;
  chapterMedian: number;
}

/** Value of one spread holding `count` photos whose best page scored `fit`. */
function spreadValue(count: number, fit: number, photos: AlbumPhoto[], ctx: RunContext): number {
  let value = count * fit - PACE_WEIGHT * (count - ctx.pace) ** 2;
  if (count === 1) {
    value += BREATH_WEIGHT * (strength(photos[0]) - ctx.chapterMedian);
    if (ctx.opensAlbum) value += OPENING_BONUS;
    else if (ctx.opensChapter && ctx.chapterLength >= LONG_CHAPTER) value += CHAPTER_OPENING_BONUS;
  }
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Cut one chapter into spreads: the best total over every possible set of
 *  cuts, remembering the previous spread's size so the pace keeps moving. */
export function paginateChapter(
  photoIds: string[],
  byId: Map<string, AlbumPhoto>,
  spreadAspect: number,
  options: LayoutOptions,
  opensAlbum = false,
): Array<{ photoIds: string[]; pages: PageFit[] }> {
  const n = photoIds.length;
  if (!n) return [];
  const chapterMedian = median(photoIds.map((id) => strength(byId.get(id))));
  const clearance = options.foldClearance ?? FOLD_CLEARANCE;
  const runs = new Map<string, RunChoice | null>();
  const runAt = (start: number, end: number): RunChoice | null => {
    const key = `${start}:${end}`;
    if (!runs.has(key)) {
      const ids = photoIds.slice(start, end);
      const pages = rankPages(ids, byId, spreadAspect, clearance);
      runs.set(key, pages.length
        ? {
          value: spreadValue(ids.length, pages[0].score, ids.map((id) => byId.get(id)!), {
            pace: options.pace,
            opensAlbum: opensAlbum && start === 0,
            opensChapter: start === 0,
            chapterLength: n,
            chapterMedian,
          }),
          pages: pages.slice(0, KEEP_PAGES),
        }
        : null);
    }
    return runs.get(key)!;
  };

  // best[j][k]: best value of the first j photos, the last spread holding k
  const NONE = Number.NEGATIVE_INFINITY;
  const best = Array.from({ length: n + 1 }, () => Array<number>(MAX_RUN + 1).fill(NONE));
  const from = Array.from({ length: n + 1 }, () => Array<number>(MAX_RUN + 1).fill(-1));
  best[0][0] = 0;
  for (let end = 1; end <= n; end += 1) {
    for (let k = 1; k <= Math.min(MAX_RUN, end); k += 1) {
      const run = runAt(end - k, end);
      if (!run) continue;
      for (let prev = 0; prev <= MAX_RUN; prev += 1) {
        const before = best[end - k][prev];
        if (before === NONE) continue;
        const value = before + run.value - (prev === k && k > 1 ? SAME_COUNT_PENALTY : 0);
        if (value > best[end][k]) {
          best[end][k] = value;
          from[end][k] = prev;
        }
      }
    }
  }

  let k = best[n].reduce((top, value, index) => (value > best[n][top] ? index : top), 0);
  if (best[n][k] === NONE) {
    // nothing in the Vault carries this chapter cleanly — keep every photo,
    // one run per spread, and let the caller lay it out the old way
    const out: Array<{ photoIds: string[]; pages: PageFit[] }> = [];
    for (let start = 0; start < n; start += 4) out.push({ photoIds: photoIds.slice(start, start + 4), pages: [] });
    return out;
  }
  const out: Array<{ photoIds: string[]; pages: PageFit[] }> = [];
  let end = n;
  while (end > 0) {
    const prev = from[end][k];
    out.push({ photoIds: photoIds.slice(end - k, end), pages: runAt(end - k, end)!.pages });
    end -= k;
    k = prev;
  }
  return out.reverse();
}

/** The whole album: chapters in order, each paginated, then each spread's page
 *  chosen so the book does not repeat itself. */
export function planAlbum(
  chapters: Array<{ id: string | undefined; photoIds: string[] }>,
  photos: AlbumPhoto[],
  spreadAspect: number,
  options: LayoutOptions,
): PlannedSpread[] {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const planned: PlannedSpread[] = [];
  const recent: string[] = [];
  chapters.forEach((chapter, index) => {
    for (const run of paginateChapter(chapter.photoIds, byId, spreadAspect, options, index === 0)) {
      const pick = run.pages
        .map((page) => ({
          page,
          value: page.score
            - (recent.slice(-RECENT_WINDOW).includes(page.template.id) ? REPEAT_PENALTY : 0)
            - REUSE_PENALTY * recent.filter((id) => id === page.template.id).length,
        }))
        .sort((a, b) => b.value - a.value)[0]?.page ?? null;
      if (pick) recent.push(pick.template.id);
      planned.push({ sessionId: chapter.id, fit: pick, photoIds: pick?.photoIds ?? run.photoIds });
    }
  });
  return planned;
}
