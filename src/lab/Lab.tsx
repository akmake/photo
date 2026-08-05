/* The lab — one photo, one tool at a time, and a straight answer about what
 * happened.
 *
 * Two things here are not decoration, they are the point:
 *
 *  1. FULL RESOLUTION IS THE DEFAULT. The engine's face tools bail out under a
 *     120px face (skin.py MIN_FACE_PX). Downscaling a 3648x5472 frame to
 *     1600px puts the face at ~85px, and every face tool then returns the
 *     frame untouched with faceTooSmall — measured, not assumed. A preview
 *     that silently disables the thing being tested is worse than a slow one.
 *
 *  2. THE DIFFERENCE VIEW. "I don't see any change" and "nothing changed" are
 *     different claims, and arguing about them by eye is a waste of time. The
 *     diff view amplifies |result - original| and prints the actual numbers,
 *     so the question stops being a matter of opinion.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Recipe, ToolInstance } from '../types';
import {
  defaultRecipe, getTool, isToolAtDefault, orderedInstances, setToolEnabled,
  updateToolParams, updateToolSelection, visibleInstances,
} from '../toolRegistry';
import {
  renderRecipe, renderRecipeAtPath, checkEngine, detectSpots, detectSpotsAtPath,
} from '../api';
import type { RenderStep, SpotCandidate, SpotDetection } from '../api';
import {
  batchOfFrame, batchRecipe, effectiveRecipe, frameSteps, removeFrameStep, setFrameStep,
} from '../studio/store';
import { explainStep, scaleBlockKind, markLabel, markReason } from './explain';
import type { StepReport } from './explain';
// Travels with the screen, not with the app: the lab is lazily loaded and its
// sheet has no business in the first paint. Every selector is .lab-* / .cmp-*.
import './lab.css';
import { Histogram, computeDiff, loadImage } from '../design/Metering';
import type { Delta } from '../design/Metering';

const DEBOUNCE_MS = 260;
/** Multiplier on the fitted size. A 3648px frame fitted into ~900px of stage
 *  sits at ~0.25, so 80x is roughly 2000% — enough to inspect single pixels. */
const MAX_ZOOM = 80;
/** The one tool that reports its findings as objects a person can choose
 *  between. Everything else here is a field: there is nothing to enumerate. */
const CLEANUP_ID = 'skin-cleanup';

/* A photograph that belongs to a project.
 *
 * THE SCREEN DOES NOT CHANGE WHEN THIS IS PRESENT. Same three regions, same
 * tool list with its switches, same result/diff/marks, same marking geometry,
 * same brush, same zoom. What changes is only the plumbing at the two ends:
 * the engine works from the FILE by path instead of from pixels the browser
 * uploaded, and a save goes into the project's recipe instead of downloading a
 * JPG.
 *
 * ONE component serves both, deliberately. A copy of this file adapted for
 * projects would be two labs by the end of the month, and the one people
 * actually use would be whichever was fixed last. */
export interface LabFrame {
  projectId: string;
  /** Absolute path on disk — the engine opens it; the browser never holds the
   *  original's pixels. */
  path: string;
  name: string;
  /** The batch this session belongs to, for the layer a save could reach. */
  batchId: string | null;
  /** Swap to another photograph of the set. */
  onChange: () => void;
}

interface Loaded {
  name: string;
  /** A displayable original. From the chosen file when the bench is standalone;
   *  rendered from the file by the engine when it is a project's frame. */
  full: string;
  /** Set only for a project frame. Its presence is what routes every engine
   *  call to the by-path API. */
  path?: string;
  w: number;
  h: number;
}

function emptyRecipe(): Recipe {
  const r = defaultRecipe();
  return { tools: r.tools.map((t) => ({ ...t, enabled: false })) };
}

/** The project's decisions, poured into the switches this screen already has.
 *
 *  The mapping is exact and that is why it is worth doing: this panel shows the
 *  STATE of every tool — on or off, at what values — and a project recipe is
 *  precisely that. So a frame opens showing what has already been decided about
 *  it, rather than switched off over a set that carries a look. */
function recipeFromSteps(steps: ToolInstance[]): Recipe {
  let r = emptyRecipe();
  for (const step of steps) {
    if (!r.tools.some((t) => t.toolId === step.toolId)) continue;
    r = {
      tools: r.tools.map((t) => (t.toolId === step.toolId ? { ...t, ...step } : t)),
    };
  }
  return r;
}


function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

/** Measure a chosen file. Only its dimensions are wanted — the render always
 *  runs on the full picture, and the fitted size is just the brush canvas. */
async function measure(dataUrl: string): Promise<Omit<Loaded, 'name' | 'full' | 'path'>> {
  const img = await loadImage(dataUrl);
  return { w: img.width, h: img.height };
}

function paramNote(toolId: string, params: Record<string, number>): string {
  try {
    return getTool(toolId).params.map((s) => `${s.label} ${params[s.id]}`).join(' · ');
  } catch {
    return '';
  }
}

