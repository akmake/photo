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
import type { Recipe } from '../types';
import {
  defaultRecipe, getTool, isToolAtDefault, orderedInstances, setToolEnabled,
  updateToolMask, updateToolParams, updateToolSelection, visibleInstances,
} from '../toolRegistry';
import { renderRecipe, checkEngine, detectSpots } from '../api';
import type { RenderStep, SpotCandidate, SpotDetection } from '../api';
import { explainStep, isScaleBlocked, markLabel, markReason } from './explain';
import type { StepReport } from './explain';

/** Only used when "מהיר" is switched on — and it is off by default, because at
 *  this size the face tools stop working. */
const FAST_PREVIEW = 1600;
const DEBOUNCE_MS = 260;
/** The diff is a diagnostic overlay, not a deliverable; capping it keeps a
 *  20MP frame from allocating 160MB of pixel buffers on every render. */
const DIFF_CAP = 2400;
/** Multiplier on the fitted size. A 3648px frame fitted into ~900px of stage
 *  sits at ~0.25, so 80x is roughly 2000% — enough to inspect single pixels. */
const MAX_ZOOM = 80;
/** Frame-relative tools reject region masks in the engine (render.py
 *  FRAME_ONLY) — offering a brush for them would be a lying control. */
const NO_BRUSH = new Set(['light-point', 'glow', 'vignette']);
/** Painted edges get engine-side feathering so a preview-resolution stroke
 *  stays soft at export resolution. */
const PAINT_FEATHER = 12;
/** The one tool that reports its findings as objects a person can choose
 *  between. Everything else here is a field: there is nothing to enumerate. */
const CLEANUP_ID = 'skin-cleanup';

interface Loaded {
  name: string;
  full: string;
  preview: string;
  w: number;
  h: number;
  pw: number;
  ph: number;
}

interface Delta {
  mean: number;
  max: number;
  p3: number;
}

function emptyRecipe(): Recipe {
  const r = defaultRecipe();
  return { tools: r.tools.map((t) => ({ ...t, enabled: false })) };
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode failed'));
    i.src = src;
  });
}

async function downscale(dataUrl: string): Promise<Omit<Loaded, 'name' | 'full'>> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, FAST_PREVIEW / Math.max(img.width, img.height));
  const pw = Math.round(img.width * scale);
  const ph = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = pw;
  c.height = ph;
  c.getContext('2d')!.drawImage(img, 0, 0, pw, ph);
  return { preview: c.toDataURL('image/jpeg', 0.95), w: img.width, h: img.height, pw, ph };
}

/** |a - b| amplified into `canvas`, plus the numbers behind it. */
async function computeDiff(
  aSrc: string,
  bSrc: string,
  canvas: HTMLCanvasElement,
  gain: number,
): Promise<Delta | null> {
  const [a, b] = await Promise.all([loadImage(aSrc), loadImage(bSrc)]);
  if (a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight) return null;

  const s = Math.min(1, DIFF_CAP / Math.max(a.naturalWidth, a.naturalHeight));
  const w = Math.max(1, Math.round(a.naturalWidth * s));
  const h = Math.max(1, Math.round(a.naturalHeight * s));

  const grab = (im: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(im, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };

  const pa = grab(a);
  const pb = grab(b);

  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const outImg = ctx.createImageData(w, h);
  const out = outImg.data;

  let sum = 0;
  let max = 0;
  let over3 = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const dr = Math.abs(pa[j] - pb[j]);
    const dg = Math.abs(pa[j + 1] - pb[j + 1]);
    const db = Math.abs(pa[j + 2] - pb[j + 2]);
    const d = dr > dg ? (dr > db ? dr : db) : dg > db ? dg : db;
    sum += (dr + dg + db) / 3;
    if (d > max) max = d;
    if (d > 3) over3++;
    const v = d * gain;
    const c = v > 255 ? 255 : v;
    out[j] = c;
    out[j + 1] = c;
    out[j + 2] = c;
    out[j + 3] = 255;
  }
  ctx.putImageData(outImg, 0, 0);
  return { mean: sum / n, max, p3: (over3 / n) * 100 };
}

function paramNote(toolId: string, params: Record<string, number>): string {
  try {
    return getTool(toolId).params.map((s) => `${s.label} ${params[s.id]}`).join(' · ');
  } catch {
    return '';
  }
}

