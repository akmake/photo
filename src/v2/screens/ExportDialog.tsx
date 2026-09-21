/* ייצוא — the edited set leaves the program as files.
 *
 * Each frame is rendered once, from its original, through its OWN effective
 * recipe (base → its group's light → its own exception), exactly as the edit
 * screen shows it. One call per frame: the counter is real, stopping means
 * something, and a frame that fails is named instead of taking the run down.
 *
 * A failure is a result, not a crash. The frames that worked are on disk; the
 * ones that did not stay listed until they are retried or the window closes.
 */

import { useMemo, useRef, useState } from 'react';
import { exportFiles, pickFolder } from '../../api';
import type { Frame } from '../../api';
import { effectiveRecipe } from '../../studio/store';

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
const stemOf = (p: string) => (p.split(/[\\/]/).pop() ?? p).replace(/\.[^.]*$/, '');
const same = (a: string, b: string) =>
  a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();

export default function ExportDialog({
  projectId,
  home,
  frames,
  what,
  onClose,
}: {
  projectId: string;
  /** The project's folder; the default destination sits inside it. */
  home?: string;
  frames: Frame[];
  /** What these frames are, in words: "בחירת הלקוח" / "כל התמונות בפרויקט". */
  what: string;
  onClose: () => void;
}) {
  const [dest, setDest] = useState<string | null>(home ? `${home}\\תמונות ערוכות` : null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState<{ frame: Frame; error: string }[]>([]);
  const [finished, setFinished] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  /* Two originals that share a name (IMG_0001.CR2 and IMG_0001.JPG) become one
   * IMG_0001.jpg, and the second overwrites the first. Said before, not after. */
  const clashes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const f of frames) {
      const k = stemOf(f.name).toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.values()].filter((n) => n > 1).length;
  }, [frames]);

  /* The engine refuses to write over an original too; this says it before the
   * run instead of once per frame. */
  const intoOriginals = useMemo(
    () => Boolean(dest) && frames.some((f) => same(dirOf(f.path), dest!)),
    [dest, frames],
  );

  const choose = async () => {
    setError(null);
    try {
      const chosen = await pickFolder();
      if (chosen) setDest(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן לפתוח את חלון הבחירה');
    }
  };

  const run = async (list: Frame[]) => {
    if (!dest || !list.length) return;
    setError(null);
    setRunning(true);
    setFinished(false);
    setStopped(false);
    setDone(0);
    setTotal(list.length);
    setFailed([]);
    stop.current = false;
    for (const frame of list) {
      if (stop.current) break;
      try {
        const own = effectiveRecipe(projectId, frame.name).filter((t) => t.enabled);
        const r = await exportFiles([frame.path], own, dest);
        if (r.errors?.length) {
          setFailed((f) => [...f, { frame, error: r.errors[0].error }]);
        }
      } catch (e) {
        setFailed((f) => [...f, { frame, error: e instanceof Error ? e.message : 'שגיאה' }]);
      }
      setDone((d) => d + 1);
    }
    setStopped(stop.current);
    setRunning(false);
    setFinished(true);
  };

  const pct = total ? Math.round((done / total) * 100) : 0;
  const written = done - failed.length;

  return (
    <div
      className="scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !running) onClose();
      }}
    >
      <section className="dialog tz-export" role="dialog" aria-modal="true" aria-label="ייצוא תמונות">
        <header className="dialog-head">
          <h2>ייצוא תמונות</h2>
          <button className="dialog-x" onClick={onClose} disabled={running} aria-label="סגירה">×</button>
        </header>

        <div className="tz-export-body">
          <p className="tz-export-what">
            <b>{frames.length.toLocaleString('he-IL')}</b> תמונות · {what}
            <span>כל תמונה נכתבת מהמקור, עם העריכה שלה, כ-JPEG באיכות מלאה. המקורות לא נוגעים.</span>
          </p>

          <div className="tz-export-where">
            <span className="tz-export-label">יעד</span>
            {dest
              ? <code dir="ltr">{dest}</code>
              : <span className="tz-export-muted">לא נבחרה תיקייה</span>}
            <button className="btn" onClick={choose} disabled={running}>
              {dest ? 'שנה תיקייה' : 'בחר תיקייה'}
            </button>
          </div>

          {intoOriginals && (
            <p className="tz-export-warn">
              זו התיקייה של המקורות. ייצוא לכאן היה דורס אותם — בחר תיקייה אחרת.
            </p>
          )}
          {clashes > 0 && !intoOriginals && (
            <p className="tz-export-warn">
              {clashes.toLocaleString('he-IL')} שמות קבצים חוזרים (למשל RAW ו-JPEG של אותו צילום).
              בתיקיית היעד יישאר רק אחד מכל זוג.
            </p>
          )}
          {error && <p className="tz-export-fail">{error}</p>}

          {(running || finished) && (
            <div className="tz-export-progress" aria-live="polite">
              <div className="tz-export-bar"><span style={{ width: `${pct}%` }} /></div>
              <span className="mono">
                {done.toLocaleString('he-IL')} מתוך {total.toLocaleString('he-IL')}
              </span>
            </div>
          )}

          {finished && !running && (
            <p className={failed.length ? 'tz-export-fail' : 'tz-export-ok'}>
              {stopped && done < total ? 'הייצוא נעצר. ' : ''}
              {written.toLocaleString('he-IL')} קבצים נכתבו
              {failed.length > 0 && <> · <b>{failed.length.toLocaleString('he-IL')} נכשלו</b></>}
            </p>
          )}

          {failed.length > 0 && !running && (
            <ul className="tz-export-failed">
              {failed.map((f) => (
                <li key={f.frame.path}>
                  <span dir="ltr">{f.frame.name}</span>
                  <span>{f.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="dialog-foot">
          {running ? (
            <button className="btn" onClick={() => { stop.current = true; }}>עצור</button>
          ) : (
            <>
              <button className="btn" onClick={onClose}>{finished ? 'סגור' : 'ביטול'}</button>
              {failed.length > 0 ? (
                <button
                  className="btn btn-primary"
                  onClick={() => run(failed.map((f) => f.frame))}
                  disabled={!dest || intoOriginals}
                >
                  נסה שוב את {failed.length.toLocaleString('he-IL')} שנכשלו
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => run(frames)}
                  disabled={!dest || intoOriginals || !frames.length}
                >
                  {finished ? 'ייצא שוב' : `ייצא ${frames.length.toLocaleString('he-IL')} תמונות`}
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
