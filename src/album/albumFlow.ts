import { buildAlbumLayoutCandidates } from './layoutEngine';
import type { AlbumPhoto, AlbumSpread } from './model';
import { getAlbumStyle } from './styleEngine';

/* The album is a timeline with cuts.
 *
 * The photographer drops every chosen photo onto ONE strip, in order, and marks
 * where one spread ends and the next begins. Each run of photos between two cuts
 * becomes a spread whose layout is chosen for it. This is the model SmartAlbums
 * and Fundy both landed on, and the reason is simple: nobody builds an album by
 * staring at an empty spread. They build it by pacing a sequence.
 *
 * A "cut" is a boundary BEFORE a photo index — `cuts` holds the indices in
 * `1..n-1` where a new spread starts. Index 0 is always a start and never listed.
 */

/** The default cut positions for a sequence, from the pacing rhythm. Returns the
 *  boundary indices (each in `1..n-1`) where a new spread begins. */
export function autoCuts(count: number, styleName?: string): number[] {
  if (count <= 0) return [];
  const rhythm = getAlbumStyle(styleName).rhythm;
  const cuts: number[] = [];
  let cursor = 0;
  let rhythmIndex = 0;
  while (cursor < count) {
    const remaining = count - cursor;
    let take = Math.min(rhythm[rhythmIndex % rhythm.length], remaining);
    // Never strand a single photo as the last spread — fold it back.
    if (remaining - take === 1 && take < 6) take += 1;
    cursor += take;
    rhythmIndex += 1;
    if (cursor < count) cuts.push(cursor);
  }
  return cuts;
}

/** Split an ordered id list at the given cut boundaries into spread-sized groups. */
export function groupsFromCuts(photoIds: string[], cuts: number[]): string[][] {
  const bounds = [...new Set(cuts)]
    .filter((c) => c > 0 && c < photoIds.length)
    .sort((a, b) => a - b);
  const groups: string[][] = [];
  let start = 0;
  for (const bound of bounds) {
    groups.push(photoIds.slice(start, bound));
    start = bound;
  }
  groups.push(photoIds.slice(start));
  return groups.filter((group) => group.length > 0);
}

/** Turn ready-made groups into spreads, one layout chosen per group. This is the
 *  single place a grouping becomes an album, so the timeline and the legacy
 *  auto-builder produce identical spreads. */
export function buildAlbumFromGroups(
  groups: string[][],
  photos: AlbumPhoto[],
  pageAspect: number,
  styleName?: string,
): AlbumSpread[] {
  const stamp = Date.now();
  const style = getAlbumStyle(styleName);
  return groups.map((photoIds, index) => {
    const candidates = buildAlbumLayoutCandidates(photoIds, photos, pageAspect, style.id);
    const recommended = candidates[0];
    return {
      id: `spread-${stamp}-${index}`,
      pageStart: 2 + index * 2,
      layoutId: recommended?.id ?? 'balanced',
      photoIds: recommended?.photoIds ?? photoIds,
      customSlots: recommended?.slots,
      background: style.backgrounds[index % style.backgrounds.length],
      locked: false,
      status: 'draft',
      frameSettings: {},
    };
  });
}

/** Build a whole album from a flat selection, using the default pacing. Kept as
 *  the one-shot entry the tray's "build" button calls; the timeline uses the
 *  cut-aware pieces above so the photographer can move the boundaries first. */
export function buildAutomaticAlbum(
  selectedPhotoIds: string[],
  photos: AlbumPhoto[],
  pageAspect: number,
  styleName?: string,
): AlbumSpread[] {
  const unique = selectedPhotoIds.filter((id, index, all) => all.indexOf(id) === index);
  const groups = groupsFromCuts(unique, autoCuts(unique.length, styleName));
  return buildAlbumFromGroups(groups, photos, pageAspect, styleName);
}
