/* The screens the business rail reaches that are not yet their own module.
 *
 * There used to be a demo file behind these — invented clients, invented
 * counts, a "נתוני דמה" badge under each one. The badge did not help: a screen
 * full of confident numbers reads as real no matter what the footnote says,
 * and the photographer plans against it. Everything here now reads the project
 * store or says plainly that it is not built.
 */

import { useProjects } from '../store';
import type { Project } from '../store';
import { IcCheckCircle, IcSparkle } from '../../design/Icons';

function Head({ title, sub, action }: { title: string; sub: string; action?: JSX.Element }) {
  return (
    <div className="screen-head">
      <div>
        <h2>{title}</h2>
        <div className="card-sub">{sub}</div>
      </div>
      {action}
    </div>
  );
}

interface ClientRow {
  name: string;
  projects: number;
  lastEvent: string;
  lastDate: string;
  photos: number;
  billed: number;
  paid: number;
  active: boolean;
}

/** Clients are not a separate list that has to be kept in step — a client IS
 *  whoever the projects are for. Derived, so it can never drift from the work
 *  (docs/UX-SKELETON.md §4.1: לקוח 1 ──< פרויקט N). */
function clientsOf(projects: Project[]): ClientRow[] {
  const byName = new Map<string, Project[]>();
  projects.forEach((project) => {
    const list = byName.get(project.client) ?? [];
    list.push(project);
    byName.set(project.client, list);
  });

  return [...byName.entries()]
    .map(([name, jobs]) => {
      const sorted = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        name,
        projects: jobs.length,
        lastEvent: sorted[0].event,
        lastDate: sorted[0].date,
        photos: jobs.reduce((sum, job) => sum + job.imported, 0),
        billed: jobs.reduce((sum, job) => sum + (job.price ?? 0), 0),
        paid: jobs.reduce((sum, job) => sum + (job.paid ?? 0), 0),
        active: jobs.some((job) => job.state !== 'done'),
      };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

export function Clients() {
  const projects = useProjects();
  const rows = clientsOf(projects);

  if (!rows.length) {
    return (
      <>
        <Head title="לקוחות" sub="כל מי שיש לו עבודה אצלך" />
        <section className="card card-pad">
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 'var(--s6)' }}>
            אין עדיין לקוחות. לקוח נוצר יחד עם הפרויקט הראשון שלו.
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <Head title="לקוחות" sub={`${rows.length} לקוחות · מתוך הפרויקטים עצמם`} />
      <section className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>לקוח</th><th>פרויקטים</th><th>אחרון</th>
              <th>תמונות</th><th>פתוח לתשלום</th><th>מצב</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const open = row.billed - row.paid;
              return (
                <tr key={row.name}>
                  <td style={{ fontWeight: 600 }}>{row.name}</td>
                  <td className="mono">{row.projects}</td>
                  <td>{row.lastEvent} · <span className="mono">{row.lastDate}</span></td>
                  <td className="mono">{row.photos.toLocaleString('he-IL')}</td>
                  <td className="mono">{open > 0 ? `₪${open.toLocaleString('he-IL')}` : '—'}</td>
                  <td>
                    <span className={`pill ${row.active ? 'pill-run' : 'pill-ok'}`}>
                      {!row.active && <IcCheckCircle size={13} />}
                      {row.active ? 'בעבודה' : 'הושלם'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** A screen that does not exist yet, saying exactly that. No invented numbers
 *  to plan against — that is the whole point. */
export function Simple({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <Head title={title} sub={sub} />
      <section className="card card-pad" style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          <IcSparkle size={30} />
          <div style={{ marginTop: 10 }}>המסך הזה עדיין לא נבנה.</div>
        </div>
      </section>
    </>
  );
}
