import { buildAlbumLayoutCandidates } from './layoutEngine';
import type { AlbumPhoto, AlbumSession, AlbumSpread } from './model';
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

function sourceAspect(photo: AlbumPhoto | undefined): number {
  if (!photo?.widthPx || !photo.heightPx) return 1;
  return Math.max(0.4, Math.min(2.5, photo.widthPx / photo.heightPx));
}

function groupContextScore(
  ids: string[],
  start: number,
  end: number,
  total: number,
  byId: Map<string, AlbumPhoto>,
  styleName?: string,
): number {
  const photos = ids.map((id) => byId.get(id));
  const count = photos.length;
  const baseByCount = [0, -6, 5, 8, 7, 3, 0];
  const orientations = photos.map((photo) => photo?.orientation ?? 'landscape');
  const dominant = Math.max(
    orientations.filter((value) => value === 'portrait').length,
    orientations.filter((value) => value === 'landscape').length,
    orientations.filter((value) => value === 'square').length,
  ) / Math.max(1, count);
  const qualities = photos.map((photo) => photo?.analysis?.qualityScore ?? 0.72);
  const averageQuality = qualities.reduce((sum, value) => sum + value, 0) / Math.max(1, count);
  const aspects = photos.map(sourceAspect);
  const aspectJumps = aspects.slice(1).reduce(
    (sum, aspect, index) => sum + Math.min(1, Math.abs(aspect - aspects[index]) / 1.2),
    0,
  );
  const visualContinuity = count <= 1 ? 1 : 1 - aspectJumps / (count - 1);
  const style = getAlbumStyle(styleName);

  let score = (baseByCount[count] ?? -4)
    + dominant * (count >= 3 ? 5 : 2)
    + visualContinuity * (count >= 3 ? 4 : 1)
    + averageQuality * 2
    // Density remains only a gentle tie-breaker for the selected style.
    - Math.abs(count - style.densityTarget) * 0.35;

  const firstQuality = qualities[0] ?? 0.72;
  if (start === 0 && count === 1 && firstQuality >= 0.76) score += 11;
  if (end === total && count === 1 && firstQuality >= 0.82) score += 5;
  if (count === 1 && start > 0 && end < total && firstQuality < 0.84) score -= 8;

  // A visible composition change is a natural, but deliberately weak, page turn.
  const next = end < total ? byId.get(ids[end]) : undefined;
  const last = photos[photos.length - 1];
  if (next && last) {
    if (next.orientation !== last.orientation) score += 1.5;
    const nextQuality = next.analysis?.qualityScore ?? 0.72;
    const lastQuality = last.analysis?.qualityScore ?? 0.72;
    if (Math.abs(nextQuality - lastQuality) >= 0.18) score += 1;
  }
  return score;
}

/** Choose spread boundaries from the actual ordered photographs. The dynamic
 * program compares coherent pairs/sequences, a strong opening hero and natural
 * visual changes; style density is only a small tie-breaker. */
