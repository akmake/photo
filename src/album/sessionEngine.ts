import { albumMoments, embedAlbum } from '../api';
import type { AlbumPhoto, AlbumSession } from './model';

const EMBED_CHUNK = 8;

/** Detect the visual chapters of one selected story. Detection preserves the
 * photographer's order; it only places boundaries between consecutive frames.
 * Every selected photo is returned exactly once, including a frame whose visual
 * fingerprint could not be read. */
export async function detectAlbumSessions(photos: AlbumPhoto[]): Promise<AlbumSession[]> {
  if (!photos.length) return [];

  const usable = photos.filter((photo) => photo.sourcePath);
  if (usable.length !== photos.length) return oneSession(photos.map((photo) => photo.id));

  const paths = usable.map((photo) => photo.sourcePath!);
  for (let start = 0; start < paths.length; start += EMBED_CHUNK) {
    await embedAlbum(paths.slice(start, start + EMBED_CHUNK));
  }

  const result = await albumMoments(paths);
  if (!result.moments.length) return oneSession(photos.map((photo) => photo.id));

  const idByPath = new Map(usable.map((photo) => [photo.sourcePath!, photo.id]));
  const momentById = new Map<string, number>();
  result.moments.forEach((moment, index) => {
    moment.forEach((path) => {
      const id = idByPath.get(path);
      if (id) momentById.set(id, index);
    });
  });

  // Missing embeddings inherit the nearest chapter. This keeps the story
  // contiguous and, importantly, never drops an unreadable photograph.
  const labels = photos.map((photo) => momentById.get(photo.id));
  let previous: number | undefined;
  labels.forEach((label, index) => {
    if (label !== undefined) previous = label;
    else if (previous !== undefined) labels[index] = previous;
  });
  let next: number | undefined;
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    if (labels[index] !== undefined) next = labels[index];
    else if (next !== undefined) labels[index] = next;
  }

  const runs: string[][] = [];
  let activeMoment: number | undefined;
  photos.forEach((photo, index) => {
    const detected = labels[index];
    if (detected !== undefined && detected !== activeMoment) {
      runs.push([]);
      activeMoment = detected;
    }
    if (!runs.length) runs.push([]);
    runs[runs.length - 1].push(photo.id);
  });

  return runs.filter((run) => run.length).map((photoIds, index) => ({
    id: `session-${index + 1}`,
    label: `סשן ${index + 1}`,
    photoIds,
  }));
}

export function oneSession(photoIds: string[]): AlbumSession[] {
  return photoIds.length ? [{ id: 'session-1', label: 'סשן 1', photoIds }] : [];
}
