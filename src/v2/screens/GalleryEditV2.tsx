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
import type { LearnedColorModel, ManualStroke, ToolInstance } from '../../types';
import { defaultParams, getTool, isRawFile, isToolAtDefault } from '../../toolRegistry';
import ManualBrush, { DEFAULT_R, MAX_R, MIN_R } from './ManualBrush';
import ToolsPanelV2 from './ToolsPanelV2';
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
  const [brushR, setBrushR] = useState(DEFAULT_R);
  const [pendingStrokes, setPendingStrokes] = useState<ManualStroke[]>([]);

  // ColorMatch state
  const [cmEdited, setCmEdited] = useState<{ name: string; data: string } | null>(null);
  const [cmLearning, setCmLearning] = useState(false);
  const [cmLearned, setCmLearned] = useState<LearnColorResponse | null>(null);
  const [cmError, setCmError] = useState<string | null>(null);
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

  // Sync current photo's edits to the entire batch
  const handleSyncToBatch = useCallback(() => {
    if (!currentFrame || !at) return;
    const tools = frameSteps(project.id, currentFrame.name);
    if (!tools.length) return;

    for (const tool of tools) {
      setStep(project.id, tool, at);
    }
    // Warm all frames in the batch
    preview.warm(slideFrames.map((f) => f.path));
  }, [currentFrame, at, project.id, slideFrames, preview]);

  // Reset current frame back to batch defaults
  const handleResetFrame = useCallback(() => {
    if (!currentFrame) return;
    const tools = frameSteps(project.id, currentFrame.name);
    for (const tool of tools) {
      removeFrameStep(project.id, currentFrame.name, tool.toolId);
    }
  }, [currentFrame, project.id]);

  // ColorMatch learn
  const handleLearnColorMatch = useCallback(async () => {
    if (!currentFrame || !cmEdited) return;
    setCmError(null);
    setCmLearning(true);
    setCmLearned(null);
    try {
      const res = await learnColorModel({ path: currentFrame.path }, { data: cmEdited.data });
      setCmLearned(res);
      // Automatically apply to batch
      setStep(project.id, { toolId: 'pixel-color', params: {}, enabled: true, model: res.model }, at);
      preview.warm(slideFrames.map((f) => f.path));
    } catch (e) {
      setCmError(e instanceof Error ? e.message : 'למידת הצבע נכשלה');
    } finally {
      setCmLearning(false);
    }
  }, [currentFrame, cmEdited, project.id, at, preview, slideFrames]);

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
                onClick={() => setBrushOn((v) => !v)}
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
                onOpenBrush={() => setBrushOn((v) => !v)}
                brushOn={brushOn}
                brushStrokes={manualStrokes.length}
                isRaw={isRawFile(currentPath)}
              />
            ) : (
              /* ColorMatch Tab */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, overflowY: 'auto', minHeight: 0 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#52525b', lineHeight: 1.45 }}>
                  העלה את הגרסה הערוכה של תמונה זו מ-Lightroom/Photoshop, והמנוע ילמד את הצבע ויחיל אותו על כל המקבץ.
                </p>

                <label
                  htmlFor="tz-ge-cm-upload"
                  className={`tz-ge-slot-well ${cmEdited ? 'filled' : ''}`}
                  style={{ height: 160 }}
                >
                  {cmEdited ? (
                    <img className="tz-ge-slot-img" src={cmEdited.data} alt="ערוך" />
                  ) : (
                    <div className="tz-ge-slot-empty-content" style={{ padding: 10 }}>
                      <TzIconUpload size={20} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>העלה קובץ ערוך מהמחשב</span>
                    </div>
                  )}
                  <input
                    id="tz-ge-cm-upload"
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const data = await readAsDataUrl(file);
                        setCmEdited({ name: file.name, data });
                      }
                    }}
                  />
                </label>

                {cmError && (
                  <div style={{ background: '#fef2f2', color: '#ef4444', padding: 8, borderRadius: 8, fontSize: 12 }}>
                    {cmError}
                  </div>
                )}

                <button
                  type="button"
                  className="tz-ge-sync-batch-btn"
                  disabled={!cmEdited || cmLearning}
                  onClick={handleLearnColorMatch}
                >
                  <TzIconSparkle size={16} />
                  {cmLearning ? 'לומד צבע...' : 'למד והחל על כל המקבץ'}
                </button>

                {cmLearned && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: 10, borderRadius: 10, fontSize: 12 }}>
                    המראה נלמד והוחל בהצלחה על כל {slideFrames.length} התמונות במקבץ!
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Action Bar */}
          <div className="tz-ge-panel-footer">
            <button
              type="button"
              className="tz-ge-sync-batch-btn"
              onClick={handleSyncToBatch}
              disabled={!currentFrame || slideFrames.length === 0}
            >
              <TzIconCheckCircle size={16} />
              {at === '__all__'
                ? `החל עריכה על כל ${slideFrames.length} התמונות`
                : at === null
                  ? `החל עריכה על כל התמונות ללא מקבץ (${slideFrames.length})`
                  : `החל עריכה על כל המקבץ (${slideFrames.length} תמונות)`}
            </button>

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
