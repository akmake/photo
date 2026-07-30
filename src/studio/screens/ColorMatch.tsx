/* התאמת צבעים — learn a look from ONE before/after pair, apply it to the folder.
 *
 * This screen judges colour, so it sits at the DARK end of the ramp. That is
 * not a theme choice: a light surround shifts how the eye reads the pair, and
 * the whole screen exists to answer "did it match".
 *
 * The engine already did the hard part (engine/pixel_color.py + /learn-color,
 * /apply-color, /export-color). What was missing was the connection, and the
 * REPORT: the model comes back with numbers about its own fit, and a tool that
 * hides those is asking to be trusted blind on hundreds of files.
 *
 * Batch runs file by file rather than handing the whole list to the engine in
 * one call — same total work, but the counter is real, cancel means something,
 * and a bad frame is named instead of taking the run down with it.
 */

import { useCallback, useRef, useState } from 'react';
import { exportColorFiles, learnColorModel, listImages } from '../../api';
import type { LearnColorResponse, LearnedColorModel } from '../../api';
import { IcCheckCircle, IcFolderOpen, IcSparkle } from '../../design/Icons';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

interface Slot {
  name: string;
  url: string;
}

function Frame({
  label,
  hint,
  slot,
  onPick,
}: {
  label: string;
  hint: string;
  slot: Slot | null;
  onPick: (s: Slot) => void;
}) {
  const id = `pick-${label}`;
  return (
    <label className="cm-slot" htmlFor={id}>
      <span className="cm-slot-label">
        {label}
        <em>{hint}</em>
      </span>
      <span className="cm-slot-frame">
        {slot ? <img src={slot.url} alt="" /> : <span className="cm-slot-empty">בחר קובץ</span>}
      </span>
      <span className="cm-slot-name mono">{slot?.name ?? '—'}</span>
      <input
        id={id}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) onPick({ name: f.name, url: await readAsDataUrl(f) });
        }}
      />
    </label>
  );
}

