/* The studio's side of the client gallery: publish, then watch for the answer.
 *
 * WHY THE STUDIO POLLS AND NOT THE ENGINE.
 *
 * The spec said the engine would poll, on the reasoning that the photographer's
 * machine is behind NAT and cannot be called back. The NAT part is true and
 * nothing here is a webhook — but it does not follow that the ENGINE should be
 * the one asking. project.json has exactly one writer while the studio is open:
 * the browser holds the whole memory in hand and writes the file whole, on a
 * debounce. An engine writing a batch into the same file would be overwritten
 * by the next keystroke in the studio, or would overwrite it — and the loser
 * would be a client's choice, silently.
 *
 * So the browser asks. If the studio is closed the answer simply waits on the
 * server, which costs nothing: the set only matters when the photographer sits
 * down to edit.
 *
 * The matching itself is NOT done here. gallery.import_plan does it, server
 * side, where it can be tested — this module applies a decision, it does not
 * make one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  galleryImportPlan,
  galleryState,
  publishFrames,
  type GalleryLink,
  type GalleryState,
} from '../api';
import {
  framesOf,
  galleryOf,
  importClientChoice,
  setGalleryLink,
  useGalleryOf,
} from './store';

/** How often the studio asks, with a project open. A couple choosing takes
 *  evenings, not seconds; anything faster is a request per photographer per
 *  minute forever in exchange for nothing. */
const POLL_MS = 45_000;

/** Frames per publish call. Six hundred in one request is one HTTP round trip
 *  holding a connection open for minutes, with no progress and nothing kept if
 *  it drops. In chunks the counter is real and a failure costs one chunk. */
const CHUNK = 12;

export interface PublishProgress {
  done: number;
  total: number;
  failed: { name: string; error: string }[];
}

/** Derive and publish a project's frames, in chunks, reporting as it goes.
 *
 *  Files that cannot be read are collected and returned, never thrown: one
 *  unreadable JPEG in six hundred must not cost the other 599. */
export async function publishAll(
  galleryId: string,
  frames: { path: string; name: string }[],
  onProgress: (p: PublishProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<PublishProgress> {
  const progress: PublishProgress = { done: 0, total: frames.length, failed: [] };
  for (let i = 0; i < frames.length; i += CHUNK) {
    if (shouldStop()) break;
    const chunk = frames.slice(i, i + CHUNK);
    try {
      const out = await publishFrames(
        galleryId,
        // frameId is the FILE NAME: project.json is keyed by name so the folder
        // can move or arrive under another drive letter. A gallery answering in
        // paths would answer in a language the project cannot read.
        chunk.map((f) => ({ path: f.path, frameId: f.name, name: f.name })),
      );
      progress.done += out.published.length;
      progress.failed.push(...out.failed);
    } catch (e) {
      progress.failed.push(
        ...chunk.map((f) => ({
          name: f.name,
          error: e instanceof Error ? e.message : 'שגיאה',
        })),
      );
    }
    onProgress({ ...progress });
  }
  return progress;
}

export interface GalleryWatch {
  link: GalleryLink | null;
  state: GalleryState | null;
  /** 'down' is not 'nothing yet': a gallery that cannot be reached says so. */
  status: 'none' | 'reading' | 'ready' | 'down';
  fault: string | null;
  /** Set on the poll that turned a locked choice into a batch, so the screen
   *  can say what just happened instead of quietly growing a batch. */
  imported: { batchId: string; count: number; missing: string[] } | null;
  refresh: () => void;
}

export function useGalleryWatch(projectId: string): GalleryWatch {
  const link = useGalleryOf(projectId);
  const [state, setState] = useState<GalleryState | null>(null);
  const [status, setStatus] = useState<GalleryWatch['status']>('none');
  const [fault, setFault] = useState<string | null>(null);
  const [imported, setImported] = useState<GalleryWatch['imported']>(null);
  const busy = useRef(false);
  const galleryId = link?.galleryId ?? null;

  const poll = useCallback(async () => {
    if (!galleryId || busy.current) return;
    busy.current = true;
    try {
      const next = await galleryState(galleryId);
      setState(next);
      setFault(null);
      setStatus('ready');

      /* The whole point of the mechanism: a locked choice becomes a set. Once
       * only — importedAt is written in the same move as the batch. */
      const current = link;
      if (next.gallery.lockedAt && current && !current.importedAt) {
        const names = framesOf(projectId).map((f) => f.name);
        const plan = await galleryImportPlan(galleryId, names);
        const out = importClientChoice(projectId, current, plan);
        setImported({
          batchId: out.batchId,
          count: plan.matched.length,
          missing: out.missing,
        });
      }
    } catch (e) {
      setFault(e instanceof Error ? e.message : 'לא ניתן להגיע לגלריה');
      setStatus('down');
    } finally {
      busy.current = false;
    }
  }, [galleryId, projectId, link]);

  useEffect(() => {
    if (!galleryId) {
      setStatus('none');
      setState(null);
      return;
    }
    setStatus((s) => (s === 'ready' ? s : 'reading'));
    void poll();
    /* Keeps asking for as long as the screen is open — including AFTER the
     * import. An earlier version stopped once the choice had landed, on the
     * reasoning that a finished gallery has nothing left to say. It has: the
     * NOTES only start once the choice is locked, so that version delivered
     * the batch and then went deaf to every correction the couple asked for.
     *
     * The cost of being wrong the other way is one request every 45 seconds,
     * and only while the photographer is looking at this stage. */
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [galleryId, poll]);

  return { link, state, status, fault, imported, refresh: () => void poll() };
}

/** What the couple chose, per album they were sold, ready for the album studio.
 *
 *  No translation happens here and none is needed: an AlbumPhoto's id is
 *  frameKey(name) and the gallery answers in file names, because project.json
 *  is keyed by name so a folder can travel. The two halves of the product were
 *  already speaking the same language.
 *
 *  Album membership never affects EDITING — a frame is edited once however many
 *  albums it is in. It only matters here, at layout. */
export function clientAlbumsOf(
  projectId?: string,
): { name: string; frames: string[] }[] | undefined {
  if (!projectId) return undefined;
  const albums = galleryOf(projectId)?.albums;
  if (!albums) return undefined;
  return Object.values(albums).map((a) => ({ name: a.name, frames: a.frames }));
}

/** Forget the gallery on this project — after the server copy is gone. */
export function unlinkGallery(projectId: string) {
  setGalleryLink(projectId, null);
}