export function contextualCuts(
  photoIds: string[],
  photos: AlbumPhoto[],
  styleName?: string,
): number[] {
  if (photoIds.length <= 1) return [];
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const best = Array<number>(photoIds.length + 1).fill(Number.NEGATIVE_INFINITY);
  const previous = Array<number>(photoIds.length + 1).fill(-1);
  best[0] = 0;

  for (let end = 1; end <= photoIds.length; end += 1) {
    for (let count = 1; count <= Math.min(6, end); count += 1) {
      const start = end - count;
      const score = best[start] + groupContextScore(
        photoIds.slice(start, end), start, end, photoIds.length, byId, styleName,
      );
      if (score > best[end]) {
        best[end] = score;
        previous[end] = start;
      }
    }
  }

  const cuts: number[] = [];
  let cursor = photoIds.length;
  while (cursor > 0 && previous[cursor] >= 0) {
    cursor = previous[cursor];
    if (cursor > 0) cuts.push(cursor);
  }
  return cuts.reverse();
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
  groupSessionIds: Array<string | undefined> = [],
): AlbumSpread[] {
  const stamp = Date.now();
  const style = getAlbumStyle(styleName);
  const spreads: AlbumSpread[] = [];
  groups.forEach((photoIds, index) => {
    const sessionStart = Boolean(groupSessionIds[index])
      && groupSessionIds[index] !== groupSessionIds[index - 1];
    const candidates = buildAlbumLayoutCandidates(photoIds, photos, pageAspect, style.id, {
      sessionStart,
      sessionEnd: Boolean(groupSessionIds[index])
        && groupSessionIds[index] !== groupSessionIds[index + 1],
      spreadIndex: index,
      spreadCount: groups.length,
      previousLayoutId: spreads[index - 1]?.layoutId,
    });
    const recommended = candidates[0];
    spreads.push({
      id: `spread-${stamp}-${index}`,
      pageStart: 2 + index * 2,
      layoutId: recommended?.id ?? 'balanced',
      photoIds: recommended?.photoIds ?? photoIds,
      customSlots: recommended?.slots,
      background: style.backgrounds[index % style.backgrounds.length],
      locked: false,
      status: 'draft',
      frameSettings: {},
      sessionId: groupSessionIds[index],
      sessionStart,
    });
  });
  return spreads;
}

/** Split arbitrary edited groups at session boundaries. This is the invariant
 * that prevents a timeline edit from accidentally putting the end of one shoot
 * and the beginning of another on the same spread. */
export function constrainGroupsToSessions(
  groups: string[][],
  sessions: AlbumSession[] | undefined,
): { groups: string[][]; sessionIds: Array<string | undefined> } {
  if (!sessions?.length) return { groups, sessionIds: groups.map(() => undefined) };
  const sessionByPhoto = new Map(sessions.flatMap((session) => (
    session.photoIds.map((id) => [id, session.id] as const)
  )));
  const constrained: string[][] = [];
  const sessionIds: Array<string | undefined> = [];
  for (const group of groups) {
    let run: string[] = [];
    let runSession: string | undefined;
    for (const id of group) {
      const nextSession = sessionByPhoto.get(id);
      if (run.length && nextSession !== runSession) {
        constrained.push(run);
        sessionIds.push(runSession);
        run = [];
      }
      run.push(id);
      runSession = nextSession;
    }
    if (run.length) {
      constrained.push(run);
      sessionIds.push(runSession);
    }
  }
  return { groups: constrained, sessionIds };
}

/** Build a whole album from a flat selection, using the default pacing. Kept as
 *  the one-shot entry the tray's "build" button calls; the timeline uses the
 *  cut-aware pieces above so the photographer can move the boundaries first. */
export function buildAutomaticAlbum(
  selectedPhotoIds: string[],
  photos: AlbumPhoto[],
  pageAspect: number,
  styleName?: string,
  sessions?: AlbumSession[],
): AlbumSpread[] {
  const unique = selectedPhotoIds.filter((id, index, all) => all.indexOf(id) === index);
  const uniqueSet = new Set(unique);
  const chapters: Array<{ id: string | undefined; label: string; photoIds: string[] }> = sessions?.length
    ? sessions
      .map((session) => ({ ...session, photoIds: session.photoIds.filter((id) => uniqueSet.has(id)) }))
      .filter((session) => session.photoIds.length)
    : [{ id: undefined, label: '', photoIds: unique }];
  const seen = new Set(chapters.flatMap((session) => session.photoIds));
  const orphans = unique.filter((id) => !seen.has(id));
  if (orphans.length) chapters.push({ id: undefined, label: '', photoIds: orphans });

  const groups: string[][] = [];
  const sessionIds: Array<string | undefined> = [];
  chapters.forEach((session) => {
    const chapterGroups = groupsFromCuts(
      session.photoIds,
      contextualCuts(session.photoIds, photos, styleName),
    );
    chapterGroups.forEach((group) => {
      groups.push(group);
      sessionIds.push(session.id);
    });
  });
  return buildAlbumFromGroups(groups, photos, pageAspect, styleName, sessionIds);
}
