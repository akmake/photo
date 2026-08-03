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
import { TOOLS, defaultParams } from '../../toolRegistry';
import type { ToolDef, ToolInstance } from '../../types';
import type { Project } from '../store';
import { activeSteps, recipeOf, setStep, useRecipe } from '../store';
import ProjectFiles from './ProjectFiles';
import SetRecipe from './SetRecipe';
import { IcSliders } from '../../design/Icons';

/** The long edge the panel renders at. Tuning re-renders on every move. */
const PREVIEW_W = 1100;

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

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export default function SetWorkbench({
  project,
  onBack,
}: {
  project: Project;
  onBack: () => void;
}) {
  const recipe = useRecipe(project.id);
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

  const saved = useMemo(() => activeSteps(project.id), [project.id, recipe]);

  // ---- the settled image: the set without the tool being tuned -------------
  useEffect(() => {
    if (!frame) {
      setSettled(null);
      return;
    }
    let alive = true;
    setError(null);
    renderRecipeAtPath(frame, saved, PREVIEW_W)
      .then((r) => alive && setSettled(r.image))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'הרינדור נכשל'));
    return () => {
      alive = false;
    };
  }, [frame, saved]);

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
      renderRecipeAtPath(frame, [...saved.filter((t) => t.toolId !== draft.toolId), draft], PREVIEW_W)
        .then((r) => alive && setTrial(r.image))
        .catch((e) => alive && setError(e instanceof Error ? e.message : 'הרינדור נכשל'))
        .finally(() => alive && setBusy(false));
      return () => {
        alive = false;
      };
    }, 320);
    return () => window.clearTimeout(timer.current);
  }, [frame, draft, saved]);

  const start = useCallback((def: ToolDef) => {
    const already = recipeOf(project.id).base.find((t) => t.toolId === def.id);
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

  const save = useCallback(() => {
    if (!draft) return;
    setStep(project.id, draft);
    setDraft(null);
    setTrial(null);
  }, [draft, project.id]);

  const def = draft ? TOOLS.find((t) => t.id === draft.toolId) : undefined;

  /* Tools already saved that this one will run BEFORE. Saying so is the whole
   * difference between a pipeline and a surprise. */
  const runsBefore = useMemo(() => {
    if (!def) return [];
    return recipeOf(project.id).base
      .filter((t) => t.toolId !== def.id)
      .map((t) => TOOLS.find((x) => x.id === t.toolId))
      .filter((t): t is ToolDef => t !== undefined && t.order > def.order)
      .map((t) => t.label);
  }, [def, project.id, recipe]);

  const shown = showBefore ? settled : (trial ?? settled);

  return (
    <div className="wb" data-surface="studio">
      <header className="wb-head">
        <button className="cm-back" onClick={onBack}>← חזרה לפרויקט</button>
        <h1>עריכה של הסט</h1>
        <p>{project.client} · כלי אחד בכל פעם, נשמר, ואז הבא על גביו.</p>
      </header>

      <div className="wb-body">
        {/* ---------------- the frame ---------------- */}
        <main className="wb-canvas">
          {!frame ? (
            <div className="wb-empty">
              <p>בחר תמונת ייחוס מהסט. מה שתכוון עליה ייקבע על כל התמונות.</p>
              <button className="btn btn-primary" onClick={() => setPicking(true)}>
                בחר תמונת ייחוס
              </button>
            </div>
          ) : (
            <>
              <div className="wb-frame">
                {shown
                  ? <img src={shown} alt="" />
                  : <span className="wb-wait">מרנדר…</span>}
              </div>
              <div className="wb-under">
                <span className="mono" dir="ltr">{baseName(frame)}</span>
                <button className="btn btn-ghost" onClick={() => setPicking(true)}>
                  החלף תמונת ייחוס
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
                {busy && <span className="wb-busy">מרנדר…</span>}
              </div>
            </>
          )}
          {error && <p className="cm-error">{error}</p>}
        </main>

        {/* ---------------- the panel ---------------- */}
        <aside className="wb-panel scroll-y">
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

              <SetRecipe projectId={project.id} />
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
                <button className="btn btn-primary" onClick={save} disabled={busy}>
                  שמור על הסט
                </button>
                <button className="btn" onClick={() => { setDraft(null); setTrial(null); }}>
                  בטל
                </button>
              </div>
              <p className="wb-note">
                שמירה קובעת את הכלי על כל התמונות בסט. אפשר לכבות או להסיר אותו אחר כך,
                ושום קובץ עדיין לא נכתב.
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
            aria-label="בחר תמונת ייחוס"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="dialog-head">
              <h2>בחר תמונת ייחוס</h2>
              <button className="dialog-x" onClick={() => setPicking(false)} aria-label="סגור">✕</button>
            </div>
            <div className="dialog-body cm-picker-body">
              <ProjectFiles
                projectId={project.id}
                onPickOriginal={(path) => {
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
