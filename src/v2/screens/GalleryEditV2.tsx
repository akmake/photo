import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../studio/store';
import {
  batchRecipe,
  colorStep,
  effectiveRecipe,
  frameKey,
  framesInBatch,
  frameSteps,
  removeFrameStep,
  setFrameStep,
  setFrameSteps,
  setStep,
  unassignedFrames,
  useBatches,
  useProjectFiles,
  useRecipe,
  useStatuses,
  setPhotoStatus,
  publishFinished,
  useDiskFault,
  retrySave,
} from '../../studio/store';
import { EDIT_WIDTH, learnColorModel, prepareFrames, renderRecipeAtPath, Superseded, thumbUrl } from '../../api';
import type { LearnColorResponse } from '../../api';
import type { LearnedColorModel, ManualStroke, ToolInstance, ToolMask } from '../../types';
import { defaultParams, getTool, isRawFile, isToolAtDefault } from '../../toolRegistry';
import ManualBrush, { DEFAULT_R, MAX_R, MIN_R } from './ManualBrush';
import ToolsPanelV2 from './ToolsPanelV2';
import ColorMatchPanel from './ColorMatchPanel';
import ExportDialog from './ExportDialog';
import { computeDiff } from '../../design/Metering';
import type { Delta } from '../../design/Metering';
import EditedReviewV2 from './EditedReviewV2';
import { useFramePreview, useSetPreview } from '../../studio/preview';
import { useGalleryWatch } from '../../studio/galleryLink';
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
import './gallery-edit-photos.css';

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
  /* The strip shows every photograph AS EDITED — base, batch and its own
   * layer. It used to show the raw file, so a look applied to the whole batch
   * changed the big picture and nothing beside it, and read as "nothing
   * happened". */
  const stripPreview = useFramePreview(project.id);
  const galleryWatch = useGalleryWatch(project.id);

  // Active batch selection
  const [at, setAt] = useState<string | null>(null);
  const [choseBatch, setChoseBatch] = useState(false);
  const [showUnselected, setShowUnselected] = useState(false);
  const [exporting, setExporting] = useState(false);
  /* הסט הערוך — the finished set, frame by frame, each through its own recipe. */
  const [reviewing, setReviewing] = useState(false);
  const statuses = useStatuses(project.id);
  const diskFault = useDiskFault(project.id);
  const isDone = (name: string) => statuses[frameKey(name)] === 'ready';

  /* The client's choice is not a new batch. It is a lens over the original
   * shoot structure, so "garden", "family" and "dance floor" remain useful
   * editing groups. Prefer the live locked answer when the server is reachable;
   * the saved answer keeps this screen working offline afterwards. */
  const choiceIsFinal = Boolean(
    galleryWatch.state?.gallery.lockedAt || galleryWatch.link?.importedAt,
  );
  const selectedFrameKeys = useMemo(() => {
    const names = galleryWatch.state?.gallery.lockedAt
      ? galleryWatch.state.selection.map((entry) => entry.frameId)
      : galleryWatch.link?.selectedFrames
        ?? Object.values(galleryWatch.link?.albums ?? {}).flatMap((album) => album.frames);
    return new Set(names.map(frameKey));
  }, [galleryWatch.state, galleryWatch.link]);
  const originalGroupByFrame = useMemo(() => {
    const groups = new Map<string, { id: string | null; name: string | null }>();
    if (galleryWatch.state?.gallery.lockedAt) {
      for (const entry of galleryWatch.state.selection) {
        if (entry.groupId !== undefined || entry.groupName !== undefined) {
          groups.set(frameKey(entry.frameId), {
            id: entry.groupId ?? null,
            name: entry.groupName ?? null,
          });
        }
      }
      return groups;
    }
    for (const [name, group] of Object.entries(galleryWatch.link?.selectionGroups ?? {})) {
      groups.set(frameKey(name), group);
    }
    return groups;
  }, [galleryWatch.state, galleryWatch.link]);
  const selectedOnly = choiceIsFinal && !showUnselected;
  const inCurrentView = useCallback(
    (list: typeof frames) => selectedOnly
      ? list.filter((frame) => selectedFrameKeys.has(frameKey(frame.name)))
      : list,
    [selectedOnly, selectedFrameKeys],
  );
  const framesForBatch = useCallback((batchId: string) => {
    const currentlyAssigned = framesInBatch(project.id, batchId);
    if (!selectedOnly || originalGroupByFrame.size === 0) {
      return inCurrentView(currentlyAssigned);
    }
    const currentKeys = new Set(currentlyAssigned.map((frame) => frameKey(frame.name)));
    return frames.filter((frame) => {
      const key = frameKey(frame.name);
      if (!selectedFrameKeys.has(key)) return false;
      const original = originalGroupByFrame.get(key);
      return original ? original.id === batchId : currentKeys.has(key);
    });
  }, [frames, inCurrentView, originalGroupByFrame, project.id, selectedFrameKeys, selectedOnly]);
  const visibleBatches = useMemo(
    () => selectedOnly
      ? batches.filter((batch) => framesForBatch(batch.id).length > 0)
      : batches,
    [batches, selectedOnly, framesForBatch],
  );
  const visibleUnassigned = useMemo(
    () => {
      const currentlyUnassigned = unassignedFrames(project.id);
      if (!selectedOnly || originalGroupByFrame.size === 0) {
        return inCurrentView(currentlyUnassigned);
      }
      const currentKeys = new Set(currentlyUnassigned.map((frame) => frameKey(frame.name)));
      return frames.filter((frame) => {
        const key = frameKey(frame.name);
        if (!selectedFrameKeys.has(key)) return false;
        const original = originalGroupByFrame.get(key);
        return original ? !original.id : currentKeys.has(key);
      });
    },
    [inCurrentView, project.id, frames, batches, originalGroupByFrame, selectedFrameKeys, selectedOnly],
  );
  const visibleAll = useMemo(() => inCurrentView(frames), [frames, inCurrentView]);

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
  /* הפרש — the Lab's difference view: black where the edit left the picture
   * alone, white where it changed it, amplified so a subtle change shows, and
   * the numbers beside it. "I see no change" and "nothing changed" stop being
   * the same sentence. */
  /* FULL QUALITY WHEN ZOOMED. The working preview is EDIT_WIDTH on its long
   * edge — right for a fitted frame, soft the moment he zooms in to judge skin
   * or focus. Zoomed past what the preview holds, the same recipe is rendered
   * again at the size the screen now shows (up to the file itself) and swapped
   * in when it is ready; the working preview stays up until then. */
  const [hiRes, setHiRes] = useState<{ key: string; src: string } | null>(null);
  const [hiResBusy, setHiResBusy] = useState(false);
  const [diffOn, setDiffOn] = useState(false);
  const [diffGain, setDiffGain] = useState(5);
  const [diffStats, setDiffStats] = useState<Delta | null | 'mismatch'>(null);
  const diffRef = useRef<HTMLCanvasElement | null>(null);
  const [renderedSrc, setRenderedSrc] = useState<string | null>(null);
  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [busyRender, setBusyRender] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasViewport, setCanvasViewport] = useState({ width: 0, height: 0 });
  const [imageNatural, setImageNatural] = useState({ width: 0, height: 0 });

  /* THE MANUAL BRUSH. The picture element is the brush's coordinate system, so
   * the overlay needs a handle on it (see ManualBrush.tsx). `pendingStrokes`
   * are the ones painted but not yet answered for by the engine: they are shown
   * in red so a stroke never looks lost during the second it takes to rebuild,
   * and they are dropped the moment a render finishes. */
  const canvasImgRef = useRef<HTMLImageElement | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const zoomAnchorRef = useRef<{
    xRatio: number;
    yRatio: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const [brushOn, setBrushOn] = useState(false);
  const [brushErase, setBrushErase] = useState(false);
  /* The tool whose REGION is being painted, if any. Null means the brush on
   * the picture — when there is one — is the cleaning brush. */
  const [maskPaintTool, setMaskPaintTool] = useState<string | null>(null);
  const [brushR, setBrushR] = useState(DEFAULT_R);
  const [pendingStrokes, setPendingStrokes] = useState<ManualStroke[]>([]);
  // What "סיימתי" did with each frame's file, said once it is known.
  const [finishNotes, setFinishNotes] = useState<Record<string, string>>({});
  // The cleaning action pointed at in the tools panel's list.
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);

  const [sheetModel, setSheetModel] = useState<LearnedColorModel | null>(null);

  /* The photograph starts fitted, then grows inside a genuinely scrollable
   * work surface. Explicit pixel dimensions matter here: a CSS transform can
   * make a picture LOOK larger without enlarging its scroll area, which leaves
   * the photographer unable to reach the edges they zoomed in to inspect. */
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    /* The WHOLE box, scrollbars included. Measured inside them (clientWidth)
     * the room shrank the moment a zoomed frame overflowed by a hair: the
     * scrollbar took ten pixels, the fit shrank the picture, the overflow went,
     * the scrollbar went, the room grew back — and the frame jumped in a loop
     * that only a square or landscape frame near the edge could start. */
    const measure = () => setCanvasViewport((prev) => {
      const next = { width: viewport.offsetWidth, height: viewport.offsetHeight };
      return prev.width === next.width && prev.height === next.height ? prev : next;
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const changeCanvasZoom = useCallback((
    delta: number,
    anchor?: { x: number; y: number },
  ) => {
    const viewport = canvasViewportRef.current;
    if (viewport) {
      const clientX = anchor?.x ?? viewport.clientWidth / 2;
      const clientY = anchor?.y ?? viewport.clientHeight / 2;
      zoomAnchorRef.current = {
        xRatio: (viewport.scrollLeft + clientX) / Math.max(1, viewport.scrollWidth),
        yRatio: (viewport.scrollTop + clientY) / Math.max(1, viewport.scrollHeight),
        clientX,
        clientY,
      };
    }
    setCanvasZoom((current) => {
      const next = Math.round((current + delta) * 4) / 4;
      const clamped = Math.min(4, Math.max(0.5, next));
      if (clamped === current) zoomAnchorRef.current = null;
      return clamped;
    });
  }, []);

  // Start in the first original group that contains a visible photograph.
  useEffect(() => {
    if (!choseBatch && ready) {
      if (visibleBatches.length > 0) {
        const nonEmpty = visibleBatches.find(
          (batch) => framesForBatch(batch.id).length > 0,
        );
        if (nonEmpty) {
          setAt(nonEmpty.id);
        } else if (visibleUnassigned.length > 0) {
          setAt(null);
        } else {
          setAt('__all__');
        }
      } else {
        setAt('__all__');
      }
      setChoseBatch(true);
    }
  }, [visibleBatches, visibleUnassigned.length, choseBatch, ready, framesForBatch]);

  // A gallery answer can arrive after the editor opened. If the active group
  // has no chosen frames, move to the first group that does instead of showing
  // an unexplained empty rail.
  useEffect(() => {
    if (!selectedOnly || !choseBatch) return;
    const activeStillVisible = at === '__all__'
      || (at === null && visibleUnassigned.length > 0)
      || (typeof at === 'string' && visibleBatches.some((batch) => batch.id === at));
    if (activeStillVisible) return;
    setAt(visibleBatches[0]?.id ?? (visibleUnassigned.length ? null : '__all__'));
    setActiveSlideIndex(0);
  }, [selectedOnly, choseBatch, at, visibleBatches, visibleUnassigned.length]);

  // Slides for current batch
  const currentBatch = batches.find((b) => b.id === at) ?? null;
  const slideFrames = useMemo(() => {
    if (at === '__all__') return visibleAll;
    if (at === null) return visibleUnassigned;
    if (at) {
      const inB = framesForBatch(at);
      if (inB.length > 0) return inB;
    }
    return visibleAll;
  }, [at, visibleAll, visibleUnassigned, framesForBatch]);

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
    preciseFrames: boolean;
  } => {
    const n = slideFrames.length;
    if (selectedOnly) {
      const label = at === '__all__'
        ? 'על כל בחירת הלקוח'
        : at === null
          ? 'על התמונות שנבחרו ללא מקבץ'
          : `על בחירת הלקוח במקבץ ${currentBatch?.name ?? ''}`.trim();
      return { batchId: null, label, count: n, blocked: null, preciseFrames: true };
    }
    if (at === '__all__') {
      return { batchId: null, label: 'על כל התמונות בפרויקט', count: n, blocked: null, preciseFrames: false };
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
        preciseFrames: false,
      };
    }
    return {
      batchId: at,
      label: `על המקבץ ${currentBatch?.name ?? ''}`.trim(),
      count: n,
      blocked: null,
      preciseFrames: false,
    };
  }, [at, slideFrames.length, frames.length, currentBatch, selectedOnly]);

  // Active frame
  const currentFrame = slideFrames[activeSlideIndex] ?? slideFrames[0] ?? null;

  /* סיימתי — this photograph is finished. The edit itself is already on disk
   * (every change is); this records the photographer's word that it is DONE,
   * and moves on to the next frame in this view that is not. */
  const finishCurrent = useCallback(() => {
    if (!currentFrame) return;
    if (isDone(currentFrame.name)) {
      setPhotoStatus(project.id, currentFrame.name, 'working');
      return;
    }
    setPhotoStatus(project.id, currentFrame.name, 'ready');
    // The finished file goes to the album and to the client's gallery.
    const finished = currentFrame.name;
    setFinishNotes((n) => ({ ...n, [finished]: 'שומר את התמונה הערוכה…' }));
    void publishFinished(project.id, finished).then((out) => {
      const words = out.fileError
        ? `לא נשמרה: ${out.fileError}`
        : out.gallery === 'sent' ? 'נשמרה לאלבום · נשלחה ללקוח'
        : out.gallery === 'failed' ? `נשמרה לאלבום · לא נשלחה ללקוח: ${out.galleryError ?? ''}`
        : out.gallery === 'not-in-gallery' ? 'נשמרה לאלבום · לא בגלריה של הלקוח'
        : 'נשמרה לאלבום';
      setFinishNotes((n) => ({ ...n, [finished]: words }));
    });
    const after = slideFrames.findIndex((f, i) => i > activeSlideIndex && !isDone(f.name));
    if (after >= 0) setActiveSlideIndex(after);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrame, slideFrames, activeSlideIndex, statuses, project.id]);
  const finishRef = useRef(finishCurrent);
  finishRef.current = finishCurrent;

  /* From the review back to one frame: in this batch if it is here, else in
   * the whole view, once that view has rendered. */
  const [openAfter, setOpenAfter] = useState<string | null>(null);
  const openFrame = useCallback((name: string) => {
    const i = slideFrames.findIndex((f) => frameKey(f.name) === frameKey(name));
    if (i >= 0) { setActiveSlideIndex(i); return; }
    setAt('__all__');
    setOpenAfter(name);
  }, [slideFrames]);
  useEffect(() => {
    if (!openAfter) return;
    const i = slideFrames.findIndex((f) => frameKey(f.name) === frameKey(openAfter));
    if (i >= 0) { setActiveSlideIndex(i); setOpenAfter(null); }
  }, [openAfter, slideFrames]);

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

  useEffect(() => {
    if (!diffOn) { setDiffStats(null); return undefined; }
    const canvas = diffRef.current;
    if (!rawSrc || !renderedSrc || !canvas) return undefined;
    let alive = true;
    setDiffStats(null);
    computeDiff(rawSrc, renderedSrc, canvas, diffGain)
      .then((d) => { if (alive) setDiffStats(d ?? 'mismatch'); })
      .catch(() => { if (alive) setDiffStats('mismatch'); });
    return () => { alive = false; };
    // The picture's box (viewport, zoom, file size): the canvas remounts with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffOn, diffGain, rawSrc, renderedSrc, canvasViewport, canvasZoom, imageNatural]);

  /* THE ORIGINAL, once per frame. It used to be rendered again beside every
   * slider move — the same pixels, on the same single engine worker, doubling
   * the wait for the picture that had actually changed. */
  const currentPath = currentFrame?.path ?? null;
  // A stroke waiting to be rebuilt belongs to the frame it was painted on.
  useEffect(() => setPendingStrokes([]), [currentPath]);
  useEffect(() => {
    setCanvasZoom(1);
  }, [currentPath]);
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

  useEffect(() => {
    if (!slideFrames.length) return;
    const at = Math.max(0, activeSlideIndex);
    const order = [...slideFrames.slice(at), ...slideFrames.slice(0, at).reverse()];
    stripPreview.want(order.map((f) => ({ path: f.path, name: f.name })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideFrames, activeSlideIndex, recipe]);

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
      if (reviewing) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        finishRef.current();
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setShowOriginal(true);
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyD' || e.key === 'ג') && !brushOn && !maskPaintTool) {
        e.preventDefault();
        setDiffOn((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        changeCanvasZoom(0.25);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        changeCanvasZoom(-0.25);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setCanvasZoom(1);
        return;
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
  }, [slideFrames.length, brushOn, undoStroke, changeCanvasZoom, reviewing]);

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
    const shared: ToolInstance[] = [];
    for (const tool of tools) {
      if (tool.mask?.region === 'painted' || (tool.strokes?.length ?? 0) > 0) {
        held.push(getTool(tool.toolId).label);
        continue;
      }
      shared.push(tool);
    }
    if (applyScope.preciseFrames) {
      setFrameSteps(project.id, slideFrames.map((frame) => frame.name), shared);
    } else {
      for (const tool of shared) setStep(project.id, tool, applyScope.batchId);
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
      const step: ToolInstance = { toolId: 'pixel-color', params: {}, enabled: true, model };
      if (applyScope.preciseFrames) {
        setFrameSteps(project.id, slideFrames.map((frame) => frame.name), [step]);
      } else {
        setStep(project.id, step, applyScope.batchId);
      }
      preview.warm(slideFrames.map((f) => f.path));
    },
    [project.id, applyScope.batchId, applyScope.preciseFrames, preview, slideFrames],
  );

  const hasCustomEdits = Boolean(currentFrame && frameSteps(project.id, currentFrame.name).length > 0);
  const fittedImage = useMemo(() => {
    if (!imageNatural.width || !imageNatural.height || !canvasViewport.width || !canvasViewport.height) {
      return null;
    }
    const roomWidth = Math.max(1, canvasViewport.width - 32);
    const roomHeight = Math.max(1, canvasViewport.height - 32);
    const fit = Math.min(
      roomWidth / imageNatural.width,
      roomHeight / imageNatural.height,
      1,
    );
    return {
      width: Math.round(imageNatural.width * fit * canvasZoom),
      height: Math.round(imageNatural.height * fit * canvasZoom),
    };
  }, [canvasViewport, canvasZoom, imageNatural]);
  /* How many pixels the screen shows along the long edge right now, and the
   * render that serves it: 0 = the preview is enough; else a bucket, so a
   * wheel turn from 150% to 175% does not ask for a new render each step. */
  const shownLong = fittedImage
    ? Math.max(fittedImage.width, fittedImage.height) * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    : 0;
  const hiBucket = shownLong > EDIT_WIDTH * 1.15 ? (shownLong <= 3000 ? 3000 : 0) : -1; // -1 = not needed, 0 = the full file
  const hiKey = currentPath && hiBucket >= 0 ? `${currentPath}|${hiBucket}|${JSON.stringify(recipe)}` : '';
  const hiShown = !showOriginal && hiRes && hiRes.key === hiKey ? hiRes.src : null;
  const displayImage = showOriginal
    ? (hiBucket >= 0 && currentPath ? thumbUrl(currentPath, hiBucket || 8000) : (rawSrc || thumbUrl(currentFrame?.path ?? '', 1200)))
    : (hiShown || renderedSrc || thumbUrl(currentFrame?.path ?? '', 1200));
  /* Only as big as the picture needs; the stylesheet's min-width/height 100%
   * fills the rest of the room. Forcing it to the measured box (scrollbars
   * included) would itself overflow by a scrollbar's width. */
  const canvasSurface = {
    width: (fittedImage?.width ?? 0) + 32,
    height: (fittedImage?.height ?? 0) + 32,
  };

  useEffect(() => {
    if (!hiKey || !currentPath || !currentName) { setHiResBusy(false); return undefined; }
    if (hiRes?.key === hiKey) return undefined;
    let alive = true;
    const t = window.setTimeout(async () => {
      setHiResBusy(true);
      try {
        const tools = effectiveRecipe(project.id, currentName).filter((x) => x.enabled);
        const res = await renderRecipeAtPath(currentPath, tools, hiBucket || undefined, false, 'edit-v2-hi');
        if (alive) setHiRes({ key: hiKey, src: res.image });
      } catch (e) {
        if (!(e instanceof Superseded)) console.error('[איכות מלאה]', e);
      } finally {
        if (alive) setHiResBusy(false);
      }
    }, 350);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiKey]);

  /* Preserve the point under the mouse while zooming, like a photo editor.
   * A wheel turn over an eye keeps that eye under the pointer instead of
   * throwing the photographer back to the centre of the frame. */
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const raf = requestAnimationFrame(() => {
      const anchor = zoomAnchorRef.current;
      if (anchor) {
        viewport.scrollLeft = Math.max(0, anchor.xRatio * viewport.scrollWidth - anchor.clientX);
        viewport.scrollTop = Math.max(0, anchor.yRatio * viewport.scrollHeight - anchor.clientY);
        zoomAnchorRef.current = null;
      } else if (canvasZoom > 1) {
        viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
        viewport.scrollTop = Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2);
      } else {
        viewport.scrollLeft = 0;
        viewport.scrollTop = 0;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [canvasZoom, fittedImage?.width, fittedImage?.height]);

  return (
    <div className="tz-ge-studio-root is-photos">
      {/* 1. TOP BAR: BATCH TABS & ACTIONS */}
      <header className="tz-ge-top-bar">
        <div className="tz-ge-batch-tabs">
          <span style={{ fontSize: 13, fontWeight: 700, color: '#18181b', marginLeft: 6 }}>
            {selectedOnly ? 'בחירת הלקוח לפי מקבצים:' : 'מקבץ עבודה:'}
          </span>

          {(visibleBatches.length > 0 || visibleAll.length > 0) && (
            <button
              type="button"
              className={`tz-ge-batch-tab ${at === '__all__' ? 'active' : ''}`}
              onClick={() => {
                setAt('__all__');
                setActiveSlideIndex(0);
              }}
            >
              <span>{selectedOnly ? 'כל בחירת הלקוח' : 'כל התמונות'}</span>
              <span className="tz-ge-batch-pill-badge">{visibleAll.length}</span>
            </button>
          )}

          {visibleBatches.map((b) => {
            const count = framesForBatch(b.id).length;
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

          {visibleUnassigned.length > 0 && (
            <button
              type="button"
              className={`tz-ge-batch-tab ${at === null ? 'active' : ''}`}
              onClick={() => {
                setAt(null);
                setActiveSlideIndex(0);
              }}
            >
              <span>ללא מקבץ</span>
              <span className="tz-ge-batch-pill-badge">{visibleUnassigned.length}</span>
            </button>
          )}
        </div>

        <div className="tz-ge-top-actions">
          {choiceIsFinal && (
            <button
              type="button"
              className={`tz-ge-choice-toggle ${showUnselected ? 'showing-all' : ''}`}
              onClick={() => {
                const nextShowUnselected = !showUnselected;
                setShowUnselected(nextShowUnselected);
                if (!nextShowUnselected) {
                  const currentHasChoice = at === '__all__'
                    || (at === null && selectedFrameKeys.size > 0 && visibleUnassigned.length > 0)
                    || (typeof at === 'string' && visibleBatches.some((batch) => batch.id === at));
                  if (!currentHasChoice) {
                    setAt(visibleBatches[0]?.id ?? (visibleUnassigned.length ? null : '__all__'));
                  }
                }
                setActiveSlideIndex(0);
              }}
            >
              <TzIconGallery size={16} />
              {showUnselected ? 'הצג רק את בחירת הלקוח' : 'הצג גם תמונות שלא נבחרו'}
            </button>
          )}
          {onBack && (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              onClick={onBack}
            >
              ← שלב קודם
            </button>
          )}
          {/* Every change is written to the project as it is made. Said, because
              a screen with no word about saving is a screen people distrust —
              and when the write failed, said louder, with the way to retry. */}
          {diskFault ? (
            <button type="button" className="tz-ge-save is-fault" onClick={() => retrySave(project.id)} title={diskFault}>
              השינויים לא נשמרו — נסה שוב
            </button>
          ) : (
            <span className="tz-ge-save" title="כל שינוי נשמר בתיקיית הפרויקט ברגע שהוא נעשה">נשמר אוטומטית ✓</span>
          )}
          <button
            type="button"
            className="tz-sc-subtle-btn"
            onClick={() => setReviewing(true)}
            disabled={!visibleAll.length}
            title="כל התמונות כפי שהן אחרי העריכה"
          >
            הסט הערוך · {visibleAll.filter((f) => isDone(f.name)).length}/{visibleAll.length}
          </button>
          <button
            type="button"
            className="tz-sc-subtle-btn"
            onClick={() => setExporting(true)}
            disabled={!visibleAll.length}
            title="כתיבת התמונות הערוכות לתיקייה"
          >
            ייצוא תמונות
          </button>
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

      {reviewing && (
        <EditedReviewV2
          projectId={project.id}
          frames={visibleAll}
          startAt={currentFrame?.name}
          onClose={() => setReviewing(false)}
          onEdit={(name) => { setReviewing(false); openFrame(name); }}
        />
      )}

      {exporting && (
        <ExportDialog
          projectId={project.id}
          home={project.home}
          frames={visibleAll}
          what={selectedOnly ? 'בחירת הלקוח' : 'כל התמונות בפרויקט'}
          onClose={() => setExporting(false)}
        />
      )}

      {/* 2. 3-COLUMN STUDIO WORKSPACE: Slide Deck (Right) | Canvas (Center) | Tools (Left) */}
      <div className="tz-ge-studio-workspace">
        {/* RIGHT COLUMN: POWERPOINT-STYLE SLIDE DECK */}
        <aside className="tz-ge-slide-deck">
          <div className="tz-ge-deck-header">
            <span>שקופיות ({slideFrames.length})</span>
            <span style={{ fontSize: 11.5, color: '#71717a' }}>בחר לעריכה</span>
          </div>
          {(() => {
            /* An edit laid on the whole view takes the engine a while per
             * photograph — the colour match reads each frame's skin and
             * materials. Said, with a count, so it never looks like nothing. */
            const edited = slideFrames.filter((f) => stripPreview.edited(f.name));
            const waiting = edited.filter((f) => stripPreview.pending(f.path, f.name)).length;
            if (!waiting) return null;
            const done = edited.length - waiting;
            return (
              <div className="tz-ge-deck-progress" role="status">
                <span>מחיל את העריכה · {done.toLocaleString('he-IL')} מתוך {edited.length.toLocaleString('he-IL')}</span>
                <i><b style={{ width: `${(done / Math.max(1, edited.length)) * 100}%` }} /></i>
              </div>
            );
          })()}

          <div className="tz-ge-deck-scroll">
            {slideFrames.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#a1a1aa', fontSize: 12 }}>
                {selectedOnly ? 'אין תמונות שבחר הלקוח במקבץ זה' : 'אין תמונות במקבץ זה'}
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
                      className={`tz-ge-slide-thumb${stripPreview.pending(f.path, f.name) ? ' is-pending' : ''}`}
                      src={stripPreview.url(f.path, f.name, 320)}
                      alt={f.name}
                      title={f.name}
                      loading="lazy"
                    />
                    {stripPreview.pending(f.path, f.name) && (
                      <span className="tz-ge-slide-busy" title="מחיל את העריכה על התמונה…" />
                    )}
                    <span className="tz-ge-slide-idx">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    {isCustomized && (
                      <span className="tz-ge-slide-badge">מותאם</span>
                    )}
                    {isDone(f.name) && (
                      <span className="tz-ge-slide-done" title="סומנה כגמורה">✓</span>
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
              {currentFrame && (
                <button
                  type="button"
                  className={`tz-ge-done-btn${isDone(currentFrame.name) ? ' is-done' : ''}`}
                  onClick={finishCurrent}
                  title={isDone(currentFrame.name)
                    ? 'התמונה סומנה כגמורה — לחיצה מחזירה אותה לעריכה'
                    : 'סיימתי לערוך את התמונה — עוברים לבאה שלא הסתיימה (Ctrl+Enter)'}
                >
                  {isDone(currentFrame.name) ? 'הסתיימה ✓ · החזר לעריכה' : 'סיימתי ✓'}
                </button>
              )}
              {currentFrame && finishNotes[currentFrame.name] && isDone(currentFrame.name) && (
                <span
                  className={`tz-ge-finish-note${/לא נ/.test(finishNotes[currentFrame.name]) ? ' is-fault' : ''}`}
                  role="status"
                >
                  {finishNotes[currentFrame.name]}
                </span>
              )}
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
                className={`tz-ge-canvas-compare-btn ${diffOn ? 'active' : ''}`}
                onClick={() => setDiffOn((v) => !v)}
                title="איפה העריכה שינתה את התמונה — שחור: לא נגעה, לבן: שינתה (D)"
              >
                <span>הפרש</span>
              </button>
              {diffOn && (
                <div className="tz-ge-diff-bar">
                  {[1, 5, 10, 25].map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={`tz-ge-brush-mini ${diffGain === g ? 'active' : ''}`}
                      onClick={() => setDiffGain(g)}
                      title="הגברה — כדי לראות גם שינוי עדין"
                    >
                      ×{g}
                    </button>
                  ))}
                  <span className="tz-ge-diff-stats">
                    {diffStats === 'mismatch'
                      ? 'החיתוך שינה את גודל התמונה — אין השוואה פיקסל מול פיקסל'
                      : diffStats
                        ? `ממוצע ${diffStats.mean.toFixed(1)} · מקסימום ${Math.round(diffStats.max)} · ${diffStats.p3.toFixed(1)}% מהתמונה השתנה לעין`
                        : 'מחשב…'}
                  </span>
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
          <div
            className={`tz-ge-canvas-viewport${
              canvasZoom > 1 && !brushOn && !maskPaintTool ? ' is-pannable' : ''
            }${panning ? ' is-panning' : ''}`}
            ref={canvasViewportRef}
            onWheel={(event) => {
              if (brushOn || maskPaintTool) return;
              event.preventDefault();
              const rect = event.currentTarget.getBoundingClientRect();
              changeCanvasZoom(
                event.deltaY < 0 ? 0.25 : -0.25,
                { x: event.clientX - rect.left, y: event.clientY - rect.top },
              );
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || canvasZoom <= 1 || brushOn || maskPaintTool) return;
              panRef.current = {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                scrollLeft: event.currentTarget.scrollLeft,
                scrollTop: event.currentTarget.scrollTop,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setPanning(true);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const pan = panRef.current;
              if (!pan || pan.pointerId !== event.pointerId) return;
              event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
              event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.y);
            }}
            onPointerUp={(event) => {
              if (panRef.current?.pointerId !== event.pointerId) return;
              panRef.current = null;
              setPanning(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={() => {
              panRef.current = null;
              setPanning(false);
            }}
            onDoubleClick={() => {
              if (!brushOn && !maskPaintTool) setCanvasZoom((zoom) => (zoom === 1 ? 2 : 1));
            }}
          >
            {currentFrame ? (
              <>
                <div
                  className="tz-ge-canvas-surface"
                  style={{ width: canvasSurface.width, height: canvasSurface.height }}
                >
                  <img
                    key={currentFrame.path}
                    ref={canvasImgRef}
                    className="tz-ge-canvas-img"
                    src={displayImage}
                    alt={currentFrame.name}
                    draggable={false}
                    style={fittedImage ? {
                      width: fittedImage.width,
                      height: fittedImage.height,
                      maxWidth: 'none',
                      maxHeight: 'none',
                    } : undefined}
                    onLoad={(event) => setImageNatural({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })}
                  />
                  {/* Painting is disabled while the original is being held up for
                      comparison: the marks would land on the frame he is NOT
                      looking at, which is the same picture in the same place but
                      a different question. */}
                  {diffOn && !showOriginal && fittedImage && (
                    <canvas
                      ref={diffRef}
                      className="tz-ge-diff-canvas"
                      style={{ width: fittedImage.width, height: fittedImage.height }}
                      aria-label="מפת ההפרש"
                    />
                  )}
                  {/* The action pointed at in the list, drawn where it was painted.
                      Look-only: it takes no pointer, so the picture stays usable. */}
                  {!brushOn && hoveredAction && !showOriginal && (
                    <div className="tz-ge-action-peek">
                      <ManualBrush
                        imgRef={canvasImgRef}
                        pending={manualStrokes.filter((st) => st.id === hoveredAction)}
                        radius={brushR}
                        onRadius={() => undefined}
                        erasing={false}
                        onStroke={() => undefined}
                        onErase={() => undefined}
                        tint="197, 203, 240"
                      />
                    </div>
                  )}
                  {brushOn && !showOriginal && (
                    <ManualBrush
                      imgRef={canvasImgRef}
                      pending={[...pendingStrokes, ...manualStrokes.filter((st) => st.id === hoveredAction && !pendingStrokes.some((p) => p.id === st.id))]}
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
                </div>
                {showOriginal && (
                  <div className="tz-ge-canvas-badge-original">
                    תמונת מקור (לפני עריכה)
                  </div>
                )}
                {hiResBusy && !busyRender && (
                  <div className="tz-ge-hires-note">טוען איכות מלאה…</div>
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
          {currentFrame && (
            <div className="tz-ge-zoom" role="group" aria-label="הגדלת התמונה">
              <button
                type="button"
                onClick={() => changeCanvasZoom(-0.25)}
                disabled={canvasZoom <= 0.5}
                aria-label="הקטן תמונה"
                title="הקטן (Ctrl−)"
              >
                −
              </button>
              <output aria-live="polite">
                {canvasZoom === 1 ? 'התאמה' : `${Math.round(canvasZoom * 100)}%`}
              </output>
              <button
                type="button"
                onClick={() => changeCanvasZoom(0.25)}
                disabled={canvasZoom >= 4}
                aria-label="הגדל תמונה"
                title="הגדל (Ctrl+)"
              >
                +
              </button>
              <button
                type="button"
                className="tz-ge-zoom-fit"
                onClick={() => setCanvasZoom(1)}
                disabled={canvasZoom === 1}
                title="התאם למסך (Ctrl+0)"
              >
                התאם
              </button>
            </div>
          )}
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
                onClick={() => { setActiveTab('colormatch'); setBrushOn(false); }}
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
                /* Touching any OTHER tool puts the cleaning brush away: he has
                 * moved on, and a brush left open keeps taking the pointer. */
                onParam={(toolId, paramId, value) => { if (toolId !== 'manual-clean') setBrushOn(false); handleParamChange(toolId, paramId, value); }}
                onToggle={(toolId, enabled) => { if (toolId !== 'manual-clean') setBrushOn(false); handleToolEnabled(toolId, enabled); }}
                onReset={(toolId) => { if (toolId !== 'manual-clean') setBrushOn(false); handleToolReset(toolId); }}
                onOpenBrush={() => { setBrushOn((v) => !v); setMaskPaintTool(null); }}
                brushOn={brushOn}
                brushStrokes={manualStrokes.length}
                onMask={(toolId, mask) => { setBrushOn(false); handleMask(toolId, mask); }}
                onPaintMask={handlePaintMask}
                paintingMask={maskPaintTool}
                maskStrokes={maskStrokeCounts}
                isRaw={isRawFile(currentPath)}
                brushActions={manualStrokes}
                onDeleteAction={(id) => {
                  writeStrokes(manualStrokes.filter((st) => st.id !== id));
                  setPendingStrokes((p) => p.filter((st) => st.id !== id));
                }}
                onHoverAction={setHoveredAction}
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