export default function Lab() {
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
  const seq = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLImageElement>(null);
  const diffRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  /* The manual brush: a per-photo override painted over ONE tool's result.
   * The strokes live in an offscreen canvas at preview size; commit ships
   * them as a PNG in the tool's mask spec, and the ENGINE blends — the same
   * code path the export uses, so what she paints is what she gets. */
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

  const [paintFor, setPaintFor] = useState<string | null>(null);
  const [brush, setBrush] = useState(70);
  const [erase, setErase] = useState(false);
  const [paintMode, setPaintMode] = useState<'except' | 'only'>('except');
  const maskCanvas = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<{ x: number; y: number } | null>(null);

  const originalSrc = img ? img.full : '';

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

  /* ------------------------------------------------------------- brush */

  const redrawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    const mc = maskCanvas.current;
    if (!ov || !mc) return;
    const g = ov.getContext('2d')!;
    g.clearRect(0, 0, ov.width, ov.height);
    g.drawImage(mc, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = 'rgba(255, 64, 64, 0.5)';
    g.fillRect(0, 0, ov.width, ov.height);
    g.globalCompositeOperation = 'source-over';
  }, []);

  const enterPaint = useCallback(
    (toolId: string) => {
      if (paintFor === toolId) {
        setPaintFor(null);
        return;
      }
      if (!img) return;
      let c = maskCanvas.current;
      if (!c || c.width !== img.pw || c.height !== img.ph) {
        c = document.createElement('canvas');
        c.width = img.pw;
        c.height = img.ph;
        maskCanvas.current = c;
      }
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      const inst = recipe.tools.find((t) => t.toolId === toolId);
      if (inst?.mask?.region === 'painted' && inst.mask.paint) {
        setPaintMode(inst.mask.invert ? 'except' : 'only');
        loadImage(inst.mask.paint).then((im) => {
          ctx.drawImage(im, 0, 0, c!.width, c!.height);
          redrawOverlay();
        });
      }
      setPaintFor(toolId);
    },
    [img, paintFor, recipe, redrawOverlay],
  );

  useEffect(() => {
    if (paintFor) redrawOverlay();
  }, [paintFor, redrawOverlay]);

  const commitMask = useCallback(
    (mode: 'except' | 'only') => {
      const c = maskCanvas.current;
      if (!c || !paintFor) return;
      setRecipe((r) =>
        updateToolMask(r, paintFor, {
          region: 'painted',
          paint: c.toDataURL('image/png'),
          invert: mode === 'except',
          feather: PAINT_FEATHER,
        }),
      );
    },
    [paintFor],
  );

  /** Pointer position in mask-bitmap pixels. object-fit: contain letterboxes
   *  the bitmap inside the element box; the box itself already carries the
   *  zoom/pan transform, so this mapping is honest at any zoom. */
  function maskPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const s = Math.min(r.width / el.width, r.height / el.height);
    const ox = r.left + (r.width - el.width * s) / 2;
    const oy = r.top + (r.height - el.height * s) / 2;
    return { x: (e.clientX - ox) / s, y: (e.clientY - oy) / s, s };
  }

  function stamp(x: number, y: number, rad: number) {
    const ctx = maskCanvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    const grad = ctx.createRadialGradient(x, y, rad * 0.55, x, y, rad);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  function brushDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = maskPoint(e);
    stamp(p.x, p.y, Math.max(3, brush / 2 / p.s));
    stroke.current = { x: p.x, y: p.y };
    redrawOverlay();
  }

  function brushMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!stroke.current) return;
    const p = maskPoint(e);
    const rad = Math.max(3, brush / 2 / p.s);
    const last = stroke.current;
    const steps = Math.max(1, Math.floor(Math.hypot(p.x - last.x, p.y - last.y) / (rad * 0.35)));
    for (let i = 1; i <= steps; i++) {
      stamp(last.x + ((p.x - last.x) * i) / steps, last.y + ((p.y - last.y) * i) / steps, rad);
    }
    stroke.current = { x: p.x, y: p.y };
    redrawOverlay();
  }

  function brushUp() {
    if (!stroke.current) return;
    stroke.current = null;
    commitMask(paintMode);
  }

  const clearMask = useCallback(() => {
    const c = maskCanvas.current;
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    redrawOverlay();
    if (paintFor) setRecipe((r) => updateToolMask(r, paintFor, null));
  }, [paintFor, redrawOverlay]);

  /* -------------------------------------------------------------- load */

  const load = useCallback(async (file: File) => {
    setError(null);
    setOut(null);
    setReports([]);
    setMissing([]);
    setDelta(null);
    setRecipe(emptyRecipe());
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPaintFor(null);
    maskCanvas.current = null;
    // A candidate set describes one photograph. Carrying it to the next frame
    // would outline marks that are not there.
    setMarks(null);
    setMarksKey('');
    setMarksError(null);
    setMarksReset(false);
    setHoverMark(null);
    scanAttempt.current = '';
    try {
      const full = await readFile(file);
      const dims = await downscale(full);
      setImg({ name: file.name, full, ...dims });
    } catch (e) {
      setError(`טעינת הקובץ נכשלה: ${(e as Error).message}`);
    }
  }, []);

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
        const res = await renderRecipe(
          originalSrc,
          enabled.map((i) => ({
            toolId: i.toolId,
            params: i.params,
            enabled: true,
            ...(i.mask ? { mask: i.mask } : {}),
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

  const selectedIds = useMemo(
    () => new Set((cleanupInst?.selection?.polygons ?? []).map((p) => p.id)),
    [cleanupInst],
  );

  /** Write a set of chosen candidates into the recipe. The render effect above
   *  does the rest — a chosen mark travels exactly like a slider value, which is
   *  also how it reaches the export. */
  const commitMarks = useCallback(
    (ids: Set<string>, items: SpotCandidate[]) => {
      setRecipe((r) =>
        updateToolSelection(r, CLEANUP_ID, {
          polygons: items
            .filter((i) => ids.has(i.id))
            .flatMap((i) => i.contours.map((points) => ({ id: i.id, points }))),
        }),
      );
    },
    [],
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
      const found = await detectSpots(img.full, cleanupInst?.params ?? {}, prefix);
      setMarks(found);
      setMarksKey(key);
      // A fresh scan starts from the engine's own answer: everything it accepted
      // is marked. Two reasons — the picture does not jump when this view opens
      // (marking all the accepted candidates reproduces the automatic result
      // exactly), and unmarking three is less work than marking forty.
      commitMarks(
        new Set(found.items.filter((i) => i.verdict === 'heal').map((i) => i.id)),
        found.items,
      );
    } catch (e) {
      setMarksError((e as Error).message);
    } finally {
      setMarksBusy(false);
    }
  }, [img, recipe, scanKey, cleanupInst, cleanupOrder, commitMarks]);

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

  const toggleMark = useCallback(
    (id: string) => {
      if (!marks) return;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setMarksReset(false);
      commitMarks(next, marks.items);
    },
    [marks, selectedIds, commitMarks],
  );

  const markEvery = useCallback(
    (which: 'all' | 'accepted' | 'none') => {
      if (!marks) return;
      setMarksReset(false);
      const ids = new Set(
        marks.items
          .filter((i) => which === 'all' || (which === 'accepted' && i.verdict === 'heal'))
          .map((i) => i.id),
      );
      commitMarks(ids, marks.items);
    },
    [marks, commitMarks],
  );

  /** Hand the decision back to the engine. Different from marking everything it
   *  accepted, even though today they produce the same pixels: this one keeps
   *  following the detector if a slider moves, and that one does not. */
  const backToAuto = useCallback(() => {
    setRecipe((r) => updateToolSelection(r, CLEANUP_ID, null));
  }, []);

  const shownMarks = useMemo(() => {
    const items = (marks?.items ?? []).filter(
      (i) => showRefused || i.verdict === 'heal' || selectedIds.has(i.id),
    );
    return [...items].sort((a, b) => {
      const rank = (i: SpotCandidate) => (i.verdict === 'heal' ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (b.facts.areaPx ?? 0) - (a.facts.areaPx ?? 0);
    });
  }, [marks, showRefused, selectedIds]);

  /* ------------------------------------------------------------- save */

  /* What is on screen is a PREVIEW: possibly downscaled, and always q90 with
   * 4:2:0 chroma subsampling. Handing that file over would deliver something
   * measurably worse than the edit that was made. So saving re-renders the
   * ORIGINAL frame and asks the engine for delivery settings. */
  const save = useCallback(async () => {
    if (!img) return;
    const enabled = orderedInstances(recipe).filter((i) => i.enabled);
    if (enabled.length === 0) return;
    setSaving(true);
    try {
      const res = await renderRecipe(
        img.full,
        enabled.map((i) => ({
          toolId: i.toolId,
          params: i.params,
          enabled: true,
          ...(i.mask ? { mask: i.mask } : {}),
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
  }, [img, recipe]);

  /* --------------------------------------------------------------- ui */

  if (!img) {
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

  const scaleBlocked = reports.some(isScaleBlocked);
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
            {paintFor && (
              <canvas
                ref={overlayRef}
                className="lab-img lab-over lab-paintlayer"
                width={img.pw}
                height={img.ph}
                onPointerDown={brushDown}
                onPointerMove={brushMove}
                onPointerUp={brushUp}
                onPointerCancel={brushUp}
              />
            )}
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
                  const chosen = selectedIds.has(item.id);
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
                  const cls =
                    `lab-mark ${item.verdict === 'heal' ? 'ok' : 'refused'}` +
                    `${chosen ? ' on' : ''}${hoverMark === item.id ? ' hot' : ''}`;
                  return (
                    <g key={item.id}>
                      {/* a 5px blob on a 20MP frame is sub-pixel on screen; the
                          fat transparent stroke is what makes it clickable */}
                      <path
                        className="lab-mark-hit"
                        d={d}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          toggleMark(item.id);
                        }}
                        onPointerEnter={() => setHoverMark(item.id)}
                        onPointerLeave={() => setHoverMark(null)}
                      />
                      <path className={cls} d={d} />
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

          {paintFor && (
            <div className="lab-paintbar">
              <strong>מכחול · {getTool(paintFor).label}</strong>
              <label className="lab-paint-size">
                גודל
                <input
                  type="range"
                  min={14}
                  max={240}
                  value={brush}
                  onChange={(e) => setBrush(Number(e.target.value))}
                />
              </label>
              <div className="lab-modes">
                <button className={!erase ? 'on' : ''} onClick={() => setErase(false)}>צייר</button>
                <button className={erase ? 'on' : ''} onClick={() => setErase(true)}>מחק</button>
              </div>
              <div className="lab-modes">
                <button
                  className={paintMode === 'except' ? 'on' : ''}
                  onClick={() => { setPaintMode('except'); commitMask('except'); }}
                  title="האזור שצויר מוגן — הכלי לא נוגע בו"
                >
                  הסר מהציור
                </button>
                <button
                  className={paintMode === 'only' ? 'on' : ''}
                  onClick={() => { setPaintMode('only'); commitMask('only'); }}
                  title="הכלי פועל רק בתוך האזור שצויר"
                >
                  רק בציור
                </button>
              </div>
              <button onClick={clearMask}>נקה</button>
              <button onClick={() => setPaintFor(null)}>סיום</button>
            </div>
          )}

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
                    {marks.items.length} מוקדים
                    {marks.faces > 1 && <> · {marks.faces} פנים</>}
                  </strong>
                  <span className="lab-mark-tally">
                    <i className="dot on" />
                    {selectedIds.size} מסומנים לתיקון
                    <i className="dot refused" />
                    {marks.items.filter((i) => i.verdict !== 'heal').length} נדחו ע״י המנוע
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
            <button className="btn btn-ghost" onClick={save} disabled={!out || saving}
              title={`שומר ברזולוציה מלאה ${img.w}×${img.h}, איכות מלאה — לא את התצוגה`}>
              {saving ? 'שומר…' : `שמור ${img.w}×${img.h}`}
            </button>
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
                            ? 'ידני — לא נבחר כלום'
                            : `ידני — ${new Set(inst.selection.polygons.map((p) => p.id)).size} מוקדים`}
                        </span>
                      )}
                    </div>
                  )}

                  {!NO_BRUSH.has(def.id) && (
                    <div className="lab-mask-row">
                      <button
                        className={`btn btn-ghost lab-brush-btn ${paintFor === def.id ? 'on' : ''}`}
                        disabled={!inst.enabled}
                        onClick={() => enterPaint(def.id)}
                      >
                        {paintFor === def.id ? 'מצייר… (סיום)' : 'מכחול ידני'}
                      </button>
                      {inst.mask?.region === 'painted' && (
                        <span className="lab-mask-note">
                          {inst.mask.invert ? 'מוסר באזור שצויר' : 'פועל רק באזור שצויר'}
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
                  <button onClick={() => markEvery('accepted')}>רק מה שאושר</button>
                  <button onClick={() => markEvery('all')}>סמן הכל</button>
                  <button onClick={() => markEvery('none')}>נקה הכל</button>
                  <button
                    className={cleanupInst?.selection ? '' : 'on'}
                    onClick={backToAuto}
                    title="מבטל את הסימון וחוזר להחלטת המנוע — שממשיכה להתעדכן כשמזיזים סליידר"
                  >
                    אוטומטי
                  </button>
                </div>
              )}

              {marksReset && (
                <div className="lab-hint">
                  סריקה חדשה — הסימון אופס לברירת המחדל (כל מה שהמנוע אישר).
                </div>
              )}

              {marks && marks.items.length === 0 && !marksBusy && (
                <div className="lab-log-idle">
                  הגלאי לא מצא כלום על הפנים האלה בעוצמה הזאת.
                  {marks.notes.faceTooSmall
                    ? ' הפנים קטנות מהמינימום שהכלי דורש.'
                    : ' העלה את "ניקוי נקודתי" וסרוק מחדש כדי לראות מועמדים חלשים יותר.'}
                </div>
              )}

              {shownMarks.map((item) => {
                const chosen = selectedIds.has(item.id);
                return (
                  <label
                    key={item.id}
                    className={`lab-mark-row ${item.verdict === 'heal' ? 'ok' : 'refused'}${
                      chosen ? ' on' : ''
                    }`}
                    onMouseEnter={() => setHoverMark(item.id)}
                    onMouseLeave={() => setHoverMark(null)}
                  >
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={() => toggleMark(item.id)}
                    />
                    <span className="lab-mark-kind">{markLabel(item.kind)}</span>
                    <span className="lab-mark-why">
                      {markReason(item.verdict, item.facts)}
                    </span>
                    {item.verdict !== 'heal' && chosen && (
                      <span className="lab-mark-forced">נכפה</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {scaleBlocked && (
            <div className="lab-hint">
              הפנים בתמונה הזאת קטנות מהמינימום שהמנוע דורש (120px), אז הכלים דילגו.
              זו התמונה, לא הגדרה — כלי הפנים לא יעבדו עליה.
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
function Histogram({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!src) return;
    let alive = true;
    loadImage(src).then((im) => {
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const s = Math.min(1, 480 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.naturalWidth * s));
      c.height = Math.max(1, Math.round(im.naturalHeight * s));
      const cx = c.getContext('2d', { willReadFrequently: true })!;
      cx.drawImage(im, 0, 0, c.width, c.height);
      const px = cx.getImageData(0, 0, c.width, c.height).data;

      const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
      for (let i = 0; i < px.length; i += 4) {
        hist[0][px[i]]++;
        hist[1][px[i + 1]]++;
        hist[2][px[i + 2]]++;
        hist[3][Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])]++;
      }
      let peak = 0;
      for (const h of hist) for (let v = 0; v < 256; v++) if (h[v] > peak) peak = h[v];
      if (peak === 0) return;

      const W = canvas.width;
      const H = canvas.height;
      const g = canvas.getContext('2d')!;
      g.clearRect(0, 0, W, H);
      const y = (n: number) => H - Math.sqrt(n / peak) * (H - 2);

      // luminance: filled
      g.beginPath();
      g.moveTo(0, H);
      for (let v = 0; v < 256; v++) g.lineTo((v / 255) * W, y(hist[3][v]));
      g.lineTo(W, H);
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.30)';
      g.fill();

      // channels: thin lines
      const colors = ['rgba(255,90,80,0.9)', 'rgba(90,220,110,0.9)', 'rgba(90,150,255,0.9)'];
      for (let ch = 0; ch < 3; ch++) {
        g.beginPath();
        for (let v = 0; v < 256; v++) {
          const X = (v / 255) * W;
          const Y = y(hist[ch][v]);
          if (v === 0) g.moveTo(X, Y);
          else g.lineTo(X, Y);
        }
        g.strokeStyle = colors[ch];
        g.lineWidth = 1;
        g.stroke();
      }
    });
    return () => {
      alive = false;
    };
  }, [src]);

  return <canvas ref={ref} className="lab-hist" width={232} height={74} />;
}

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
