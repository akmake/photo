/* התאמת צבעים — learn a look from ONE pair, apply it to that frame's folder.
 *
 * The two halves of the pair come from different worlds, and the screen says so
 * instead of pretending otherwise:
 *
 *   מקור   is chosen FROM THE PROJECT. The photographer already pointed the
 *          project at their folders; asking them to find the same file again in
 *          a system dialog would be the tool forgetting what it was told.
 *   ערוך   is chosen FROM THE COMPUTER, because it was made somewhere else —
 *          Lightroom, Photoshop, a client's retoucher — and it does not live in
 *          the project at all.
 *
 * And once the result is good, "apply to the set" needs no folder picker and no
 * destination: it puts the look ON THE PROJECT.
 *
 * WHAT THIS SCREEN USED TO DO, AND WHY IT STOPPED. It rendered the folder file
 * by file into `<folder>\TEZA` — around 55 minutes for a wedding — and then
 * forgot where it had put them: the destination lived in this component's
 * state, the store had no concept of an output, and /list-images does not
 * recurse, so the result was invisible to the product that made it. Open any
 * tool afterwards and it showed the raw files again.
 *
 * Now the fitted model is written to the project's recipe as one step. It is
 * instantaneous, nothing is written to disk, and every screen that shows a
 * frame renders through it — so the set simply IS graded from that moment on.
 * Files are produced once, at delivery, from the originals; a set can be
 * re-graded any number of times without a single re-encode.
 *
 * This screen judges colour, so it sits at the DARK end of the ramp. A light
 * surround shifts how the eye reads the pair, and answering "did it match" is
 * the only thing this screen is for.
 */

import { useCallback, useEffect, useState } from 'react';
import { learnColorModel, thumbUrl } from '../../api';
import type { LearnColorResponse } from '../../api';
import type { LearnedColorModel } from '../../types';
import type { Project } from '../store';
import {
  colorStep, framesInBatch, setStep, unassignedFrames, useBatches, useProjectFiles,
} from '../store';
import FramePicker from './FramePicker';
import { useSetPreview } from '../preview';
import BeforeAfter from './BeforeAfter';
import { IcCheckCircle, IcEye, IcSparkle } from '../../design/Icons';

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

