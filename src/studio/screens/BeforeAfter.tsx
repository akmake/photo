/* כל התמונות, לפני ואחרי.
 *
 * A look is judged on ONE pair and then lands on eighty photographs. The pair
 * proves the model reproduced that frame's edit; it proves nothing at all about
 * the other seventy-nine — and the frames a learned grade breaks on are never
 * the one it was fitted to. They are the frame with a window behind the
 * subject, the one shot two stops down, the one with a red dress in it.
 *
 * So this shows the whole batch as pairs, before the photographer commits.
 *
 * AFTER = the raw through the LEARNED COLOUR ALONE — not through the project's
 * other tools. The question this screen answers is "did the colour land right
 * everywhere", and rendering cleanup and skin work on every frame would cost
 * minutes and put two variables in a picture meant to isolate one.
 *
 * The engine caches per (recipe, file, width), so the second visit to this
 * screen is served from disk and costs nothing.
 */

import { useEffect, useState } from 'react';
import { previewUrl, registerRecipe, thumbUrl } from '../../api';
import type { LearnedColorModel } from '../../types';
import type { Frame } from '../store';

export default function BeforeAfter({
  frames,
  model,
  onClose,
}: {
  frames: Frame[];
  model: LearnedColorModel;
  onClose: () => void;
}) {
  const [key, setKey] = useState('');
  const [failed, setFailed] = useState(false);
  /** One frame blown up. Judging colour on a 320px tile is judging nothing. */
  const [zoom, setZoom] = useState<Frame | null>(null);

  useEffect(() => {
    let alive = true;
    registerRecipe([{ toolId: 'pixel-color', params: {}, enabled: true, model }])
      .then((k) => alive && setKey(k))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [model]);

  return (
    <div className="scrim ba-scrim" onMouseDown={onClose}>
      <div
        className="ba"
        role="dialog"
        aria-modal="true"
        aria-label="כל התמונות לפני ואחרי"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ba-head">
          <h2>
            לפני ואחרי
            <span className="mono ba-n">{frames.length.toLocaleString('he-IL')}</span>
          </h2>
          <p>המראה שנלמד, על כל תמונה במקבץ. לחיצה על זוג מגדילה אותו.</p>
          <button className="dialog-x" onClick={onClose} aria-label="סגור">✕</button>
        </div>

        {failed && (
          <p className="cm-error">המנוע אינו זמין, ולכן אי אפשר להציג את הצד הערוך.</p>
        )}

        <div className="ba-body scroll-y">
          {frames.map((f) => (
            <figure className="ba-pair" key={f.path} onClick={() => setZoom(f)}>
              <div className="ba-shot">
                <img src={thumbUrl(f.path, 520)} alt="" loading="lazy" />
                <span>לפני</span>
              </div>
              <div className="ba-shot">
                {/* Until the key comes back this is deliberately the RAW, and
                  * labelled as such by the missing key — never a silent raw
                  * frame sitting under a label that says "אחרי". */}
                {key
                  ? <img src={previewUrl(f.path, 520, key)} alt="" loading="lazy" />
                  : <span className="ba-wait">מרנדר…</span>}
                <span>אחרי</span>
              </div>
              <figcaption className="mono" dir="ltr">{f.name}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      {zoom && (
        <div className="scrim ba-zoom-scrim" onMouseDown={() => setZoom(null)}>
          <div className="ba-zoom" onMouseDown={(e) => e.stopPropagation()}>
            <div className="ba-shot">
              <img src={thumbUrl(zoom.path, 1600)} alt="" />
              <span>לפני</span>
            </div>
            <div className="ba-shot">
              {key && <img src={previewUrl(zoom.path, 1600, key)} alt="" />}
              <span>אחרי</span>
            </div>
            <button className="dialog-x" onClick={() => setZoom(null)} aria-label="סגור">✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
