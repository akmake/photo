/* שולחן העבודה של הסט — one tool at a time, committed before the next.
 *
 * NOT the twelve-slider panel this product used to open. A photographer picks
 * ONE tool, tunes it on a reference frame with everything already decided about
 * this set applied underneath it, looks at before/after, and either saves it or
 * throws it away. Saving appends a step to the set's recipe; the next tool then
 * opens on top of that result. The stack is built deliberately, one decision at
 * a time, instead of twelve controls all being live at once with no way to say
 * "this part is settled".
 *
 * Before/after is an INSTANT swap between two images that were already
 * rendered — never a re-render, never a fade. A comparison you have to wait for
 * is not a comparison, and a cross-fade makes small differences unjudgeable.
 *
 * ONE THING THIS SCREEN DOES NOT DO, deliberately: it does not run the tools in
 * the order they were added. The engine sorts by pipeline order, because noise
 * reduction after sharpening smears the sharpening and no amount of UI can make
 * that the right answer. So the list is shown in the order things actually
 * happen, and adding a tool that lands earlier than something already saved
 * says so out loud rather than quietly re-ordering the set.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderRecipeAtPath } from '../../api';
import type { RenderStep } from '../../api';
import { TOOLS, defaultParams, getTool } from '../../toolRegistry';
import type { ToolDef, ToolInstance } from '../../types';
import type { Project } from '../store';
import {
  activeSteps, batchOfFrame, effectiveRecipe, framesInBatch, frameSteps, removeFrameStep,
  setFrameStep, setStep, unassignedFrames, useBatches, useProjectFiles, useRecipe,
} from '../store';
import FramePicker from './FramePicker';
import { useSetPreview } from '../preview';
import { useZoomPan } from '../zoom';
import { Histogram, computeDiff } from '../../design/Metering';
import type { Delta } from '../../design/Metering';
import { explainStep, isScaleBlocked } from '../../lab/explain';
import type { StepReport } from '../../lab/explain';
import SetRecipe from './SetRecipe';
import { IcCheck, IcSliders } from '../../design/Icons';

/* THE FRAME IS RENDERED AT THE SIZE IT IS SHOWN AT — measured, not guessed.
 *
 * This was a flat 1100px. On any screen wider than that the picture could not
 * fill its own well no matter what the CSS said, because `max-width:100%` lets
 * an image shrink and never grow: a 1100px render in a 1500px well displays at
 * 1100px with dead space around it. That is the whole "the photo is small"
 * complaint, and it was never a layout bug.
 *
 * Clamped at both ends: below 900 the preview stops being worth judging, and
 * above 2600 the re-render on every slider move costs more than the extra
 * pixels are worth. */
const MIN_W = 900;
const MAX_W = 2600;

/** `pixel-color` is fitted from a pair, not configured — it has no sliders and
 *  is reached through התאמת צבעים. Legacy tools still render for recipes that
 *  already carry them, but are never offered for a new one. */
const PICKABLE: ToolDef[] = TOOLS.filter((t) => !t.legacy && t.id !== 'pixel-color');

const GROUPS: { id: ToolDef['category']; label: string }[] = [
  { id: 'raw', label: 'גלם' },
  { id: 'local-ai', label: 'אנשים' },
  { id: 'tone-color', label: 'טון וצבע' },
  { id: 'scene', label: 'סצנה' },
  { id: 'artistic', label: 'סגנון' },
];

/** The slider values behind a step, for the report line. Mirrors the lab's
 *  local helper; the report reads far better with the numbers next to the
 *  verdict than with the verdict alone. */
function paramNote(toolId: string, params: Record<string, number>): string {
  try {
    return getTool(toolId).params.map((p) => `${p.label} ${params[p.id]}`).join(' · ');
  } catch {
    return '';
  }
}

/** Turn a render's steps into reports, matched back to the instances that
 *  produced them so each one can carry its own settings. */
