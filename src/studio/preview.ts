/* Showing a set in the state its recipe leaves it — batch by batch.
 *
 * The recipe is registered with the engine once and addressed by a key
 * afterwards, which is what keeps a preview a plain GET: `<img loading="lazy">`
 * then does the work of not rendering the 1,900 frames nobody scrolled to, and
 * the browser caches what it has already seen. Sending the recipe with every
 * frame would mean a POST per thumbnail and no laziness at all.
 *
 * There is now one key PER SITUATION rather than one for the project, because
 * that is the whole point of a batch: the garden and the dance floor are
 * two different grades, and a single key over the set would show one of them
 * everywhere. A frame with no batch renders through the base alone.
 *
 * Each key is a hash of its steps, so it changes the moment that batch's
 * recipe does and a stale proxy can never be served under it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { previewReady, previewUrl, registerRecipe, warmPreviews } from '../api';
import { batchOfFrame, batchRecipe, effectiveRecipe, useRecipe, useBatches } from './store';

export interface SetPreview {
  /** A frame as the set currently looks — through ITS batch's recipe. */
  url: (path: string, width?: number) => string;
  /** True once at least one batch has steps AND the engine acknowledged. */
  graded: boolean;
  /** Steps on the base. 0 means the project has no shared look yet. */
  steps: number;
  /** The engine could not be reached, so the frames below are the RAW files.
   *  Worth saying out loud: silently showing unedited frames under a screen
   *  that promises the edit is the exact confusion this model removes. */
  stale: boolean;
  /** Hand the engine a screenful to render ahead of being asked. Safe to call
   *  on every render — the engine de-dupes and the call is fire-and-forget. */
  warm: (paths: string[]) => void;
  /** TRUE while this frame is still showing the RAW file under a graded URL.
   *  A caller that shows `url()` is required to show this too; that is the
   *  whole contract that makes serving an ungraded frame acceptable. */
  pending: (path: string) => boolean;
}

/** '' is the base layer — frames that have not been given a batch yet. */
const BASE = '';

