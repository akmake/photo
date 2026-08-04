/* מסירה — the one place a recipe becomes files.
 *
 * Everything before this point is non-destructive: the set has a state, and the
 * state is a list of steps. Here it is rendered ONCE, from the originals, at
 * full quality — which is the property the old "apply to the folder" model
 * could not have. A set that had been graded, retouched and sharpened used to
 * be three round trips through JPEG; now it is one.
 *
 * The run goes file by file rather than handing the whole list to one call. The
 * work is identical, but the counter is real, cancelling means something, and a
 * frame that fails is named instead of taking the batch down with it.
 */

import { useCallback, useRef, useState } from 'react';
import { exportFiles, pickFolder } from '../../api';
import { effectiveRecipe, framesOf, recipeOf } from '../store';
import { IcCheckCircle, IcFolderOpen } from '../../design/Icons';

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export default function DeliverSet({ projectId }: { projectId: string }) {
  const [dest, setDest] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState<{ file: string; error: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [wrote, setWrote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const { perFrame } = recipeOf(projectId);
  const exceptions = Object.keys(perFrame).length;
  const frames = framesOf(projectId);

  const choose = useCallback(async () => {
    setError(null);
    try {
      const chosen = await pickFolder();
      if (chosen) setDest(chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן לפתוח את חלון הבחירה');
    }
  }, []);

  const run = useCallback(async () => {
    if (!dest) return;
    setError(null);
    setRunning(true);
    setDone(0);
    setFailed([]);
    setWrote(null);
    cancelled.current = false;
    try {
      setTotal(frames.length);

      /* Delivered from the RAW through each frame's OWN effective recipe —
       * base, then its situation's light, then its own exception. Sending one
       * recipe for the whole set would deliver the dance floor carrying the
       * garden's colour, which is the exact mistake situations exist to
       * prevent. */
      for (const frame of frames) {
        if (cancelled.current) break;
        try {
          const own = effectiveRecipe(projectId, frame.name).filter((t) => t.enabled);
          const r = await exportFiles([frame.path], own, dest);
          if (r.errors?.length) setFailed((f) => [...f, ...r.errors]);
        } catch (e) {
          setFailed((f) => [
            ...f,
            { file: frame.name, error: e instanceof Error ? e.message : 'שגיאה' },
          ]);
        }
        setDone((d) => d + 1);
      }
      setWrote(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הייצוא נכשל');
    } finally {
      setRunning(false);
    }
  }, [dest, frames, projectId]);

  return (
    <section className="dlv">
      <div className="dlv-what">
        <span>ייכתבו קבצים חדשים לפי מצב הסט</span>
        <b className="mono">{frames.length.toLocaleString('he-IL')}</b>
        <span>תמונות{exceptions > 0 && <> · <b className="mono">{exceptions}</b> חריגות</>}</span>
      </div>

      <div className="dlv-where">
        <button className="btn" onClick={choose} disabled={running}>
          <IcFolderOpen size={16} />
          {dest ? 'שנה יעד' : 'בחר תיקיית יעד'}
        </button>
        {dest
          ? <span className="mono dlv-path" dir="ltr">{dest}</span>
          : <span className="muted">המקורות לא ייגעו — הפלט נכתב לתיקייה שתבחר.</span>}
      </div>

      {error && <p className="cm-error">{error}</p>}

      <div className="dlv-run">
        {!running ? (
          <button className="btn btn-primary" onClick={run} disabled={!dest}>
            כתוב את הסט לדיסק
          </button>
        ) : (
          <button className="btn" onClick={() => { cancelled.current = true; }}>עצור</button>
        )}

        {(running || done > 0) && (
          <div className="dlv-progress">
            <div className="dlv-bar">
              <span style={{ width: total ? `${(done / total) * 100}%` : '0%' }} />
            </div>
            <span className="mono">
              {done.toLocaleString('he-IL')} מתוך {total.toLocaleString('he-IL')}
            </span>
            {failed.length > 0 && <span className="dlv-failed mono">{failed.length} נכשלו</span>}
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

      {/* A partial failure is a normal result, not a crash: the frames that
        * worked are on disk, and the ones that did not are named. */}
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
    </section>
  );
}
