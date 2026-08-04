/* "היום" — the landing screen.
 *
 * WHAT WENT WRONG THE FIRST TWO TIMES, and why this is a different screen and
 * not a restyle of the last one:
 *
 * A queue of five sentences cannot hold a 1400px screen. Stretched to fill, it
 * produced two enormous half-empty boxes; left unstretched, it left the bottom
 * two thirds of the window blank. Either way the screen read as broken, and no
 * amount of spacing or contrast was going to fix a composition with nothing in
 * it.
 *
 * So the screen carries THE WORK ITSELF. Below the short "needs you" strip sits
 * the desk: every active job as a frame from that shoot, its stage, and its
 * counts. That is what a photographer opens the application to see, it is the
 * only content there is enough of to hold the space, and it is made of
 * photographs — which is the one material this product has and a generic admin
 * panel does not.
 *
 * Order in the queue is by real urgency, not recency: a waiting CLIENT outranks
 * money, money outranks a deadline.
 */

import { useMemo } from 'react';
import type { SectionId } from '../nav';
import { STATE_LABEL, coverUrl, stagesOf, useProjects } from '../store';
import type { Project } from '../store';
import { IcCamera, IcCalendar } from '../../design/Icons';

type Urgency = 'client' | 'money' | 'deadline';

interface QueueItem {
  id: string;
  /** Which job this row is about — the row opens it. */
  projectId: string;
  /** What happened. One short sentence, and it is the loudest thing in the row. */
  verb: string;
  /** Everything else on ONE muted line: who, how many, when. Spreading these
   *  across separate columns is what made the rows unreadable — the eye had to
   *  cross two empty gaps to assemble a single fact. */
  line: string;
  action: string;
  /** Resolved cover url, or null when the job has no photographs yet. */
  thumb: string | null;
  urgency: Urgency;
}

/* The queue is DERIVED, never authored. It used to be five hand-written
 * sentences about clients who do not exist — a screen that opens every morning
 * with confident, invented facts. Every row below is a condition read off a
 * real project, and when nothing is true the queue is empty, which is itself
 * the most useful thing the screen can say.
 *
 * Order is by real urgency, not recency: a waiting CLIENT outranks money,
 * money outranks a deadline. */
function queueOf(projects: Project[]): QueueItem[] {
  const rows: QueueItem[] = [];

  projects.forEach((p) => {
    if (p.state === 'waiting') {
      rows.push({
        id: `${p.id}-waiting`,
        projectId: p.id,
        verb: `${p.client} טרם סיימו לבחור`,
        line: `${p.event} · ${p.kept.toLocaleString('he-IL')} בגלריה${p.waitingSince ? ` · נשלח ${p.waitingSince}` : ''}`,
        action: 'פתח את הפרויקט',
        thumb: coverUrl(p, 120),
        urgency: 'client',
      });
    } else if (p.picked > p.rendered) {
      rows.push({
        id: `${p.id}-render`,
        projectId: p.id,
        verb: `${p.client} — ${(p.picked - p.rendered).toLocaleString('he-IL')} תמונות ממתינות לעריכה`,
        line: `${p.event} · ${p.rendered.toLocaleString('he-IL')} מתוך ${p.picked.toLocaleString('he-IL')} נערכו`,
        action: 'המשך לערוך',
        thumb: coverUrl(p, 120),
        urgency: 'deadline',
      });
    }
  });

  projects.forEach((p) => {
    const owed = (p.price ?? 0) - (p.paid ?? 0);
    if (owed > 0 && p.state === 'done') {
      rows.push({
        id: `${p.id}-money`,
        projectId: p.id,
        verb: `${p.client} חייבים ₪${owed.toLocaleString('he-IL')}`,
        line: `${p.event} · נמסר · ${p.date}`,
        action: 'פתח את הפרויקט',
        thumb: coverUrl(p, 120),
        urgency: 'money',
      });
    }
  });

  const rank: Record<Urgency, number> = { client: 0, money: 1, deadline: 2 };
  return rows.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
}

/** dd.mm as a real date, so "who is next" is an answer and not a guess. The
 *  year is the nearest one that has not passed — a shoot on 02.01 seen in
 *  December belongs to January. */
function shootDate(ddmm: string, now: Date): Date | null {
  const [day, month] = ddmm.split('.').map(Number);
  if (!day || !month) return null;
  const thisYear = new Date(now.getFullYear(), month - 1, day);
  const days = (thisYear.getTime() - now.getTime()) / 86400000;
  return days < -180
    ? new Date(now.getFullYear() + 1, month - 1, day)
    : thisYear;
}

