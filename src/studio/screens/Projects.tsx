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
import { STATE_LABEL, coverUrl, retryStore, stagesOf, useProjects, useStoreState } from '../store';
import type { Project, ProjectState } from '../store';
import NewProject from './NewProject';
import { IcCamera, IcFolderOpen } from '../../design/Icons';

type Filter = 'all' | ProjectState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'הכול' },
  { id: 'work', label: 'בעבודה' },
  { id: 'waiting', label: 'ממתין ללקוח' },
  { id: 'shoot', label: 'לפני צילום' },
  { id: 'done', label: 'הושלמו' },
];

export default function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const PROJECTS = useProjects();
  const db = useStoreState();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: PROJECTS.length };
    for (const p of PROJECTS) c[p.state] = (c[p.state] ?? 0) + 1;
    return c;
  }, [PROJECTS]);

  const shown = filter === 'all' ? PROJECTS : PROJECTS.filter((p) => p.state === filter);

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

      {/* Three different empty screens, because they mean three different
        * things. "No projects at all" is a first run and needs the way in;
        * "none in this filter" is a filter; a failed READ is not empty at all,
        * and saying "no projects" there would be the tool telling a
        * photographer their work is gone. */}
      {db.state === 'loading' ? (
        <p className="pj-empty">קורא את הפרויקטים…</p>
      ) : db.state === 'down' ? (
        <div className="pj-empty pj-empty-bad">
          <b>לא ניתן להתחבר למסד הנתונים.</b>
          <p>
            הפרויקטים לא נמחקו — הם פשוט לא נקראו, ושום דבר לא ייכתב עליהם עד
            שהחיבור יחזור. ודא שהמנוע המקומי רץ וששירות MongoDB פעיל.
          </p>
          {db.failure && <p className="mono" dir="ltr">{db.failure}</p>}
          <button className="btn" onClick={retryStore}>נסה שוב</button>
        </div>
      ) : PROJECTS.length === 0 ? (
        <div className="pj-blank">
          <IcFolderOpen size={30} />
          <strong>אין עדיין פרויקטים</strong>
          <span>פרויקט הוא עבודה אחת: לקוח, תאריך, והתוצרים שיוצאים ממנה.</span>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <IcFolderOpen size={17} />
            הפרויקט הראשון
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="pj-empty">אין פרויקטים במצב הזה.</p>
      ) : (
        <div className="jobs">
          {shown.map((p) => (
            <button key={p.id} className="job" onClick={() => onOpen(p.id)}>
              <span className="job-frame">
                {coverUrl(p) ? (
                  <img src={coverUrl(p)!} alt="" style={{ objectPosition: p.pos }} loading="lazy" />
                ) : (
                  /* No photographs yet. An empty frame says so; a stock photo
                   * would say this shoot happened and looked like that. */
                  <span className="job-nocover"><IcCamera size={22} /></span>
                )}
                {p.state === 'waiting' && <span className="job-wait">{STATE_LABEL.waiting}</span>}
                {p.state === 'done' && <span className="job-done">{STATE_LABEL.done}</span>}
              </span>
              <span className="job-name">{p.client}</span>
              <span className="job-meta">
                {p.event}
                <i>·</i>
                <span className="mono">{p.date}</span>
              </span>
              <span className="job-measure" aria-hidden="true">
                {stagesOf(p).map((s2, i) => (
                  <span
                    key={s2.id}
                    className={`seg ${i < p.at ? 'done' : ''} ${i === p.at && p.state !== 'done' ? 'on' : ''}`}
                    title={s2.label}
                  />
                ))}
              </span>
              <span className="job-counts">{p.counts}</span>
            </button>
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
