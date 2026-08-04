/* מקבצים — cutting the day into the lights it was shot in.
 *
 * A single grade over a whole wedding is a lie: the garden at 16:00 and the
 * dance floor at 23:00 are two different light sources, and a colour learned
 * from one has no business on the other. This screen is where the photographer
 * says where the boundaries are.
 *
 * THE POOL SHRINKS. Mark a run of frames, name it, and they LEAVE. What is left
 * on screen is exactly what has not been decided yet, which means three things
 * fall out for free:
 *
 *   · "finished" is a visible state — an empty pool — and needs no counter
 *   · no photograph can end up in two batches, because a named frame is gone
 *   · every round is faster than the one before it: 300 → 213 → 79 → 12
 *
 * The pool is ordered by CAPTURE TIME and nothing else, which is what makes
 * shift-click worth having: a batch is a stretch of the day, so in capture
 * order it is a contiguous run. Eighty-seven photographs are two clicks.
 *
 * A batch is a tag, never a folder. Re-assigning is a click; if these were
 * directories it would be a file move, and every path held by a recipe, a
 * status or a painted mask would be pointing at nothing.
 *
 * The pool does NOT have to empty. Frames nobody wanted to name are perfectly
 * valid — they simply render through the project's base instead of a
 * batch's own light. This stage never blocks the next one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addBatch, assignFrames, framesInBatch, removeBatch, renameBatch,
  unassignedFrames, useProjectFiles, useBatches,
} from '../store';
import type { Frame } from '../store';
import { useSetPreview } from '../preview';
import { IcCheckCircle, IcSparkle } from '../../design/Icons';

function clock(shot: number): string {
  if (!shot) return '';
  return new Date(shot * 1000).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Batches({ projectId }: { projectId: string }) {
  const { frames, ready } = useProjectFiles(projectId);
  const batches = useBatches(projectId);
  const preview = useSetPreview(projectId);

  /* The pool is the first place a graded set is seen in bulk — warm it. */
  useEffect(() => {
    if (frames.length) preview.warm(frames.map((f) => f.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames.length, preview.graded]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const anchor = useRef<number | null>(null);

  const pool = useMemo(
    () => unassignedFrames(projectId),
    // frames and batches both move the pool; either one changing rebuilds it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, frames, batches],
  );

  /* Range select is the whole reason the pool is in capture order. Plain click
   * replaces the selection, shift extends from the anchor, ctrl toggles one. */
  const hit = useCallback(
    (index: number, e: React.MouseEvent) => {
      const frame = pool[index];
      setPicked((current) => {
        if (e.shiftKey && anchor.current !== null) {
          const [a, b] = [anchor.current, index].sort((x, y) => x - y);
          const next = new Set(current);
          for (let i = a; i <= b; i += 1) next.add(pool[i].name);
          return next;
        }
        if (e.ctrlKey || e.metaKey) {
          const next = new Set(current);
          if (next.has(frame.name)) next.delete(frame.name);
          else next.add(frame.name);
          anchor.current = index;
          return next;
        }
        anchor.current = index;
        return new Set([frame.name]);
      });
    },
    [pool],
  );

  const create = useCallback(() => {
    if (!picked.size) return;
    addBatch(projectId, name, [...picked]);
    setPicked(new Set());
    setName('');
    anchor.current = null;
  }, [name, picked, projectId]);

  if (!ready) return <p className="pf-note">קורא את התיקייה…</p>;

  if (!frames.length) {
    return (
      <p className="pf-empty">
        אין עדיין תמונות בפרויקט. אחרי הייבוא אפשר לחלק אותן למקבצים.
      </p>
    );
  }

  return (
    <div className="bat">
      {/* ---- what has already been named ---- */}
      {batches.length > 0 && (
        <ul className="bat-list">
          {batches.map((s) => {
            const inside = framesInBatch(projectId, s.id);
            const isOpen = open === s.id;
            return (
              <li key={s.id} className={`bat-row ${isOpen ? 'on' : ''}`}>
                <div className="bat-bar">
                  <input
                    className="bat-name"
                    value={s.name}
                    onChange={(e) => renameBatch(projectId, s.id, e.target.value)}
                    aria-label="שם המקבץ"
                  />
                  <span className="bat-count mono">
                    {inside.length.toLocaleString('he-IL')}
                  </span>
                  {inside.length > 0 && (
                    <span className="bat-when mono">
                      {clock(inside[0].shot)}–{clock(inside[inside.length - 1].shot)}
                    </span>
                  )}
                  <button className="btn" onClick={() => setOpen(isOpen ? null : s.id)}>
                    {isOpen ? 'סגור' : 'פתח'}
                  </button>
                  <button className="bat-drop" onClick={() => removeBatch(projectId, s.id)}>
                    פרק
                  </button>
                </div>

                {isOpen && (
                  <div className="pf-grid">
                    {inside.map((f) => (
                      <figure className="pf-shot" key={f.path}>
                        <img src={preview.url(f.path, 320)} alt="" loading="lazy" />
                        {preview.pending(f.path) && <i className="pf-pending">המראה נטען…</i>}
                        <figcaption className="mono" dir="ltr">{f.name}</figcaption>
                        <button
                          className="pf-use"
                          onClick={() => assignFrames(projectId, [f.name], null)}
                        >
                          החזר לבריכה
                        </button>
                      </figure>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ---- the pool ---- */}
      {pool.length === 0 ? (
        <p className="bat-done">
          <IcCheckCircle size={16} />
          כל התמונות שויכו. אפשר להמשיך לעריכה — לכל מקבץ יהיה הצבע שלו.
        </p>
      ) : (
        <>
          <div className="bat-head">
            <h3>
              נותרו לשיוך
              <span className="bat-count mono">{pool.length.toLocaleString('he-IL')}</span>
            </h3>
            <p className="hint">
              לחיצה בוחרת · Shift בוחר טווח · Ctrl מוסיף אחת. הסדר הוא סדר הצילום,
              ולכן מקבץ הוא בדרך כלל רצף.
            </p>
          </div>

          <div className={`bat-mark ${picked.size ? 'live' : ''}`}>
            <span className="mono bat-picked">{picked.size.toLocaleString('he-IL')}</span>
            <span>נבחרו</span>
            <input
              className="bat-input"
              placeholder="שם המקבץ — ריקודים, חוץ, משפחה…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              disabled={!picked.size}
            />
            <button className="btn btn-primary" onClick={create} disabled={!picked.size}>
              <IcSparkle size={16} />
              צור מקבץ
            </button>
            <button
              className="btn"
              onClick={() => setPicked(new Set(pool.map((f) => f.name)))}
            >
              בחר את כל הנותרות
            </button>
            {picked.size > 0 && (
              <button className="btn" onClick={() => setPicked(new Set())}>נקה בחירה</button>
            )}
          </div>

          <div className="pf-grid bat-pool">
            {pool.map((frame: Frame, i: number) => (
              <figure
                className={`pf-shot bat-cell ${picked.has(frame.name) ? 'picked' : ''}`}
                key={frame.path}
                onClick={(e) => hit(i, e)}
              >
                <img src={preview.url(frame.path, 320)} alt="" loading="lazy" />
                {preview.pending(frame.path) && <i className="pf-pending">המראה נטען…</i>}
                <figcaption className="mono" dir="ltr">
                  {clock(frame.shot)} · {frame.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
