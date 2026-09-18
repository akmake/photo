/* התאמת צבעים — the panel, rebuilt so the screen says what it is doing.
 *
 * WHAT WAS WRONG. The tab was one upload box, one sentence and one button that
 * both learned the colour AND set it on the whole batch. Three separate
 * problems, and none of them was the maths:
 *
 *   * THE PAIR WAS HALF INVISIBLE. Learning a look needs two photographs —
 *     the frame as it came out of the camera, and the same frame after someone
 *     graded it. Only the second had a place on screen. The first was "the
 *     photograph you happen to have open", which the screen never said, so
 *     there was nothing to check and nothing to correct.
 *   * `tz-ge-slot-well` WAS IN NO STYLESHEET. The upload target rendered as an
 *     unstyled label. Not a design opinion — the class did not exist.
 *   * LEARN AND APPLY WERE ONE CLICK. The result landed on a whole batch
 *     before anyone had seen whether the colour actually matched.
 *
 * So: the pair is two slots with the photographs in them, learning shows what
 * it got against what was asked for, and putting it on the set is its own
 * button with the number of photographs written on it.
 */
import { useCallback, useState } from 'react';

import { learnColorModel, thumbUrl } from '../../api';
import type { LearnColorResponse } from '../../api';
import type { LearnedColorModel } from '../../types';
import FramePicker from '../../studio/screens/FramePicker';
import { TzIconSparkle, TzIconUpload, TzIconCheckCircle, TzIconGallery } from '../TzIcons';

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
    fr.readAsDataURL(file);
  });
}

/** Where a learned look would be written, decided by the caller because it is
 *  the one holding the batch. `blocked` carries the reason in the photographer's
 *  words — a disabled button with no reason is a screen refusing to explain
 *  itself. */
export type ApplyTarget =
  | { kind: 'base' | 'batch'; label: string; count: number }
  | { kind: 'blocked'; why: string };

