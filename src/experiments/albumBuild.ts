/* בניית האלבום — from a kept set of frames to placed, checked spreads.
 *
 * Two decisions live here, and they are made in this order on purpose:
 *
 *   1. WHICH photos share a spread. Driven by a rhythm so the book breathes,
 *      with the strongest frames pulled out to carry a spread alone.
 *   2. WHICH template that group sits in. Every template in the vocabulary that
 *      holds the right number of frames is tried, every arrangement of the
 *      photos inside it is scored, and the winner is the one that survives both
 *      the design rules and the physical book.
 *
 * The scoring is where a grid becomes a book. Three forces pull on it:
 *
 *   - CROP LOSS. A slot is always filled edge to edge, so a standing portrait
 *     in a letterbox slot loses its subject. This is the loudest design term.
 *   - THE FOLD. A face in the gutter is a face with a crease through it, and no
 *     composition is worth that.
 *   - RESOLUTION. A frame printed below the lab's floor is a reprint.
 *
 * A composition that scores beautifully and fails any of those loses to a
 * plainer one that doesn't.
 */

import type { AlbumPhoto } from '../album/model';
import {
  availableCounts,
  cropLoss,
  templatesFor,
  wantsMatch,
  type SpreadTemplate,
  type TemplateSlot,
} from './albumTemplates';
import {
  crossesGutter,
  frameResolution,
  gutterFraction,
  spreadSize,
  type FrameResolution,
  type PrintSpec,
} from './printSpec';

export interface BuiltFrame {
  photo: AlbumPhoto;
  slot: TemplateSlot;
  resolution: FrameResolution;
  /** A face of this frame lands inside the fold's risk band. */
  faceOnFold: boolean;
}

export interface BuiltSpread {
  /** 1-based, as the photographer counts spreads. */
  number: number;
  layoutId: string;
  layoutName: string;
  bleed: boolean;
  frames: BuiltFrame[];
  warnings: string[];
}

export interface BuiltAlbum {
  spreads: BuiltSpread[];
  /** Frames that fall under the lab's floor — the list that blocks an export. */
  softFrames: number;
  facesOnFold: number;
  /** How much of the book runs to the edge. A book of insets reads as a slide deck. */
  bleedRatio: number;
}

/* A frame earns a spread of its own when it is both technically strong and
 * about someone. Quality alone promotes a sharp photo of a chair; faces alone
 * promote a blurry one. */
function heroScore(photo: AlbumPhoto): number {
  const analysis = photo.analysis;
  if (!analysis || analysis.status !== 'ready') return 0;
  const faces = analysis.faces.length;
  const biggestFace = analysis.faces.reduce(
    (max, box) => Math.max(max, box.width * box.height),
    0,
  );
  const presence = faces === 0 ? 0 : Math.min(1, biggestFace * 6) * (faces <= 3 ? 1 : 0.7);
  return analysis.qualityScore * 0.55 + analysis.sharpnessScore * 0.15 + presence * 0.3;
}

/* The rhythm of the book.
 *
 * A run of same-size spreads is what makes an album feel machine-made, so the
 * pulse alternates deliberately: a solo, then a busier spread, then a pair. The
 * counts are clamped to what the template vocabulary actually draws — asking for
 * a seven-up spread that has no template would silently fall back to a grid.
 */
const RHYTHM = [1, 3, 2, 4, 1, 2, 6, 3];

function groupIntoSpreads(photos: AlbumPhoto[], counts: number[]): AlbumPhoto[][] {
  const allowed = new Set(counts);
  const rhythm = RHYTHM.filter((n) => allowed.has(n));
  const beats = rhythm.length ? rhythm : [Math.min(...counts)];

  const heroCount = Math.min(
    Math.max(1, Math.round(photos.length / 7)),
    Math.max(1, Math.floor(photos.length / 3)),
  );
  const heroes = new Set(
    [...photos]
      .sort((a, b) => heroScore(b) - heroScore(a))
      .slice(0, heroCount)
      .filter((photo) => heroScore(photo) > 0)
      .map((photo) => photo.id),
  );

  const out: AlbumPhoto[][] = [];
  let index = 0;
  let beat = 0;
  while (index < photos.length) {
    if (heroes.has(photos[index].id)) {
      out.push([photos[index]]);
      index += 1;
      beat += 1; // a solo spread advances the pulse, never repeats it
      continue;
    }
    const want = beats[beat % beats.length];
    const group: AlbumPhoto[] = [];
    while (group.length < want && index < photos.length && !heroes.has(photos[index].id)) {
      group.push(photos[index]);
      index += 1;
    }
    if (group.length) out.push(group);
    beat += 1;
  }

  // A trailing group the vocabulary cannot draw is folded into its neighbour
  // rather than rendered by some fallback nobody designed.
  return out.filter((g) => g.length > 0).flatMap((g) => (
    allowed.has(g.length) ? [g] : g.map((p) => [p])
  ));
}

/** Does any face of this photo land in the fold? */
function faceLandsOnFold(photo: AlbumPhoto, slot: TemplateSlot, spec: PrintSpec): boolean {
  if (!crossesGutter(slot.x, slot.width, spec)) return false;
  const faces = photo.analysis?.faces ?? [];
  if (!faces.length) return false;
  const band = gutterFraction(spec);
  return faces.some((face) => {
    const centre = slot.x + (face.x + face.width / 2) * slot.width;
    return centre > 0.5 - band && centre < 0.5 + band;
  });
}

