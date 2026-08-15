/* בניית האלבום — from a filtered set of frames to placed, checked spreads.
 *
 * This is the part that decides "which photos share a spread, and where each
 * one sits". It does NOT invent a second layout engine: `src/album/layoutEngine`
 * already generates and scores candidate compositions, and `layoutTemplates`
 * already holds the geometry vocabulary. What was missing is everything that
 * makes the choice a PRINT decision rather than a screen one — the fold, the
 * bleed, the resolution of a frame once it is cropped into its slot.
 *
 * So the flow is: group into spreads (rhythm + heroes) → ask the layout engine
 * for candidates → re-score every candidate against the physical spec → keep
 * the best. A composition that puts a face on the fold loses to a plainer one
 * that doesn't, which is the whole difference between a grid and a book.
 */

import { buildAlbumLayoutCandidates, type GeneratedAlbumLayout } from '../album/layoutEngine';
import type { AlbumPhoto, LayoutSlot } from '../album/model';
import { getAlbumStyle } from '../album/styleEngine';
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
  slot: LayoutSlot;
  resolution: FrameResolution;
  /** A face of this frame lands inside the fold's risk band. */
  faceOnFold: boolean;
}

export interface BuiltSpread {
  /** 1-based, as the photographer counts spreads. */
  number: number;
  layoutId: string;
  layoutName: string;
  frames: BuiltFrame[];
  warnings: string[];
}

export interface BuiltAlbum {
  spreads: BuiltSpread[];
  /** Frames that fall under the lab's floor — the list that blocks an export. */
  softFrames: number;
  facesOnFold: number;
}

/* A frame earns a spread of its own when it is both technically strong and
 * about someone. Quality alone promotes a sharp photo of a chair; faces alone
 * promote a blurry one. The album's rhythm needs a few of these or every
 * spread weighs the same and the book reads flat. */
function heroScore(photo: AlbumPhoto): number {
  const analysis = photo.analysis;
  if (!analysis || analysis.status !== 'ready') return 0;
  const faces = analysis.faces.length;
  const biggestFace = analysis.faces.reduce(
    (max, box) => Math.max(max, box.width * box.height),
    0,
  );
  // A close portrait beats a distant group; two people beat a crowd.
  const presence = faces === 0 ? 0 : Math.min(1, biggestFace * 6) * (faces <= 3 ? 1 : 0.7);
  return analysis.qualityScore * 0.55 + analysis.sharpnessScore * 0.15 + presence * 0.3;
}

/** How many frames share each spread: the style's rhythm, with heroes pulled out. */
function groupIntoSpreads(photos: AlbumPhoto[], styleName?: string): AlbumPhoto[][] {
  const style = getAlbumStyle(styleName);
  const rhythm = style.rhythm.length ? style.rhythm : [2, 3, 2, 4];

  // The top frames get a spread to themselves — roughly one every eight photos,
  // never so many that "hero" stops meaning anything.
  const heroCount = Math.min(
    Math.max(1, Math.round(photos.length / 8)),
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
      // A solo spread resets the pulse, so a hero is never followed by another.
      beat = 1;
      continue;
    }
    const want = rhythm[beat % rhythm.length];
    const group: AlbumPhoto[] = [];
    while (group.length < want && index < photos.length && !heroes.has(photos[index].id)) {
      group.push(photos[index]);
      index += 1;
    }
    if (group.length) out.push(group);
    beat += 1;
  }
  return out;
}

/** Does any face of this photo land in the fold, given where the slot sits? */
function faceLandsOnFold(photo: AlbumPhoto, slot: LayoutSlot, spec: PrintSpec): boolean {
  if (!crossesGutter(slot.x, slot.width, spec)) return false;
  const faces = photo.analysis?.faces ?? [];
  if (!faces.length) return false;

  const band = gutterFraction(spec);
  return faces.some((face) => {
    // The face box is in photo space; `cover` maps it onto the slot, and the
    // focal point keeps it roughly centred. Approximating the mapping as linear
    // across the slot is enough to answer "is it near the fold or not".
    const centre = slot.x + (face.x + face.width / 2) * slot.width;
    return centre > 0.5 - band && centre < 0.5 + band;
  });
}

/* Re-score a layout candidate against the physical album.
 *
 * The layout engine's own score is about composition — balance, hero quality,
 * crop safety. It knows nothing about this book. Here the fold and the lab's
 * PPI floor get a vote, and they get a loud one: a soft frame is a reprint, and
 * a face in the fold is a face with a crease through it. */
function scoreAgainstSpec(
  candidate: GeneratedAlbumLayout,
  photosById: Map<string, AlbumPhoto>,
  spec: PrintSpec,
): { score: number; frames: BuiltFrame[] } {
  const frames: BuiltFrame[] = [];
  let penalty = 0;

  candidate.slots.forEach((slot, index) => {
    const photo = photosById.get(candidate.photoIds[index]);
    if (!photo) return;
    const resolution = frameResolution(
      photo.widthPx,
      photo.heightPx,
      slot.width,
      slot.height,
      spec,
    );
    const faceOnFold = faceLandsOnFold(photo, slot, spec);
    if (!resolution.ok) penalty += 30;
    else if (resolution.belowTarget) penalty += 6;
    if (faceOnFold) penalty += 40;
    frames.push({ photo, slot, resolution, faceOnFold });
  });

  return { score: candidate.score - penalty, frames };
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

export function buildAlbum(
  photos: AlbumPhoto[],
  spec: PrintSpec,
  styleName?: string,
): BuiltAlbum {
  const { pageAspect } = spreadSize(spec);
  const groups = groupIntoSpreads(photos, styleName);
  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const spreads: BuiltSpread[] = [];

  groups.forEach((group, index) => {
    const candidates = buildAlbumLayoutCandidates(
      group.map((photo) => photo.id),
      group,
      pageAspect,
      styleName,
    );
    if (!candidates.length) return;

    let best = { score: -Infinity, frames: [] as BuiltFrame[], candidate: candidates[0] };
    for (const candidate of candidates) {
      const scored = scoreAgainstSpec(candidate, photosById, spec);
      if (scored.score > best.score) best = { ...scored, candidate };
    }

    spreads.push({
      number: index + 1,
      layoutId: best.candidate.id,
      layoutName: best.candidate.name,
      frames: best.frames,
      warnings: warningsFor(best.frames, spec),
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
  };
}
