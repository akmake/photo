import { buildAlbumLayoutCandidates } from './layoutEngine';
import type { AlbumPhoto, AlbumSpread } from './model';

const BACKGROUNDS = ['#f8f6f1', '#f4efe7', '#e9e2d8'];
const RHYTHM = [1, 4, 5, 3, 6, 4, 5];

function splitForAlbum(photoIds: string[]): string[][] {
  if (photoIds.length <= 6) return [photoIds];
  const groups: string[][] = [];
  let cursor = 0;
  let rhythmIndex = 0;
  while (cursor < photoIds.length) {
    const remaining = photoIds.length - cursor;
    let count = Math.min(RHYTHM[rhythmIndex % RHYTHM.length], remaining);
    if (remaining - count === 1 && count < 6) count += 1;
    groups.push(photoIds.slice(cursor, cursor + count));
    cursor += count;
    rhythmIndex += 1;
  }
  if (groups.length > 1 && groups[groups.length - 1]?.length === 1) {
    groups[groups.length - 2].push(...groups.pop()!);
  }
  return groups;
}

export function buildAutomaticAlbum(
  selectedPhotoIds: string[],
  photos: AlbumPhoto[],
  pageAspect: number,
): AlbumSpread[] {
  const unique = selectedPhotoIds.filter((id, index, all) => all.indexOf(id) === index);
  return splitForAlbum(unique).map((photoIds, index) => {
    const candidates = buildAlbumLayoutCandidates(photoIds, photos, pageAspect);
    const recommended = candidates[0];
    return {
      id: `auto-${Date.now()}-${index}`,
      pageStart: 2 + index * 2,
      layoutId: recommended?.id ?? 'balanced',
      photoIds: recommended?.photoIds ?? photoIds,
      background: BACKGROUNDS[index % BACKGROUNDS.length],
      locked: false,
      status: 'draft',
      frameSettings: {},
    };
  });
}
