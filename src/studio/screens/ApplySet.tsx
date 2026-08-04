/* החלה — the moment the recipe becomes the second folder.
 *
 * A project holds two folders of photographs and no more:
 *
 *   תמונות גלם   the truth. Written once, at import, never again.
 *   תמונות       one current version per frame, REPLACED on every apply.
 *
 * Applying a batch renders each of its frames and overwrites its file in
 * `תמונות`. There is no folder per change and no history — the photographer
 * asked for one current version, and one is what there is.
 *
 * THE ONE DECISION THAT IS NOT VISIBLE ON THIS SCREEN: every replacement is
 * computed from the RAW through the whole current recipe, never on top of the
 * file already sitting there. Stacking would make a fifth tool the fifth JPEG
 * generation — the texture budget this engine is measured against (95%) does
 * not survive that — and it would make every step permanent the moment it ran.
 * Rendering from the raw costs nothing extra and keeps "switch that off" a
 * question that still has an answer.
 *
 * It runs file by file rather than handing the list to one call: the work is
 * identical, but the counter is real, cancelling means something, and a frame
 * that fails is named instead of taking the batch down with it.
 */

import { useCallback, useRef, useState } from 'react';
import { applyToFrame } from '../../api';
import {
  framesInBatch, getProject, reloadFrames, batchRecipe, unassignedFrames,
} from '../store';
import type { Frame } from '../store';
import { IcCheckCircle, IcSparkle } from '../../design/Icons';

export default function ApplySet({
  projectId,
  batchId,
}: {
  projectId: string;
  /** null applies the base to the frames that belong to no batch. */
  batchId: string | null;
}) {
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState<{ file: string; error: string }[]>([]);
  const [running, setRunning] = useState(false);
  const [wrote, setWrote] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const steps = batchRecipe(projectId, batchId).filter((t) => t.enabled);
  const frames: Frame[] = batchId
    ? framesInBatch(projectId, batchId)
    : unassignedFrames(projectId);

  const run = useCallback(async () => {
    const home = getProject(projectId)?.home;
    if (!home) {
      setError('לפרויקט אין עדיין תיקייה על הדיסק');
      return;
    }
    setError(null);
    setRunning(true);
    setDone(0);
    setWrote(0);
    setFailed([]);
    setTotal(frames.length);
    cancelled.current = false;

    const editedDir = `${home}\\תמונות`;
    let written = 0;
    for (const frame of frames) {
      if (cancelled.current) break;
      try {
        // From `frame.path` — the RAW — and not from `frame.shown`, which is
        // the previous output. This is the whole no-stacking rule, in one line.
        await applyToFrame(frame.path, editedDir, steps);
        written += 1;
        setWrote(written);
      } catch (e) {
        setFailed((f) => [...f, {
          file: frame.name,
          error: e instanceof Error ? e.message : 'שגיאה',
        }]);
      }
      setDone((d) => d + 1);
    }
    await reloadFrames(projectId);
    setRunning(false);
  }, [frames, projectId, steps]);

  if (!frames.length) {
    return (
      <p className="hint">
        {batchId
          ? 'אין תמונות במקבץ הזה עדיין.'
          : 'כל התמונות שויכו למקבצים — בחר מקבץ למעלה כדי להחיל עליו.'}
      </p>
    );
  }

  const already = frames.filter((f) => f.edited).length;

  return (
    <section className="apl">
      <div className="apl-what">
        <b className="mono">{frames.length.toLocaleString('he-IL')}</b>
        <span>תמונות</span>
        <b className="mono">{steps.length}</b>
        <span>שלבים פעילים</span>
        {already > 0 && (
          <i className="apl-already">· <b className="mono">{already}</b> כבר נכתבו</i>
        )}
      </div>

      {error && <p className="cm-error">{error}</p>}

      <div className="apl-run">
        {!running ? (
          <button className="btn btn-primary" onClick={run} disabled={!steps.length}>
            <IcSparkle size={16} />
            החל על המקבץ
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

      {!steps.length && (
        <p className="hint">
          אין עדיין מה להחיל — קבע צבע או כלי על המקבץ, ואז הקבצים ייכתבו.
        </p>
      )}

      {!running && wrote > 0 && (
        <p className="cm-done">
          <IcCheckCircle size={16} />
          {' '}<b className="mono">{wrote.toLocaleString('he-IL')}</b> תמונות הוחלפו בתיקיית
          {' '}<span className="mono" dir="ltr">תמונות</span>. הגלם לא נגע.
        </p>
      )}

      {/* A partial failure is a normal result, not a crash: the frames that
        * worked are on disk, and the ones that did not are named. */}
      {failed.length > 0 && (
        <ul className="cm-fail-list">
          {failed.slice(0, 8).map((f) => (
            <li key={f.file}>
              <span className="mono" dir="ltr">{f.file}</span>
              <span>{f.error}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
