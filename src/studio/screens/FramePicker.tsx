/* Choosing one frame out of the project — batch first, then the photograph.
 *
 * Split out of the import screen, which is about copying files in and has no
 * business also being a picker.
 *
 * The batch step is not decoration. Learning a look for the dance floor from a
 * frame shot in the garden is exactly the mistake batches exist to prevent, and
 * a flat grid of 1,800 frames offers that mistake on every row. Narrowing first
 * also makes the grid a size a person can look at.
 *
 * When the caller already knows the batch (`lock`), the chooser is not shown: a
 * control whose answer is already decided only invites a wrong one.
 */

import { useEffect, useState } from 'react';
import {
  framesInBatch, unassignedFrames, useBatches, useProjectFiles,
} from '../store';
import { useSetPreview } from '../preview';

export default function FramePicker({
  projectId,
  batchId,
  lock = false,
  label = 'בחר',
  onPick,
}: {
  projectId: string;
  /** Which batch to open on. `undefined` offers the whole set. */
  batchId?: string | null;
  /** Hide the chooser and stay on `batchId`. */
  lock?: boolean;
  label?: string;
  onPick: (path: string) => void;
}) {
  const { frames, ready } = useProjectFiles(projectId);
  const batches = useBatches(projectId);
  const preview = useSetPreview(projectId);

  const [at, setAt] = useState<string | null | undefined>(batchId);

  const loose = unassignedFrames(projectId);
  const shown = at === undefined
    ? frames
    : at
      ? framesInBatch(projectId, at)
      : loose;

  /* Hand the engine everything this list shows, so the frames render while the
   * photographer is still reading the batch names rather than after they
   * click. Safe to repeat: the engine de-dupes. */
  useEffect(() => {
    if (shown.length) preview.warm(shown.map((f) => f.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, shown.length]);

  if (!ready) return <p className="pf-note">קורא את התיקייה…</p>;

  if (!frames.length) {
    return <p className="pf-empty">אין עדיין תמונות בפרויקט — צריך לייבא קודם.</p>;
  }

  return (
    <div className="fp">
      {!lock && batches.length > 0 && (
        <div className="fp-batches">
          {batches.map((b) => (
            <button
              key={b.id}
              className={`fp-batch ${at === b.id ? 'on' : ''}`}
              onClick={() => setAt(b.id)}
            >
              <b>{b.name}</b>
              <span className="mono">{framesInBatch(projectId, b.id).length}</span>
            </button>
          ))}
          {loose.length > 0 && (
            <button
              className={`fp-batch ${at === null ? 'on' : ''}`}
              onClick={() => setAt(null)}
            >
              <b>ללא מקבץ</b>
              <span className="mono">{loose.length}</span>
            </button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="pf-empty">אין תמונות במקבץ הזה.</p>
      ) : (
        <div className="pf-grid">
          {shown.map((frame) => (
            <figure className="pf-shot" key={frame.path}>
              <img src={preview.url(frame.path, 320)} alt="" loading="lazy" />
              {preview.pending(frame.path) && <i className="pf-pending">המראה נטען…</i>}
              <figcaption className="mono" dir="ltr">{frame.name}</figcaption>
              <button className="pf-use" onClick={() => onPick(frame.path)}>
                {label}
              </button>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
