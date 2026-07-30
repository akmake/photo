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
 * And once the result is good, "apply to the whole folder" needs no folder
 * picker: the origin frame already named its folder.
 *
 * This screen judges colour, so it sits at the DARK end of the ramp. A light
 * surround shifts how the eye reads the pair, and answering "did it match" is
 * the only thing this screen is for.
 *
 * Batch runs file by file rather than handing the list over in one call: same
 * work, but the counter is real, cancel means something, and a bad frame is
 * named instead of taking the run down with it.
 */

import { useCallback, useRef, useState } from 'react';
import { exportColorFiles, learnColorModel, listImages, thumbUrl } from '../../api';
import type { LearnColorResponse, LearnedColorModel } from '../../api';
import type { Project } from '../store';
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

  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState<{ file: string; error: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [wrote, setWrote] = useState<string | null>(null);
  const cancelled = useRef(false);

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

  /** No folder picker: the origin frame already named its folder. */
  const applyToFolder = useCallback(async (model: LearnedColorModel) => {
    if (!origin) return;
    setError(null);
    setRunning(true);
    setDone(0);
    setFailed([]);
    setWrote(null);
    cancelled.current = false;
    try {
      const list = await listImages(origin.folder);
      setTotal(list.count);
      const dest = `${origin.folder}\\TEZA`;
      for (const file of list.files) {
        if (cancelled.current) break;
        try {
          const r = await exportColorFiles([file], model, dest);
          if (r.errors?.length) setFailed((f) => [...f, ...r.errors]);
        } catch (e) {
          setFailed((f) => [...f, { file, error: e instanceof Error ? e.message : 'שגיאה' }]);
        }
        setDone((d) => d + 1);
      }
      setWrote(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ההחלה נכשלה');
    } finally {
      setRunning(false);
    }
  }, [origin]);

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

          {/* ---------- 3. apply — no folder picker ---------- */}
          <div className="cm-apply">
            <div className="cm-apply-where">
              <span>יוחל על כל התיקייה של תמונת המקור</span>
              <b className="mono" dir="ltr">{origin.folder}</b>
              <span>הפלט נכתב לתת־תיקייה <span className="mono" dir="ltr">\TEZA</span>. המקור לא נגע.</span>
            </div>

            <div className="cm-run">
              {!running ? (
                <button className="btn btn-primary" onClick={() => applyToFolder(learned.model)}>
                  החל על כל התיקייה
                </button>
              ) : (
                <button className="btn" onClick={() => { cancelled.current = true; }}>עצור</button>
              )}

              {(running || done > 0) && (
                <div className="cm-progress">
                  <div className="cm-bar">
                    <span style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
                  </div>
                  <span className="mono">
                    {done.toLocaleString('he-IL')} מתוך {total.toLocaleString('he-IL')}
                  </span>
                  {failed.length > 0 && <span className="cm-failed mono">{failed.length} נכשלו</span>}
                </div>
              )}
            </div>

            {!running && wrote && (
              <p className="cm-done">
                <IcCheckCircle size={16} />
                {' '}הסתיים. {(done - failed.length).toLocaleString('he-IL')} קבצים נכתבו אל
                {' '}<span className="mono" dir="ltr">{wrote}</span>
              </p>
            )}

            {failed.length > 0 && (
              <ul className="cm-fail-list">
                {failed.slice(0, 8).map((f) => (
                  <li key={f.file}>
                    <span className="mono" dir="ltr">{baseName(f.file)}</span>
                    <span>{f.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
