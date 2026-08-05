/* פרויקטים — every job in the business, in one grid.
 *
 * PHOTO-LED, because that is how a photographer finds a job: the frame first,
 * the client's name second. The same tile the desk on Today uses — one
 * component, two places — so the shape of a project is learned once.
 *
 * The filters are states, not tags: where a job is standing right now. "ממתין
 * ללקוח" is its own filter because it is the only state where the work is out
 * of the photographer's hands, and it is the one that quietly eats weeks.
 */

import { useMemo, useState } from 'react';
import { useStudio } from '../store';
import type { ProjectState } from '../store';
import NewProject from './NewProject';
import JobTile from './JobTile';
import { CannotRead, StillReading } from './Screens';
import { IcFolderOpen } from '../../design/Icons';

type Filter = 'all' | ProjectState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'הכול' },
  { id: 'work', label: 'בעבודה' },
  { id: 'waiting', label: 'ממתין ללקוח' },
  { id: 'shoot', label: 'לפני צילום' },
  { id: 'done', label: 'הושלמו' },
];

export default function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const { projects: PROJECTS, status, fault, saveFault } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: PROJECTS.length };
    for (const p of PROJECTS) c[p.state] = (c[p.state] ?? 0) + 1;
    return c;
  }, [PROJECTS]);

  const shown = filter === 'all' ? PROJECTS : PROJECTS.filter((p) => p.state === filter);

  // Before the count, before the filters, before anything that implies a
  // number: the read either worked or it did not.
  if (status === 'down') return <CannotRead what="את הפרויקטים" fault={fault} />;
  if (status === 'loading' && PROJECTS.length === 0) {
    return <StillReading what="את הפרויקטים" />;
  }

  return (
    <div className="pj">
      <header className="pj-head">
        <h1>פרויקטים</h1>
        <span className="pj-total mono">{PROJECTS.length}</span>
        <button className="btn btn-primary pj-new" onClick={() => setCreating(true)}>
          <IcFolderOpen size={17} />
          פרויקט חדש
        </button>
      </header>

      {/* A write that did not land. Loud, and above the list it disagrees with:
          the tiles below already show the change, and only this line knows the
          database does not. */}
      {saveFault && (
        <div className="pj-savefault" role="alert">
          שינוי לא נשמר במסד — {saveFault}. מה שמוצג כאן קדימה מהמסד עד שזה ייפתר.
        </div>
      )}

      <nav className="pj-filters" aria-label="סינון לפי מצב">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`pj-filter ${f.id === filter ? 'on' : ''}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={f.id === filter}
          >
            {f.label}
            <span className="mono">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      {PROJECTS.length === 0 ? (
        <div className="pj-blank">
          <h2>אין עדיין פרויקטים</h2>
          <p>כל עבודה מתחילה כאן — לקוח, אירוע ותאריך. הקבצים מגיעים אחר כך.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <IcFolderOpen size={17} />
            צור פרויקט ראשון
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="pj-empty">אין פרויקטים במצב הזה.</p>
      ) : (
        <div className="jobs">
          {shown.map((p) => (
            <JobTile key={p.id} project={p} onOpen={onOpen} />
          ))}
        </div>
      )}

      {creating && (
        <NewProject
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            onOpen(created.id);
          }}
        />
      )}
    </div>
  );
}