export default function Lab({ frame }: { frame?: LabFrame } = {}) {
  const [img, setImg] = useState<Loaded | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(emptyRecipe);
  const [out, setOut] = useState<string | null>(null);
  const [reports, setReports] = useState<StepReport[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState(0);
  const [showOriginal, setShowOriginal] = useState(false);
  const [engineOk, setEngineOk] = useState<boolean | null>(null);
  const [openTool, setOpenTool] = useState<string | null>(null);

  const [mode, setMode] = useState<'result' | 'diff' | 'marks'>('result');
  const [gain, setGain] = useState(10);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitScale, setFitScale] = useState(1);

  const [saving, setSaving] = useState(false);
  /** Which frame the recipe on screen was seeded FROM. The autosave below will
   *  not write until this matches, so a fresh mount's empty recipe can never
   *  land on top of what the set already decided. */
  const seeded = useRef<string | null>(null);
  const seq = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLImageElement>(null);
  const diffRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  /* THE MANUAL BRUSH IS GONE, and it is not coming back as a brush.
   *
   * It let you smear a soft-edged stroke over one tool's result and say "except
   * here" or "only here". Judged from use: bad and broken. The honest diagnosis
   * is that a feathered stroke painted at preview scale is the wrong instrument
   * for a decision that has to be exact — you cannot see where it lands, you
   * cannot adjust it after the fact, and it is stored as a PNG that means
   * nothing to anyone reading the recipe later.
   *
   * What replaced it is the drawn REGION below: a closed outline the
   * photographer places deliberately, either "clean only inside this" or
   * "clean everything except this". Same intent, exact geometry, legible in the
   * recipe, and reversible. */

  /* The marking pass: every candidate the cleanup detector found, outlined, and
   * a choice about each one.
   *
   * The outlines are the engine's own repair geometry (engine/cleanup.py
   * detect()), not an illustration of it — so what is drawn here is what gets
   * rebuilt, and marking exactly what the engine accepted reproduces the
   * automatic result bit for bit (test_cleanup_marking.py). That identity is the
   * reason this can be a control and not a preview.
   *
   * The chosen outlines live in the RECIPE, which means the ordinary render
   * effect below picks them up with no special path: choosing a mark is the same
   * kind of act as moving a slider, and it reaches the export the same way. */
  const [marks, setMarks] = useState<SpotDetection | null>(null);
  const [marksKey, setMarksKey] = useState('');
  const [marksBusy, setMarksBusy] = useState(false);
  const [marksError, setMarksError] = useState<string | null>(null);
  const [marksReset, setMarksReset] = useState(false);
  const [showRefused, setShowRefused] = useState(true);
  const [hoverMark, setHoverMark] = useState<string | null>(null);
  /* What the outlines are drawn over. The default is the ORIGINAL, because the
   * question this view answers is "what did it find on my photo" — outlining
   * dirt on a frame the dirt has already been removed from asks the reader to
   * take the marks on faith. Switching to the result is one click, for checking
   * the repair without leaving the marks. */
  const [markBase, setMarkBase] = useState<'original' | 'result'>('original');

  const originalSrc = img ? img.full : '';

  /* ONE DOOR TO THE ENGINE, so the two sources cannot drift apart.
   *
   * A project's frame travels as a PATH: the engine opens the file, and a 20MP
   * original never goes through a POST body. A file chosen from disk has no
   * path, so its pixels go, exactly as before.
   *
   * Both render the WHOLE picture — no width is passed. The resolution
   * behaviour of this screen is unchanged by the move into projects, which is
   * the point of the move being plumbing only. */
  const runRender = useCallback(
    (tools: ToolInstance[], deliver = false) =>
      (img?.path
        ? renderRecipeAtPath(img.path, tools, undefined, deliver)
        : renderRecipe(img!.full, tools, deliver)),
    [img],
  );

  const runDetect = useCallback(
    (params: Record<string, number>, prefix: ToolInstance[]) =>
      (img?.path
        ? detectSpotsAtPath(img.path, params, prefix)
        : detectSpots(img!.full, params, prefix)),
    [img],
  );

  useEffect(() => {
    checkEngine().then(setEngineOk);
  }, []);

  /* ------------------------------------------------------------ compare */

  useEffect(() => {
    function down(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setShowOriginal(true);
      }
      if (e.key === '0') resetView();
      if (e.key === '1') zoomToActual();
    }
    function up(e: KeyboardEvent) {
      if (e.code === 'Space') setShowOriginal(false);
    }
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitScale]);

  /* --------------------------------------------------------- zoom & pan */

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomToActual = useCallback(() => {
    setZoom(fitScale > 0 ? 1 / fitScale : 1);
    setPan({ x: 0, y: 0 });
  }, [fitScale]);

  // How much the browser already shrank the image to fit the stage. Needed to
  // turn "×2 of fit" into an honest "100%".
  useLayoutEffect(() => {
    const el = baseRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.parentElement;
      if (!box || el.naturalWidth === 0) return;
      // object-fit: contain — the image fills whichever axis runs out first
      setFitScale(
        Math.min(box.clientWidth / el.naturalWidth, box.clientHeight / el.naturalHeight),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [originalSrc]);

  // Native listener: React's onWheel is passive, so it cannot preventDefault
  // and the page scrolls instead of the image zooming.
  //
  // The dependency on `img` is load-bearing. With [] this ran once at mount,
  // when the empty state is on screen and .lab-stage does not exist yet — so
  // the listener was never attached and the wheel did nothing at all.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(1, z * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        const k = next / z;
        setPan((p) => (next === 1 ? { x: 0, y: 0 } : { x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
        return next;
      });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img]);

  function startPan(e: React.PointerEvent) {
    if (zoom <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function movePan(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  }
  function endPan() {
    drag.current = null;
  }

  /* -------------------------------------------------------------- load */

  /** Everything that describes the PREVIOUS photograph. A candidate set and a
   *  zoom belong to one frame; carrying either across would outline marks that
   *  are not there. */
  const forget = useCallback((next: Recipe) => {
    setError(null);
    setOut(null);
    setReports([]);
    setMissing([]);
    setDelta(null);
    setRecipe(next);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMarks(null);
    setMarksKey('');
    setMarksError(null);
    setMarksReset(false);
    setHoverMark(null);
    scanAttempt.current = '';
  }, []);

  const load = useCallback(async (file: File) => {
    forget(emptyRecipe());
    setImg(null);
    try {
      const full = await readFile(file);
      const dims = await measure(full);
      setImg({ name: file.name, full, ...dims });
    } catch (e) {
      setError(`טעינת הקובץ נכשלה: ${(e as Error).message}`);
    }
  }, [forget]);

  /* A PROJECT'S FRAME. The engine renders the original with an empty recipe to
   * produce something displayable — the same call the workbench makes for its
   * raw comparison — and nothing but the path travels for every render after
   * that.
   *
   * The recipe is seeded from the project, so this frame arrives carrying what
   * has already been decided about it. Opening a photograph switched off, over
   * a set that has a look, is the "I open the tool and see the raw file"
   * complaint the recipe model exists to remove. */
  const framePath = frame?.path;
  const frameProject = frame?.projectId;
  useEffect(() => {
    if (!framePath || !frameProject) return;
    let alive = true;
    forget(recipeFromSteps(effectiveRecipe(frameProject, framePath)));
    seeded.current = framePath;
    setImg(null);
    renderRecipeAtPath(framePath, [])
      .then(async (r) => {
        if (!alive) return;
        const im = await loadImage(r.image);
        if (!alive) return;
        setImg({
          name: frame!.name,
          full: r.image,
          path: framePath,
          w: im.width,
          h: im.height,
        });
      })
      .catch((e) => alive && setError(`טעינת התמונה נכשלה: ${(e as Error).message}`));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framePath, frameProject, forget]);

  /* ------------------------------------------------------------ render */

  useEffect(() => {
    if (!img) return;
    const enabled = orderedInstances(recipe).filter((i) => i.enabled);

    if (enabled.length === 0) {
      seq.current++;
      setOut(null);
      setReports([]);
      setMissing([]);
      setDelta(null);
      setTotalMs(0);
      setBusy(false);
      return;
    }

    setBusy(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const started = performance.now();
      try {
        const res = await runRender(
          enabled.map((i) => ({
            toolId: i.toolId,
            params: i.params,
            enabled: true,
            ...(i.mask ? { mask: i.mask } : {}),
            // The marked candidates have to travel WITH the tool, not beside it.
            // They did not, at first, and the failure was silent in the worst
            // way: the marking view showed one set of outlines while the render
            // quietly kept using the engine's own automatic decision.
            ...(i.selection ? { selection: i.selection } : {}),
          })),
        );
        if (mine !== seq.current) return;
        const steps: RenderStep[] = res.meta?.steps ?? [];
        setOut(res.image);
        setReports(
          steps.map((s) => {
            const inst = enabled.find((i) => i.toolId === s.tool);
            return explainStep(
              s,
              inst ? paramNote(s.tool, inst.params) : '',
              inst ? isToolAtDefault(inst) : false,
            );
          }),
        );
        setMissing(
          enabled.filter((i) => !steps.some((s) => s.tool === i.toolId)).map((i) => i.toolId),
        );
        setTotalMs(Math.round(performance.now() - started));
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        setError((e as Error).message);
        setReports([]);
        setOut(null);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, recipe]);

  // Measure the change on every result, whether or not the diff view is open —
  // the number belongs in the log either way.
  useEffect(() => {
    const canvas = diffRef.current;
    if (!out || !canvas || !originalSrc) {
      setDelta(null);
      return;
    }
    let alive = true;
    computeDiff(originalSrc, out, canvas, gain)
      .then((d) => alive && setDelta(d))
      .catch(() => alive && setDelta(null));
    return () => {
      alive = false;
    };
  }, [out, originalSrc, gain]);

  /* ------------------------------------------------------------- marks */

  const cleanupInst = recipe.tools.find((t) => t.toolId === CLEANUP_ID);
  const cleanupOrder = getTool(CLEANUP_ID).order;

  /* Everything the candidate set depends on. Not just the cleanup sliders: a
   * tool that runs EARLIER changes the frame cleanup receives, so it changes
   * what there is to find. Leaving that out is how a marking view ends up
   * describing a picture that no longer exists. The chosen outlines are
   * deliberately NOT in here — choosing marks must not invalidate the scan they
   * came from. */
  const scanKey = useMemo(() => {
    if (!img) return '';
    return JSON.stringify({
      img: img.name,
      w: img.w,
      h: img.h,
      before: orderedInstances(recipe)
        .filter((i) => i.enabled && getTool(i.toolId).order <= cleanupOrder)
        .map((i) => ({ t: i.toolId, p: i.params })),
    });
  }, [img, recipe, cleanupOrder]);

  const marksStale = !!marks && marksKey !== scanKey;
  const scanAttempt = useRef('');

  /* THREE STATES, NOT TWO.
   *
   *   ממתין  — found, nothing decided. Outlined, asking.
   *   תוקן   — repaired. The outline comes OFF: it is handled, and an outline
   *            over a blemish that is already gone is asking about nothing.
   *   מוגן   — looked at, deliberately left alone. Outlined differently, and it
   *            stays that way through a rescan.
   *
   * Both decisions live in the recipe, so they travel to the export exactly like
   * a slider value, and both survive a reload. */
  const fixedIds = useMemo(
    () => new Set((cleanupInst?.selection?.polygons ?? []).map((p) => p.id)),
    [cleanupInst],
  );
  const sparedIds = useMemo(
    () => new Set(cleanupInst?.selection?.spared ?? []),
    [cleanupInst],
  );

  /** Write both decisions into the recipe. The render effect above does the
   *  rest — a fixed mark travels like a slider value, and reaches the export
   *  the same way. */
  const commitMarks = useCallback(
    (fixed: Set<string>, spared: Set<string>, items: SpotCandidate[]) => {
      setRecipe((r) =>
        updateToolSelection(r, CLEANUP_ID, {
          polygons: items
            .filter((i) => fixed.has(i.id))
            .flatMap((i) => i.contours.map((points) => ({ id: i.id, points }))),
          spared: [...spared],
        }),
      );
    },
    [],
  );

  /** Repair this one, now.
   *
   *  Switching the tool on is part of the click and not a separate chore — but
   *  it is switched on in its POINTWISE form: `selection` is present, so the
   *  engine rebuilds exactly the outlines listed and nothing else. It never
   *  becomes "clean the whole face" as a side effect of asking for one spot. */
  const fixMark = useCallback(
    (id: string) => {
      if (!marks) return;
      const fixed = new Set(fixedIds);
      const spared = new Set(sparedIds);
      fixed.add(id);
      spared.delete(id);
      setMarksReset(false);
      commitMarks(fixed, spared, marks.items);
      setRecipe((r) => (r.tools.find((t) => t.toolId === CLEANUP_ID)?.enabled
        ? r
        : setToolEnabled(r, CLEANUP_ID, true)));
    },
    [marks, fixedIds, sparedIds, commitMarks],
  );

  /** "Found it, and we are not touching it." */
  const spareMark = useCallback(
    (id: string) => {
      if (!marks) return;
      const fixed = new Set(fixedIds);
      const spared = new Set(sparedIds);
      fixed.delete(id);
      spared.add(id);
      setMarksReset(false);
      commitMarks(fixed, spared, marks.items);
    },
    [marks, fixedIds, sparedIds, commitMarks],
  );

  /** Back to undecided — the way out of either decision. */
  const resetMark = useCallback(
    (id: string) => {
      if (!marks) return;
      const fixed = new Set(fixedIds);
      const spared = new Set(sparedIds);
      fixed.delete(id);
      spared.delete(id);
      setMarksReset(false);
      commitMarks(fixed, spared, marks.items);
    },
    [marks, fixedIds, sparedIds, commitMarks],
  );

  const runScan = useCallback(async () => {
    if (!img) return;
    const key = scanKey;
    setMarksBusy(true);
    setMarksError(null);
    try {
      const prefix = orderedInstances(recipe)
        .filter((i) => i.enabled && getTool(i.toolId).order < cleanupOrder)
        .map((i) => ({ toolId: i.toolId, params: i.params, enabled: true }));
      const found = await runDetect(cleanupInst?.params ?? {}, prefix);
      setMarks(found);
      setMarksKey(key);
      /* NOTHING IS REPAIRED UNTIL IT IS ASKED FOR.
       *
       * This used to open with everything the engine accepted already marked,
       * so the view's job was to talk it back down. That is the opposite of
       * what the control is called: "סמן ובחר מה לתקן" is an instruction to
       * choose, and a screen that has already chosen for you is a screen you
       * argue with rather than one you operate.
       *
       * An empty polygon list is not "no decision" to the engine — it is the
       * explicit answer "none of them", which is exactly right here. Anything
       * previously spared on this frame is kept: that decision was made by
       * looking, and a rescan is not a reason to ask again. */
      commitMarks(new Set(), sparedIds, found.items);
    } catch (e) {
      setMarksError((e as Error).message);
    } finally {
      setMarksBusy(false);
    }
  }, [img, recipe, scanKey, cleanupInst, cleanupOrder, commitMarks, sparedIds]);

  const rescan = useCallback(() => {
    scanAttempt.current = scanKey;
    setMarksReset(true);
    runScan();
  }, [runScan, scanKey]);

  // Scan once, when the view is first opened on this photo. Deliberately NOT on
  // every slider move: detection runs at full resolution, and a view that
  // silently re-runs a multi-second pass on every drag is a view nobody opens.
  // Staleness is surfaced instead — and the marks already chosen stay valid
  // whatever the sliders do, because an outline describes itself.
  useEffect(() => {
    if (mode !== 'marks' || !img || marks || marksBusy) return;
    if (scanAttempt.current === scanKey) return;
    scanAttempt.current = scanKey;
    runScan();
  }, [mode, img, marks, marksBusy, scanKey, runScan]);

  /** The bulk moves. `accepted` is the engine's own answer applied in one go —
   *  which reproduces the automatic result exactly (test_cleanup_marking.py),
   *  so it is a shortcut and not a different outcome. Nothing spared is ever
   *  swept up by these: a decision already made is not overwritten by a bulk
   *  one. */
  const markEvery = useCallback(
    (which: 'all' | 'accepted' | 'none') => {
      if (!marks) return;
      setMarksReset(false);
      const fixed = which === 'none'
        ? new Set<string>()
        : new Set(
          marks.items
            .filter((i) => !sparedIds.has(i.id))
            .filter((i) => which === 'all' || i.verdict === 'heal')
            .map((i) => i.id),
        );
      commitMarks(fixed, sparedIds, marks.items);
      if (fixed.size) {
        setRecipe((r) => (r.tools.find((t) => t.toolId === CLEANUP_ID)?.enabled
          ? r
          : setToolEnabled(r, CLEANUP_ID, true)));
      }
    },
    [marks, sparedIds, commitMarks],
  );

  /** Put one candidate under the loupe: centred, and zoomed until it is big
   *  enough to actually judge.
   *
   *  This is not a convenience. "Is this dirt or is it her freckle" cannot be
   *  answered from a mark that is three screen pixels across, and at fit zoom on
   *  a 20MP frame that is what every mark is. A marking view without this asks
   *  the photographer to take the outlines on faith, which is the complaint the
   *  view was built to answer. */
  const focusMark = useCallback(
    (item: SpotCandidate) => {
      if (!marks || fitScale <= 0) return;
      const w = (item.bbox[2] - item.bbox[0]) * marks.width;
      const h = (item.bbox[3] - item.bbox[1]) * marks.height;
      // ~170 screen px of mark: large enough to see its texture, small enough
      // that the surrounding skin is still in frame for comparison. The floor is
      // on the mark's size in FRAME pixels — putting it on the product instead
      // silently pinned every small mark to the same zoom as a large one, which
      // defeats the whole point for exactly the marks that need it most.
      const want = 170 / (Math.max(8, Math.max(w, h)) * fitScale);
      const next = Math.min(MAX_ZOOM, Math.max(1, want));
      const cx = ((item.bbox[0] + item.bbox[2]) / 2 - 0.5) * marks.width * fitScale;
      const cy = ((item.bbox[1] + item.bbox[3]) / 2 - 0.5) * marks.height * fitScale;
      // .lab-zoomer is translate(pan) scale(zoom) about its own centre, and the
      // image is centred in that box — so cancelling the scaled offset puts the
      // mark dead centre.
      setZoom(next);
      setPan({ x: -next * cx, y: -next * cy });
      setHoverMark(item.id);
    },
    [marks, fitScale],
  );

  /** Hand the decision back to the engine. Different from marking everything it
   *  accepted, even though today they produce the same pixels: this one keeps
   *  following the detector if a slider moves, and that one does not. */
  const backToAuto = useCallback(() => {
    setRecipe((r) => updateToolSelection(r, CLEANUP_ID, null));
  }, []);

  type MarkState = 'pending' | 'fixed' | 'spared';
  const stateOfMark = useCallback(
    (id: string): MarkState =>
      (fixedIds.has(id) ? 'fixed' : sparedIds.has(id) ? 'spared' : 'pending'),
    [fixedIds, sparedIds],
  );

  /** Repaired spots are OFF the canvas, and that is the point of the state —
   *  the outline was a question and it has been answered. They stay in the list
   *  so the decision is reversible, and the toggle below brings them back onto
   *  the picture when the repair itself needs checking. */
  const [showFixed, setShowFixed] = useState(false);

  const shownMarks = useMemo(() => {
    const items = (marks?.items ?? []).filter(
      (i) => showRefused || i.verdict === 'heal' || fixedIds.has(i.id) || sparedIds.has(i.id),
    );
    // Undecided first — the list is a queue of things still asking.
    const rank = (i: SpotCandidate) => {
      const s = stateOfMark(i.id);
      if (s === 'pending') return i.verdict === 'heal' ? 0 : 1;
      return s === 'spared' ? 2 : 3;
    };
    return [...items].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (b.facts.areaPx ?? 0) - (a.facts.areaPx ?? 0);
    });
  }, [marks, showRefused, fixedIds, sparedIds, stateOfMark]);

  const tally = useMemo(() => {
    const items = marks?.items ?? [];
    return {
      total: items.length,
      pending: items.filter((i) => stateOfMark(i.id) === 'pending').length,
      fixed: items.filter((i) => stateOfMark(i.id) === 'fixed').length,
      spared: items.filter((i) => stateOfMark(i.id) === 'spared').length,
    };
  }, [marks, stateOfMark]);

  /* ------------------------------------------------------------- save */

  /* What is on screen is a PREVIEW: possibly downscaled, and always q90 with
   * 4:2:0 chroma subsampling. Handing that file over would deliver something
   * measurably worse than the edit that was made. So saving re-renders the
   * ORIGINAL frame and asks the engine for delivery settings. */
  /* SAVING INTO A PROJECT WRITES NO FILE, and that is the point.
   *
   * The recipe IS the deliverable: it travels to the batch, to the export, and
   * to every later change of mind, from the RAW each time. Rendering a JPG here
   * would make a second copy of the truth that the next slider move silently
   * invalidates.
   *
   * The reconciliation is the whole job. This panel states the FULL state of
   * every tool, on or off, while a project keeps a SPARSE list of exceptions.
   * So three things have to happen, and missing any one of them loses work:
   *   - what is on is written to this frame;
   *   - a tool the set carries that was switched off here needs an explicit
   *     off, or the inherited step simply comes back on the next render;
   *   - a frame-level step for a tool that is now neither on nor inherited is
   *     removed, rather than left as an exception that excepts nothing. */
  const commit = useCallback(() => {
    if (!frame) return;
    const { projectId, path } = frame;

    /* ONLY THE TOOLS THIS PANEL ACTUALLY CARRIES.
     *
     * `pixel-color` is why this line exists, and it cost real work to find. It
     * is a look FITTED from a pair rather than configured, it has no sliders,
     * and it is deliberately not one of the switches on this screen — so it
     * never enters this recipe at all. Reconciling against the inherited list
     * without this guard read its absence as "the photographer switched it
     * off" and wrote an explicit off onto the frame, silently removing the
     * batch's learned colour from a photograph nobody had touched. Measured,
     * not theorised: `perFrame["321A1770.JPG"]` came back
     * `vignette:true, pixel-color:false` after a save that only moved a
     * vignette slider.
     *
     * A tool that cannot be seen cannot have been turned off. Anything outside
     * this set is left exactly as the set left it. */
    const known = new Set(recipe.tools.map((t) => t.toolId));
    const on = orderedInstances(recipe).filter((i) => i.enabled);
    const onIds = new Set(on.map((i) => i.toolId));
    const inherited = batchRecipe(
      projectId,
      batchOfFrame(projectId, path) ?? frame.batchId,
    ).filter((t) => t.enabled && known.has(t.toolId));

    for (const step of on) setFrameStep(projectId, path, step);
    for (const step of inherited) {
      if (!onIds.has(step.toolId)) {
        setFrameStep(projectId, path, { ...step, enabled: false });
      }
    }
    for (const own of frameSteps(projectId, path)) {
      if (!known.has(own.toolId)) continue; // not this screen's to remove
      if (!onIds.has(own.toolId) && !inherited.some((t) => t.toolId === own.toolId)) {
        removeFrameStep(projectId, path, own.toolId);
      }
    }
  }, [frame, recipe]);

  /** The standalone bench has nowhere to save TO, so it hands over a file. What
   *  is on screen is a preview — q90, 4:2:0 — so this re-renders and asks the
   *  engine for delivery settings rather than shipping the picture displayed. */
  const download = useCallback(async () => {
    if (!img) return;
    const enabled = orderedInstances(recipe).filter((i) => i.enabled);
    if (enabled.length === 0) return;
    setSaving(true);
    try {
      const res = await runRender(
        enabled.map((i) => ({
          toolId: i.toolId,
          params: i.params,
          enabled: true,
          ...(i.mask ? { mask: i.mask } : {}),
          // the delivered file must be healed where she marked, not where the
          // detector would have chosen — same reason the preview forwards it
          ...(i.selection ? { selection: i.selection } : {}),
        })),
        true,
      );
      const a = document.createElement('a');
      a.href = res.image;
      a.download = `${img.name.replace(/\.[^.]+$/, '')}-lab.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(`השמירה נכשלה: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }, [img, recipe, runRender]);

  /* EVERY ACTION SAVES ITSELF. There is no "save it all at the end" press in a
   * project any more: a slider, a spot repaired, a spot spared — each one is
   * written to this frame's recipe as it happens. That is what makes the work
   * dynamic and exact to the pixel. You can stop at any moment and what you
   * decided is already recorded, and nothing is ever lost to a button nobody
   * pressed.
   *
   * Debounced, because a slider drag emits dozens of values a second and each
   * one would otherwise be a disk write. Gated on the seed having landed for
   * THIS frame: without that, the empty recipe a fresh mount starts with could
   * be written over the inherited one before the seeding effect replaces it. */
  /* The timer is keyed on the RECIPE, not on `commit`.
   *
   * `commit` closes over `recipe` and `frame`, and `frame` is a fresh object
   * every render, so depending on it re-armed the timer on every render — and
   * this component re-renders on mouse-over of a mark. Moving the pointer along
   * a list of forty spots would have postponed the save indefinitely. A ref
   * keeps the newest function while the schedule follows the actual change. */
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (!framePath || seeded.current !== framePath) return;
    const t = setTimeout(() => commitRef.current(), 450);
    return () => clearTimeout(t);
  }, [recipe, framePath]);

  /* --------------------------------------------------------------- ui */

  if (!img) {
    /* A project's frame is already chosen — there is nothing to ask for, only
     * the engine's first pass on the file to wait for. Offering the file picker
     * here would invite loading a photograph from outside the project into a
     * screen whose save writes to the project's recipe. */
    if (frame) {
      return (
        <div className="lab lab-empty">
          <div className="lab-empty-card">
            <h2>{frame.name}</h2>
            <p>{error ? 'התמונה לא נטענה.' : 'קורא את התמונה מהקובץ…'}</p>
            {error && <div className="lab-error">{error}</div>}
            <button className="btn" onClick={frame.onChange}>בחר תמונה אחרת</button>
            <EngineBadge ok={engineOk} />
          </div>
        </div>
      );
    }
    return (
      <div className="lab lab-empty">
        <div className="lab-empty-card">
          <h2>מעבדה</h2>
          <p>
            תמונה אחת, כלי אחד בכל פעם, ודוח מלא על מה שכל כלי באמת עשה —
            כולל כשהוא רץ ולא שינה כלום.
          </p>
          <label className="btn btn-primary" style={{ height: 44, padding: '0 26px' }}>
            בחר תמונה
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
            />
          </label>
          <EngineBadge ok={engineOk} />
          {error && <div className="lab-error">{error}</div>}
        </div>
      </div>
    );
  }

  const scaleBlocked = scaleBlockKind(reports);
  const showProcessed = !!out && !showOriginal;
  const pctZoom = Math.round(zoom * fitScale * 100);

  return (
    <div className="lab">
      <section className="lab-canvas">
        <div
          className={`lab-stage ${zoom > 1 ? 'pannable' : ''}`}
          ref={stageRef}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onDoubleClick={() => (zoom > 1 ? resetView() : zoomToActual())}
        >
          <div
            className="lab-zoomer"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              imageRendering: zoom * fitScale >= 3 ? 'pixelated' : 'auto',
            }}
          >
            <img ref={baseRef} className="lab-img" src={originalSrc} alt={img.name} />
            <img
              className="lab-img lab-over"
              src={out ?? originalSrc}
              alt=""
              style={{
                opacity:
                  showProcessed &&
                  (mode === 'result' || (mode === 'marks' && markBase === 'result'))
                    ? 1
                    : 0,
              }}
            />
            <canvas
              ref={diffRef}
              className="lab-img lab-over"
              style={{ opacity: showProcessed && mode === 'diff' ? 1 : 0 }}
            />
            {/* SVG, not a canvas: the outline has to stay one hairline wide at
                2000% zoom (vector-effect) and each candidate has to be clickable
                as itself. A rasterised overlay would need manual hit-testing and
                would go to mush exactly when the photographer leans in. */}
            {mode === 'marks' && marks && (
              <svg
                className="lab-img lab-over lab-marks"
                viewBox={`0 0 ${marks.width} ${marks.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {shownMarks.map((item) => {
                  const state = stateOfMark(item.id);
                  /* A REPAIRED SPOT LEAVES THE PICTURE.
                   *
                   * The outline was a question — "do you want this gone?" — and
                   * it has been answered. Leaving it drawn over skin that is
                   * already rebuilt asks about nothing and hides the repair
                   * being judged. It stays in the list, so the decision is one
                   * click from being undone, and `showFixed` puts it back on
                   * the canvas when the repair itself is what needs checking. */
                  if (state === 'fixed' && !showFixed) return null;
                  // A real 31x52px mark on a 3648px frame fitted to the stage is
                  // 1.9x3.1 SCREEN px — measured, not estimated. The outline is
                  // exact and completely invisible at the same time, so anything
                  // under a ring's width gets a locator drawn around it: at fit
                  // you need to know where the marks ARE, and at 100% you need
                  // the boundary. The ring's radius is divided by the scale so it
                  // stays one size on screen and disappears as you zoom in and
                  // the outline itself becomes legible.
                  const scale = Math.max(1e-6, fitScale * zoom);
                  const w = (item.bbox[2] - item.bbox[0]) * marks.width;
                  const h = (item.bbox[3] - item.bbox[1]) * marks.height;
                  const tiny = Math.max(w, h) * scale < 16;
                  // Line width is COMPUTED, never declared.
                  //
                  // `vector-effect: non-scaling-stroke` was the obvious tool and
                  // it is the wrong one here: it compensates for the SVG's own
                  // viewBox scale, and this stage zooms with a CSS transform on
                  // an ancestor HTML element, which stretches the rasterised
                  // layer — strokes included. So the outline grew with the zoom:
                  // at 20x a 1.25px line paints 25px, which is exactly the
                  // "huge and clunky at every zoom" that was reported.
                  //
                  // User units here ARE frame pixels (the viewBox is the frame),
                  // so dividing by the frame->screen scale pins the line to one
                  // screen pixel at every zoom by arithmetic. And that is what
                  // makes zooming in worth doing: the line stays a hairline while
                  // the contour under it resolves, so the boundary gets more
                  // exact the closer you look, instead of thicker.
                  const hair = 1 / scale;
                  const d = item.contours
                    .map(
                      (ring) =>
                        'M' +
                        ring
                          .map(([x, y]) => `${x * marks.width} ${y * marks.height}`)
                          .join('L') +
                        'Z',
                    )
                    .join(' ');
                  // The paint lives on the SHAPE, not in a stylesheet.
                  //
                  // Twice now a rule has quietly filled these: once because
                  // `.on` set a fill, and once because a stale sheet in an open
                  // tab kept painting the old one. Either way the result is the
                  // same and it is the worst possible one — a solid blob over
                  // the exact pixels this view exists to show. A presentation
                  // attribute travels with the element, so the outline cannot
                  // become a blob because a stylesheet somewhere disagrees.
                  /* Three states, three colours, and the state wins over the
                   * engine's verdict — once a decision has been made, what the
                   * detector thought is history. Undecided still shows the
                   * verdict, because that is the one moment it is useful. */
                  const colour = state === 'fixed'
                    ? '#7cc6ff'
                    : state === 'spared'
                      ? '#ffb74d'
                      : item.verdict === 'heal' ? '#19f5a6' : '#ff4d4d';
                  const hot = hoverMark === item.id;
                  return (
                    <g key={item.id}>
                      {/* a 5px blob on a 20MP frame is sub-pixel on screen; the
                          fat transparent stroke is what makes it clickable.
                          A click REPAIRS — that is the whole gesture this view
                          exists for. Undoing and sparing are in the row. */}
                      <path
                        className="lab-outline-hit"
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16 * hair}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (state === 'fixed') resetMark(item.id);
                          else fixMark(item.id);
                        }}
                        onPointerEnter={() => setHoverMark(item.id)}
                        onPointerLeave={() => setHoverMark(null)}
                      />
                      {tiny && (
                        <circle
                          cx={((item.bbox[0] + item.bbox[2]) / 2) * marks.width}
                          cy={((item.bbox[1] + item.bbox[3]) / 2) * marks.height}
                          r={13 / scale}
                          fill="none"
                          stroke={colour}
                          strokeWidth={hair}
                          strokeDasharray={`${2 * hair} ${3 * hair}`}
                          opacity={0.75}
                        />
                      )}
                      {/* Two strokes on the SAME path, both a hairline and both
                          on the boundary: a continuous dark line, then the
                          coloured one over it. That is how an outline stays
                          readable over a forehead, a shadow and hair without a
                          fill or a glow — neither of which can be used here,
                          because both cover the mark. */}
                      <path
                        d={d}
                        fill="none"
                        stroke="rgba(0,0,0,0.7)"
                        strokeWidth={(hot ? 1.6 : 1) * hair}
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke={colour}
                        strokeWidth={(hot ? 1.6 : 1) * hair}
                        // Solid once decided, dashed while still asking.
                        strokeDasharray={
                          state === 'pending' ? `${3 * hair} ${2.5 * hair}` : undefined
                        }
                      />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>

          {busy && <span className="lab-spinner">מעבד…</span>}
          {showOriginal && out && <span className="lab-badge-orig">מקור</span>}
          {/* histogram follows what the eye sees: result, or original on hold */}
          <Histogram src={showProcessed ? out! : originalSrc} />


          {mode === 'marks' && (
            <div className="lab-marksbar">
              {marksBusy ? (
                <strong>סורק את הפנים…</strong>
              ) : marksError ? (
                <strong className="bad">הסריקה נכשלה: {marksError}</strong>
              ) : !marks ? (
                <strong>אין סריקה</strong>
              ) : (
                <>
                  <strong>
                    {tally.pending} ממתינים
                    {marks.faces > 1 && <> · {marks.faces} פנים</>}
                  </strong>
                  <span className="lab-mark-tally">
                    <i className="dot fixed" />
                    {tally.fixed} תוקנו
                    <i className="dot spared" />
                    {tally.spared} מוגנים
                    <i className="dot all" />
                    {tally.total} סה״כ
                  </span>
                </>
              )}
              <div className="lab-modes">
                <button
                  className={markBase === 'original' ? 'on' : ''}
                  onClick={() => setMarkBase('original')}
                  title="הקווקוו על התמונה המקורית — שם הלכלוך עוד נמצא"
                >
                  מקור
                </button>
                <button
                  className={markBase === 'result' ? 'on' : ''}
                  onClick={() => setMarkBase('result')}
                  disabled={!out}
                  title="אותו קווקוו על התוצאה — לבדוק את התיקון בלי לאבד את הסימון"
                >
                  תוצאה
                </button>
              </div>
              <label className="lab-mark-check">
                <input
                  type="checkbox"
                  checked={showRefused}
                  onChange={(e) => setShowRefused(e.target.checked)}
                />
                הצג נדחים
              </label>
              <label className="lab-mark-check">
                <input
                  type="checkbox"
                  checked={showFixed}
                  onChange={(e) => setShowFixed(e.target.checked)}
                />
                הצג מתוקנים
              </label>
              <button
                className={marksStale ? 'stale' : ''}
                onClick={rescan}
                disabled={marksBusy || !img}
                title={
                  marksStale
                    ? 'הפרמטרים השתנו מאז הסריקה — הסימון הקיים עדיין תקף, אבל הרשימה לא מעודכנת'
                    : 'סרוק מחדש'
                }
              >
                {marksStale ? 'סרוק מחדש ●' : 'סרוק מחדש'}
              </button>
              {/* THE WAY OUT. The bar opened and there was no way to shut it —
                * the only exit was to notice that "תוצאה" in a different group
                * of controls happened to also leave this mode, which is not a
                * close button and does not read as one. Nothing is lost by
                * leaving: every decision was already written when it was made. */}
              <button
                className="lab-marks-x"
                onClick={() => setMode('result')}
                aria-label="סגור את הסימון"
                title="סגור — ההחלטות כבר שמורות"
              >
                ✕
              </button>
            </div>
          )}

          <div className="lab-zoombar">
            <button onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
            <span>{pctZoom}%</span>
            <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}>+</button>
            <i />
            <button onClick={resetView}>התאם</button>
            <button onClick={zoomToActual}>100%</button>
          </div>
        </div>

        <div className="lab-canvas-bar">
          <button className="lab-hold" disabled={!out}
            onPointerDown={() => setShowOriginal(true)}
            onPointerUp={() => setShowOriginal(false)}
            onPointerLeave={() => setShowOriginal(false)}
            onPointerCancel={() => setShowOriginal(false)}
          >
            החזק לראות מקור
            <kbd>רווח</kbd>
          </button>

          <div className="lab-modes">
            <button className={mode === 'result' ? 'on' : ''} onClick={() => setMode('result')}>
              תוצאה
            </button>
            <button className={mode === 'diff' ? 'on' : ''} onClick={() => setMode('diff')}
              disabled={!out}>
              הפרש
            </button>
            <button
              className={mode === 'marks' ? 'on' : ''}
              onClick={() => setMode('marks')}
              title="מראה כל מה שהמנוע מצא — מאושר ונדחה — ונותן לבחור מה לתקן"
            >
              סימון
            </button>
            {mode === 'diff' && (
              <select value={gain} onChange={(e) => setGain(Number(e.target.value))}>
                <option value={1}>×1</option>
                <option value={5}>×5</option>
                <option value={10}>×10</option>
                <option value={25}>×25</option>
              </select>
            )}
          </div>

          <span className="lab-meta">
            {img.name} · {img.w}×{img.h}
            {totalMs > 0 && <> · {totalMs}ms</>}
          </span>

          <div className="row">
            {frame && (
              <button className="btn btn-ghost" onClick={frame.onChange}>
                החלף תמונה
              </button>
            )}
            {/* No save button in a project. Every decision was already written
              * when it was made — a button here would be a lie about when the
              * work is safe. */}
            {frame ? (
              <span className="lab-autosave" title="כל פעולה נשמרת בנפרד למתכון של התמונה">
                נשמר אוטומטית
              </span>
            ) : (
              <button className="btn btn-ghost" onClick={download} disabled={!out || saving}
                title={`שומר ברזולוציה מלאה ${img.w}×${img.h}, איכות מלאה — לא את התצוגה`}>
                {saving ? 'שומר…' : `שמור ${img.w}×${img.h}`}
              </button>
            )}
          </div>
        </div>
      </section>

      <aside className="lab-tools scroll-y">
        <div className="lab-tools-head">
          <h2>כלים</h2>
          <button className="btn btn-ghost" onClick={() => setRecipe(emptyRecipe())}>
            כבה הכל
          </button>
        </div>
        <EngineBadge ok={engineOk} />

        {visibleInstances(recipe).map((inst) => {
          const def = getTool(inst.toolId);
          // A tool that is ON always shows its sliders — that is the whole
          // point of switching it on. A tool that is off can still be opened
          // to look at its range before committing.
          const open = inst.enabled || openTool === def.id;
          return (
            <div className={`lab-tool ${inst.enabled ? 'on' : ''}`} key={def.id}>
              <div className="lab-tool-head" onClick={() => setOpenTool(open ? null : def.id)}>
                <label className="switch" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={inst.enabled}
                    onChange={(e) => setRecipe(setToolEnabled(recipe, def.id, e.target.checked))}
                  />
                  <span className="slider-sw" />
                </label>
                <span className="lab-tool-name">{def.label}</span>
                {def.experimental && <span className="lab-exp">ניסיוני</span>}
              </div>

              {open && (
                <div className="lab-tool-body">
                  {def.params.map((spec) => (
                    <div className="lab-param" key={spec.id}>
                      <div className="lab-param-row">
                        <label>{spec.label}</label>
                        <span className="val">{inst.params[spec.id]}</span>
                      </div>
                      <input
                        type="range"
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        value={inst.params[spec.id]}
                        disabled={!inst.enabled}
                        onChange={(e) =>
                          setRecipe(
                            updateToolParams(recipe, def.id, {
                              [spec.id]: Number(e.target.value),
                            }),
                          )
                        }
                        onDoubleClick={() =>
                          setRecipe(
                            updateToolParams(recipe, def.id, { [spec.id]: spec.default }),
                          )
                        }
                      />
                    </div>
                  ))}

                  {def.id === CLEANUP_ID && (
                    <div className="lab-mask-row">
                      <button
                        className={`btn btn-ghost ${mode === 'marks' ? 'on' : ''}`}
                        onClick={() => setMode('marks')}
                      >
                        סמן ובחר מה לתקן
                      </button>
                      {inst.selection && (
                        <span className="lab-mask-note">
                          {inst.selection.polygons.length === 0
                            ? 'נקודתי — עוד לא נבחר כלום'
                            : `נקודתי — ${new Set(inst.selection.polygons.map((p) => p.id)).size} מוקדים`}
                        </span>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          );
        })}
      </aside>

      <section className="lab-log">
        <div className="lab-log-head">
          <h3>מה נעשה בפעולה הזאת</h3>
          {delta && (
            <span className={`lab-delta ${delta.max <= 1 ? 'zero' : delta.p3 < 1 ? 'tiny' : 'real'}`}>
              {delta.max <= 1
                ? 'התמונה זהה למקור — אפס פיקסלים השתנו'
                : `שינוי מרבי ${delta.max}/255 · ${delta.p3.toFixed(2)}% מהפיקסלים · ממוצע ${delta.mean.toFixed(3)}`}
            </span>
          )}
        </div>

        <div className="lab-log-body scroll-y">
          {error && <div className="lab-error">✗ {error}</div>}

          {mode === 'marks' && (
            <div className="lab-marks-panel">
              {!cleanupInst?.enabled && (
                <div className="lab-hint">
                  כלי ניקוי הכתמים כבוי, אז שום סימון לא ייושם.
                  <button
                    className="btn btn-ghost"
                    onClick={() => setRecipe(setToolEnabled(recipe, CLEANUP_ID, true))}
                  >
                    הדלק אותו
                  </button>
                </div>
              )}

              {marks && marks.items.length > 0 && (
                <div className="lab-marks-actions">
                  <button
                    onClick={() => markEvery('accepted')}
                    title="תקן בבת אחת כל מה שהמנוע אישר — זהה לתוצאה האוטומטית, פיקסל בפיקסל"
                  >
                    תקן את מה שאושר
                  </button>
                  <button onClick={() => markEvery('all')}>תקן הכל</button>
                  <button onClick={() => markEvery('none')}>בטל תיקונים</button>
                  <button
                    className={cleanupInst?.selection ? '' : 'on'}
                    onClick={backToAuto}
                    title="מוותר על הבחירה הידנית ומחזיר את ההחלטה למנוע — שממשיך להתעדכן כשמזיזים סליידר"
                  >
                    חזור לאוטומטי
                  </button>
                </div>
              )}

              {marksReset && (
                <div className="lab-hint">
                  סריקה חדשה. שום דבר לא מתוקן עד שתבחר — מה שסימנת כמוגן נשמר.
                </div>
              )}

              {marks && marks.items.length === 0 && !marksBusy && (
                <div className="lab-log-idle">
                  הגלאי לא מצא כלום על הפנים האלה בעוצמה הזאת.
                  {marks.notes.previewTooSmall
                    ? ' הפנים קטנות מדי בתצוגה המוקטנת — סרוק מהקובץ המלא כדי לסמן עליהן.'
                    : marks.notes.faceTooSmall
                      ? ' הפנים קטנות מהמינימום שהכלי דורש.'
                      : ' העלה את "ניקוי נקודתי" וסרוק מחדש כדי לראות מועמדים חלשים יותר.'}
                </div>
              )}

              {shownMarks.map((item) => {
                const state = stateOfMark(item.id);
                return (
                  <div
                    key={item.id}
                    className={`lab-mark-row ${item.verdict === 'heal' ? 'ok' : 'refused'} st-${state}`}
                    onMouseEnter={() => setHoverMark(item.id)}
                    onMouseLeave={() => setHoverMark(null)}
                  >
                    <button
                      className="lab-mark-focus"
                      onClick={() => focusMark(item)}
                      title="הגדל אל המוקד הזה"
                    >
                      <span className="lab-mark-kind">{markLabel(item.kind)}</span>
                      <span className="lab-mark-why">
                        {markReason(item.verdict, item.facts)}
                      </span>
                    </button>

                    {/* The three states, as three acts rather than one checkbox.
                      * A checkbox can only say yes or no, and "I looked at this
                      * and we are leaving it" is neither. */}
                    <span className="lab-mark-acts">
                      {state === 'pending' ? (
                        <>
                          <button
                            className="act fix"
                            onClick={() => fixMark(item.id)}
                            title="תקן את זה עכשיו"
                          >
                            תקן
                          </button>
                          <button
                            className="act spare"
                            onClick={() => spareMark(item.id)}
                            title="נמצא, ובמפורש לא נוגעים בו — נשמר גם אחרי סריקה מחדש"
                          >
                            לא נוגעים
                          </button>
                        </>
                      ) : (
                        <button
                          className="act undo"
                          onClick={() => resetMark(item.id)}
                          title="חזרה למצב לא-מוכרע"
                        >
                          {state === 'fixed' ? 'תוקן ✓' : 'מוגן'}
                        </button>
                      )}
                    </span>

                    {item.verdict !== 'heal' && state === 'fixed' && (
                      <span className="lab-mark-forced">נכפה</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Two refusals, two sentences. This block used to assert the
            * harsher one for both cases — "this is the photograph, not a
            * setting" — about faces the export was retouching at full size. */}
          {scaleBlocked === 'preview' && (
            <div className="lab-hint">
              הפנים גדולות מספיק בקובץ עצמו, אבל לא בתצוגה המוקטנת שרצה כאן.
              בייצוא הכלים ירוצו עליהן ברזולוציה המלאה.
            </div>
          )}
          {scaleBlocked === 'photo' && (
            <div className="lab-hint">
              הפנים בתמונה הזאת קטנות מהמינימום שהמנוע דורש, אז הכלים דילגו.
              זו התמונה, לא הגדרה — גם בייצוא הם לא יעבדו עליה.
            </div>
          )}
          {scaleBlocked === 'both' && (
            <div className="lab-hint">
              חלק מהפנים קטנות מדי בצילום עצמו והכלים ידלגו עליהן גם בייצוא;
              אחרות רק בתצוגה המוקטנת, והן כן ייעשו בקובץ המלא.
            </div>
          )}

          {!error && reports.length === 0 && !busy && (
            <div className="lab-log-idle">
              הדלק כלי כדי לראות מה הוא עושה. כל כלי מדווח כאן מה הוא מצא בתמונה
              ומה הוא שינה בפועל.
            </div>
          )}

          {reports.map((r, i) => (
            <div className={`lab-step ${r.verdict}`} key={`${r.toolId}-${i}`}>
              <div className="lab-step-head">
                <span className="lab-step-mark" />
                <strong>{r.label}</strong>
                <span className="lab-step-ms">{r.ms}ms</span>
                <span className="lab-step-verdict">{r.headline}</span>
              </div>
              {r.facts.length > 0 && (
                <ul className="lab-step-facts">
                  {r.facts.map((f, k) => (
                    <li key={k}>{f}</li>
                  ))}
                </ul>
              )}
              <details className="lab-step-more">
                <summary>נתונים גולמיים</summary>
                <pre>{r.raw}</pre>
              </details>
            </div>
          ))}

          {missing.map((id) => (
            <div className="lab-step warn" key={`missing-${id}`}>
              <div className="lab-step-head">
                <span className="lab-step-mark" />
                <strong>{id}</strong>
                <span className="lab-step-verdict">
                  המנוע לא הריץ את הכלי — הוא לא רשום ב-engine/render.py
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Live histogram of whatever is on screen — luminance filled, R/G/B as thin
 *  lines. Sqrt-scaled: a linear y-axis makes every portrait histogram look
 *  like one spike at the midtones and nothing else. */
function EngineBadge({ ok }: { ok: boolean | null }) {
  if (ok === null) return null;
  if (ok) return <div className="lab-engine ok">המנוע מחובר · 127.0.0.1:8756</div>;
  return (
    <div className="lab-engine down">
      המנוע לא פועל — שום כלי לא ירוץ. הרץ בטרמינל:
      <code>engine\.venv\Scripts\python.exe engine\server.py</code>
    </div>
  );
}
