/* כלים ראשוניים — the lab bench, narrowed to the tools that shape light.
 *
 * WHY A PAGE AND NOT A FILTER ON THE LAB: the lab is the place where any tool
 * gets examined, and taking eighteen of its tools away would have cost that.
 * This is a second door into the same room, holding the set the photographer
 * actually rides on most frames — tone, sculpting, structure and bloom — so
 * reaching a slider is not a scroll past the retouching tools first.
 *
 * IT IS THE BENCH ITSELF, NOT A COPY. `Lab` takes an allowlist; everything
 * else on the screen is the same code: the same engine call, the same
 * result/הפרש views, the same per-step report, the same save. A duplicated
 * 1,500-line screen would drift from the lab within a week, and then two
 * screens would disagree about what a tool did.
 *
 * ONE MODE IS ABSENT ON PURPOSE. "סימון" is ניקוי כתמים's own view — it scans
 * for blemishes and writes outlines into that tool's selection. That tool is
 * not in this set, so the mode is hidden rather than left to offer a scan
 * whose result nothing here could apply.
 */

import { Suspense, lazy } from 'react';
import './lab.css';

const Lab = lazy(() => import('./Lab'));

/* Frozen and module-level, not an inline literal: `Lab` takes this as a
 * dependency of the effects that seed a recipe, and a fresh array on every
 * render would re-seed the bench under the photographer's hands.
 *
 * The four, in pipeline order (registry `order` in brackets):
 *   contour        [21]  פיסול אור וצל — dodge & burn, light where the bone is
 *   tone-color     [30]  חשיפה · ניגודיות · היילייטים · לבנים · צלליות ·
 *                        שחורים · שחזור מקומי · חום · גוון · רוויה · חיוניות
 *   tonal-contrast [33]  תלת מימד — structure by tonal zone, aimed by region
 *   glow           [55]  גלואו — bloom, with people / skin / fabric strengths
 */
export const PRIMARY_TOOLS: readonly string[] = Object.freeze([
  'contour',
  'tone-color',
  'tonal-contrast',
  'glow',
]);

export default function PrimaryTools() {
  return (
    <div className="labsec">
      <nav className="labsec-tabs" aria-label="שולחן הכלים הראשוניים">
        <span
          className="labsec-tab on"
          title="פיסול אור וצל · טון וצבע · תלת מימד · גלואו — על תמונה אחת, עם דוח מלא"
        >
          כלים ראשוניים
        </span>
      </nav>

      <div className="labsec-body">
        <Suspense fallback={<div className="screen-wait">טוען…</div>}>
          <Lab only={PRIMARY_TOOLS} />
        </Suspense>
      </div>
    </div>
  );
}
