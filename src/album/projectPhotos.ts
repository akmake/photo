/* The album's photographs, taken from the project's own folders.
 *
 * An album used to demand that the photographer upload the files a second
 * time, into the browser's IndexedDB — the same frames the project already
 * points at on disk, copied and stored twice. That is wrong twice over: it
 * doubles the disk a wedding costs, and it breaks the rule the whole product
 * rests on (docs/PRODUCT-UX.md §3.7) — the photographs stay where the
 * photographer put them, and the database only holds knowledge ABOUT them.
 *
 * So an album photo IS a path. The engine serves the pixels at whatever size
 * is asked for: a small frame for the tray, a large one for the canvas, the
 * original for the press. Nothing is copied anywhere.
 */

import { analyzeAlbumFrame, listImages, thumbUrl } from '../api';
import { foldersOf } from '../studio/store';
import type { AlbumPhoto, AlbumPhotoAnalysis, PhotoOrientation } from './model';

/** The working preview. Wide enough that a frame filling half a spread on a
 *  large screen still has pixels to spare when the crop is zoomed in, and
 *  small enough that a tray of 240 frames does not stall the engine. */
export const WORK_WIDTH = 1400;

/** What the press gets. `thumbnail()` never enlarges, so asking for more than
 *  the file holds simply returns the file — this is an upper bound, not a
 *  resize. A 600mm spread at 300ppi is ~7,090px, so one frame across a full
 *  spread is the widest thing an export can need. */
export const PRINT_WIDTH = 7200;