export default function Today({
  onSection,
  onOpenProject,
}: {
  onSection: (s: SectionId) => void;
  /** Every row on this screen is about ONE job, so every row opens that job —
   *  landing on the projects list and hunting for it again is a step the
   *  screen already had the answer to. */
  onOpenProject: (id: string) => void;
}) {
  const projects = useProjects();
  const now = new Date();
  const day = now.toLocaleDateString('he-IL', { weekday: 'long' });
  const date = now.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });

  const queue = useMemo(() => queueOf(projects), [projects]);
  const jobs = useMemo(
    () => projects.filter((p) => p.state !== 'done'),
    [projects],
  );
  const upcoming = useMemo(() => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return projects
      .map((p) => ({ project: p, when: shootDate(p.date, today) }))
      .filter((row): row is { project: Project; when: Date } => !!row.when && row.when >= today)
      .sort((a, b) => a.when.getTime() - b.when.getTime())
      .slice(0, 4);
    // `now` is a fresh Date on every render; the projects are what actually change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const nextShoot = upcoming[0];
  const owed = projects.reduce(
    (sum, p) => sum + Math.max(0, (p.price ?? 0) - (p.paid ?? 0)),
    0,
  );
  const waiting = projects.filter((p) => p.state === 'waiting').length;
  const editing = projects.filter((p) => p.picked > p.rendered).length;

  const dayLabel = (when: Date) => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((when.getTime() - today.getTime()) / 86400000);
    if (days === 0) return 'היום';
    if (days === 1) return 'מחר';
    if (days < 7) return when.toLocaleDateString('he-IL', { weekday: 'long' });
    return when.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="today">
      <header className="today-head">
        <h1>
          {day}
          <span className="today-date">{date}</span>
        </h1>
        <div className="today-shoot">
          <IcCamera size={15} />
          {/* The shoot line states what the projects actually say. No shoot on
            * the books is a real answer, and inventing "מחר 17:00" was how the
            * screen lied before anything else on it had a chance to. */}
          <span>
            {nextShoot
              ? <>הצילום הבא · <b>{dayLabel(nextShoot.when)} · {nextShoot.project.client}</b></>
              : 'אין צילום בלוח'}
          </span>
        </div>
      </header>

      <div className="today-top">
        <section aria-label="דורש ממך משהו">
          <div className="sec-bar">
            <h2>דורש ממך משהו</h2>
            <span className="sec-n mono">{queue.length}</span>
          </div>
          {queue.length ? (
            <ul className="queue">
              {queue.map((item) => (
                <li key={item.id}>
                  <button
                    className={`q-row u-${item.urgency}`}
                    onClick={() => onOpenProject(item.projectId)}
                  >
                    {item.thumb
                      ? <img className="q-thumb" src={item.thumb} alt="" loading="lazy" />
                      : <span className="q-thumb job-nocover"><IcCamera size={16} /></span>}
                    <span className="q-main">
                      <b>{item.verb}</b>
                      <span className="q-sub">{item.line}</span>
                    </span>
                    <span className="q-action">{item.action}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="today-clear">
              {projects.length
                ? 'שום דבר לא ממתין לך. כל העבודות מתקדמות.'
                : 'אין עדיין פרויקטים. פרויקט חדש נפתח ממסך הפרויקטים.'}
            </p>
          )}
        </section>

        <aside aria-label="צילומים קרובים">
          <div className="sec-bar">
            <h2>הקרוב ביותר</h2>
            <button className="sec-link" onClick={() => onSection('calendar')}>
              <IcCalendar size={14} />
              היומן
            </button>
          </div>
          {upcoming.length ? (
            <ul className="up-list">
              {upcoming.map(({ project, when }) => (
                <li key={project.id}>
                  <button className="up-row" onClick={() => onOpenProject(project.id)}>
                    <span className="up-when">
                      <b>{dayLabel(when)}</b>
                      <span className="mono">{project.date}</span>
                    </span>
                    <span className="up-main">
                      <b>{project.client}</b>
                      <span>{project.event}{project.location ? ` · ${project.location}` : ''}</span>
                    </span>
                    {/* No time column: the store keeps a DAY, not an hour.
                      * Showing "17:00" for a date nobody entered is exactly the
                      * kind of confident detail that made this screen fiction. */}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="today-clear">אין צילומים קרובים בלוח.</p>
          )}
        </aside>
      </div>

      {/* The desk. This is what actually holds the screen. */}
      <section className="desk" aria-label="העבודות שעל השולחן">
        <div className="sec-bar">
          <h2>על השולחן</h2>
          <span className="sec-n mono">{jobs.length}</span>
          <button className="sec-link" onClick={() => onSection('projects')}>
            כל הפרויקטים
          </button>
        </div>

        {jobs.length ? (
          <div className="jobs">
            {jobs.map((job) => (
              <button key={job.id} className="job" onClick={() => onOpenProject(job.id)}>
                <span className="job-frame">
                  {coverUrl(job) ? (
                    <img src={coverUrl(job)!} alt="" style={{ objectPosition: job.pos }} loading="lazy" />
                  ) : (
                    <span className="job-nocover"><IcCamera size={22} /></span>
                  )}
                  {job.state === 'waiting' && <span className="job-wait">{STATE_LABEL.waiting}</span>}
                </span>
                <span className="job-name">{job.client}</span>
                <span className="job-meta">
                  {job.event}
                  <i>·</i>
                  <span className="mono">{job.date}</span>
                </span>
                {/* The measure shows the stages THIS job has — a family session
                  * without an album must not show an album segment. */}
                <span className="job-measure" aria-hidden="true">
                  {stagesOf(job).map((s, i) => (
                    <span
                      key={s.id}
                      className={`seg ${i < job.at ? 'done' : ''} ${i === job.at ? 'on' : ''}`}
                      title={s.label}
                    />
                  ))}
                </span>
                <span className="job-counts mono">{job.counts}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="today-clear">
            {projects.length
              ? 'כל העבודות הושלמו.'
              : 'השולחן ריק. הפרויקט הראשון נפתח ממסך הפרויקטים.'}
          </p>
        )}
      </section>

      <footer className="today-foot">
        <span><b className="mono">{jobs.length}</b> פרויקטים פעילים</span>
        <i />
        <span><b className="mono">{waiting}</b> ממתינים ללקוח</span>
        <i />
        <span><b className="mono">{editing}</b> בעריכה</span>
        <i />
        <span><b className="mono">₪{owed.toLocaleString('he-IL')}</b> לגבייה</span>
      </footer>
    </div>
  );
}
