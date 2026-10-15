import { useEffect, useState } from 'react';
import { softProofSpread, type SoftProofResult } from '../api';

/* THE PAPER PREVIEW — the spread as the lab's paper will show it, before the
 * photographer pays for a print. Research: docs/RESEARCH-album-print-export.md §4.2.
 *
 * Defaults are the ones every print guide gives: relative colorimetric with
 * black-point compensation, paper white NOT simulated (it flattens the image
 * and reads as "dull" when it is only the monitor). Colours the paper cannot
 * print are outlined with a hairline, never filled — the photograph under the
 * warning stays visible. Every control is a visible button. */

interface Props {
  /** The spread drawn by the export renderer, as a PNG data URL. */
  renderImage(): Promise<string>;
  icc: { name: string; data: string };
  title: string;
  onClose(): void;
}

export default function SoftProofView({ renderImage, icc, title, onClose }: Props) {
  const [original, setOriginal] = useState<string | null>(null);
  const [result, setResult] = useState<SoftProofResult | null>(null);
  const [intent, setIntent] = useState<'relative' | 'perceptual'>('relative');
  const [simulatePaper, setSimulatePaper] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [showGamut, setShowGamut] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    renderImage()
      .then((image) => { if (alive) setOriginal(image); })
      .catch((reason) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : 'לא ניתן לצייר את הכפולה');
        setBusy(false);
      });
    return () => { alive = false; };
  }, [renderImage]);

  useEffect(() => {
    if (!original) return;
    let alive = true;
    setBusy(true);
    setError(null);
    softProofSpread(original, icc.data, intent, simulatePaper)
      .then((next) => { if (alive) setResult(next); })
      .catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'תצוגת הנייר נכשלה');
      })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [original, icc.data, intent, simulatePaper]);

  const notPrinter = result && result.profile.deviceClass !== 'prtr';

  return (
    <div className="softproof-overlay" role="dialog" aria-modal="true" aria-label="תצוגת נייר">
      <header>
        <div>
          <strong>תצוגת נייר · {title}</strong>
          <span>{result ? result.profile.description : icc.name}</span>
        </div>
        <button onClick={onClose}>חזרה לעורך</button>
      </header>

      <div className="softproof-controls">
        <button className={showBefore ? '' : 'on'} onClick={() => setShowBefore(false)}>על הנייר</button>
        <button className={showBefore ? 'on' : ''} onClick={() => setShowBefore(true)}>כמו במסך</button>
        <span className="softproof-divider" />
        <button className={showGamut ? 'on' : ''} onClick={() => setShowGamut((value) => !value)}>
          סימון צבעים שהנייר לא מדפיס
        </button>
        <span className="softproof-divider" />
        <button className={intent === 'relative' ? 'on' : ''} onClick={() => setIntent('relative')}
          title="צבעים שבטווח הנייר נשארים מדויקים; רק החריגים נחתכים לגבול">
          צבע מדויק
        </button>
        <button className={intent === 'perceptual' ? 'on' : ''} onClick={() => setIntent('perceptual')}
          title="כל הצבעים נדחסים מעט כדי שגם החריגים ייכנסו בלי מעבר חד">
          דחיסה רכה
        </button>
        <span className="softproof-divider" />
        <button className={simulatePaper ? 'on' : ''} onClick={() => setSimulatePaper((value) => !value)}
          title="מציג את הלבן של הנייר במקום לבן המסך. נראה דהוי יותר — זה המסך, לא התמונה">
          הדמיית לבן הנייר
        </button>
      </div>

      <main className="softproof-stage">
        {error && <div className="softproof-error">{error}</div>}
        {!error && busy && !result && <div className="softproof-wait">מצייר את הכפולה ובונה תצוגת נייר…</div>}
        {result && original && (
          <figure>
            <img src={showBefore ? original : result.image} alt={showBefore ? 'הכפולה כמו במסך' : 'הכפולה על הנייר'} />
            {showGamut && !showBefore && <img className="softproof-gamut" src={result.gamut} alt="" aria-hidden="true" />}
            {busy && <div className="softproof-busy">מעדכן…</div>}
          </figure>
        )}
      </main>

      {result && (
        <footer className="softproof-footer">
          {notPrinter && (
            <span className="softproof-warn">
              הקובץ שנטען אינו קובץ של מדפסת או נייר ({result.profile.deviceClass}) — בקשו מהמעבדה את קובץ ה-ICC של הנייר.
            </span>
          )}
          <span>
            {result.outOfGamutPercent < 0.5
              ? 'כל הצבעים בכפולה בטווח של הנייר.'
              : `כ-${result.outOfGamutPercent.toFixed(1)}% מהכפולה בצבעים שהנייר לא מדפיס במדויק (מסומנים בקו). על הנייר הם ייצאו כפי שמוצג כאן.`}
          </span>
        </footer>
      )}
    </div>
  );
}