function reportsFor(steps: RenderStep[], used: ToolInstance[]): StepReport[] {
  return steps.map((s) => {
    const inst = used.find((i) => i.toolId === s.tool);
    return explainStep(s, inst ? paramNote(s.tool, inst.params) : '');
  });
}

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export default function SetWorkbench({
  project,
  batchId = null,
  onBack,
}: {
  project: Project;
  /** Which layer this session writes to. A batch is a LIGHT, and the look
   *  learned under one has no business under another — passing it here is what
   *  keeps the garden and the dance floor two different grades. null is the
   *  project's base. */
  batchId?: string | null;
  onBack: () => void;
}) {
  const recipe = useRecipe(project.id);
  const batches = useBatches(project.id);
  const { frames: allFrames } = useProjectFiles(project.id);
  const preview = useSetPreview(project.id);
  const [frame, setFrame] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const [draft, setDraft] = useState<ToolInstance | null>(null);
  /* Open on arrival. The box of tools is the thing this screen is FOR, and
   * hiding it behind a button on an otherwise empty panel reads as "there is
   * nothing here" — which is exactly how it was first reported. */
  const [choosing, setChoosing] = useState(true);

  /** The set as it stands — what the next tool is applied on top of. */
  const [settled, setSettled] = useState<string | null>(null);
  /** The set with the tool currently being tuned. */
  const [trial, setTrial] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  /* THE SPLIT. Hold-to-compare answers "did this change anything"; it cannot
   * answer "is this better", because the two states never share the screen and
   * the eye has to carry one of them across the gap in memory. A draggable
   * divider puts them side by side on the same photograph. Both are kept: hold is
   * faster for a yes/no, the split is honest for a judgement. */
  const [split, setSplit] = useState(0);   // 0 = off, otherwise 1..99 (%)

  /* THE INSTRUMENTS.
   *
   * `renderRecipeAtPath` has always returned a per-step report and this screen
   * threw it away. That is the difference between a slider you trust and one
   * you argue with: a tool that runs and changes nothing looks exactly like a
   * tool set too weak, so you push it further, and the strength was never the
   * problem. See docs/BUGS.md BUG-001 — five face tools are inert in every
   * preview this app renders, and nothing on screen says so. */
  const [reports, setReports] = useState<StepReport[]>([]);
  const [delta, setDelta] = useState<Delta | null>(null);
  const [gain, setGain] = useState(5);
  const [diffOn, setDiffOn] = useState(false);
  const diffRef = useRef<HTMLCanvasElement | null>(null);
  /** The well's real pixel width, so the render matches the display. */
  const wellRef = useRef<HTMLDivElement | null>(null);
  const [wellW, setWellW] = useState(1400);
  /* The panel used to be a grid column that the stylesheet DROPPED below
   * 1180px, which left it stacked inside a fixed-height box, squeezed to a
   * strip, with no control anywhere to get it back. It is a drawer now, and a
   * drawer has a handle. */
  const [panelOpen, setPanelOpen] = useState(true);

  /* THE SET AS THIS FRAME ACTUALLY IS — base, then its batch's light, then its
   * own exceptions. It used to be `activeSteps(project.id)` with no frame,
   * which returns the BASE ALONE: the reference image was rendered without the
   * batch's learned colour, so every tool was tuned on top of a picture the set
   * never looked like. That is the same defect that made "open the polish tool
   * and you see the raw file" the complaint this whole model exists to fix. */
  /* A ResizeObserver rather than a window listener: the well changes size when
   * the tools drawer opens too, and a window resize is not the only way that
   * happens. Rounded to 200px steps so a drag does not queue a render per
   * pixel, and so the engine's cache keys stay few. */
  useEffect(() => {
    const el = wellRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width * (window.devicePixelRatio || 1);
      const stepped = Math.round(Math.min(MAX_W, Math.max(MIN_W, w)) / 200) * 200;
      setWellW((prev) => (prev === stepped ? prev : stepped));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame]);

  const saved = useMemo(
    () => (frame ? activeSteps(project.id, frame) : []),
    // `recipe` is the store's identity for these steps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, frame, recipe],
  );

  /** Which batch this frame belongs to — shown, so the screen never hides which
   *  light is underneath what is being tuned. */
  const frameBatch = frame ? batchOfFrame(project.id, frame) : undefined;
  const batchName = batches.find((b) => b.id === frameBatch)?.name;

  /* The strip: the rest of THIS batch, in capture order. It replaces the
   * business rail while editing — moving to the next photograph of the set is
   * the one navigation that matters in here, and it was costing a dialog. */
  const strip = useMemo(() => {
    if (!frame) return [];
    return frameBatch
      ? framesInBatch(project.id, frameBatch)
      : unassignedFrames(project.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, frame, frameBatch, allFrames, recipe]);

  // ---- the settled image: the set without the tool being tuned -------------
  useEffect(() => {
    if (!frame) {
      setSettled(null);
      return;
    }
    let alive = true;
    setError(null);
    renderRecipeAtPath(frame, saved, wellW)
      .then((r) => {
        if (!alive) return;
        setSettled(r.image);
        setReports(reportsFor(r.meta.steps, saved));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'הרינדור נכשל'));
    return () => {
      alive = false;
    };
  }, [frame, saved, wellW]);

  // ---- the trial image, debounced -----------------------------------------
  // A slider drag emits dozens of values; rendering each one queues work the
  // engine will finish long after the value stopped being interesting.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!frame || !draft) {
      setTrial(null);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      let alive = true;
      setBusy(true);
      renderRecipeAtPath(frame, [...saved.filter((t) => t.toolId !== draft.toolId), draft], wellW)
        .then((r) => {
          if (!alive) return;
          setTrial(r.image);
          setReports(reportsFor(r.meta.steps, [...saved, draft]));
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : 'הרינדור נכשל'))
        .finally(() => alive && setBusy(false));
      return () => {
        alive = false;
      };
    }, 320);
    return () => window.clearTimeout(timer.current);
  }, [frame, draft, saved, wellW]);

  const start = useCallback((def: ToolDef) => {
    /* Look through the WHOLE stack this frame renders through, not just the
     * base — a tool tuned on this frame or on its batch must reopen with the
     * values it was given, not with defaults. */
    const already = frame
      ? effectiveRecipe(project.id, frame).find((t) => t.toolId === def.id)
      : undefined;
    setDraft(already ?? {
      toolId: def.id,
      params: defaultParams(def),
      enabled: true,
    });
    setChoosing(false);
    setShowBefore(false);
    // Picking a tool before a reference frame is a reasonable order to work in
    // — the panel just needs a frame to show it on, so ask for one then rather
    // than locking the whole tool box until one exists.
    if (!frame) setPicking(true);
  }, [frame, project.id]);

  /* PHOTO BY PHOTO. This screen is where retouching happens, and retouching is
   * judged on one face: a skin setting that flatters this frame is not a
   * setting for the batch, it is a guess about every other face in it. So the
   * default commits to `perFrame`.
   *
   * Putting it on the whole batch is still one click away — but it is a
   * separate, deliberate click, which is the difference between a decision and
   * an accident. */
  const save = useCallback(() => {
    if (!draft || !frame) return;
    setFrameStep(project.id, frame, draft);
    setDraft(null);
    setTrial(null);
  }, [draft, frame, project.id]);

  const saveToBatch = useCallback(() => {
    if (!draft) return;
    setStep(project.id, draft, frameBatch ?? batchId);
    setDraft(null);
    setTrial(null);
  }, [draft, frameBatch, batchId, project.id]);

  const def = draft ? TOOLS.find((t) => t.id === draft.toolId) : undefined;

  /* Tools already saved that this one will run BEFORE. Saying so is the whole
   * difference between a pipeline and a surprise. */
  const runsBefore = useMemo(() => {
    if (!def) return [];
    return (frame ? effectiveRecipe(project.id, frame) : [])
      .filter((t) => t.toolId !== def.id)
      .map((t) => TOOLS.find((x) => x.id === t.toolId))
      .filter((t): t is ToolDef => t !== undefined && t.order > def.order)
      .map((t) => t.label);
  }, [def, frame, project.id, recipe]);

  const shown = showBefore ? settled : (trial ?? settled);
  const view = useZoomPan(frame);

  /* Measured on EVERY result, whether or not the diff view is open. "Did this
   * do anything" is not a question that should cost a click, and the number is
   * the one thing that separates a weak tool from an inert one. Compares the
   * set as it stands against the set with the tool being tuned — so it answers
   * for THIS tool, not for the whole stack. */
  useEffect(() => {
    if (!settled || !trial) {
      setDelta(null);
      return;
    }
    let alive = true;
    computeDiff(settled, trial, diffOn ? diffRef.current : null, gain)
      .then((d) => alive && setDelta(d))
      .catch(() => alive && setDelta(null));
    return () => { alive = false; };
  }, [settled, trial, gain, diffOn]);

  const blocked = reports.some(isScaleBlocked);

  return (
    <div className="wb">
      <header className="wb-head">
        <h1>עריכה</h1>
        <p>
          {project.client}
          {batchName ? ` · ${batchName}` : ''}
          {strip.length > 0 && frame
            ? ` · ${strip.findIndex((f) => f.path === frame) + 1} מתוך ${strip.length}`
            : ''}
        </p>
        {/* The way OUT. It used to be a small "← חזרה לפרויקט" in the corner,
          * which reads as navigation — one more place you might be going — not
          * as "I am finished with this". Nothing is at risk in leaving: every
          * step is already saved to the recipe, so this button is a full stop,
          * not a commit. */}
        <button className="btn btn-primary wb-done" onClick={onBack}>
          <IcCheck size={16} />
          סיימתי לערוך
        </button>
      </header>

      <div className={`wb-body ${panelOpen ? '' : 'panel-shut'} ${strip.length ? '' : 'no-strip'}`}>
        {/* ---------------- the set, as a strip ----------------
          * The slide panel of a presentation tool, and for the same reason: the
          * thing you do most while editing one item is move to the next one. */}
        {strip.length > 0 && (
          <nav className="wb-strip scroll-y" aria-label="תמונות המקבץ">
            {strip.map((f, i) => {
              const own = frameSteps(project.id, f.path).length;
              return (
                <button
                  key={f.path}
                  className={`wb-slide ${f.path === frame ? 'on' : ''}`}
                  onClick={() => { setFrame(f.path); setDraft(null); setTrial(null); }}
                  title={f.name}
                >
                  <span className="wb-slide-n mono">{i + 1}</span>
                  <img src={preview.url(f.path, 200)} alt="" loading="lazy" />
                  {/* A frame carrying edits of its own — so "what have I already
                    * been through" is answerable without opening each one. */}
                  {own > 0 && <i className="wb-slide-dot" aria-label="נערכה" />}
                </button>
              );
            })}
          </nav>
        )}

        {/* ---------------- the frame ---------------- */}
        <main className="wb-canvas">
          {!frame ? (
            <div className="wb-empty">
              <p>בחר מקבץ, ומתוכו תמונה. מה שתכוון כאן נשמר לתמונה הזאת בלבד.</p>
              <button className="btn btn-primary" onClick={() => setPicking(true)}>
                בחר תמונה
              </button>
            </div>
          ) : (
            <>
              <div
                className={`wb-frame ${view.pannable ? 'grab' : ''}`}
                ref={(el) => { wellRef.current = el; view.stageRef.current = el; }}
                onPointerDown={view.onPointerDown}
                onPointerMove={view.onPointerMove}
                onPointerUp={view.onPointerUp}
                onPointerCancel={view.onPointerUp}
              >
                {shown ? (
                  <div className="wb-zoomer" style={view.style}>
                    <img ref={view.imgRef} src={shown} alt="" draggable={false} />
                    {/* The "before" laid over the same pixels and clipped, so
                      * both halves sit in ONE transform. Two separately
                      * positioned images would drift apart the moment the frame
                      * is panned, and a comparison that does not line up is
                      * worse than none. */}
                    {/* The amplified difference, on the same transform so it
                      * can be zoomed into like anything else. */}
                    <canvas
                      ref={diffRef}
                      className="wb-diff"
                      style={{ opacity: diffOn && trial ? 1 : 0 }}
                    />
                    {split > 0 && settled && (
                      <img
                        className="wb-before"
                        src={settled}
                        alt=""
                        draggable={false}
                        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                      />
                    )}
                  </div>
                ) : (
                  <span className="wb-wait">מרנדר…</span>
                )}
                {shown && <Histogram src={shown} className="wb-hist" />}
                {split > 0 && (
                  <>
                    {/* `left`, not `inset-inline-start`. The clip below is
                      * clip-path: inset(), which is PHYSICAL and does not flip
                      * in RTL — so the divider that marks it must not flip
                      * either, or the line lands on the opposite side from the
                      * edge it is supposed to be marking. */}
                    <div className="wb-split-line" style={{ left: `${split}%` }} />
                    <input
                      className="wb-split-grip"
                      type="range"
                      min={1}
                      max={99}
                      value={split}
                      onChange={(e) => setSplit(Number(e.target.value))}
                      aria-label="גבול ההשוואה"
                    />
                    <span className="wb-split-tag before">לפני</span>
                    <span className="wb-split-tag after">אחרי</span>
                  </>
                )}
              </div>
              <div className="wb-under">
                <span className="mono" dir="ltr">{baseName(frame)}</span>
                {batchName && <span className="wb-batch">{batchName}</span>}
                <button className="btn btn-ghost" onClick={() => setPicking(true)}>
                  החלף תמונה
                </button>
                {/* Hold to see the set without the tool being tuned. Mouse down
                  * and up, not a toggle: the eye compares best when the swap is
                  * under the hand. */}
                {draft && (
                  <button
                    className="btn wb-compare"
                    onMouseDown={() => setShowBefore(true)}
                    onMouseUp={() => setShowBefore(false)}
                    onMouseLeave={() => setShowBefore(false)}
                    disabled={!trial}
                  >
                    החזק כדי לראות בלי {def?.label}
                  </button>
                )}

                {/* The split lives next to hold-to-compare because they answer
                  * different questions: hold answers "did this do anything",
                  * the split answers "is this better". */}
                <button
                  className={`btn ${split > 0 ? 'on' : ''}`}
                  onClick={() => setSplit((v) => (v > 0 ? 0 : 50))}
                  disabled={!settled}
                >
                  {split > 0 ? 'סגור השוואה' : 'לפני / אחרי'}
                </button>

                <button
                  className={`btn ${diffOn ? 'on' : ''}`}
                  onClick={() => setDiffOn((v) => !v)}
                  disabled={!trial}
                  title="מראה רק את מה שהשתנה, מוגבר"
                >
                  הפרש
                </button>
                {diffOn && (
                  <select
                    className="wb-gain"
                    value={gain}
                    onChange={(e) => setGain(Number(e.target.value))}
                    aria-label="הגברת ההפרש"
                  >
                    <option value={1}>×1</option>
                    <option value={5}>×5</option>
                    <option value={10}>×10</option>
                    <option value={25}>×25</option>
                  </select>
                )}

                {/* Zoom. Judging retouching at fit is judging a rumour: at fit a
                  * 20MP frame shows about one pixel in twenty. */}
                <span className="wb-zoom">
                  <button
                    className={`btn btn-ghost ${view.zoom === 1 ? 'on' : ''}`}
                    onClick={view.fit}
                    title="התאם למסך (0)"
                  >
                    התאם
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={view.actual}
                    title="גודל אמיתי (1)"
                  >
                    1:1
                  </button>
                  <b className="mono">{view.percent}%</b>
                </span>
                {busy && <span className="wb-busy">מרנדר…</span>}
                <button
                  className="btn btn-ghost wb-panel-toggle"
                  onClick={() => setPanelOpen((v) => !v)}
                >
                  {panelOpen ? 'הסתר כלים' : 'הצג כלים'}
                </button>
              </div>
            </>
          )}
          {error && <p className="cm-error">{error}</p>}
        </main>

        {/* ---------------- the panel ---------------- */}
        <aside className="wb-panel scroll-y">
          <button
            className="wb-panel-x"
            onClick={() => setPanelOpen(false)}
            aria-label="הסתר את הכלים"
          >
            ✕
          </button>
          {!draft ? (
            <>
              <button
                className="btn btn-primary btn-wide"
                onClick={() => setChoosing((v) => !v)}
              >
                <IcSliders size={16} />
                {choosing ? 'סגור את הרשימה' : `הוסף כלי · ${PICKABLE.length}`}
              </button>

              {choosing && (
                <div className="wb-pick">
                  {GROUPS.map((g) => {
                    const items = PICKABLE.filter((t) => t.category === g.id);
                    if (!items.length) return null;
                    return (
                      <section key={g.id}>
                        <h4>{g.label}</h4>
                        {items.map((t) => {
                          const on = recipe.base.some((s) => s.toolId === t.id);
                          return (
                            <button key={t.id} className="wb-pick-row" onClick={() => start(t)}>
                              <span>{t.label}</span>
                              {on && <i>כבר בסט · ערוך</i>}
                            </button>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
              )}

              <SetRecipe projectId={project.id} batchId={batchId} frame={frame} />

              <Report reports={reports} delta={delta} blocked={blocked} />
            </>
          ) : (
            <div className="wb-tune">
              <div className="wb-tune-head">
                <h3>{def?.label}</h3>
                <span className="muted">{def?.kind === 'ai' ? 'רץ במנוע' : 'כלי גלובלי'}</span>
              </div>

              {runsBefore.length > 0 && (
                <p className="wb-order">
                  יורץ לפני {runsBefore.join(' · ')} — סדר הצנרת קובע, לא סדר ההוספה.
                </p>
              )}

              <div className="wb-params">
                {def?.params.map((p) => (
                  <label className="prm" key={p.id}>
                    <span className="prm-label">{p.label}</span>
                    <input
                      className="prm-num mono"
                      type="number"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={draft.params[p.id] ?? p.default}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          params: { ...draft.params, [p.id]: Number(e.target.value) },
                        })
                      }
                    />
                    <input
                      className="prm-slider"
                      type="range"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={draft.params[p.id] ?? p.default}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          params: { ...draft.params, [p.id]: Number(e.target.value) },
                        })
                      }
                      onDoubleClick={() =>
                        setDraft({
                          ...draft,
                          params: { ...draft.params, [p.id]: p.default },
                        })
                      }
                    />
                  </label>
                ))}
              </div>

              <div className="wb-commit">
                <button className="btn btn-primary" onClick={save} disabled={busy || !frame}>
                  שמור על התמונה הזאת
                </button>
                <button className="btn" onClick={() => { setDraft(null); setTrial(null); }}>
                  בטל
                </button>
              </div>
              <button
                className="btn btn-wide wb-to-batch"
                onClick={saveToBatch}
                disabled={busy || !frame}
              >
                החל על כל {batchName ? `"${batchName}"` : 'המקבץ'}
              </button>
              <Report reports={reports} delta={delta} blocked={blocked} />

              <p className="wb-note">
                ברירת המחדל היא התמונה הזאת בלבד — ריטוש נשפט על פנים אחת, והגדרה
                שמחמיאה לפריים הזה היא ניחוש לגבי כל שאר הפנים במקבץ. שום קובץ עדיין
                לא נכתב.
              </p>
            </div>
          )}
        </aside>
      </div>

      {picking && (
        <div className="scrim" onMouseDown={() => setPicking(false)}>
          <div
            className="dialog cm-picker"
            role="dialog"
            aria-modal="true"
            aria-label="בחר מקבץ ותמונה"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="dialog-head">
              <h2>בחר מקבץ, ואז תמונה</h2>
              <button className="dialog-x" onClick={() => setPicking(false)} aria-label="סגור">✕</button>
            </div>
            <div className="dialog-body cm-picker-body">
              <FramePicker
                projectId={project.id}
                batchId={batchId}
                label="ערוך את זו"
                onPick={(path) => {
                  setFrame(path);
                  setPicking(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the report
 *
 * What the engine said it did, in the photographer's language. Brought over
 * from the lab, which was the only place it existed — and the lab is where
 * tools are calibrated, not where the person who has to trust them works.
 *
 * The order is deliberate: whether anything moved at all comes FIRST, because
 * it is the answer that changes what you do next. Everything below it is
 * detail you only want once you know the tool ran.
 */
function Report({
  reports,
  delta,
  blocked,
}: {
  reports: StepReport[];
  delta: Delta | null;
  blocked: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!reports.length && !delta) return null;

  return (
    <section className="wb-report">
      <h3>מה קרה בפועל</h3>

      {/* THE ONE LINE THAT MATTERS. "Nothing moved" and "this is subtle" look
        * identical on screen and are completely different problems. */}
      {delta && (
        <p className={`wb-delta ${delta.max <= 1 ? 'zero' : delta.p3 < 1 ? 'tiny' : 'real'}`}>
          {delta.max <= 1
            ? 'הכלי לא שינה כלום — אפס פיקסלים זזו'
            : `שינוי מרבי ${delta.max}/255 · ${delta.p3.toFixed(2)}% מהפיקסלים · ממוצע ${delta.mean.toFixed(3)}`}
        </p>
      )}

      {/* A tool that skipped because the preview is too small is not a weak
        * tool, and the fix is not the slider. See docs/BUGS.md BUG-001. */}
      {blocked && (
        <p className="wb-blocked">
          כלי דילג כי הפנים קטנות מדי ברזולוציית התצוגה. הסליידר לא ישנה את זה —
          בייצוא הוא כן ירוץ, ברזולוציה המלאה.
        </p>
      )}

      <ul className="wb-steps">
        {reports.map((r) => (
          <li className={`wb-step ${r.verdict}`} key={r.toolId}>
            <button className="wb-step-head" onClick={() => setOpen(open === r.toolId ? null : r.toolId)}>
              <b>{r.label}</b>
              <span className="wb-step-verdict">{r.headline}</span>
              <span className="mono wb-step-ms">{r.ms}ms</span>
            </button>
            {open === r.toolId && (
              <div className="wb-step-body">
                {r.facts.length > 0 && (
                  <ul className="wb-facts">
                    {r.facts.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                )}
                {/* The raw tree, for when the summary is not enough. It is the
                  * engine's own words and is never edited on the way here. */}
                <pre className="wb-raw mono" dir="ltr">{r.raw}</pre>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
