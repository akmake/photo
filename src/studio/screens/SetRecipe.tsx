/* מה נעשה לסט — the state of the working set, as a list.
 *
 * This is the screen the recipe model needs and the folder model never had: the
 * set's current state used to be a directory somebody had to remember, and now
 * it is an ordered list of steps that can be read, switched off and removed
 * without re-rendering anything.
 *
 * Switching a step off is instant and costs nothing, because no file was ever
 * written for it. That is the property worth showing: a photographer can ask
 * "what does this look like without the colour?" and get an answer rather than
 * a 55-minute batch.
 *
 * ⛔ Not a card grid, not a set of panels — a list with hairlines, per §10 of
 * the design direction. A step is a row.
 */

import { TOOLS } from '../../toolRegistry';
import type { ToolInstance } from '../../types';
import { removeStep, toggleStep, useRecipe } from '../store';
import { IcSparkle } from '../../design/Icons';

/** The engine owns tools the front-end registry has never heard of —
 *  `pixel-color` is fitted, not configured, so it has no slider definition.
 *  getTool() throws on those, which would take the whole screen down. */
function stepLabel(toolId: string): string {
  if (toolId === 'pixel-color') return 'מראה שנלמד מזוג תמונות';
  return TOOLS.find((t) => t.id === toolId)?.label ?? toolId;
}

/** What this step is doing, in the terms the step is actually made of. A fitted
 *  model has no parameters to report, so it reports its own shape instead. */
function stepDetail(step: ToolInstance): string {
  if (step.model) {
    const anchors = step.model.anchors?.length ?? 0;
    const skin = step.model.skinAnchors?.length ? ' · מודל עור נפרד' : '';
    return `${anchors} עוגני צבע${skin}`;
  }
  const entries = Object.entries(step.params ?? {});
  if (!entries.length) return '—';
  return entries.map(([k, v]) => `${k} ${v}`).join(' · ');
}

export default function SetRecipe({ projectId }: { projectId: string }) {
  const recipe = useRecipe(projectId);
  const frames = Object.keys(recipe.perFrame).length;

  if (!recipe.base.length) {
    return (
      <section className="setr">
        <h3>מה נעשה לסט</h3>
        <p className="setr-empty">
          עוד לא נקבע כלום. מה שנקבע כאן חל על כל התמונות בסט, ואפשר לכבות אותו בכל רגע.
        </p>
      </section>
    );
  }

  return (
    <section className="setr">
      <h3>
        מה נעשה לסט
        <span className="setr-n mono">{recipe.base.length}</span>
      </h3>

      <ul className="setr-list">
        {recipe.base.map((step, i) => (
          <li key={step.toolId} className={`setr-row ${step.enabled ? '' : 'off'}`}>
            <span className="setr-i mono">{i + 1}</span>
            <span className="setr-main">
              <b>
                {step.model && <IcSparkle size={14} />}
                {stepLabel(step.toolId)}
              </b>
              <span className="setr-detail">{stepDetail(step)}</span>
            </span>
            <label className="setr-on">
              <input
                type="checkbox"
                checked={step.enabled}
                onChange={(e) => toggleStep(projectId, step.toolId, e.target.checked)}
              />
              פעיל
            </label>
            <button
              className="setr-drop"
              onClick={() => removeStep(projectId, step.toolId)}
              aria-label={`הסר ${stepLabel(step.toolId)}`}
            >
              הסר
            </button>
          </li>
        ))}
      </ul>

      <p className="setr-note">
        שום קובץ לא נכתב. כיבוי או הסרה משנים את הסט מיד, וקבצים נוצרים פעם אחת — במסירה,
        מהמקור ובאיכות מלאה.
        {frames > 0 && (
          <>
            {' '}<b className="mono">{frames}</b> תמונות עם חריגה אישית נשמרות בנפרד.
          </>
        )}
      </p>
    </section>
  );
}
