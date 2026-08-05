/* Placeholder for sections whose real screen is still ahead.
 *
 * The old gallery and dashboard screens lived here, filled with invented numbers
 * and labelled "נתוני דמה". They were removed with the rest of the demo data — a
 * screen that shows made-up figures is worse than an honest "coming soon". What
 * remains is one clean placeholder, in the product's own language.
 */

import type { StageId } from '../nav';
import { reload } from '../store';

/* THE READ FAILED — which is not the same screen as "nothing here yet".
 *
 * An empty studio is a fact. An unreachable database is a fault. Printing the
 * first when the second is true tells a photographer their work is gone, and
 * they will believe it, because a list that says zero looks identical either
 * way. Every screen with an empty state routes through here instead.
 *
 * It names the fault and offers the retry, because the usual cause is simply
 * that the engine is not running — and this is one of the very few screens the
 * app can still draw when it is not. */
export function CannotRead({ what, fault }: { what: string; fault: string | null }) {
  return (
    <div className="soon">
      <h1>לא ניתן לקרוא {what}</h1>
      {fault && <p className="soon-sub">{fault}</p>}
      <p className="soon-note">
        זו תקלת קריאה, לא רשימה ריקה — שום דבר לא נמחק. המנוע המקומי צריך לרוץ:
        הפעל <code>dev.bat</code>, או <code>restart-engine.cmd</code> אם רק המנוע נפל.
      </p>
      <button className="btn btn-primary" onClick={reload}>נסה שוב</button>
    </div>
  );
}

/** The first read is in flight. Says nothing about how many there are, because
 *  it does not know yet — that is the entire reason it is a separate state. */
export function StillReading({ what }: { what: string }) {
  return (
    <div className="soon">
      <p className="soon-note">קורא {what} מהמסד…</p>
    </div>
  );
}

export function Simple({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="soon">
      <h1>{title}</h1>
      {sub && <p className="soon-sub">{sub}</p>}
      <p className="soon-note">המסך הזה ייבנה בשלב הבא.</p>
    </div>
  );
}

/** Legacy pre-direction stage routes. Empty now that the demo screens are gone;
 *  any such hash falls back to the placeholder above. */
export const STAGE_SCREENS: Partial<Record<StageId, () => JSX.Element>> = {};
