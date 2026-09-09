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
import { learnColorModel, renderRecipeAtPath, thumbUrl } from '../../api';
import type { LearnColorResponse } from '../../api';
import type { LearnedColorModel } from '../../types';
import type { ToolInstance } from '../../types';
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

  // Canvas comparison state
  const [showOriginal, setShowOriginal] = useState(false);
  const [renderedSrc, setRenderedSrc] = useState<string | null>(null);
  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [busyRender, setBusyRender] = useState(false);

  // ColorMatch state
  const [cmEdited, setCmEdited] = useState<{ name: string; data: string } | null>(null);
  const [cmLearning, setCmLearning] = useState(false);
  const [cmLearned, setCmLearned] = useState<LearnColorResponse | null>(null);
  const [cmError, setCmError] = useState<string | null>(null);
  const [sheetModel, setSheetModel] = useState<LearnedColorModel | null>(null);

  // Initialize batch
  useEffect(() => {
    if (!choseBatch && batches.length > 0) {
      setAt(batches[0].id);
      setChoseBatch(true);
    }
  }, [batches, choseBatch]);

  // Slides for current batch
  const currentBatch = batches.find((b) => b.id === at) ?? null;
  const slideFrames = useMemo(() => {
    if (at) return framesInBatch(project.id, at);
    if (batches.length > 0) return unassignedFrames(project.id);
    return frames;
  }, [at, batches.length, project.id, frames]);

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

  // Helper to extract slider value
  const getParamVal = useCallback(
    (toolId: string, paramId: string, fallback: number): number => {
      const step = frameEffectiveTools.find((t) => t.toolId === toolId);
      if (step && step.params && step.params[paramId] !== undefined) {
        return Number(step.params[paramId]);
      }
      return fallback;
    },
    [frameEffectiveTools],
  );

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

  // Render the active frame when frame or recipe changes (debounced)
  const renderTimeout = useRef<number | null>(null);
  useEffect(() => {
    if (!currentFrame) {
      setRenderedSrc(null);
      setRawSrc(null);
      return;
    }

    // Warm preview in background
    preview.warm([currentFrame.path]);

    setBusyRender(true);
    if (renderTimeout.current) clearTimeout(renderTimeout.current);

    renderTimeout.current = window.setTimeout(async () => {
      try {
        const tools = effectiveRecipe(project.id, currentFrame.name).filter((t) => t.enabled);
        const [resGraded, resRaw] = await Promise.all([
          renderRecipeAtPath(currentFrame.path, tools, 1400),
          renderRecipeAtPath(currentFrame.path, [], 1400),
        ]);
        setRenderedSrc(resGraded.image);
        setRawSrc(resRaw.image);
      } catch {
        // Fallback to thumb if full render error
        setRenderedSrc(thumbUrl(currentFrame.path, 1200));
        setRawSrc(thumbUrl(currentFrame.path, 1200));
      } finally {
        setBusyRender(false);
      }
    }, 80);

    return () => {
      if (renderTimeout.current) clearTimeout(renderTimeout.current);
    };
  }, [currentFrame, recipe, project.id, preview]);

  // Keyboard navigation for slides (ArrowUp / ArrowDown) and compare (Space)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, select')) return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setShowOriginal(true);
      }
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
  }, [slideFrames.length]);

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

      {/* 2. 3-COLUMN STUDIO WORKSPACE */}
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
                    <span className="tz-ge-slide-idx">
                      {String(idx + 1).padStart(2, '0')}
                    </span>

                    <div className="tz-ge-slide-thumb-wrap">
                      <img
                        className="tz-ge-slide-thumb"
                        src={thumbUrl(f.path, 320)}
                        alt={f.name}
                        loading="lazy"
                      />
                    </div>

                    <div className="tz-ge-slide-info">
                      <span className="tz-ge-slide-title" title={f.name}>
                        {f.name}
                      </span>
                      {isCustomized && (
                        <span className="tz-ge-slide-badge">מותאם</span>
                      )}
                    </div>
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
                title="שקופית קודמת"
              >
                ›
              </button>
              <button
                type="button"
                className="tz-ge-canvas-nav-btn"
                disabled={activeSlideIndex >= slideFrames.length - 1}
                onClick={() => setActiveSlideIndex((i) => Math.min(slideFrames.length - 1, i + 1))}
                title="שקופית הבאה"
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
                  className="tz-ge-canvas-img"
                  src={displayImage}
                  alt={currentFrame.name}
                />
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

        {/* LEFT COLUMN: INSPECTOR & PRIMARY TOOLS */}
        <aside className="tz-ge-tools-panel">
          <div className="tz-ge-panel-head">
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={`tz-sc-source-pill ${activeTab === 'primary' ? 'active' : ''}`}
                style={{ padding: '5px 12px', fontSize: 12 }}
                onClick={() => setActiveTab('primary')}
              >
                <TzIconSliders size={14} />
                כלים ראשוניים
              </button>
              <button
                type="button"
                className={`tz-sc-source-pill ${activeTab === 'colormatch' ? 'active' : ''}`}
                style={{ padding: '5px 12px', fontSize: 12 }}
                onClick={() => setActiveTab('colormatch')}
              >
                <TzIconSparkle size={14} />
                ColorMatch
              </button>
            </div>
          </div>

          <div className="tz-ge-panel-scroll">
            {activeTab === 'primary' ? (
              <>
                {/* 1. Face Retouch & Skin Smoothing */}
                <div className="tz-ge-tool-sec">
                  <div className="tz-ge-tool-sec-head">
                    <span className="tz-ge-tool-sec-title">
                      <TzIconSparkle size={15} />
                      ריטוש פנים והחלקת עור (AI)
                    </span>
                  </div>
                  <div className="tz-ge-tool-sec-body">
                    <SliderField
                      label="עוצמת ריטוש פנים"
                      value={getParamVal('face-retouch', 'strength', 70)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('face-retouch', 'strength', v)}
                    />
                    <SliderField
                      label="החלקת עור"
                      value={getParamVal('skin', 'strength', 60)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('skin', 'strength', v)}
                    />
                    <SliderField
                      label="שימור טקסטורת עור"
                      value={getParamVal('skin', 'texture', 100)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('skin', 'texture', v)}
                    />
                    <SliderField
                      label="ניקוי אדמומיות"
                      value={getParamVal('skin-cleanup', 'redness', 90)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('skin-cleanup', 'redness', v)}
                    />
                    <SliderField
                      label="ברק ולובן עיניים"
                      value={getParamVal('eye-sparkle', 'strength', 50)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('eye-sparkle', 'strength', v)}
                    />
                  </div>
                </div>

                {/* 2. Light & Shadow Sculpting (Contour / Dodge & Burn) */}
                <div className="tz-ge-tool-sec">
                  <div className="tz-ge-tool-sec-head">
                    <span className="tz-ge-tool-sec-title">
                      <TzIconSliders size={15} />
                      פיסול אור וצל (Dodge & Burn)
                    </span>
                  </div>
                  <div className="tz-ge-tool-sec-body">
                    <SliderField
                      label="עצמות לחיים"
                      value={getParamVal('contour', 'cheekbones', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('contour', 'cheekbones', v)}
                    />
                    <SliderField
                      label="מרכז המצח"
                      value={getParamVal('contour', 'forehead', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('contour', 'forehead', v)}
                    />
                    <SliderField
                      label="קו הלסת"
                      value={getParamVal('contour', 'jaw', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('contour', 'jaw', v)}
                    />
                    <SliderField
                      label="מתחת לעיניים"
                      value={getParamVal('contour', 'undereye', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('contour', 'undereye', v)}
                    />
                    <SliderField
                      label="הגברת תאורה קיימת"
                      value={getParamVal('contour', 'sculpt', 0)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('contour', 'sculpt', v)}
                    />
                  </div>
                </div>

                {/* 3. Tone, Exposure & Color */}
                <div className="tz-ge-tool-sec">
                  <div className="tz-ge-tool-sec-head">
                    <span className="tz-ge-tool-sec-title">
                      <TzIconSliders size={15} />
                      טון, חשיפה וצבע
                    </span>
                  </div>
                  <div className="tz-ge-tool-sec-body">
                    <SliderField
                      label="חשיפה"
                      value={getParamVal('tone-color', 'exposure', 0)}
                      min={-200}
                      max={200}
                      onChange={(v) => handleParamChange('tone-color', 'exposure', v)}
                    />
                    <SliderField
                      label="ניגודיות"
                      value={getParamVal('tone-color', 'contrast', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('tone-color', 'contrast', v)}
                    />
                    <SliderField
                      label="היילייטים"
                      value={getParamVal('tone-color', 'highlights', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('tone-color', 'highlights', v)}
                    />
                    <SliderField
                      label="צלליות"
                      value={getParamVal('tone-color', 'shadows', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('tone-color', 'shadows', v)}
                    />
                    <SliderField
                      label="חום (טמפרטורה)"
                      value={getParamVal('tone-color', 'temperature', 0)}
                      min={-200}
                      max={200}
                      onChange={(v) => handleParamChange('tone-color', 'temperature', v)}
                    />
                    <SliderField
                      label="רוויה"
                      value={getParamVal('tone-color', 'saturation', 0)}
                      min={-100}
                      max={100}
                      onChange={(v) => handleParamChange('tone-color', 'saturation', v)}
                    />
                  </div>
                </div>

                {/* 4. Tonal Contrast & Glow */}
                <div className="tz-ge-tool-sec">
                  <div className="tz-ge-tool-sec-head">
                    <span className="tz-ge-tool-sec-title">
                      <TzIconSparkle size={15} />
                      תלת מימד וגלואו (Bloom)
                    </span>
                  </div>
                  <div className="tz-ge-tool-sec-body">
                    <SliderField
                      label="קונטרסט תלת מימד"
                      value={getParamVal('tonal-contrast', 'contrast', 40)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('tonal-contrast', 'contrast', v)}
                    />
                    <SliderField
                      label="עוצמת גלואו"
                      value={getParamVal('glow', 'strength', 30)}
                      min={0}
                      max={100}
                      onChange={(v) => handleParamChange('glow', 'strength', v)}
                    />
                  </div>
                </div>
              </>
            ) : (
              /* ColorMatch Tab */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              disabled={!hasCustomEdits}
            >
              <TzIconCheckCircle size={16} />
              החל עריכה על כל המקבץ ({slideFrames.length} תמונות)
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
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="tz-ge-slider-wrap">
      <div className="tz-ge-slider-meta">
        <span>{label}</span>
        <span className="tz-ge-slider-val">{value}</span>
      </div>
      <input
        type="range"
        className="tz-ge-range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