export default function ColorMatch({ onBack }: { onBack: () => void }) {
  const [before, setBefore] = useState<Slot | null>(null);
  const [after, setAfter] = useState<Slot | null>(null);

  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<LearnColorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [folder, setFolder] = useState('');
  const [dest, setDest] = useState('');
  const [files, setFiles] = useState<string[] | null>(null);

  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<{ file: string; error: string }[]>([]);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  const learn = useCallback(async () => {
    if (!before || !after) return;
    setError(null);
    setLearning(true);
    setLearned(null);
    try {
      setLearned(await learnColorModel(before.url, after.url));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הלמידה נכשלה');
    } finally {
      setLearning(false);
    }
  }, [before, after]);

  const check = useCallback(async () => {
    setError(null);
    setFiles(null);
    try {
      const r = await listImages(folder);
      setFiles(r.files);
      if (!dest) setDest(`${r.folder}\\graded`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'התיקייה לא נמצאה');
    }
  }, [folder, dest]);

  const run = useCallback(async (model: LearnedColorModel) => {
    if (!files?.length || !dest) return;
    cancelled.current = false;
    setRunning(true);
    setDone(0);
    setFailed([]);
    for (const file of files) {
      if (cancelled.current) break;
      try {
        const r = await exportColorFiles([file], model, dest);
        if (r.errors?.length) setFailed((f) => [...f, ...r.errors]);
      } catch (e) {
        setFailed((f) => [...f, { file, error: e instanceof Error ? e.message : 'שגיאה' }]);
      }
      setDone((d) => d + 1);
    }
    setRunning(false);
  }, [files, dest]);

  const report = learned?.report;
  const gap = report ? Math.round(report.gapClosed * 100) : 0;

  return (
    <div className="cm" data-surface="studio">
      <header className="cm-head">
        <button className="cm-back" onClick={onBack}>← חזרה לפרויקט</button>
        <h1>התאמת צבעים</h1>
        <p>זוג אחד — מקור וערוך — ומכאן על כל התיקייה.</p>
      </header>

      {/* ---------- 1. the pair ---------- */}
      <section className="cm-step">
        <div className="cm-step-bar">
          <span className="cm-n mono">1</span>
          <h2>הזוג</h2>
          <p>אותה תמונה פעמיים: לפני ואחרי העריכה שלך.</p>
        </div>

        <div className="cm-pair">
          <Frame label="מקור" hint="הקובץ כפי שיצא מהמצלמה" slot={before} onPick={setBefore} />
          <Frame label="ערוך" hint="אותה תמונה אחרי הצבע שלך" slot={after} onPick={setAfter} />

          <div className="cm-learn">
            <button
              className="btn btn-primary"
              disabled={!before || !after || learning}
              onClick={learn}
            >
              <IcSparkle size={17} />
              {learning ? 'לומד…' : 'למד את הצבע'}
            </button>
            {learning && <p className="cm-note">הלמידה רצה על המחשב שלך. 10–40 שניות.</p>}
          </div>
        </div>
      </section>

      {error && <p className="cm-error">{error}</p>}

      {/* ---------- 2. what was learned ---------- */}
      {learned && report && (
        <section className="cm-step">
          <div className="cm-step-bar">
            <span className="cm-n mono">2</span>
            <h2>מה נלמד</h2>
            <p>לפני שמריצים על 400 קבצים — הנה מה שהמודל עשה על התמונה הזאת עצמה.</p>
          </div>

          <div className="cm-result">
            <figure>
              <img src={learned.preview} alt="" />
              <figcaption>המודל על המקור</figcaption>
            </figure>
            <figure>
              <img src={after!.url} alt="" />
              <figcaption>היעד — העריכה שלך</figcaption>
            </figure>
          </div>

          <div className="cm-numbers">
            <div className={gap >= 70 ? 'good' : gap >= 45 ? 'ok' : 'weak'}>
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
        </section>
      )}

      {/* ---------- 3. the folder ---------- */}
      {learned && (
        <section className="cm-step">
          <div className="cm-step-bar">
            <span className="cm-n mono">3</span>
            <h2>החלה על התיקייה</h2>
            <p>הקבצים נקראים ונכתבים ישירות על המחשב שלך.</p>
          </div>

          <div className="cm-folder">
            <label className="cm-field">
              <span>תיקיית המקור</span>
              <input
                className="field mono"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="D:\Shoots\2026-07-24"
                dir="ltr"
              />
            </label>
            <button className="btn" onClick={check} disabled={!folder.trim()}>
              <IcFolderOpen size={16} />
              בדוק תיקייה
            </button>
          </div>

          {files && (
            <>
              <p className="cm-found">
                <IcCheckCircle size={16} />
                נמצאו <b className="mono">{files.length.toLocaleString('he-IL')}</b> תמונות
              </p>

              <label className="cm-field cm-field-wide">
                <span>לאן נשמר</span>
                <input
                  className="field mono"
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  dir="ltr"
                />
              </label>

              <div className="cm-run">
                {!running ? (
                  <button
                    className="btn btn-primary"
                    disabled={!files.length || !dest.trim()}
                    onClick={() => run(learned.model)}
                  >
                    החל על {files.length.toLocaleString('he-IL')} תמונות
                  </button>
                ) : (
                  <button className="btn" onClick={() => { cancelled.current = true; }}>
                    עצור
                  </button>
                )}

                {(running || done > 0) && (
                  <div className="cm-progress">
                    <div className="cm-bar">
                      <span style={{ width: `${(done / files.length) * 100}%` }} />
                    </div>
                    <span className="mono">
                      {done.toLocaleString('he-IL')} מתוך {files.length.toLocaleString('he-IL')}
                    </span>
                    {failed.length > 0 && (
                      <span className="cm-failed mono">{failed.length} נכשלו</span>
                    )}
                  </div>
                )}
              </div>

              {!running && done > 0 && (
                <p className="cm-done">
                  הסתיים. {(done - failed.length).toLocaleString('he-IL')} קבצים נכתבו אל
                  {' '}<span className="mono" dir="ltr">{dest}</span>
                </p>
              )}

              {failed.length > 0 && (
                <ul className="cm-fail-list">
                  {failed.slice(0, 8).map((f) => (
                    <li key={f.file}>
                      <span className="mono" dir="ltr">{f.file.split(/[\\/]/).pop()}</span>
                      <span>{f.error}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
