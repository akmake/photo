/* Placeholder for sections whose real screen is still ahead.
 *
 * The old gallery and dashboard screens lived here, filled with invented numbers
 * and labelled "נתוני דמה". They were removed with the rest of the demo data — a
 * screen that shows made-up figures is worse than an honest "coming soon". What
 * remains is one clean placeholder, in the product's own language.
 */

import type { StageId } from '../nav';

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