export default function ColorMatchPanel({
  projectId,
  batchId,
  frame,
  target,
  onApply,
}: {
  projectId: string;
  /** The batch the editor is showing, for the picker to open on. */
  batchId: string | null;
  /** The photograph on screen — the source unless another is chosen. */
  frame: { path: string; name: string } | null;
  target: ApplyTarget;
  /** Put the learned look on the set. The caller owns the recipe. */
  onApply: (model: LearnedColorModel) => void;
}) {
  /* The source. Null means "the frame on screen" rather than a copy of its
   * path, so stepping to another photograph moves the source with it — until
   * he picks one deliberately, and then it stays where he put it. */
  const [source, setSource] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [edited, setEdited] = useState<{ name: string; data: string } | null>(null);
  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState<LearnColorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const sourcePath = source ?? frame?.path ?? null;

  /* Anything that changes the pair invalidates what was learned from it. A
   * result left on screen under a new photograph is the screen lying. */
  const resetResult = useCallback(() => {
    setLearned(null);
    setApplied(false);
    setError(null);
  }, []);

  const learn = useCallback(async () => {
    if (!sourcePath || !edited) return;
    setError(null);
    setLearning(true);
    setLearned(null);
    setApplied(false);
    try {
      setLearned(await learnColorModel({ path: sourcePath }, { data: edited.data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא הצלחתי ללמוד את הצבע מהזוג הזה');
    } finally {
      setLearning(false);
    }
  }, [sourcePath, edited]);

  const gap = learned ? Math.round(learned.report.gapClosed * 100) : 0;
  const ready = Boolean(sourcePath && edited);

  return (
    <div className="tz-cm">
      <div className="tz-cm-intro">
        <h3>התאמת צבעים</h3>
        <p>
          תמונה אחת שכבר ערכת במקום אחר מלמדת את התוכנה את הצבע שלך, והיא מחילה
          אותו על שאר התמונות.
        </p>
      </div>

      {/* ---------- 1. the frame as it came out of the camera ---------- */}
      <section className="tz-cm-step">
        <header>
          <span className="tz-cm-n">1</span>
          <div>
            <b>לפני</b>
            <i>התמונה כמו שיצאה מהמצלמה</i>
          </div>
        </header>

        <div className={`tz-cm-well ${sourcePath ? 'filled' : ''}`}>
          {sourcePath ? (
            <img src={thumbUrl(sourcePath, 520)} alt="" />
          ) : (
            <div className="tz-cm-empty">
              <TzIconGallery size={20} />
              <span>אין תמונה פתוחה</span>
            </div>
          )}
        </div>

        {sourcePath && (
          <div className="tz-cm-well-foot">
            <span className="tz-cm-file">{baseName(sourcePath)}</span>
            <button type="button" className="tz-cm-link" onClick={() => setPicking(true)}>
              בחר תמונה אחרת
            </button>
          </div>
        )}
      </section>

      <div className="tz-cm-arrow" aria-hidden="true">↓</div>

      {/* ---------- 2. the same frame, graded somewhere else ---------- */}
      <section className="tz-cm-step">
        <header>
          <span className="tz-cm-n">2</span>
          <div>
            <b>אחרי</b>
            <i>אותה תמונה, אחרי שערכת אותה</i>
          </div>
        </header>

        <label
          htmlFor="tz-cm-upload"
          className={`tz-cm-well drop ${edited ? 'filled' : ''}`}
        >
          {edited ? (
            <img src={edited.data} alt="" />
          ) : (
            <div className="tz-cm-empty">
              <TzIconUpload size={20} />
              <span>גרור לכאן את הקובץ הערוך</span>
              <i>או לחץ לבחירה מהמחשב</i>
            </div>
          )}
          <input
            id="tz-cm-upload"
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              resetResult();
              setEdited({ name: file.name, data: await readAsDataUrl(file) });
            }}
          />
        </label>

        {edited && (
          <div className="tz-cm-well-foot">
            <span className="tz-cm-file">{edited.name}</span>
            <button
              type="button"
              className="tz-cm-link"
              onClick={() => { setEdited(null); resetResult(); }}
            >
              הסר
            </button>
          </div>
        )}
      </section>

      <button
        type="button"
        className="tz-cm-learn"
        disabled={!ready || learning}
        onClick={learn}
      >
        <TzIconSparkle size={16} />
        {learning ? 'לומד את הצבע…' : 'למד את הצבע מהזוג הזה'}
      </button>

      {!ready && !learning && (
        <p className="tz-cm-hint">
          צריך את שתי התמונות — אותה תמונה לפני ואחרי — כדי שיהיה מה להשוות.
        </p>
      )}

      {error && <p className="tz-cm-error">{error}</p>}

      {/* ---------- 3. what came out, before it touches the set ---------- */}
      {learned && (
        <section className="tz-cm-result">
          <header>
            <span className="tz-cm-n">3</span>
            <div>
              <b>מה יצא</b>
              <i>על התמונה הזאת, לפני שנוגעים בשאר</i>
            </div>
          </header>

          <div className="tz-cm-pair">
            <figure>
              <img src={learned.preview} alt="" />
              <figcaption>מה שהתוכנה עשתה</figcaption>
            </figure>
            <figure>
              <img src={edited!.data} alt="" />
              <figcaption>מה שביקשת</figcaption>
            </figure>
          </div>

          {/* The one number worth reading. The rest of the report is diagnostic
           *  and belongs in the lab, not in the panel he works in. */}
          <div className={`tz-cm-score ${gap >= 70 ? 'good' : gap >= 45 ? 'ok' : 'weak'}`}>
            <div className="tz-cm-score-head">
              <b>{gap}%</b>
              <span>מהדרך לצבע שלך</span>
            </div>
            <div className="tz-cm-bar"><i style={{ width: `${Math.min(100, gap)}%` }} /></div>
            <p>
              {gap >= 70
                ? 'התאמה טובה. אפשר להחיל על השאר.'
                : gap >= 45
                  ? 'התאמה חלקית — תסתכל על הזוג למעלה לפני שתחיל על השאר.'
                  : 'ההתאמה חלשה. בדרך כלל זה אומר שהתמונות אינן אותה תמונה, או שהעריכה כוללת שינויים מקומיים שצבע לבדו לא יכול לשחזר.'}
            </p>
          </div>

          {!learned.report.safe && (
            <p className="tz-cm-warn">
              המודל לא עבר את בדיקת האימות הפנימית. הוא יעבוד, אבל כדאי לבדוק
              תמונה-שתיים מהשאר לפני שמוסרים.
            </p>
          )}

          {target.kind === 'blocked' ? (
            <p className="tz-cm-warn">{target.why}</p>
          ) : (
            <>
              <button
                type="button"
                className="tz-cm-apply"
                onClick={() => { onApply(learned.model); setApplied(true); }}
              >
                <TzIconCheckCircle size={16} />
                החל על כל {target.count.toLocaleString('he-IL')} התמונות
              </button>
              <p className="tz-cm-where">{target.label}</p>
            </>
          )}

          {applied && (
            <p className="tz-cm-done">
              <TzIconCheckCircle size={14} />
              הצבע הוחל. כל התמונות בטווח הזה נראות עכשיו לפי העריכה שלך.
            </p>
          )}
        </section>
      )}

      {picking && (
        <div className="tz-cm-scrim" onMouseDown={() => setPicking(false)}>
          <div
            className="tz-cm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="בחירת תמונת מקור"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="tz-cm-dialog-head">
              <h4>איזו תמונה ערכת?</h4>
              <button type="button" onClick={() => setPicking(false)} aria-label="סגור">✕</button>
            </div>
            <div className="tz-cm-dialog-body">
              <FramePicker
                projectId={projectId}
                batchId={batchId}
                lock
                label="בחר כמקור"
                onPick={(path) => {
                  setSource(path);
                  resetResult();
                  setPicking(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
