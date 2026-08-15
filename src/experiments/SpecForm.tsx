/* מפרט הדפוס — the form.
 *
 * Seven numbers off the lab's spec sheet. They start EMPTY on purpose: a
 * pre-filled "30×30, bleed 3" would render a convincing spread that quietly
 * belongs to nobody's album. Nothing builds until they are real.
 */

import { SPEC_FIELDS, specProblems, type SpecDraft } from './printSpec';

export default function SpecForm({
  draft,
  onChange,
  onSubmit,
}: {
  draft: SpecDraft;
  onChange: (draft: SpecDraft) => void;
  onSubmit: () => void;
}) {
  const problems = specProblems(draft);
  const ready = problems.length === 0;

  return (
    <section className="specform">
      <header className="specform-head">
        <p className="label">מפרט הדפוס</p>
        <h2>המידות של הספר</h2>
        <p className="specform-lede">
          המספרים האלה נמצאים בדף המפרט של בית הדפוס. הם קובעים את הפריסה עצמה —
          כפולה ארוכה מקבלת תבניות אחרות מכפולה מרובעת, ופנים שיושבות בסדר על
          layflat נבלעות בציר של ספר כרוך. בלי מספרים אמיתיים אין בנייה.
        </p>
      </header>

      <div className="specform-grid">
        {SPEC_FIELDS.map((field) => (
          <label key={field.key} className="specfield">
            <span className="specfield-label">{field.label}</span>
            <span className="specfield-input">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                dir="ltr"
                value={draft[field.key]}
                onChange={(e) => onChange({ ...draft, [field.key]: e.target.value })}
              />
              <span className="specfield-unit">{field.unit}</span>
            </span>
            <small className="specfield-hint">{field.hint}</small>
          </label>
        ))}
      </div>

      <footer className="specform-foot">
        <button className="btn btn-primary" disabled={!ready} onClick={onSubmit}>
          בנה אלבום לפי המידות
        </button>
        {!ready && (
          <p className="specform-missing">
            {problems.join(' · ')}
          </p>
        )}
      </footer>
    </section>
  );
}