export default function ColorMatch({
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
  /** The frame from the project, and the folder it came from. */
  const [origin, setOrigin] = useState<{ path: string; folder: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [edited, setEdited] = useState<{ name: string; data: string } | null>(null);

  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<LearnColorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Set once the look has been put on the project, so the screen can say so
   *  without pretending a long job just finished. */
  const [applied, setApplied] = useState(false);
  /** The whole-batch contact sheet. Holds the model being shown, so it can
   *  present a fit made a moment ago OR the look already on the batch. */
  const [sheetModel, setSheetModel] = useState<LearnedColorModel | null>(null);

  /* Set once the photographer has said "yes, redo this batch anyway". Until
   * then a batch that already carries a look does not offer the workflow at
   * all — see the guard block in the markup. */
  const [redo, setRedo] = useState(false);

  /* WHICH BATCH THIS LOOK IS FOR — decided HERE, not inherited in silence.
   *
   * It used to arrive only as a prop from the edit stage, so opening this tool
   * from anywhere else landed on the base with no way to see that, let alone
   * change it. The prop is now just the starting value: a photographer who
   * comes here to grade the dance floor should be able to say so on the screen
   * that grades it. */
  const batches = useBatches(project.id);
  const { frames } = useProjectFiles(project.id);
  const preview = useSetPreview(project.id);
  const [at, setAt] = useState<string | null>(batchId);
  const [chose, setChose] = useState(batchId !== null);

  /* Arriving without a batch — from the overview, or a reloaded link — lands on
   * the FIRST batch, not on the unnamed leftovers. The leftovers are usually a
   * handful of frames nobody cared to name; opening a colour tool on them by
   * default is opening it on the least important thing in the project. */
  useEffect(() => {
    if (!chose && batches.length) {
      setAt(batches[0].id);
      setChose(true);
    }
  }, [batches, chose]);

  const current = batches.find((b) => b.id === at) ?? null;
  const scope = at ? framesInBatch(project.id, at) : unassignedFrames(project.id);
  /** With no batches at all there is nothing to choose — the set IS the scope,
   *  and a selector with one dead option is worse than none. */
  const scoped = batches.length > 0;
  const scopeLabel = current ? current.name : scoped ? 'ללא מקבץ' : 'כל הסט';
  /** For a sentence: a named batch gets quoted, the leftovers get described. */
  const scopePhrase = current
    ? `מקבץ "${current.name}"`
    : scoped ? 'התמונות ללא מקבץ' : 'הפרויקט';

  const existing = colorStep(project.id, at);
  /** Batches still waiting for a look — the useful thing to offer someone who
   *  just landed on one that is already done. */
  const ungraded = batches.filter((b) => !colorStep(project.id, b.id)).length;

  /* Changing the batch drops the pair. A frame from the garden cannot teach the
   * dance floor's colour, and silently keeping it selected under a new heading
   * is precisely how that mistake gets made. */
  const chooseBatch = useCallback((id: string | null) => {
    setAt(id);
    setOrigin(null);
    setLearned(null);
    setApplied(false);
    setSheetModel(null);
    setRedo(false);
  }, []);

  const learn = useCallback(async () => {
    if (!origin || !edited) return;
    setError(null);
    setLearning(true);
    setLearned(null);
    try {
      setLearned(await learnColorModel({ path: origin.path }, { data: edited.data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הלמידה נכשלה');
    } finally {
      setLearning(false);
    }
  }, [origin, edited]);

  /* The look becomes a step on the project. No folder picker, no destination,
   * no batch: there is nothing to render yet, because nothing is being written.
   * One entry per tool — learning a second time replaces the look rather than
   * stacking two grades (studio/store.ts::setStep). */
  const applyToSet = useCallback((model: LearnedColorModel) => {
    setStep(project.id, { toolId: 'pixel-color', params: {}, enabled: true, model }, at);
    setApplied(true);
    /* THE MOMENT THAT MAKES THE WAIT DISAPPEAR. Setting a look invalidates
     * every proxy in this batch — a new recipe is a new key — and the
     * photographer's next move is to go and look at them. Rendering starts now,
     * while they are still reading this screen, instead of when they arrive. */
    setPending(scope.length);
  }, [project.id, at, scope.length]);

  /* Kept out of the callback above: `preview.warm` needs the engine to have
   * acknowledged the NEW key, which happens a render later. */
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!pending) return;
    preview.warm(scope.map((f) => f.path));
    setPending(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, preview.graded]);

  const report = learned?.report;
  const gap = report ? Math.round(report.gapClosed * 100) : 0;

  return (
    <div className="cm" data-surface="studio">
      <header className="cm-head">
        <button className="cm-back" onClick={onBack}>← חזרה לפרויקט</button>
        <h1>התאמת צבעים</h1>
        <p>{project.client} · זוג אחד, ומכאן על כל המקבץ.</p>
      </header>

      {/* ---------- already done? say so BEFORE any work ----------
        *
        * A batch that already carries a look is the most expensive mistake this
        * screen can let happen: fitting a second model costs 40 seconds, and
        * `setStep` REPLACES rather than stacks — so a photographer who did not
        * realise the batch was already graded quietly throws away the match they
        * made last week and cannot get it back.
        *
        * So it is stated at the top, before the pair, and the workflow below is
        * withheld until the question is answered. Not a toast in a corner: a
        * corner is where a warning goes when nobody minds it being missed. */}
      {existing && !redo && (
        <section className="cm-known">
          <div className="cm-known-what">
            <b>{scopeLabel} כבר עבר התאמת צבעים</b>
            <span>
              <b className="mono">{existing.anchors?.length ?? 0}</b> עוגני צבע
              {existing.skinAnchors?.length ? ' · מודל עור נפרד' : ''}
              {' · '}חל על <b className="mono">{scope.length.toLocaleString('he-IL')}</b> תמונות
            </span>
            <span className="cm-known-warn">
              התאמה חדשה תחליף את הקיימת — לא תתווסף מעליה, ואי אפשר לשחזר אותה.
            </span>
          </div>

          <div className="cm-known-do">
            <button className="btn btn-primary" onClick={() => setSheetModel(existing)}>
              <IcEye size={16} />
              צפה בהתאמה שכבר נעשתה
            </button>
            <button className="btn" onClick={() => setRedo(true)}>
              המשך להתאמה חדשה
            </button>
          </div>

          {/* Only when there is somewhere else to go. "0 מקבצים עדיין בלי מראה"
            * is a sentence that offers an option that does not exist. */}
          {scoped && ungraded > 0 && (
            <p className="cm-known-else">
              או בחר מקבץ אחר למטה — {ungraded === 1
                ? 'מקבץ אחד עדיין בלי מראה'
                : `${ungraded} מקבצים עדיין בלי מראה`}.
            </p>
          )}
        </section>
      )}

      {/* ---------- 1. which light ---------- */}
      {scoped && (
        <section className="cm-step">
          <div className="cm-step-bar">
            <span className="cm-n mono">1</span>
            <h2>המקבץ</h2>
            <p>לאיזה אור המראה הזה שייך. מה שיילמד כאן יחול על המקבץ הזה בלבד.</p>
          </div>

          <div className="cm-scope">
            {batches.map((b) => {
              const n = framesInBatch(project.id, b.id).length;
              return (
                <button
                  key={b.id}
                  className={`cm-scope-pick ${at === b.id ? 'on' : ''}`}
                  onClick={() => chooseBatch(b.id)}
                >
                  <b>{b.name}</b>
                  <span className="mono">{n.toLocaleString('he-IL')}</span>
                  {colorStep(project.id, b.id) && <i className="cm-scope-has">יש מראה</i>}
                </button>
              );
            })}
            {/* Frames nobody named are still a real group with a real light, and
              * they are the ones the base grade lands on. Hiding them would make
              * them ungradeable. */}
            {unassignedFrames(project.id).length > 0 && (
              <button
                className={`cm-scope-pick ${at === null ? 'on' : ''}`}
                onClick={() => chooseBatch(null)}
              >
                <b>ללא מקבץ</b>
                <span className="mono">
                  {unassignedFrames(project.id).length.toLocaleString('he-IL')}
                </span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* Everything from here down is the WORK. A batch that already has a
        * look does not show it until the notice above has been answered — the
        * cheapest way to prevent an accidental re-fit is to not put the button
        * on the screen. */}
      {(!existing || redo) && (
      <>
      {/* ---------- 2. the pair ---------- */}
      <section className="cm-step">
        <div className="cm-step-bar">
          <span className="cm-n mono">{scoped ? 2 : 1}</span>
          <h2>הזוג</h2>
          <p>
            אותה תמונה פעמיים: אחת מ{scopePhrase}, ואחת אחרי העריכה שלך.
          </p>
        </div>

        <div className="cm-pair">
          {/* --- from the project --- */}
          <div className="cm-slot">
            <span className="cm-slot-label">
              מקור
              <em>מתוך {scopePhrase}</em>
            </span>
            {/* The RAW, deliberately: the model is fitted raw → edited, so a
              * preview rendered through the recipe would teach it the delta it
              * has already applied. */}
            <button
              className="cm-slot-frame as-button"
              onClick={() => setPicking(true)}
              disabled={!scope.length}
            >
              {origin
                ? <img src={thumbUrl(origin.path, 900)} alt="" />
                : (
                  <span className="cm-slot-empty">
                    {scope.length
                      ? (scoped ? 'בחר תמונה מהמקבץ' : 'בחר תמונה מהפרויקט')
                      : 'אין כאן תמונות'}
                  </span>
                )}
            </button>
            <span className="cm-slot-name mono" dir="ltr">
              {origin ? baseName(origin.path) : '—'}
            </span>
          </div>

          {/* --- from the computer --- */}
          <label className="cm-slot" htmlFor="pick-edited">
            <span className="cm-slot-label">
              ערוך
              <em>מהמחשב — שם ערכת אותה</em>
            </span>
            <span className="cm-slot-frame">
              {edited
                ? <img src={edited.data} alt="" />
                : <span className="cm-slot-empty">בחר קובץ מהמחשב</span>}
            </span>
            <span className="cm-slot-name mono" dir="ltr">{edited?.name ?? '—'}</span>
            <input
              id="pick-edited"
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setEdited({ name: f.name, data: await readAsDataUrl(f) });
              }}
            />
          </label>

          <div className="cm-learn">
            <button
              className="btn btn-primary"
              disabled={!origin || !edited || learning}
              onClick={learn}
            >
              <IcSparkle size={17} />
              {learning ? 'לומד…' : 'למד את הצבע'}
            </button>
            {learning && <p className="cm-note">הלמידה רצה על המחשב שלך. 10–60 שניות.</p>}
          </div>
        </div>
      </section>

      </>
      )}

      {sheetModel && (
        <BeforeAfter
          frames={scope}
          model={sheetModel}
          onClose={() => setSheetModel(null)}
        />
      )}

      {picking && (
        <div className="scrim" onMouseDown={() => setPicking(false)}>
          <div
            className="dialog cm-picker"
            role="dialog"
            aria-modal="true"
            aria-label="בחר תמונת מקור"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="dialog-head">
              <h2>בחר תמונת מקור{scoped ? ` · ${scopeLabel}` : ''}</h2>
              <button className="dialog-x" onClick={() => setPicking(false)} aria-label="סגור">✕</button>
            </div>
            <div className="dialog-body cm-picker-body">
              <FramePicker
                projectId={project.id}
                batchId={at}
                lock
                label="בחר כמקור"
                onPick={(path) => {
                  setOrigin({ path, folder: path.replace(/[\/][^\/]+$/, '') });
                  setLearned(null);
                  setPicking(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {error && <p className="cm-error">{error}</p>}

      {/* ---------- 2. what was learned ---------- */}
      {learned && report && origin && (
        <section className="cm-step">
          <div className="cm-step-bar">
            <span className="cm-n mono">{scoped ? 3 : 2}</span>
            <h2>מה נלמד</h2>
            <p>לפני שקובעים על מקבץ שלם — מה שהמודל עשה על התמונה הזאת עצמה.</p>
          </div>

          <div className="cm-result">
            <figure>
              <img src={learned.preview} alt="" />
              <figcaption>המודל על המקור</figcaption>
            </figure>
            <figure>
              <img src={edited!.data} alt="" />
              <figcaption>היעד — העריכה שלך</figcaption>
            </figure>
          </div>

          <div className="cm-numbers">
            <div className={gap >= 70 ? 'good' : gap >= 45 ? '' : 'weak'}>
              <b className="mono">{gap}%</b>
              <span>מהפער בין המקור ליעד נסגר</span>
            </div>
            <div>
              <b className="mono">{report.clusters}</b>
              <span>עוגני צבע</span>
            </div>
            <div>
              <b className="mono">{report.selectedStrength.toFixed(2)}</b>
              <span>עוצמה שנבחרה</span>
            </div>
            <div>
              <b className="mono">{report.fitSeconds.toFixed(1)}s</b>
              <span>זמן למידה</span>
            </div>
            <div className={report.safe ? 'good' : 'weak'}>
              <b>{report.safe ? 'בטוח' : 'לא אומת'}</b>
              <span>בדיקת ולידציה</span>
            </div>
          </div>

          <p className="cm-note">
            {report.skinModel
              ? `נלמד גם מודל עור נפרד מ-${report.skinSamples.toLocaleString('he-IL')} דגימות — גווני עור מטופלים בנפרד משאר הפריים.`
              : 'לא נמצא מספיק עור בפריים למודל עור נפרד; נלמד מודל צבע כללי בלבד.'}
          </p>

          {/* ---------- 3. put it on the set ---------- */}
          <div className="cm-apply">
            <div className="cm-apply-where">
              <span>המראה הזה ייקבע על</span>
              <b>
                {scopeLabel}
                <i className="cm-apply-n mono">{scope.length.toLocaleString('he-IL')} תמונות</i>
              </b>
              <span>
                {scoped
                  ? 'שאר המקבצים לא ייגעו — לכל אור המראה שלו. '
                  : ''}
                שום קובץ לא נכתב עכשיו; המסכים מציגים את המראה מיד, והקבצים נכתבים
                כשתלחץ "החל" בשלב העריכה.
              </span>
            </div>

            <div className="cm-run">
              <button
                className="btn btn-primary"
                onClick={() => applyToSet(learned.model)}
                disabled={!scope.length}
              >
                {existing ? `החלף את המראה של ${scopeLabel}` : `קבע על ${scopeLabel}`}
              </button>
              {/* The pair proved the model on ONE frame. This is the only way to
                * find out what it does to the other seventy-nine BEFORE
                * committing — and the frames a learned grade breaks on are never
                * the one it was fitted to. */}
              <button
                className="btn"
                onClick={() => setSheetModel(learned.model)}
                disabled={!scope.length}
              >
                <IcEye size={16} />
                הצג את כל התמונות לפני ואחרי
              </button>
              {existing && !applied && (
                <span className="cm-note">
                  ל{scopeLabel} כבר יש מראה. קביעה מחליפה אותו — לא מוסיפה אותו מעליו.
                </span>
              )}
            </div>

            {applied && (
              <p className="cm-done">
                <IcCheckCircle size={16} />
                {' '}נקבע על <b>{scopeLabel}</b> — {scope.length.toLocaleString('he-IL')} תמונות
                מוצגות מעכשיו עם המראה הזה.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