export function useSetPreview(projectId: string): SetPreview {
  const recipe = useRecipe(projectId);
  const batches = useBatches(projectId);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);

  /* One entry per layer that can actually appear on screen: the base, and each
   * batch. Built from the store rather than from the frames, so scrolling
   * never triggers a registration. */
  const layers = useMemo(() => {
    const out: Record<string, ReturnType<typeof batchRecipe>> = {
      [BASE]: batchRecipe(projectId, null).filter((t) => t.enabled),
    };
    for (const s of batches) {
      out[s.id] = batchRecipe(projectId, s.id).filter((t) => t.enabled);
    }
    return out;
    // `recipe` is the store's identity for these steps; recomputing on every
    // render would re-register on every scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, recipe, batches]);

  useEffect(() => {
    let alive = true;
    setStale(false);
    const entries = Object.entries(layers).filter(([, steps]) => steps.length);
    if (!entries.length) {
      setKeys({});
      return;
    }
    Promise.all(entries.map(([id, steps]) => registerRecipe(steps).then((k) => [id, k] as const)))
      .then((pairs) => {
        if (alive) setKeys(Object.fromEntries(pairs));
      })
      .catch(() => {
        if (!alive) return;
        setKeys({});
        setStale(true);
      });
    return () => {
      alive = false;
    };
  }, [layers]);

  /* WHAT IS ACTUALLY RENDERED, and the reason a grid stops being a wall of
   * blank tiles.
   *
   * The first graded view of a frame costs ~15s of segmentation (BUG-002), so
   * a screenful of them used to be a screenful of stalled requests. Now a frame
   * that is not ready is asked for with `fast`, comes back as the RAW file
   * immediately and is queued; this polls until it exists and then swaps the
   * URL, which makes the browser fetch the real one.
   *
   * Polling, not a socket: the answer is one boolean per frame, the question is
   * asked for a whole screen at a time, and it stops entirely once everything
   * asked about is ready. */
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const watching = useRef<Set<string>>(new Set());

  const keyFor = useCallback(
    (path: string) => {
      const batch = batchOfFrame(projectId, path) ?? BASE;
      return keys[batch] ?? keys[BASE] ?? '';
    },
    [keys, projectId],
  );

  const warm = useCallback((paths: string[]) => {
    for (const p of paths) watching.current.add(p);
    const byKey = new Map<string, string[]>();
    for (const p of paths) {
      const k = keyFor(p);
      if (!k) continue;
      byKey.set(k, [...(byKey.get(k) ?? []), p]);
    }
    for (const [k, ps] of byKey) warmPreviews(k, ps);
  }, [keyFor]);

  // A new set of keys means a new look: everything believed ready no longer is.
  useEffect(() => { setReady({}); }, [keys]);

  useEffect(() => {
    if (!Object.keys(keys).length) return;
    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      const outstanding = [...watching.current].filter((p) => !ready[p]);
      if (!outstanding.length) return;   // nothing left to wait for; stop asking
      const byKey = new Map<string, string[]>();
      for (const p of outstanding) {
        const k = keyFor(p);
        if (!k) continue;
        byKey.set(k, [...(byKey.get(k) ?? []), p]);
      }
      try {
        const answers = await Promise.all(
          [...byKey].map(([k, ps]) => previewReady(k, ps)),
        );
        if (!alive) return;
        const merged: Record<string, boolean> = {};
        for (const a of answers) {
          for (const [p, ok] of Object.entries(a.ready)) if (ok) merged[p] = true;
        }
        if (Object.keys(merged).length) setReady((r) => ({ ...r, ...merged }));
      } catch {
        /* the engine will be asked again on the next tick */
      }
      if (alive) timer = window.setTimeout(tick, 1500);
    };

    timer = window.setTimeout(tick, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keys, keyFor, ready]);

  return {
    url: (path: string, width = 320) => {
      const key = keyFor(path);
      // No key means no look on this frame — the raw file IS its current state,
      // and there is nothing to wait for.
      if (!key) return previewUrl(path, width, '');
      return previewUrl(path, width, key, !ready[path]);
    },
    graded: Object.keys(keys).length > 0,
    steps: recipe.base.filter((t) => t.enabled).length,
    stale,
    warm,
    pending: (path: string) => Boolean(keyFor(path)) && !ready[path],
  };
}

/* ------------------------------------------------------ one frame, fully edited
 *
 * The set preview above shows each frame through its BATCH's look — right for
 * a grid of hundreds, and wrong for the question "is this photograph
 * finished?", because a frame's own retouch lives on the frame. This one keys
 * every frame on its EFFECTIVE recipe (base → batch → frame), registering each
 * distinct recipe once: frames with no steps of their own share their batch's
 * key, so the number of registrations is the number of distinct results.
 *
 * Same contract as useSetPreview: `url` may serve something other than the
 * current edit while its render is queued, and `pending` says so — a caller
 * that shows one shows the other.
 *
 * THREE THINGS THIS GOT WRONG, all seen in the edit screen's strip after a
 * colour look was applied (2026-09-23):
 *
 *  - A NEW LOOK WAS NEVER WATCHED. `want` could only watch frames whose key it
 *    already had, and a new look's key arrives a moment later — so those frames
 *    stayed on the raw file until the photographer happened to step to another
 *    one and `want` ran again. Now the frames last asked for are kept, and are
 *    watched and warmed again the moment their key lands.
 *  - EVERY EDIT FLASHED THE STRIP BACK TO RAW. A frame with a new key was served
 *    the raw file until the render existed. It now keeps showing its PREVIOUS
 *    edit — still marked pending — and changes straight to the new one.
 *    `showsRaw` says when there is no previous edit to keep.
 *  - THE FAR END RENDERED FIRST. The engine's warm queue serves the last frame
 *    handed to it first; the list is handed over nearest-last now, so the frame
 *    being edited and its neighbours come back first.
 */
export interface FramePreview {
  url: (path: string, name: string, width?: number) => string;
  pending: (path: string, name: string) => boolean;
  /** Pending AND there is no earlier edit of this frame to show meanwhile —
   *  `url` is the raw file right now. */
  showsRaw: (path: string, name: string) => boolean;
  /** Ask for these frames' keys and renders ahead of being looked at. */
  want: (frames: { path: string; name: string }[]) => void;
  /** False when nothing at all applies to this frame — it IS its raw file. */
  edited: (name: string) => boolean;
  stale: boolean;
}

export function useFramePreview(projectId: string): FramePreview {
  const recipe = useRecipe(projectId);
  const [keys, setKeys] = useState<Record<string, string>>({});   // recipe text -> key
  const [ready, setReady] = useState<Record<string, boolean>>({});  // `${key}|${path}` -> true
  const [stale, setStale] = useState(false);
  const asked = useRef<Set<string>>(new Set());
  /** path -> the key its CURRENT edit renders under. One per frame: a look
   *  replaced before it finished is no longer worth asking about. */
  const watching = useRef<Map<string, { key: string; path: string }>>(new Map());
  /** The frames most recently asked for, in the order asked — kept so that a
   *  key arriving after `want` still gets its frames watched and warmed. */
  const wanted = useRef<{ path: string; name: string }[]>([]);
  /** path -> the key of the last edit of it that was fully rendered. */
  const lastReady = useRef<Map<string, string>>(new Map());

  // Any edit anywhere can change any frame's effective recipe.
  useEffect(() => { asked.current.clear(); }, [recipe]);

  const textOf = useCallback(
    (name: string) => JSON.stringify(effectiveRecipe(projectId, name).filter((t) => t.enabled)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, recipe],
  );

  /** Watch and warm every wanted frame whose key is known. Handed to the
   *  engine nearest-LAST: its warm queue serves the last one first. */
  const schedule = useCallback((frames: { path: string; name: string }[]) => {
    const byKey = new Map<string, string[]>();
    for (const f of frames) {
      const k = keys[textOf(f.name)];
      if (!k) continue;
      watching.current.set(f.path, { key: k, path: f.path });
      byKey.set(k, [...(byKey.get(k) ?? []), f.path]);
    }
    for (const [k, ps] of byKey) warmPreviews(k, [...ps].reverse());
  }, [keys, textOf]);

  // A key that landed after `want` ran: its frames are watched from now on.
  useEffect(() => { schedule(wanted.current); }, [schedule]);

  const want = useCallback((frames: { path: string; name: string }[]) => {
    wanted.current = frames;
    const fresh = new Map<string, string[]>();
    for (const f of frames) {
      const text = textOf(f.name);
      if (text === '[]') continue;
      if (!keys[text] && !asked.current.has(text)) {
        asked.current.add(text);
        fresh.set(text, []);
      }
    }
    for (const text of fresh.keys()) {
      registerRecipe(JSON.parse(text))
        .then((k) => { setKeys((m) => ({ ...m, [text]: k })); setStale(false); })
        .catch(() => { asked.current.delete(text); setStale(true); });
    }
    schedule(frames);
  }, [keys, textOf, schedule]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      const outstanding = [...watching.current.entries()].filter(([, v]) => !ready[`${v.key}|${v.path}`]);
      // Nothing out right now is not "never again": stepping to another batch
      // adds frames to watch without changing a key, and a loop that had
      // stopped left them on the raw file. Idle ticks send nothing.
      if (!outstanding.length) {
        if (alive) timer = window.setTimeout(tick, 600);
        return;
      }
      const byKey = new Map<string, string[]>();
      for (const [, v] of outstanding) byKey.set(v.key, [...(byKey.get(v.key) ?? []), v.path]);
      try {
        const answers = await Promise.all([...byKey].map(([k, ps]) => previewReady(k, ps).then((a) => [k, a] as const)));
        if (!alive) return;
        const merged: Record<string, boolean> = {};
        for (const [k, a] of answers) for (const [p, ok] of Object.entries(a.ready)) if (ok) merged[`${k}|${p}`] = true;
        if (Object.keys(merged).length) setReady((r) => ({ ...r, ...merged }));
      } catch { /* asked again next tick */ }
      // A render is ~0.5s; asking every 1.5s made each one look three times
      // slower than it was. The question is a file-exists check per frame.
      if (alive) timer = window.setTimeout(tick, 600);
    };
    timer = window.setTimeout(tick, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [keys, ready]);

  /** The key this frame shows while its current edit renders: the last one
   *  that finished, if any. */
  const previous = (path: string, current: string | undefined) => {
    const k = lastReady.current.get(path);
    return k && k !== current ? k : undefined;
  };

  return {
    url: (path, name, width = 1600) => {
      const text = textOf(name);
      if (text === '[]') return previewUrl(path, width, '');
      const k = keys[text];
      if (k && ready[`${k}|${path}`]) {
        lastReady.current.set(path, k);
        return previewUrl(path, width, k);
      }
      const before = previous(path, k);
      if (before) return previewUrl(path, width, before);
      if (!k) return previewUrl(path, width, '');
      return previewUrl(path, width, k, true);
    },
    showsRaw: (path, name) => {
      const text = textOf(name);
      if (text === '[]') return false;
      const k = keys[text];
      if (k && ready[`${k}|${path}`]) return false;
      return !previous(path, k);
    },
    pending: (path, name) => {
      const text = textOf(name);
      if (text === '[]') return false;
      const k = keys[text];
      return !k || !ready[`${k}|${path}`];
    },
    want,
    edited: (name) => textOf(name) !== '[]',
    stale,
  };
}
