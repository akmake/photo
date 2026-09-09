import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '../../studio/store';
import {
  colorStep,
  framesInBatch,
  setStep,
  unassignedFrames,
  useBatches,
  useProjectFiles,
} from '../../studio/store';
import { learnColorModel, thumbUrl } from '../../api';
import type { LearnColorResponse } from '../../api';
import type { LearnedColorModel } from '../../types';
import { useSetPreview } from '../../studio/preview';
import FramePicker from '../../studio/screens/FramePicker';
import BeforeAfter from '../../studio/screens/BeforeAfter';
import { PRIMARY_TOOLS } from '../../lab/PrimaryTools';
import {
  TzIconSparkle,
  TzIconCheckCircle,
  TzIconUpload,
  TzIconLayers,
  TzIconGallery,
  TzIconSliders,
  TzIconFlask,
  TzIconRefresh,
} from '../TzIcons';
import './stages-v2.css';
import './gallery-edit-v2.css';

const Lab = lazy(() => import('../../lab/Lab'));

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

type EditMode = 'colormatch' | 'primary' | 'advanced';

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
  const preview = useSetPreview(project.id);

  // Active edit mode
  const [mode, setMode] = useState<EditMode>('colormatch');

  // Active batch selection
  const [at, setAt] = useState<string | null>(null);
  const [chose, setChose] = useState(false);

  // Active reference frame for tuning
  const [activeFramePath, setActiveFramePath] = useState<string | null>(null);

  // ColorMatch state
  const [origin, setOrigin] = useState<{ path: string; folder: string } | null>(null);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [pickingRefFrame, setPickingRefFrame] = useState(false);
  const [edited, setEdited] = useState<{ name: string; data: string } | null>(null);

  // Learning & Results
  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<LearnColorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [sheetModel, setSheetModel] = useState<LearnedColorModel | null>(null);
  const [redo, setRedo] = useState(false);
  const [pending, setPending] = useState(0);

  // Initialize on first batch if none selected
  useEffect(() => {
    if (!chose && batches.length > 0) {
      setAt(batches[0].id);
      setChose(true);
    }
  }, [batches, chose]);

  const currentBatch = batches.find((b) => b.id === at) ?? null;
  const scopeFrames = at ? framesInBatch(project.id, at) : unassignedFrames(project.id);
  const scopeLabel = currentBatch ? currentBatch.name : batches.length > 0 ? 'ללא מקבץ' : 'כל הפרויקט';

  // Set default active frame for batch when batch changes
  useEffect(() => {
    if (scopeFrames.length > 0 && (!activeFramePath || !scopeFrames.some((f) => f.path === activeFramePath))) {
      setActiveFramePath(scopeFrames[0].path);
    }
  }, [scopeFrames, activeFramePath]);

  const existingLook = colorStep(project.id, at);

  const chooseBatch = useCallback((id: string | null) => {
    setAt(id);
    setOrigin(null);
    setEdited(null);
    setLearned(null);
    setApplied(false);
    setSheetModel(null);
    setRedo(false);
    setError(null);
  }, []);

  const handleLearn = useCallback(async () => {
    if (!origin || !edited) return;
    setError(null);
    setLearning(true);
    setLearned(null);
    try {
      const res = await learnColorModel({ path: origin.path }, { data: edited.data });
      setLearned(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'למידת הצבע נכשלה');
    } finally {
      setLearning(false);
    }
  }, [origin, edited]);

  const handleApplyToSet = useCallback((model: LearnedColorModel) => {
    setStep(project.id, { toolId: 'pixel-color', params: {}, enabled: true, model }, at);
    setApplied(true);
    setPending(scopeFrames.length);
  }, [project.id, at, scopeFrames.length]);

  useEffect(() => {
    if (!pending) return;
    preview.warm(scopeFrames.map((f) => f.path));
    setPending(0);
  }, [pending, preview, scopeFrames]);

  const report = learned?.report;
  const gap = report ? Math.round(report.gapClosed * 100) : 0;

  const activeFrameName = useMemo(() => {
    if (!activeFramePath) return '';
    return frames.find((f) => f.path === activeFramePath)?.name ?? baseName(activeFramePath);
  }, [activeFramePath, frames]);

  return (
    <div className="tz-stage-container">
      {/* Stage Header */}
      <section className="tz-stage-header">
        <div className="tz-stage-header-copy">
          <div className="tz-stage-tag">שלב 4 · עריכת צבע וסגנון</div>
          <h1>עריכת מקבצים ועיבוד תמונות</h1>
          <p>
            התאם צבעים באמצעות למידת AI מזוג תמונות, כוונן את ארבעת הכלים הראשוניים המעצבים תאורה ופיסול,
            או פתח את המעבדה המלאה לעריכה פרטנית וריטושי עור ופנים מתקדמים.
          </p>
        </div>

        <div className="tz-stage-actions">
          {onBack && (
            <button
              className="tz-btn-projects-secondary"
              type="button"
              onClick={onBack}
            >
              ← חזרה לשליחה ללקוח
            </button>
          )}
          {onNext && (
            <button
              className="tz-btn-projects-primary"
              type="button"
              onClick={onNext}
            >
              המשך לעיצוב אלבום ←
            </button>
          )}
        </div>
      </section>

      {!ready ? (
        <div className="tz-stage-card">
          <p style={{ margin: 0, color: '#71717a' }}>טוען את נתוני הפרויקט...</p>
        </div>
      ) : (
        <div className="tz-ge-container">
          {/* Mode Switcher Segmented Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div className="tz-ge-mode-bar">
              <button
                type="button"
                className={`tz-ge-mode-btn ${mode === 'colormatch' ? 'active' : ''}`}
                onClick={() => setMode('colormatch')}
              >
                <TzIconSparkle size={16} />
                התאמת צבעים (מקור וערוך)
              </button>

              <button
                type="button"
                className={`tz-ge-mode-btn ${mode === 'primary' ? 'active' : ''}`}
                onClick={() => setMode('primary')}
              >
                <TzIconSliders size={16} />
                כלים ראשוניים (אור, צל וגלואו)
              </button>

              <button
                type="button"
                className={`tz-ge-mode-btn ${mode === 'advanced' ? 'active' : ''}`}
                onClick={() => setMode('advanced')}
              >
                <TzIconFlask size={16} />
                מעבדה וכלים מורכבים (ריטוש AI)
              </button>
            </div>

            {/* If in Primary or Advanced mode, show reference frame indicator */}
            {mode !== 'colormatch' && activeFramePath && (
              <div className="tz-ge-frame-info">
                <span style={{ color: '#71717a', fontSize: 13 }}>תמונת ייחוס:</span>
                <span className="tz-ge-frame-name">{activeFrameName}</span>
                <button
                  type="button"
                  className="tz-sc-subtle-btn"
                  onClick={() => setPickingRefFrame(true)}
                >
                  <TzIconGallery size={14} />
                  החלף תמונה
                </button>
              </div>
            )}
          </div>

          {/* Batch Selector Bar */}
          {batches.length > 0 && (
            <div className="tz-ge-batches-card">
              <div className="tz-ge-batches-header">
                <h3 className="tz-ge-batches-title">
                  <TzIconLayers size={18} />
                  בחר מקבץ לעריכה
                </h3>
                <span style={{ fontSize: 13, color: '#71717a' }}>
                  כל מקבץ מקבל סגנון צבע ייעודי לאור שבו צולם
                </span>
              </div>

              <div className="tz-ge-batches-pills">
                {batches.map((b) => {
                  const count = framesInBatch(project.id, b.id).length;
                  const hasGrade = Boolean(colorStep(project.id, b.id));
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`tz-ge-batch-pill ${at === b.id ? 'active' : ''}`}
                      onClick={() => chooseBatch(b.id)}
                    >
                      <span>{b.name}</span>
                      <span className="tz-ge-batch-count">{count}</span>
                      {hasGrade && <span className="tz-ge-batch-tag">יש מראה ✓</span>}
                    </button>
                  );
                })}

                {unassignedFrames(project.id).length > 0 && (
                  <button
                    type="button"
                    className={`tz-ge-batch-pill ${at === null ? 'active' : ''}`}
                    onClick={() => chooseBatch(null)}
                  >
                    <span>ללא מקבץ</span>
                    <span className="tz-ge-batch-count">
                      {unassignedFrames(project.id).length}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* MODE 1: COLOR MATCH */}
          {mode === 'colormatch' && (
            <>
              {/* If already graded, show alert card */}
              {existingLook && !redo && (
                <div className="tz-ge-known-card">
                  <div className="tz-ge-known-info">
                    <h4 className="tz-ge-known-title">
                      <TzIconCheckCircle size={18} />
                      למקבץ "{scopeLabel}" כבר יש מראה צבע פעיל
                    </h4>
                    <span className="tz-ge-known-sub">
                      המראה חל על <strong>{scopeFrames.length}</strong> תמונות במקבץ ({existingLook.anchors?.length ?? 0} עוגני צבע{existingLook.skinAnchors?.length ? ' · מודל עור ייעודי' : ''}).
                    </span>
                  </div>

                  <div className="tz-ge-known-actions">
                    <button
                      type="button"
                      className="tz-sc-subtle-btn"
                      onClick={() => setSheetModel(existingLook)}
                    >
                      <TzIconGallery size={15} />
                      הצג השוואת לפני / אחרי לכל המקבץ
                    </button>
                    <button
                      type="button"
                      className="tz-sc-subtle-btn"
                      style={{ color: 'var(--tz-brand)' }}
                      onClick={() => setRedo(true)}
                    >
                      <TzIconRefresh size={14} />
                      בצע התאמה חדשה
                    </button>
                  </div>
                </div>
              )}

              {/* Workflow Pair: Source vs Edited */}
              {(!existingLook || redo) && (
                <>
                  <div className="tz-ge-pair-grid">
                    {/* Source Photo (From Project) */}
                    <div className="tz-ge-slot-card">
                      <div className="tz-ge-slot-header">
                        <h3 className="tz-ge-slot-title">
                          <TzIconGallery size={17} />
                          תמונת מקור (מהמקבץ)
                        </h3>
                        <span className="tz-ge-slot-subtitle">{scopeLabel}</span>
                      </div>

                      <div
                        className={`tz-ge-slot-well ${origin ? 'filled' : ''}`}
                        onClick={() => setPickingOrigin(true)}
                      >
                        {origin ? (
                          <img
                            className="tz-ge-slot-img"
                            src={thumbUrl(origin.path, 900)}
                            alt="מקור"
                          />
                        ) : (
                          <div className="tz-ge-slot-empty-content">
                            <div className="tz-ge-slot-empty-icon">
                              <TzIconGallery size={22} />
                            </div>
                            <span className="tz-ge-slot-empty-text">
                              בחר תמונה מייצגת מהמקבץ
                            </span>
                            <span className="tz-ge-slot-empty-hint">
                              בחר תמונה בעלת תאורה אופיינית וגווני עור ברורים
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="tz-ge-slot-footer">
                        <span className="tz-ge-slot-file-name">
                          {origin ? baseName(origin.path) : 'טרם נבחרה תמונה'}
                        </span>
                        <button
                          type="button"
                          className="tz-sc-subtle-btn"
                          onClick={() => setPickingOrigin(true)}
                        >
                          {origin ? 'החלף תמונה' : 'בחר מהמקבץ'}
                        </button>
                      </div>
                    </div>

                    {/* Edited Photo (From Computer) */}
                    <div className="tz-ge-slot-card">
                      <div className="tz-ge-slot-header">
                        <h3 className="tz-ge-slot-title">
                          <TzIconUpload size={17} />
                          תמונה ערוכה (מהמחשב)
                        </h3>
                        <span className="tz-ge-slot-subtitle">Lightroom / Photoshop</span>
                      </div>

                      <label
                        htmlFor="tz-ge-file-upload"
                        className={`tz-ge-slot-well ${edited ? 'filled' : ''}`}
                      >
                        {edited ? (
                          <img
                            className="tz-ge-slot-img"
                            src={edited.data}
                            alt="ערוך"
                          />
                        ) : (
                          <div className="tz-ge-slot-empty-content">
                            <div className="tz-ge-slot-empty-icon">
                              <TzIconUpload size={22} />
                            </div>
                            <span className="tz-ge-slot-empty-text">
                              העלה את אותה התמונה לאחר עריכה
                            </span>
                            <span className="tz-ge-slot-empty-hint">
                              לחץ או גרור קובץ JPG / PNG שעבר עריכת צבע
                            </span>
                          </div>
                        )}
                        <input
                          id="tz-ge-file-upload"
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f) {
                              const data = await readAsDataUrl(f);
                              setEdited({ name: f.name, data });
                            }
                          }}
                        />
                      </label>

                      <div className="tz-ge-slot-footer">
                        <span className="tz-ge-slot-file-name">
                          {edited ? edited.name : 'טרם הועלה קובץ'}
                        </span>
                        <label
                          htmlFor="tz-ge-file-upload"
                          className="tz-sc-subtle-btn"
                          style={{ cursor: 'pointer' }}
                        >
                          {edited ? 'החלף קובץ' : 'העלה קובץ'}
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* Action Toolbar: Learn */}
                  <div className="tz-ge-learn-card">
                    <div className="tz-ge-learn-copy">
                      <h4 className="tz-ge-learn-title">למידת מודל הצבע והעור</h4>
                      <p className="tz-ge-learn-desc">
                        המנוע משווה פיקסל-לפיקסל בין המקור לגרסה הערוכה, בונה עוגני צבע תלת-ממדיים ומייצר מודל נפרד לגווני עור כדי לשמור עליהם טבעיים.
                      </p>
                    </div>

                    <button
                      type="button"
                      className="tz-ge-learn-btn"
                      disabled={!origin || !edited || learning}
                      onClick={handleLearn}
                    >
                      <TzIconSparkle size={18} />
                      {learning ? 'מעבד ולומד את הצבע... (10–30 שניות)' : 'למד את הצבע מהזוג ✨'}
                    </button>
                  </div>
                </>
              )}

              {error && (
                <div style={{ background: '#fef2f2', padding: 14, borderRadius: 12, color: '#ef4444', fontSize: 13 }}>
                  {error}
                </div>
              )}

              {/* Learned Results & Application Panel */}
              {learned && report && origin && (
                <div className="tz-ge-results-card">
                  <div className="tz-sc-card-header">
                    <div className="tz-sc-card-title-wrap">
                      <h3 className="tz-sc-card-title">
                        <TzIconSparkle size={18} />
                        תוצאת למידת הצבע
                      </h3>
                      <p className="tz-sc-card-desc">
                        בדוק את תוצאת המודל על תמונת המקור מול היעד לפני החלה על כל המקבץ.
                      </p>
                    </div>
                  </div>

                  <div className="tz-ge-preview-compare">
                    <figure className="tz-ge-compare-fig">
                      <img src={learned.preview} alt="המודל שלמדנו" />
                      <span className="tz-ge-compare-badge">המודל שנלמד על המקור</span>
                    </figure>
                    <figure className="tz-ge-compare-fig">
                      <img src={edited!.data} alt="היעד הערוך שלך" />
                      <span className="tz-ge-compare-badge">היעד (העריכה שלך)</span>
                    </figure>
                  </div>

                  {/* Metrics */}
                  <div className="tz-ge-metrics-row">
                    <div className={`tz-ge-metric-box ${gap >= 70 ? 'good' : ''}`}>
                      <span className="tz-ge-metric-val">{gap}%</span>
                      <span className="tz-ge-metric-lbl">מהפער נסגר</span>
                    </div>
                    <div className="tz-ge-metric-box">
                      <span className="tz-ge-metric-val">{report.clusters}</span>
                      <span className="tz-ge-metric-lbl">עוגני צבע</span>
                    </div>
                    <div className="tz-ge-metric-box">
                      <span className="tz-ge-metric-val">
                        {report.skinModel ? 'כן' : 'לא'}
                      </span>
                      <span className="tz-ge-metric-lbl">מודל עור נפרד</span>
                    </div>
                    <div className="tz-ge-metric-box">
                      <span className="tz-ge-metric-val">{report.fitSeconds.toFixed(1)}s</span>
                      <span className="tz-ge-metric-lbl">זמן למידה</span>
                    </div>
                    <div className={`tz-ge-metric-box ${report.safe ? 'good' : ''}`}>
                      <span className="tz-ge-metric-val">{report.safe ? 'תקין' : 'זהיר'}</span>
                      <span className="tz-ge-metric-lbl">בדיקת ולידציה</span>
                    </div>
                  </div>

                  {/* Apply Actions */}
                  <div className="tz-ge-apply-bar">
                    <span style={{ fontSize: 13.5, color: '#3f3f46' }}>
                      המראה מוכן להחלה על <strong>{scopeFrames.length}</strong> תמונות במקבץ "<strong>{scopeLabel}</strong>".
                    </span>

                    <div className="tz-ge-apply-actions">
                      <button
                        type="button"
                        className="tz-sc-subtle-btn"
                        onClick={() => setSheetModel(learned.model)}
                      >
                        <TzIconGallery size={15} />
                        הצג את כל התמונות לפני ואחרי
                      </button>

                      <button
                        type="button"
                        className="tz-sc-publish-btn"
                        style={{ width: 'auto', padding: '10px 22px' }}
                        onClick={() => handleApplyToSet(learned.model)}
                      >
                        <TzIconCheckCircle size={17} />
                        החל מראה על כל המקבץ ({scopeFrames.length} תמונות)
                      </button>
                    </div>
                  </div>

                  {applied && (
                    <div className="tz-sc-imported-card">
                      <div className="tz-sc-imported-copy">
                        <TzIconCheckCircle size={22} />
                        <span>
                          המראה נקבע בהצלחה על מקבץ <strong>"{scopeLabel}"</strong>! כל {scopeFrames.length} התמונות מוצגות כעת עם הצבע החדש.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* MODE 2: PRIMARY TOOLS (LIGHT & TONE BENCH) */}
          {mode === 'primary' && activeFramePath && (
            <div className="tz-ge-lab-wrapper">
              <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#71717a' }}>טוען את הכלים הראשוניים...</div>}>
                <Lab
                  only={PRIMARY_TOOLS}
                  frame={{
                    projectId: project.id,
                    path: activeFramePath,
                    name: activeFrameName,
                    batchId: at,
                    onChange: () => setPickingRefFrame(true),
                  }}
                />
              </Suspense>
            </div>
          )}

          {/* MODE 3: ADVANCED LAB & RETOUCHING */}
          {mode === 'advanced' && activeFramePath && (
            <div className="tz-ge-lab-wrapper">
              <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#71717a' }}>טוען את מעבדת הכלים המורכבים...</div>}>
                <Lab
                  frame={{
                    projectId: project.id,
                    path: activeFramePath,
                    name: activeFrameName,
                    batchId: at,
                    onChange: () => setPickingRefFrame(true),
                  }}
                />
              </Suspense>
            </div>
          )}

          {/* Modal Dialog: Pick Origin Frame for ColorMatch */}
          {pickingOrigin && (
            <div className="scrim" onMouseDown={() => setPickingOrigin(false)}>
              <div
                className="dialog cm-picker"
                role="dialog"
                aria-modal="true"
                aria-label="בחר תמונת מקור"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="dialog-head">
                  <h2>בחר תמונת מקור · {scopeLabel}</h2>
                  <button
                    className="dialog-x"
                    onClick={() => setPickingOrigin(false)}
                    aria-label="סגור"
                  >
                    ✕
                  </button>
                </div>
                <div className="dialog-body cm-picker-body">
                  <FramePicker
                    projectId={project.id}
                    batchId={at}
                    lock
                    label="בחר תמונה זו כמקור"
                    onPick={(path) => {
                      setOrigin({ path, folder: path.replace(/[\/][^\/]+$/, '') });
                      setLearned(null);
                      setPickingOrigin(false);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Modal Dialog: Pick Reference Frame for Lab Tuning */}
          {pickingRefFrame && (
            <div className="scrim" onMouseDown={() => setPickingRefFrame(false)}>
              <div
                className="dialog cm-picker"
                role="dialog"
                aria-modal="true"
                aria-label="בחר תמונת ייחוס לעריכה"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="dialog-head">
                  <h2>בחר תמונת ייחוס לכוונון · {scopeLabel}</h2>
                  <button
                    className="dialog-x"
                    onClick={() => setPickingRefFrame(false)}
                    aria-label="סגור"
                  >
                    ✕
                  </button>
                </div>
                <div className="dialog-body cm-picker-body">
                  <FramePicker
                    projectId={project.id}
                    batchId={at}
                    lock
                    label="ערוך תמונה זו"
                    onPick={(path) => {
                      setActiveFramePath(path);
                      setPickingRefFrame(false);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Modal Dialog: Before / After Contact Sheet */}
          {sheetModel && (
            <BeforeAfter
              frames={scopeFrames}
              model={sheetModel}
              onClose={() => setSheetModel(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
