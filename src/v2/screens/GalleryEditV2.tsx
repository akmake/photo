import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../studio/store';
import {
  batchRecipe,
  colorStep,
  effectiveRecipe,
  framesInBatch,
  frameSteps,
  removeFrameStep,
  setFrameStep,
  setStep,
  unassignedFrames,
  useBatches,
  useProjectFiles,
  useRecipe,
} from '../../studio/store';
import { EDIT_WIDTH, learnColorModel, prepareFrames, renderRecipeAtPath, Superseded, thumbUrl } from '../../api';
import type { LearnColorResponse } from '../../api';
import type { LearnedColorModel, ManualStroke, ToolInstance, ToolMask } from '../../types';
import { defaultParams, getTool, isRawFile, isToolAtDefault } from '../../toolRegistry';
import ManualBrush, { DEFAULT_R, MAX_R, MIN_R } from './ManualBrush';
import ToolsPanelV2 from './ToolsPanelV2';
import ColorMatchPanel from './ColorMatchPanel';
import { useSetPreview } from '../../studio/preview';
import BeforeAfter from '../../studio/screens/BeforeAfter';
import {
  TzIconSparkle,
  TzIconCheckCircle,
  TzIconUpload,
  TzIconLayers,
  TzIconGallery,
  TzIconSliders,
  TzIconRefresh,
} from '../TzIcons';
import './stages-v2.css';
import './gallery-edit-v2.css';

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
    fr.readAsDataURL(file);
  });
}