export function frameUrl(path: string, width = WORK_WIDTH): string {
  return thumbUrl(path, width);
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function orientationFor(width: number, height: number): PhotoOrientation {
  const ratio = width / height;
  if (ratio > 1.12) return 'landscape';
  if (ratio < 0.88) return 'portrait';
  return 'square';
}

const PENDING_ANALYSIS: AlbumPhotoAnalysis = {
  status: 'pending',
  faces: [],
  focalPoint: { x: 0.5, y: 0.5 },
  sharpnessScore: 0,
  qualityScore: 0,
  analyzedBy: 'pending',
};

/** The path IS the identity — it is stable, unique, and it is what every engine
 *  call needs anyway (studio/store.ts says the same about `Photo`). Nothing is
 *  guessed here: orientation and pixel size stay unknown until the engine has
 *  actually opened the file, because an album that assumes landscape and lays
 *  out a portrait is worse than one that says "still reading". */
export function photoFromPath(path: string): AlbumPhoto {
  const blank: AlbumPhoto = {
    id: path,
    path,
    name: baseName(path),
    url: frameUrl(path),
    orientation: 'landscape',
    widthPx: 0,
    heightPx: 0,
    analysis: PENDING_ANALYSIS,
  };
  /* A frame analysed earlier in this session is already known. Handing back a
   * pending photo instead would show "מנתח" forever: the queue skips what it
   * has already measured, so nothing would ever arrive to correct it. */
  const known = analysed.get(path);
  return known ? applyFacts(blank, known) : blank;
}

export interface ProjectPhotoSet {
  photos: AlbumPhoto[];
  /** Folders that could not be read — a disconnected external drive is the
   *  normal case, and it deserves a sentence, not a silent empty tray. */
  errors: { folder: string; error: string }[];
}

/** Every frame in every folder the project points at, read fresh from disk. */
export async function loadProjectPhotos(projectId: string): Promise<ProjectPhotoSet> {
  const folders = foldersOf(projectId);
  const photos: AlbumPhoto[] = [];
  const errors: { folder: string; error: string }[] = [];
  const seen = new Set<string>();

  for (const folder of folders) {
    try {
      const listing = await listImages(folder.path);
      listing.files.forEach((file) => {
        // the same folder added twice must not produce the same frame twice
        if (seen.has(file)) return;
        seen.add(file);
        photos.push(photoFromPath(file));
      });
    } catch (error) {
      errors.push({
        folder: folder.path,
        error: error instanceof Error ? error.message : 'לא ניתן לקרוא את התיקייה',
      });
    }
  }
  return { photos, errors };
}

/* ------------------------------------------------------------ the analysis
 *
 * Analysis is what turns a file into something the layout engine can place:
 * real pixel dimensions, faces, a focal point. It costs a full decode per
 * frame, so it runs in the background, a few at a time, and never twice for
 * the same file in one session.
 */

/** Everything one decode of a file tells us: what the layout engine needs
 *  (faces, focal point, scores) AND the original pixel size, which is what
 *  every print-resolution check downstream is measured against. */
export interface FrameFacts {
  analysis: AlbumPhotoAnalysis;
  widthPx: number;
  heightPx: number;
}

const analysed = new Map<string, FrameFacts>();
const inFlight = new Map<string, Promise<FrameFacts | null>>();

export function cachedFacts(path: string): FrameFacts | undefined {
  return analysed.get(path);
}

async function analyseOne(path: string): Promise<FrameFacts | null> {
  const done = analysed.get(path);
  if (done) return done;
  const running = inFlight.get(path);
  if (running) return running;

  const task = analyzeAlbumFrame(path)
    .then((result): FrameFacts => {
      const facts: FrameFacts = {
        analysis: {
          status: 'ready',
          faces: result.faces,
          subject: result.subject ?? null,
          focalPoint: result.focalPoint,
          sharpnessScore: result.sharpnessScore,
          qualityScore: result.qualityScore,
          analyzedBy: result.analyzedBy,
        },
        widthPx: result.widthPx,
        heightPx: result.heightPx,
      };
      analysed.set(path, facts);
      return facts;
    })
    .catch(() => null)
    .finally(() => {
      inFlight.delete(path);
    });

  inFlight.set(path, task);
  return task;
}

/** What one finished analysis says about a frame, in the shape a photo wants. */
export function applyFacts(photo: AlbumPhoto, facts: FrameFacts | null): AlbumPhoto {
  if (!facts) {
    return {
      ...photo,
      analysis: {
        ...(photo.analysis ?? PENDING_ANALYSIS),
        status: 'failed',
        analyzedBy: 'engine-unavailable',
      },
    };
  }
  return {
    ...photo,
    widthPx: facts.widthPx,
    heightPx: facts.heightPx,
    orientation: orientationFor(facts.widthPx, facts.heightPx),
    focalPoint: facts.analysis.focalPoint,
    analysis: facts.analysis,
  };
}

/** Analyse a list of frames a few at a time, reporting each one as it lands.
 *
 * Returns a function that stops the run — leaving an album mid-analysis must
 * not keep a wedding's worth of decodes queued against the engine. */
export function analyseFrames(
  paths: string[],
  onOne: (path: string, facts: FrameFacts | null) => void,
  concurrency = 3,
): () => void {
  let stopped = false;
  const queue = paths.filter((path) => !analysed.has(path));

  async function worker() {
    while (!stopped) {
      const next = queue.shift();
      if (!next) return;
      const facts = await analyseOne(next);
      if (!stopped) onOne(next, facts);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, worker);
  void Promise.all(workers);

  return () => {
    stopped = true;
    queue.length = 0;
  };
}

/** Analyse these frames and wait — used before laying an album out, where a
 *  missing pixel size would silently produce the wrong crop. */
export async function ensureAnalysed(
  paths: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, FrameFacts | null>> {
  const results = new Map<string, FrameFacts | null>();
  paths.forEach((path) => {
    const cached = analysed.get(path);
    if (cached) results.set(path, cached);
  });

  const pending = paths.filter((path) => !analysed.has(path));
  if (!pending.length) return results;

  let done = 0;
  onProgress?.(0, pending.length);
  await new Promise<void>((resolve) => {
    analyseFrames(pending, (path, facts) => {
      results.set(path, facts);
      done += 1;
      onProgress?.(done, pending.length);
      if (done >= pending.length) resolve();
    });
  });
  return results;
}
