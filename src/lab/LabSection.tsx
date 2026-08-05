/* The lab, whole, behind one door.
 *
 * It was two screens that nothing in the product pointed at — #/lab and
 * #/compare — so the only way to reach either was to type the URL. They are the
 * same room: one photograph, the engine, and a straight report about what it
 * did. They already share a stylesheet and an API surface. Now they share a
 * section, and the rail has a way in.
 *
 * WHY A SWITCH AND NOT TWO RAIL ITEMS: the rail is the business axis, and two
 * entries for one workshop would spend a second of the photographer's attention
 * every time they scan it, forever, on a distinction that only matters once
 * they are already inside. The choice between "test a tool" and "read an edit"
 * is a choice made in the lab, so it is offered in the lab.
 *
 * BOTH HALVES STAY LAZY. Opening the bench should not also fetch the reader:
 * between them they are the ~1,500 lines that App.tsx deliberately keeps out of
 * the first paint, and collapsing them into one eager module here would undo
 * that work one level down. Each Suspense is local, so switching views leaves
 * the tab row on screen instead of blanking the section.
 */

import { Suspense, lazy } from 'react';
import './lab.css';

const Lab = lazy(() => import('./Lab'));
const Compare = lazy(() => import('./Compare'));

export type LabView = 'tools' | 'compare';

const VIEWS: { id: LabView; label: string; hint: string }[] = [
  {
    id: 'tools',
    label: 'שולחן הכלים',
    hint: 'תמונה אחת, כלי אחד בכל פעם, ודוח מלא על מה שכל כלי באמת עשה',
  },
  {
    id: 'compare',
    label: 'קריאת עריכה',
    hint: 'לפני ואחרי — מה נעשה לתמונה, ומה מזה אפשר להפוך למתכון',
  },
];

export default function LabSection({
  view,
  onView,
}: {
  view: LabView;
  onView: (v: LabView) => void;
}) {
  return (
    <div className="labsec">
      <nav className="labsec-tabs" aria-label="מסכי המעבדה">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`labsec-tab ${v.id === view ? 'on' : ''}`}
            onClick={() => onView(v.id)}
            title={v.hint}
            aria-current={v.id === view ? 'page' : undefined}
          >
            {v.label}
          </button>
        ))}
      </nav>

      <div className="labsec-body">
        <Suspense fallback={<div className="screen-wait">טוען…</div>}>
          {view === 'compare' ? <Compare /> : <Lab />}
        </Suspense>
      </div>
    </div>
  );
}
