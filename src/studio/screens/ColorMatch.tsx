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

import { useCallback, useState } from 'react';
import { learnColorModel, thumbUrl } from '../../api';
import type { LearnColorResponse } from '../../api';
import type { LearnedColorModel } from '../../types';
import type { Project } from '../store';
import { colorStep, setStep } from '../store';
import ProjectFiles from './ProjectFiles';
import { IcCheckCircle, IcSparkle } from '../../design/Icons';

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
  onBack,
}: {
  project: Project;
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
  const existing = colorStep(project.id);

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
    setStep(project.id, { toolId: 'pixel-color', params: {}, enabled: true, model });
    setApplied(true);
  }, [project.id]);

  const report = learned?.report;
  const gap = report ? Math.round(report.gapClosed * 100) : 0;

  return (
    <div className="cm" data-surface="studio">
      <header className="cm-head">
        <button className="cm-back" onClick={onBack}>← חזרה לפרויקט</button>
        <h1>התאמת צבעים</h1>
        <p>{project.client} · זוג אחד, ומכאן על כל התיקייה.</p>
      </header>

      {/* ---------- 1. the pair ---------- */}
      <section className="cm-step">
        <div className="cm-step-bar">
          <span className="cm-n mono">1</span>
          <h2>הזוג</h2>
          <p>אותה תמונה פעמיים: אחת מהפרויקט, ואחת אחרי העריכה שלך.</p>
        </div>

        <div className="cm-pair">
          {/* --- from the project --- */}
          <div className="cm-slot">
            <span className="cm-slot-label">
              מקור
              <em>מתוך התיקיות של הפרויקט</em>
            </span>
            <button
              className="cm-slot-frame as-button"
              onClick={() => setPicking(true)}
            >
              {origin
                ? <img src={thumbUrl(origin.path, 900)} alt="" />
                : <span className="cm-slot-empty">בחר תמונה מהפרויקט</span>}
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
              <h2>בחר תמונת מקור</h2>
              <button className="dialog-x" onClick={() => setPicking(false)} aria-label="סגור">✕</button>
            </div>
            <div className="dialog-body cm-picker-body">
              <ProjectFiles
                projectId={project.id}
                onPickOriginal={(path, folder) => {
                  setOrigin({ path, folder });
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
            <span className="cm-n mono">2</span>
            <h2>מה נלמד</h2>
            <p>לפני שמריצים על תיקייה שלמה — מה שהמודל עשה על התמונה הזאת עצמה.</p>
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
              <span>המראה הזה ייקבע על כל הסט של הפרויקט</span>
              <b>{project.client}</b>
              <span>
                שום קובץ לא נכתב. מכאן והלאה כל מסך מציג את הסט עם המראה הזה, וקבצים
                נוצרים פעם אחת — במסירה, מהמקור.
              </span>
            </div>

            <div className="cm-run">
              <button className="btn btn-primary" onClick={() => applyToSet(learned.model)}>
                {existing ? 'החלף את המראה של הסט' : 'קבע על כל הסט'}
              </button>
              {existing && !applied && (
                <span className="cm-note">
                  לסט כבר יש מראה. קביעה מחליפה אותו — לא מוסיפה אותו מעליו.
                </span>
              )}
            </div>

            {applied && (
              <p className="cm-done">
                <IcCheckCircle size={16} />
                {' '}נקבע. הסט של {project.client} מוצג מעכשיו עם המראה הזה.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
