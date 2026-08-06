/* The album's photo pool, drawn from the project it belongs to.
 *
 * A project album does NOT import or copy photographs. The frames already live
 * in the project's folder, the engine already serves their pixels by path, and
 * `analyzeAlbumFrame` already reports their real dimensions and faces. So the
 * pool is nothing more than the project's frames, seen as album photos — each
 * shown in its best available version (`frame.shown`: the edited copy when one
 * exists, else the raw), so the photographer can lay out the album before every
 * frame is finished and the edits flow in as they land.
 */

import type { Frame } from '../api';
import { analyzeAlbumFrame, thumbUrl } from '../api';
import { frameKey } from '../studio/store';
import type { AlbumPhoto, PhotoOrientation } from './model';

/** Wide enough that a photo filling a spread is not visibly a thumbnail; the
 *  full file is used at export, never this. */
const POOL_THUMB_WIDTH = 1200;

function orientationOf(width: number, height: number): PhotoOrientation {
  if (!width || !height) return 'square';
  const ratio = width / height;
  if (ratio > 1.12) return 'landscape';
  if (ratio < 0.88) return 'portrait';
  return 'square';
}

/** One project frame as an album photo, BEFORE analysis. The pixels are real
 *  (the engine serves them); the dimensions are left at 0 and the analysis
 *  `pending` on purpose — a guessed size is exactly what a PPI check must never
 *  be handed. `enrichPool` fills the real numbers in. */
export function frameToPhoto(frame: Frame): AlbumPhoto {
  return {
    id: frameKey(frame.name),
    name: frame.name,
    url: thumbUrl(frame.shown, POOL_THUMB_WIDTH),
    sourcePath: frame.path,
    orientation: 'square',
    widthPx: 0,
    heightPx: 0,
    focalPoint: { x: 0.5, y: 0.5 },
    analysis: {
      status: 'pending',
      faces: [],
      focalPoint: { x: 0.5, y: 0.5 },
      sharpnessScore: 0,
      qualityScore: 0,
      analyzedBy: '',
    },
  };
}

export function framesToPool(frames: Frame[]): AlbumPhoto[] {
  return frames.map(frameToPhoto);
}

/** Fill in real dimensions, orientation, faces and focal point from the engine,
 *  a few frames at a time so a 300-photo shoot does not open 300 sockets at
 *  once. `onPhoto` fires with each enriched photo as it resolves, so the pool
 *  sharpens progressively instead of blocking on the whole set. A frame the
 *  engine cannot read is marked `failed`, never dropped — a missing analysis is
 *  a fact the album is allowed to show, not a photo that silently vanishes. */
export async function enrichPool(
  photos: AlbumPhoto[],
  onPhoto: (photo: AlbumPhoto) => void,
  concurrency = 4,
): Promise<void> {
  const queue = photos.filter((photo) => photo.sourcePath);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const photo = queue[cursor];
      cursor += 1;
      try {
        const a = await analyzeAlbumFrame(photo.sourcePath!);
        onPhoto({
          ...photo,
          orientation: orientationOf(a.widthPx, a.heightPx),
          widthPx: a.widthPx,
          heightPx: a.heightPx,
          focalPoint: a.focalPoint,
          analysis: {
            status: 'ready',
            faces: a.faces,
            subject: a.subject,
            focalPoint: a.focalPoint,
            sharpnessScore: a.sharpnessScore,
            qualityScore: a.qualityScore,
            analyzedBy: a.analyzedBy,
          },
        });
      } catch {
        onPhoto({
          ...photo,
          analysis: {
            status: 'failed',
            faces: [],
            focalPoint: photo.focalPoint ?? { x: 0.5, y: 0.5 },
            sharpnessScore: 0,
            qualityScore: 0,
            analyzedBy: 'unreadable',
          },
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );
}