export default function GalleryEditV2({
  project,
  onNext,
  onBack,
}: {
  project: Project;
  onNext?: () => void;
  onBack?: () => void;
}) {
  const batches = useBatches(project.id);
  const { frames, ready } = useProjectFiles(project.id);
  const recipe = useRecipe(project.id);
  const preview = useSetPreview(project.id);

  // Active batch selection
  const [at, setAt] = useState<string | null>(null);
  const [choseBatch, setChoseBatch] = useState(false);

  // Active frame index within current batch slides
  const [activeSlideIndex, setActiveSlideIndex] = useState<number>(0);

  // Active tool category tab: 'primary' | 'colormatch'
  const [activeTab, setActiveTab] = useState<'primary' | 'colormatch'>('primary');

  /* WHERE A TOOL STARTS when it is switched on.
   *
   * The catalogue default of a slider is where it sits when it does NOTHING —
   * zero, usually — which is the right answer for a recipe and the wrong one
   * for a switch: a tool turned on that changes nothing reads as broken. These
   * are the values the screen has always used for that moment, kept when the
   * panel stopped being built out of categories.
   *
   * (Tonal contrast is the reason to be careful here: it used to be switched
   * on with a value named "contrast", which the engine does not read, so the
   * tool came on and the picture never changed.) */
  const ON_DEFAULTS: Record<string, Record<string, number>> = useMemo(
    () => ({
      'skin-retouch': { blemishes: 100, evenness: 70, texture: 0, glow: 0, keepMoles: 1 },
      'skin-cleanup': { redness: 90 },
      'eye-sparkle': { strength: 50 },
      glow: { amount: 35, people: 25, skin: 20, fabric: 15, radius: 40 },
      contour: { cheekbones: 25, forehead: 15, jaw: 15, undereye: -10, sculpt: 20 },
      'tone-color': { exposure: 0, contrast: 15, highlights: -10, shadows: 15, temperature: 0, saturation: 5 },
      'tonal-contrast': { amount: 40 },
      sharpen: { amount: 30, radius: 20, masking: 25 },
    }),
    [],
  );

  // Canvas comparison state
  const [showOriginal, setShowOriginal] = useState(false);
  const [renderedSrc, setRenderedSrc] = useState<string | null>(null);
  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [busyRender, setBusyRender] = useState(false);

  /* THE MANUAL BRUSH. The picture element is the brush's coordinate system, so
   * the overlay needs a handle on it (see ManualBrush.tsx). `pendingStrokes`
   * are the ones painted but not yet answered for by the engine: they are shown
   * in red so a stroke never looks lost during the second it takes to rebuild,
   * and they are dropped the moment a render finishes. */
  const canvasImgRef = useRef<HTMLImageElement | null>(null);
  const [brushOn, setBrushOn] = useState(false);
  const [brushErase, setBrushErase] = useState(false);
  /* The tool whose REGION is being painted, if any. Null means the brush on
   * the picture — when there is one — is the cleaning brush. */
  const [maskPaintTool, setMaskPaintTool] = useState<string | null>(null);
  const [brushR, setBrushR] = useState(DEFAULT_R);
  const [pendingStrokes, setPendingStrokes] = useState<ManualStroke[]>([]);

  const [sheetModel, setSheetModel] = useState<LearnedColorModel | null>(null);

  // Initialize batch to first non-empty batch or all photos
  useEffect(() => {
    if (!choseBatch && ready) {
      if (batches.length > 0) {
        const nonEmpty = batches.find((b) => framesInBatch(project.id, b.id).length > 0);
        if (nonEmpty) {
          setAt(nonEmpty.id);
        } else if (unassignedFrames(project.id).length > 0) {
          setAt(null);
        } else {
          setAt('__all__');
        }
      } else {
        setAt('__all__');
      }
      setChoseBatch(true);
    }
  }, [batches, choseBatch, ready, project.id]);

  // Slides for current batch
  const currentBatch = batches.find((b) => b.id === at) ?? null;
  const slideFrames = useMemo(() => {
    if (at === '__all__') return frames;
    if (at === null) return unassignedFrames(project.id);
    if (at) {
      const inB = framesInBatch(project.id, at);
      if (inB.length > 0) return inB;
    }
    return frames;
  }, [at, project.id, frames]);

  /* ---------------------------------------------- WHERE "ON EVERYTHING" LANDS
   *
   * A BUG THIS SCREEN HAD, found while rebuilding the colour panel. The batch
   * tabs use two ids that the store has never heard of: `'__all__'` for the
   * whole project and `null` for the frames in no batch. Both were handed
   * straight to setStep() as if they were batch ids — so "apply to everything"
   * wrote a layer into perBatch['__all__'], which effectiveRecipe() never
   * reads, because it looks up the batch a FRAME belongs to and no frame
   * belongs to that one. The button ran, said nothing, and changed no
   * photograph. With the `null` tab it returned even earlier and did nothing
   * at all.
   *
   * The whole project is not a batch — it is the BASE layer, which every frame
   * reads under its batch. That is what `base` means here.
   *
   * The unassigned tab has no honest answer while batches also exist: base
   * would reach the batched frames too, and a per-frame copy of a colour model
   * on a wedding is megabytes of localStorage. When those frames ARE the whole
   * project (no batches made yet — the common case) it is the same set as
   * base, and base is exactly right. Otherwise the screen says so instead of
   * pretending.
   */
  const applyScope = useMemo((): {
    batchId: string | null;
    label: string;
    count: number;
    blocked: string | null;
  } => {
    const n = slideFrames.length;
    if (at === '__all__') {
      return { batchId: null, label: 'על כל התמונות בפרויקט', count: n, blocked: null };
    }
    if (at === null) {
      const all = frames.length === n;
      return {
        batchId: null,
        label: 'על כל התמונות בפרויקט',
        count: n,
        blocked: all
          ? null
          : 'התמונות שאינן במקבץ אינן שכבה בפני עצמה, אז אי אפשר לקבוע עליהן מראה בלי לגעת בשאר. בחר מקבץ, או "כל התמונות".',
      };
    }
    return {
      batchId: at,
      label: `על המקבץ ${currentBatch?.name ?? ''}`.trim(),
      count: n,
      blocked: null,
    };
  }, [at, slideFrames.length, frames.length, currentBatch]);

  // Active frame
  const currentFrame = slideFrames[activeSlideIndex] ?? slideFrames[0] ?? null;

  // Clamp index if slides change
  useEffect(() => {
    if (activeSlideIndex >= slideFrames.length && slideFrames.length > 0) {
      setActiveSlideIndex(0);
    }
  }, [slideFrames.length, activeSlideIndex]);

  // Current effective tools for the active frame
  const frameEffectiveTools = useMemo(() => {
    if (!currentFrame) return [];
    return effectiveRecipe(project.id, currentFrame.name);
  }, [project.id, currentFrame, recipe]);

  /* RETIRED TOOLS RIDE WITH THE ONE THAT REPLACED THEM.
   *
   * A recipe saved before `skin-retouch` existed still carries `face-retouch`
   * or `skin`, and they still render. Switching the retouch off has to switch
   * those off too, or the skin keeps being smoothed by a tool the panel does
   * not show. They are never switched back ON from here: that would put two
   * retouches on top of each other. */
  const RETIRED_WITH: Record<string, string[]> = { 'skin-retouch': ['face-retouch', 'skin'] };

  // Update a slider value for the active frame
  const handleParamChange = useCallback(
    (toolId: string, paramId: string, value: number) => {
      if (!currentFrame) return;
      const existing = frameEffectiveTools.find((t) => t.toolId === toolId);
      const updatedParams = { ...(existing?.params ?? {}), [paramId]: value };
      const nextStep: ToolInstance = {
        toolId,
        enabled: true,
        params: updatedParams,
        ...(existing?.model ? { model: existing.model } : {}),
        // Moving a slider must not un-mask the tool. Every piece of per-photo
        // state the step carries is carried through here for that reason: it
        // is written whole, so anything not named is dropped.
        ...(existing?.mask ? { mask: existing.mask } : {}),
        ...(existing?.selection ? { selection: existing.selection } : {}),
        ...(existing?.strokes ? { strokes: existing.strokes } : {}),
      };
      setFrameStep(project.id, currentFrame.name, nextStep);
    },
    [currentFrame, frameEffectiveTools, project.id],
  );

  /* A TOOL'S OWN SWITCH. Turning one off must leave its values alone: the
   * switch says "not on this photograph", not "forget what I set". */
  const handleToolEnabled = useCallback(
    (toolId: string, enabled: boolean) => {
      if (!currentFrame) return;
      const existing = frameEffectiveTools.find((t) => t.toolId === toolId);
      const base = existing?.params ?? defaultParams(getTool(toolId));
      // Untouched means every slider still sits where the catalogue put it, so
      // this is the FIRST time the tool is switched on and it gets a starting
      // point. A tool he has already set keeps exactly what he set.
      const untouched = !existing || isToolAtDefault(existing);
      setFrameStep(project.id, currentFrame.name, {
        toolId,
        enabled,
        params: enabled && untouched ? { ...base, ...(ON_DEFAULTS[toolId] ?? {}) } : base,
        ...(existing?.model ? { model: existing.model } : {}),
        ...(existing?.mask ? { mask: existing.mask } : {}),
        ...(existing?.selection ? { selection: existing.selection } : {}),
        ...(existing?.strokes ? { strokes: existing.strokes } : {}),
      });
      if (!enabled) {
        for (const old of RETIRED_WITH[toolId] ?? []) {
          const inst = frameEffectiveTools.find((t) => t.toolId === old);
          if (inst?.enabled) {
            setFrameStep(project.id, currentFrame.name, { ...inst, enabled: false });
          }
        }
      }
    },
    [currentFrame, frameEffectiveTools, project.id, ON_DEFAULTS],
  );

  /* BACK TO THE SET. A frame-level exception is REMOVED rather than set to the
   * catalogue's defaults — otherwise "reset" would silently detach the frame
   * from the batch it belongs to, and a later change to the batch would stop
   * reaching it. */
  const handleToolReset = useCallback(
    (toolId: string) => {
      if (!currentFrame) return;
      removeFrameStep(project.id, currentFrame.name, toolId);
    },
    [currentFrame, project.id],
  );

  /* ------------------------------------------------------ where a tool lands
   *
   * The mask is part of the STEP, not a mode of the screen: it is written on
   * the frame's own entry, so switching photographs shows that photograph's
   * answer, and a named region (the clothes, the background) rides along into
   * the batch while the hand-painted one does not — studio/store.ts::shareable
   * is the single door that enforces it.
   */
  const handleMask = useCallback(
    (toolId: string, mask: ToolMask | null) => {
      if (!currentFrame) return;
      const existing = frameEffectiveTools.find((t) => t.toolId === toolId);
      const base: ToolInstance = {
        toolId,
        // Masking a tool is asking it to act HERE, so it comes on. Choosing
        // where something lands and then finding it switched off would be the
        // screen arguing with him.
        enabled: true,
        params: existing?.params ?? { ...defaultParams(getTool(toolId)), ...(ON_DEFAULTS[toolId] ?? {}) },
        ...(existing?.model ? { model: existing.model } : {}),
        ...(existing?.selection ? { selection: existing.selection } : {}),
        ...(existing?.strokes ? { strokes: existing.strokes } : {}),
      };
      // Leaving the painted region drops the brush with it — the strokes stay
      // on the step until he clears them, so coming back to "צבע ידנית" finds
      // the work he already did.
      if (!mask && maskPaintTool === toolId) setMaskPaintTool(null);
      setFrameStep(project.id, currentFrame.name, mask ? { ...base, mask } : base);
    },
    [currentFrame, frameEffectiveTools, project.id, ON_DEFAULTS, maskPaintTool],
  );

  /** The strokes of one tool's painted region. */
  const maskStrokesOf = useCallback(
    (toolId: string): ManualStroke[] =>
      frameEffectiveTools.find((t) => t.toolId === toolId)?.mask?.strokes ?? [],
    [frameEffectiveTools],
  );

  /** How much is painted per tool, for the number on the chip. */
  const maskStrokeCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of frameEffectiveTools) {
      const n = t.mask?.strokes?.length ?? 0;
      if (n) out[t.toolId] = n;
    }
    return out;
  }, [frameEffectiveTools]);

  const writeMaskStrokes = useCallback(
    (toolId: string, next: ManualStroke[]) => {
      if (!currentFrame) return;
      const existing = frameEffectiveTools.find((t) => t.toolId === toolId);
      if (!existing?.mask) return;
      setFrameStep(project.id, currentFrame.name, {
        ...existing,
        mask: { ...existing.mask, region: 'painted', strokes: next },
      });
    },
    [currentFrame, frameEffectiveTools, project.id],
  );

  /* ONE BRUSH ON THE PICTURE AT A TIME. The cleaning brush removes things and
   * the mask brush chooses where a tool lands; they take the same pointer over
   * the same photograph, so entering one leaves the other. */
  const handlePaintMask = useCallback(
    (toolId: string) => {
      setMaskPaintTool((cur) => (cur === toolId ? null : toolId));
      setBrushOn(false);
    },
    [],
  );

  /* WHAT HE PAINTED ON THIS PHOTOGRAPH. Strokes live on the frame's own step —
   * never on a batch or the set (studio/store.ts::shareable drops them at that
   * door), because a stroke is a place on ONE face in ONE picture. */
  const manualStrokes = useMemo<ManualStroke[]>(
    () => frameEffectiveTools.find((t) => t.toolId === 'manual-clean')?.strokes ?? [],
    [frameEffectiveTools],
  );

  const writeStrokes = useCallback(
    (next: ManualStroke[]) => {
      if (!currentFrame) return;
      if (next.length === 0) {
        // No strokes is not "a manual step that does nothing" — it is no step.
        // Leaving an empty one behind would mark the frame as differing from
        // its batch for the rest of its life.
        removeFrameStep(project.id, currentFrame.name, 'manual-clean');
        return;
      }
      setFrameStep(project.id, currentFrame.name, {
        toolId: 'manual-clean', enabled: true, params: {}, strokes: next,
      });
    },
    [currentFrame, project.id],
  );

  const handleStroke = useCallback(
    (s: ManualStroke) => {
      setPendingStrokes((p) => [...p, s]);
      writeStrokes([...manualStrokes, s]);
    },
    [manualStrokes, writeStrokes],
  );

  /* Erasing removes the STROKE under the cursor, not pixels from a mask: what
   * he painted is the record, so taking one back has to leave the others
   * exactly as they were. Topmost first — the last thing painted is the thing
   * he means. */
  const handleErase = useCallback(
    (x: number, y: number) => {
      const img = canvasImgRef.current;
      const aspect = img && img.clientWidth ? img.clientHeight / img.clientWidth : 1;
      const hit = (s: ManualStroke) =>
        s.points.some(([px, py]) => Math.hypot(px - x, (py - y) * aspect) <= s.r * 1.1);
      for (let i = manualStrokes.length - 1; i >= 0; i--) {
        if (hit(manualStrokes[i])) {
          writeStrokes(manualStrokes.filter((_, j) => j !== i));
          setPendingStrokes((p) => p.filter((s) => s.id !== manualStrokes[i].id));
          return;
        }
      }
    },
    [manualStrokes, writeStrokes],
  );

  /* The mask brush's own stroke and erase. Same gestures as the cleaning
   * brush, a different book they are written into. Nothing is "pending" here:
   * a cleaning stroke is shown in red until the engine has answered and the
   * mark is gone, while a mask stroke IS the answer — it stays on screen as
   * long as it is part of the region. */
  const handleMaskStroke = useCallback(
    (st: ManualStroke) => {
      if (!maskPaintTool) return;
      writeMaskStrokes(maskPaintTool, [...maskStrokesOf(maskPaintTool), st]);
    },
    [maskPaintTool, maskStrokesOf, writeMaskStrokes],
  );

  const handleMaskErase = useCallback(
    (x: number, y: number) => {
      if (!maskPaintTool) return;
      const list = maskStrokesOf(maskPaintTool);
      const img = canvasImgRef.current;
      const aspect = img && img.clientWidth ? img.clientHeight / img.clientWidth : 1;
      const hit = (st: ManualStroke) =>
        st.points.some(([px, py]) => Math.hypot(px - x, (py - y) * aspect) <= st.r * 1.1);
      for (let i = list.length - 1; i >= 0; i--) {
        if (hit(list[i])) {
          writeMaskStrokes(maskPaintTool, list.filter((_, j) => j !== i));
          return;
        }
      }
    },
    [maskPaintTool, maskStrokesOf, writeMaskStrokes],
  );

  const undoStroke = useCallback(() => {
    if (!manualStrokes.length) return;
    writeStrokes(manualStrokes.slice(0, -1));
    setPendingStrokes((p) => p.slice(0, -1));
  }, [manualStrokes, writeStrokes]);

  /* THE ORIGINAL, once per frame. It used to be rendered again beside every
   * slider move — the same pixels, on the same single engine worker, doubling
   * the wait for the picture that had actually changed. */
  const currentPath = currentFrame?.path ?? null;
  // A stroke waiting to be rebuilt belongs to the frame it was painted on.
  useEffect(() => setPendingStrokes([]), [currentPath]);
  useEffect(() => {
    if (!currentPath) {
      setRawSrc(null);
      return;
    }
    let alive = true;
    setRawSrc(null);
    renderRecipeAtPath(currentPath, [], EDIT_WIDTH)
      .then((r) => alive && setRawSrc(r.image))
      .catch(() => alive && setRawSrc(thumbUrl(currentPath, 1200)));
    return () => {
      alive = false;
    };
  }, [currentPath]);

  /* THE EDIT, in the screen's lane. Every render request supersedes the one
   * before it: the engine refuses a stale request it has not started and
   * stops one it has at the next tool, so a dragged slider costs one render —
   * the last value — instead of queueing one per value. Only the newest answer
   * is ever shown.
   *
   * The dependencies are the frame and the recipe, and nothing else. This used
   * to depend on the whole preview object, which is a new object on every
   * render of this screen — so an unrelated re-render (the readiness poll
   * ticks every 1.5s) sent the engine another full render of an unchanged
   * frame. */
  const renderTimeout = useRef<number | null>(null);
  const renderSeq = useRef(0);
  const warm = preview.warm;
  const currentName = currentFrame?.name ?? null;
  useEffect(() => {
    if (!currentPath || !currentName) {
      setRenderedSrc(null);
      return;
    }

    // Warm preview in background
    warm([currentPath]);

    setBusyRender(true);
    if (renderTimeout.current) clearTimeout(renderTimeout.current);
    const mine = ++renderSeq.current;

    renderTimeout.current = window.setTimeout(async () => {
      try {
        const tools = effectiveRecipe(project.id, currentName).filter((t) => t.enabled);
        const res = await renderRecipeAtPath(currentPath, tools, EDIT_WIDTH, false, 'edit-v2');
        if (mine === renderSeq.current) {
          setRenderedSrc(res.image);
          // The picture now HAS the strokes in it. Keeping the red overlay up
          // would draw them twice — once rebuilt, once as a promise.
          setPendingStrokes([]);
        }
      } catch (e) {
        // Replaced by a newer render: that one will answer.
        if (e instanceof Superseded || mine !== renderSeq.current) return;
        setRenderedSrc(thumbUrl(currentPath, 1200));
      } finally {
        if (mine === renderSeq.current) setBusyRender(false);
      }
    }, 80);

    return () => {
      if (renderTimeout.current) clearTimeout(renderTimeout.current);
    };
  }, [currentPath, currentName, recipe, project.id, warm]);

  /* GET THE NEIGHBOURHOOD READY. Every time the photographer lands on a frame:
   *   - the next two and the previous one are RENDERED by the engine while it
   *     is idle, so stepping to them shows a finished frame, not a retouch in
   *     progress;
   *   - the whole batch, nearest first, goes to the background preparer, which
   *     draws its thumbnails and computes the masks the tools read — the ~15s
   *     "where is the subject" question a frame used to ask when it opened.
   * Debounced: arrowing through ten frames sends one request, for where it
   * stopped. */
  useEffect(() => {
    if (!currentPath || !slideFrames.length) return;
    const at = Math.max(0, slideFrames.findIndex((f) => f.path === currentPath));
    const timer = window.setTimeout(() => {
      const order: typeof slideFrames = [];
      for (let d = 0; order.length < slideFrames.length; d++) {
        if (at + d < slideFrames.length) order.push(slideFrames[at + d]);
        if (d > 0 && at - d >= 0) order.push(slideFrames[at - d]);
        if (at + d >= slideFrames.length && at - d < 0) break;
      }
      const recipeOf = (name: string) =>
        effectiveRecipe(project.id, name).filter((t) => t.enabled);
      const ahead = [slideFrames[at + 1], slideFrames[at - 1], slideFrames[at + 2]]
        .filter((f): f is (typeof slideFrames)[number] => Boolean(f))
        .map((f) => ({ path: f.path, recipe: recipeOf(f.name) }));
      prepareFrames({
        paths: order.map((f) => f.path),
        w: EDIT_WIDTH,
        thumbs: [320],
        recipe: recipeOf(slideFrames[at].name),
        ahead,
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [currentPath, slideFrames, recipe, project.id]);

  // Keyboard navigation for slides (ArrowUp / ArrowDown) and compare (Space)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setShowOriginal(true);
      }
      // The brush's own keys. Undo is bound whether or not the brush is open:
      // a stroke he regrets after switching tools is still a stroke he painted.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoStroke();
        return;
      }
      if (!brushOn) return;
      if (e.key === 'Escape') setBrushOn(false);
      if (e.key === '[') setBrushR((r) => Math.max(MIN_R, r / 1.15));
      if (e.key === ']') setBrushR((r) => Math.min(MAX_R, r * 1.15));
      if (e.key.toLowerCase() === 'e') setBrushErase((v) => !v);
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveSlideIndex((idx) => Math.min(slideFrames.length - 1, idx + 1));
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveSlideIndex((idx) => Math.max(0, idx - 1));
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        setShowOriginal(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [slideFrames.length, brushOn, undoStroke]);

  /* Sync current photo's edits to the entire batch.
   *
   * A HAND-PAINTED REGION DOES NOT GO. The shared layer strips what he drew
   * (store.ts::shareable), so sending such a step on would put a `painted`
   * mask with nothing in it onto every frame in the batch — a tool that reads
   * as applied on screen and touches no pixel on any of them. The step is held
   * back instead, and the screen SAYS which ones stayed behind: a silent
   * no-op is the most expensive bug there is (CLAUDE.md section 6).
   *
   * A named region rides along untouched. That is the whole point of it —
   * "the 3D on the clothes" means the clothes in every photograph. */
  const [heldBack, setHeldBack] = useState<string[]>([]);
  const handleSyncToBatch = useCallback(() => {
    if (!currentFrame || applyScope.blocked) return;
    const tools = frameSteps(project.id, currentFrame.name);
    if (!tools.length) return;

    const held: string[] = [];
    for (const tool of tools) {
      if (tool.mask?.region === 'painted') {
        held.push(getTool(tool.toolId).label);
        continue;
      }
      setStep(project.id, tool, applyScope.batchId);
    }
    setHeldBack(held);
    // Warm all frames in the batch
    preview.warm(slideFrames.map((f) => f.path));
  }, [currentFrame, applyScope, project.id, slideFrames, preview]);

  /* The list belongs to the photograph it was computed on. */
  useEffect(() => { setHeldBack([]); }, [currentName]);

  // Reset current frame back to batch defaults
  const handleResetFrame = useCallback(() => {
    if (!currentFrame) return;
    const tools = frameSteps(project.id, currentFrame.name);
    for (const tool of tools) {
      removeFrameStep(project.id, currentFrame.name, tool.toolId);
    }
  }, [currentFrame, project.id]);

  // ColorMatch learn
  /* PUTTING A LEARNED LOOK ON THE SET. Its own step now, and its own button:
   * learning used to apply itself the moment it finished, which spent a whole
   * batch on a colour nobody had looked at yet. */
  const applyColorModel = useCallback(
    (model: LearnedColorModel) => {
      setStep(
        project.id,
        { toolId: 'pixel-color', params: {}, enabled: true, model },
        applyScope.batchId,
      );
      preview.warm(slideFrames.map((f) => f.path));
    },
    [project.id, applyScope.batchId, preview, slideFrames],
  );

  const hasCustomEdits = Boolean(currentFrame && frameSteps(project.id, currentFrame.name).length > 0);
  const displayImage = showOriginal ? (rawSrc || thumbUrl(currentFrame?.path ?? '', 1200)) : (renderedSrc || thumbUrl(currentFrame?.path ?? '', 1200));

  return (
    <div className="tz-ge-studio-root">
      {/* 1. TOP BAR: BATCH TABS & ACTIONS */}
      <header className="tz-ge-top-bar">
        <div className="tz-ge-batch-tabs">
          <span style={{ fontSize: 13, fontWeight: 700, color: '#18181b', marginLeft: 6 }}>
            מקבץ עבודה:
          </span>

          {batches.length > 0 && (
            <button
              type="button"
              className={`tz-ge-batch-tab ${at === '__all__' ? 'active' : ''}`}
              onClick={() => {
                setAt('__all__');
                setActiveSlideIndex(0);
              }}
            >
              <span>כל התמונות</span>
              <span className="tz-ge-batch-pill-badge">{frames.length}</span>
            </button>
          )}

          {batches.map((b) => {
            const count = framesInBatch(project.id, b.id).length;
            const hasGrade = Boolean(colorStep(project.id, b.id));
            return (
              <button
                key={b.id}
                type="button"
                className={`tz-ge-batch-tab ${at === b.id ? 'active' : ''}`}
                onClick={() => {
                  setAt(b.id);
                  setActiveSlideIndex(0);
                }}
              >
                <span>{b.name}</span>
                <span className="tz-ge-batch-pill-badge">{count}</span>
                {hasGrade && <span style={{ color: '#059669', fontSize: 11 }}>✓</span>}
              </button>
            );
          })}

          {unassignedFrames(project.id).length > 0 && (
            <button
              type="button"
              className={`tz-ge-batch-tab ${at === null ? 'active' : ''}`}
              onClick={() => {
                setAt(null);
                setActiveSlideIndex(0);
              }}
            >
              <span>ללא מקבץ</span>
              <span className="tz-ge-batch-pill-badge">{unassignedFrames(project.id).length}</span>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {onBack && (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              onClick={onBack}
            >
              ← שלב קודם
            </button>
          )}
          {onNext && (
            <button
              type="button"
              className="tz-btn-projects-primary"
              style={{ padding: '7px 16px', fontSize: 13 }}
              onClick={onNext}
            >
              המשך לעיצוב אלבום ←
            </button>
          )}
        </div>
      </header>

      {/* 2. 3-COLUMN STUDIO WORKSPACE: Slide Deck (Right) | Canvas (Center) | Tools (Left) */}
      <div className="tz-ge-studio-workspace">
        {/* RIGHT COLUMN: POWERPOINT-STYLE SLIDE DECK */}
        <aside className="tz-ge-slide-deck">
          <div className="tz-ge-deck-header">
            <span>שקופיות ({slideFrames.length})</span>
            <span style={{ fontSize: 11.5, color: '#71717a' }}>בחר לעריכה</span>
          </div>

          <div className="tz-ge-deck-scroll">
            {slideFrames.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>
                אין תמונות במקבץ זה
              </div>
            ) : (
              slideFrames.map((f, idx) => {
                const isActive = idx === activeSlideIndex;
                const isCustomized = frameSteps(project.id, f.name).length > 0;
                return (
                  <div
                    key={f.path}
                    className={`tz-ge-slide-item ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveSlideIndex(idx)}
                  >
                    {/* The photograph, at its own shape and nothing else. A file
                      * name is not what a photographer recognises a frame by —
                      * it stays on hover, where it costs no room. */}
                    <img
                      className="tz-ge-slide-thumb"
                      src={thumbUrl(f.path, 320)}
                      alt={f.name}
                      title={f.name}
                      loading="lazy"
                    />
                    <span className="tz-ge-slide-idx">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    {isCustomized && (
                      <span className="tz-ge-slide-badge">מותאם</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* CENTER COLUMN: ACTIVE PHOTO CANVAS */}
        <main className="tz-ge-canvas-stage">
          {/* Top Canvas Bar */}
          <div className="tz-ge-canvas-toolbar">
            <div className="tz-ge-canvas-nav">
              <button
                type="button"
                className="tz-ge-canvas-nav-btn"
                disabled={activeSlideIndex <= 0}
                onClick={() => setActiveSlideIndex((i) => Math.max(0, i - 1))}
                title="שקופית קודמת (חץ למעלה)"
              >
                ›
              </button>
              <button
                type="button"
                className="tz-ge-canvas-nav-btn"
                disabled={activeSlideIndex >= slideFrames.length - 1}
                onClick={() => setActiveSlideIndex((i) => Math.min(slideFrames.length - 1, i + 1))}
                title="שקופית הבאה (חץ למטה)"
              >
                ‹
              </button>
              <span style={{ fontWeight: 600, color: '#e4e4e7', fontFamily: 'monospace' }}>
                {activeSlideIndex + 1} / {slideFrames.length}
              </span>
              <span style={{ color: '#71717a', fontSize: 11, marginRight: 8 }}>
                {currentFrame ? baseName(currentFrame.path) : ''}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* THE BRUSH. Off by default: it takes the mouse over the
                  picture, and a screen where clicking the photograph edits it
                  without being asked is a screen that surprises people. */}
              <button
                type="button"
                className={`tz-ge-brush-btn ${brushOn ? 'active' : ''}`}
                onClick={() => {
                  setBrushOn((v) => !v);
                  setMaskPaintTool(null);
                }}
                title="צייר על מה שצריך להיעלם — לכלוך, ריר, כתם (Esc ליציאה)"
              >
                <TzIconSparkle size={14} />
                <span>ניקוי ידני</span>
                {manualStrokes.length > 0 && (
                  <span className="tz-ge-brush-count">{manualStrokes.length}</span>
                )}
              </button>
              {brushOn && (
                <div className="tz-ge-brush-bar">
                  <span className="tz-ge-brush-hint">גודל</span>
                  <input
                    type="range"
                    min={MIN_R * 1000}
                    max={MAX_R * 1000}
                    step={0.5}
                    value={brushR * 1000}
                    onChange={(e) => setBrushR(Number(e.target.value) / 1000)}
                    title="גם גלגלת העכבר על התמונה"
                  />
                  <button
                    type="button"
                    className={`tz-ge-brush-mini ${brushErase ? 'active' : ''}`}
                    onClick={() => setBrushErase((v) => !v)}
                    title="מחיקת סימון שצוייר (E)"
                  >
                    מחק סימון
                  </button>
                  <button
                    type="button"
                    className="tz-ge-brush-mini"
                    onClick={undoStroke}
                    disabled={manualStrokes.length === 0}
                    title="בטל את המשיכה האחרונה (Ctrl+Z)"
                  >
                    בטל
                  </button>
                  <button
                    type="button"
                    className="tz-ge-brush-mini"
                    onClick={() => { writeStrokes([]); setPendingStrokes([]); }}
                    disabled={manualStrokes.length === 0}
                    title="הסר את כל הניקוי הידני בתמונה הזו"
                  >
                    נקה הכל
                  </button>
                </div>
              )}
              <button
                type="button"
                className={`tz-ge-canvas-compare-btn ${showOriginal ? 'active' : ''}`}
                onMouseDown={() => setShowOriginal(true)}
                onMouseUp={() => setShowOriginal(false)}
                onMouseLeave={() => setShowOriginal(false)}
                title="לחץ והחזק להשוואה מול המקור (או מקש רווח)"
              >
                <TzIconGallery size={14} />
                <span>{showOriginal ? 'מציג מקור' : 'החזק למקור'}</span>
              </button>
            </div>
          </div>

          {/* Viewport */}
          <div className="tz-ge-canvas-viewport">
            {currentFrame ? (
              <>
                <img
                  key={currentFrame.path}
                  ref={canvasImgRef}
                  className="tz-ge-canvas-img"
                  src={displayImage}
                  alt={currentFrame.name}
                />
                {/* Painting is disabled while the original is being held up for
                    comparison: the marks would land on the frame he is NOT
                    looking at, which is the same picture in the same place but
                    a different question. */}
                {brushOn && !showOriginal && (
                  <ManualBrush
                    imgRef={canvasImgRef}
                    pending={pendingStrokes}
                    radius={brushR}
                    onRadius={setBrushR}
                    erasing={brushErase}
                    onStroke={handleStroke}
                    onErase={handleErase}
                  />
                )}
                {/* The mask brush. Blue, because it is not the cleaning brush:
                    red on this screen has always meant "this is coming out of
                    the picture", and a region is the opposite promise. */}
                {maskPaintTool && !showOriginal && (
                  <ManualBrush
                    imgRef={canvasImgRef}
                    pending={maskStrokesOf(maskPaintTool)}
                    radius={brushR}
                    onRadius={setBrushR}
                    erasing={brushErase}
                    onStroke={handleMaskStroke}
                    onErase={handleMaskErase}
                    tint="59, 130, 246"
                  />
                )}
                {showOriginal && (
                  <div className="tz-ge-canvas-badge-original">
                    תמונת מקור (לפני עריכה)
                  </div>
                )}
                {busyRender && (
                  <div style={{ position: 'absolute', bottom: 16, left: 16, background: 'rgba(0,0,0,0.65)', color: '#ffffff', padding: '4px 10px', borderRadius: 8, fontSize: 11 }}>
                    מרנדר שינויים...
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#71717a' }}>אין תמונה מוצגת</div>
            )}
          </div>
        </main>

        {/* LEFT COLUMN: INSPECTOR & ACCORDION TOOLS PANEL */}
        <aside className="tz-ge-tools-panel">
          <div className="tz-ge-panel-head">
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={`tz-sc-source-pill ${activeTab === 'primary' ? 'active' : ''}`}
                style={{ padding: '7px 14px', fontSize: 12.5 }}
                onClick={() => setActiveTab('primary')}
              >
                <TzIconSliders size={14} />
                כלים ראשוניים
              </button>
              <button
                type="button"
                className={`tz-sc-source-pill ${activeTab === 'colormatch' ? 'active' : ''}`}
                style={{ padding: '7px 14px', fontSize: 12.5 }}
                onClick={() => setActiveTab('colormatch')}
              >
                <TzIconSparkle size={14} />
                ColorMatch
              </button>
            </div>

          </div>

          <div className="tz-ge-panel-scroll">
            {activeTab === 'primary' ? (
              <ToolsPanelV2
                tools={frameEffectiveTools}
                onParam={(toolId, paramId, value) => handleParamChange(toolId, paramId, value)}
                onToggle={handleToolEnabled}
                onReset={handleToolReset}
                onOpenBrush={() => { setBrushOn((v) => !v); setMaskPaintTool(null); }}
                brushOn={brushOn}
                brushStrokes={manualStrokes.length}
                onMask={handleMask}
                onPaintMask={handlePaintMask}
                paintingMask={maskPaintTool}
                maskStrokes={maskStrokeCounts}
                isRaw={isRawFile(currentPath)}
              />
            ) : (
              /* ColorMatch Tab */
              <ColorMatchPanel
                projectId={project.id}
                batchId={typeof at === 'string' && at !== '__all__' ? at : null}
                frame={currentFrame ? { path: currentFrame.path, name: currentFrame.name } : null}
                target={
                  applyScope.blocked
                    ? { kind: 'blocked', why: applyScope.blocked }
                    : {
                      kind: applyScope.batchId ? 'batch' : 'base',
                      label: applyScope.label,
                      count: applyScope.count,
                    }
                }
                onApply={applyColorModel}
              />
            )}
          </div>

          {/* Footer Action Bar */}
          <div className="tz-ge-panel-footer">
            <button
              type="button"
              className="tz-ge-sync-batch-btn"
              onClick={handleSyncToBatch}
              disabled={!currentFrame || slideFrames.length === 0 || Boolean(applyScope.blocked)}
              title={applyScope.blocked ?? applyScope.label}
            >
              <TzIconCheckCircle size={16} />
              {`החל עריכה על ${slideFrames.length.toLocaleString('he-IL')} תמונות · ${applyScope.label}`}
            </button>

            {applyScope.blocked && (
              <p className="tz-ge-held">{applyScope.blocked}</p>
            )}

            {heldBack.length > 0 && (
              <p className="tz-ge-held">
                {heldBack.join(' · ')} — נשאר רק על התמונה הזו, כי צבעת את האזור ביד
                והצביעה הזו לא מתאימה לתמונה אחרת.
              </p>
            )}

            {hasCustomEdits && (
              <button
                type="button"
                className="tz-ge-reset-btn"
                onClick={handleResetFrame}
              >
                אפס עריכה בתמונה זו
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Modal Dialog: Before / After Contact Sheet */}
      {sheetModel && (
        <BeforeAfter
          frames={slideFrames}
          model={sheetModel}
          onClose={() => setSheetModel(null)}
        />
      )}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  defaultVal = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultVal?: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="tz-ge-slider-wrap">
      <div className="tz-ge-slider-meta">
        <label className="tz-ge-slider-label">{label}</label>
        <span
          className="tz-ge-slider-val"
          onDoubleClick={() => onChange(defaultVal)}
          title="לחיצה כפולה לאיפוס"
        >
          {value > 0 && min < 0 ? `+${value}` : value}
        </span>
      </div>
      <input
        type="range"
        className="tz-ge-range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(defaultVal)}
      />
    </div>
  );
}