/** Every arrangement of `items`. Only called for small groups. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

interface Placement {
  score: number;
  frames: BuiltFrame[];
}

function placeInto(
  template: SpreadTemplate,
  order: AlbumPhoto[],
  spec: PrintSpec,
): Placement {
  const { trimWidthMm, trimHeightMm } = spreadSize(spec);
  const frames: BuiltFrame[] = [];
  let score = 0;

  template.slots.forEach((slot, i) => {
    const photo = order[i];
    if (!photo) return;

    const loss = cropLoss(photo, slot.width, slot.height, trimWidthMm, trimHeightMm);
    const resolution = frameResolution(
      photo.widthPx, photo.heightPx, slot.width, slot.height, spec,
    );
    const faceOnFold = faceLandsOnFold(photo, slot, spec);

    // Crop loss is weighted by how much of the spread the slot occupies: ruining
    // the shape of a full-bleed hero matters far more than of a thumbnail.
    const weight = 0.4 + slot.width * slot.height * 2.2;
    score -= loss * 100 * weight;
    if (!wantsMatch(photo, slot.want)) score -= 22;
    if (slot.role === 'hero') score += heroScore(photo) * 26;
    if (!resolution.ok) score -= 90;
    else if (resolution.belowTarget) score -= 10;
    if (faceOnFold) score -= 120;

    frames.push({ photo, slot, resolution, faceOnFold });
  });

  // The book needs edges. Without this a run of tidy inset spreads always wins
  // on crop loss alone, and the result is the contact sheet this file exists to
  // stop being.
  if (template.bleed) score += 26;

  return { score, frames };
}

function bestPlacement(
  group: AlbumPhoto[],
  templates: SpreadTemplate[],
  spec: PrintSpec,
): { template: SpreadTemplate; placement: Placement } | null {
  const candidates = templates.filter((t) => t.count === group.length);
  if (!candidates.length) return null;

  // 5! = 120 arrangements is nothing; beyond that, order by quality into the
  // slots by area, which puts the strongest frame in the largest opening.
  const orders = group.length <= 5
    ? permutations(group)
    : [[...group].sort((a, b) => heroScore(b) - heroScore(a))];

  let best: { template: SpreadTemplate; placement: Placement } | null = null;
  for (const template of candidates) {
    const ordered = group.length <= 5
      ? orders
      : [reorderByArea(orders[0], template.slots)];
    for (const order of ordered) {
      const placement = placeInto(template, order, spec);
      if (!best || placement.score > best.placement.score) best = { template, placement };
    }
  }
  return best;
}

/** Strongest photo into the biggest opening, and so on down. */
function reorderByArea(byQuality: AlbumPhoto[], slots: TemplateSlot[]): AlbumPhoto[] {
  const rank = slots
    .map((slot, i) => ({ i, area: slot.width * slot.height }))
    .sort((a, b) => b.area - a.area);
  const out: AlbumPhoto[] = new Array(slots.length);
  rank.forEach(({ i }, position) => { out[i] = byQuality[position]; });
  return out;
}

function warningsFor(frames: BuiltFrame[], spec: PrintSpec): string[] {
  const out: string[] = [];
  const soft = frames.filter((frame) => !frame.resolution.ok).length;
  const low = frames.filter((frame) => frame.resolution.ok && frame.resolution.belowTarget).length;
  const folded = frames.filter((frame) => frame.faceOnFold).length;
  if (soft) out.push(`${soft} מסגרות מתחת ל-${spec.minPpi} PPI`);
  if (low) out.push(`${low} מסגרות מתחת ל-PPI היעד`);
  if (folded) out.push(`${folded} פנים קרובות לציר`);
  return out;
}

export function buildAlbum(photos: AlbumPhoto[], spec: PrintSpec): BuiltAlbum {
  const { pageAspect } = spreadSize(spec);
  const templates = templatesFor(pageAspect);
  const groups = groupIntoSpreads(photos, availableCounts(pageAspect));
  const spreads: BuiltSpread[] = [];

  let previousId: string | null = null;
  groups.forEach((group) => {
    const best = bestPlacement(group, templates, spec);
    if (!best) return;

    // The same template twice running is the other way a book reads as machine
    // output. If a runner-up is close, take it instead.
    let chosen = best;
    if (best.template.id === previousId) {
      const alternatives = templates
        .filter((t) => t.count === group.length && t.id !== previousId)
        .map((t) => ({ template: t, placement: placeInto(t, group, spec) }))
        .sort((a, b) => b.placement.score - a.placement.score);
      if (alternatives.length && alternatives[0].placement.score > best.placement.score - 30) {
        chosen = alternatives[0];
      }
    }
    previousId = chosen.template.id;

    spreads.push({
      number: spreads.length + 1,
      layoutId: chosen.template.id,
      layoutName: chosen.template.name,
      bleed: chosen.template.bleed,
      frames: chosen.placement.frames,
      warnings: warningsFor(chosen.placement.frames, spec),
    });
  });

  return {
    spreads,
    softFrames: spreads.reduce(
      (sum, spread) => sum + spread.frames.filter((frame) => !frame.resolution.ok).length,
      0,
    ),
    facesOnFold: spreads.reduce(
      (sum, spread) => sum + spread.frames.filter((frame) => frame.faceOnFold).length,
      0,
    ),
    bleedRatio: spreads.length
      ? spreads.filter((s) => s.bleed).length / spreads.length
      : 0,
  };
}
