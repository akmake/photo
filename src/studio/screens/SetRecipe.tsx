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
import {
  batchRecipe, effectiveRecipe, frameSteps, removeFrameStep, removeStep, toggleStep, useRecipe,
} from '../store';
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

export default function SetRecipe({
  projectId,
  batchId = null,
  frame,
}: {
  projectId: string;
  /** The layer being shown. null is the project's base — the content tools
   *  every batch shares. A batch id shows base PLUS its own light, so
   *  the list reads as what those frames actually render through. */
  batchId?: string | null;
  /** One photograph. Shows the WHOLE stack it renders through — base, its
   *  batch, and its own exceptions — because that is what the workbench is
   *  tuning on top of. Without this the list showed the shared layers only, so
   *  a step saved to this frame vanished the moment it was saved. */
  frame?: string | null;
}) {
  const recipe = useRecipe(projectId);
  const frames = Object.keys(recipe.perFrame).length;
  // `recipe` is the store's identity for these steps.
  const steps = frame ? effectiveRecipe(projectId, frame) : batchRecipe(projectId, batchId);
  const own = new Set(
    (frame
      ? frameSteps(projectId, frame)
      : batchId ? recipe.perBatch[batchId] ?? [] : recipe.base
    ).map((t) => t.toolId),
  );

  if (!steps.length) {
    return (
      <section className="setr">
        <h3>מה נעשה לסט</h3>
        <p className="setr-empty">
          {frame
            ? 'התמונה הזאת עדיין לא עברה כלום — לא בסיס, לא מקבץ, ולא כלי משלה.'
            : batchId
              ? 'עוד לא נקבע כלום למקבץ הזה. מה שייקבע כאן יחול רק על התמונות שלו.'
              : 'עוד לא נקבע כלום. מה שנקבע כאן חל על כל התמונות בסט, ואפשר לכבות אותו בכל רגע.'}
        </p>
      </section>
    );
  }

  return (
    <section className="setr">
      <h3>
        {frame ? 'מה נעשה לתמונה' : 'מה נעשה לסט'}
        <span className="setr-n mono">{steps.length}</span>
      </h3>

      <ul className="setr-list">
        {steps.map((step, i) => (
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
                onChange={(e) => toggleStep(projectId, step.toolId, e.target.checked, batchId)}
              />
              פעיל
            </label>
            {/* A step inherited from the base is shown here because these frames
              * really do render through it — but it is not this layer's to
              * remove, and a button that silently edits a wider layer is how a
              * batch ends up changing the whole project. */}
            {own.has(step.toolId) ? (
              <button
                className="setr-drop"
                onClick={() => (frame
                  ? removeFrameStep(projectId, frame, step.toolId)
                  : removeStep(projectId, step.toolId, batchId))}
                aria-label={`הסר ${stepLabel(step.toolId)}`}
              >
                הסר
              </button>
            ) : (
              /* Inherited: these frames really do render through it, but it is
               * not this layer's to remove — a button that silently edits a
               * wider layer is how one photograph changes a whole project. */
              <span className="setr-from">{frame ? 'מהסט' : 'מהבסיס'}</span>
            )}
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
