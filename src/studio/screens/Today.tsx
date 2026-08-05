/* "היום" — the landing screen, derived entirely from the project store.
 *
 * It carries three things, and all of them are read from the real projects — no
 * demo arrays, so what shows here can never disagree with פרויקטים:
 *
 *   דורש ממך משהו   the urgency queue — a client waiting, money owed
 *   על השולחן        the desk: every active job as a frame from that shoot
 *   הקרוב ביותר       the next shoots, by date
 *
 * When there is nothing yet, the screen says so and points at the one action
 * that starts everything — creating a project. A landing screen that lies about
 * having work is worse than one that admits the studio is empty.
 */

import { useMemo } from 'react';
import type { SectionId } from '../nav';
import { STAGES, useStudio } from '../store';
import { CannotRead, StillReading } from './Screens';
import type { Project } from '../store';
import JobTile from './JobTile';
import { IcCamera, IcCalendar, IcFolderOpen } from '../../design/Icons';

const EDIT_AT = STAGES.findIndex((s) => s.id === 'edit');

function openOf(p: Project): number {
  return p.price ? p.price - (p.paid ?? 0) : 0;
}

/** dd.mm → a sortable key. Good enough to order the coming shoots. */
function dateKey(d: string): number {
  const [dd, mm] = d.split('.').map(Number);
  return (mm || 0) * 100 + (dd || 0);
}

type Urgency = 'client' | 'money';

interface QItem {
  id: string;
  urgency: Urgency;
  verb: string;
  line: string;
  action: string;
  thumb: string;
  pos: string;
}

/** The queue is derived from real signals only: a client whose turn it is, and
 *  money owed on a delivered job. Clients outrank money. */
function buildQueue(projects: Project[]): QItem[] {
  const client: QItem[] = [];
  const money: QItem[] = [];

  for (const p of projects) {
    if (p.state === 'waiting') {
      const onAlbum = p.at >= 4;
      client.push({
        id: p.id,
        urgency: 'client',
        thumb: p.thumb,
        pos: p.pos,
        verb: onAlbum ? `${p.client} בודקים את הגהת האלבום` : `${p.client} בוחרים תמונות מהגלריה`,
        line: [p.event, p.waitingSince && `נשלח ${p.waitingSince}`].filter(Boolean).join(' · '),
        action: onAlbum ? 'פתח את האלבום' : 'פתח את הבחירה',
      });
    }
  }

  for (const p of projects) {
    const open = openOf(p);
    if (p.state === 'done' && open > 0) {
      money.push({
        id: p.id,
        urgency: 'money',
        thumb: p.thumb,
        pos: p.pos,
        verb: `${p.client} — ₪${open.toLocaleString('he-IL')} פתוחים לגבייה`,
        line: `${p.event} · נמסר`,
        action: 'פתח את הפרויקט',
      });
    }
  }

  return [...client, ...money];
}

export default function Today({
  onSection,
  onOpen,
}: {
  onSection: (s: SectionId) => void;
  onOpen: (id: string) => void;
}) {
  const { projects, status, fault } = useStudio();

  const now = new Date();
  const day = now.toLocaleDateString('he-IL', { weekday: 'long' });
  const date = now.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });

  const { queue, active, upcoming, stats, nextShoot } = useMemo(() => {
    const queue = buildQueue(projects);
    const active = projects.filter((p) => p.state !== 'done');
    const upcoming = projects
      .filter((p) => p.state === 'shoot')
      .sort((a, b) => dateKey(a.date) - dateKey(b.date));
    const stats = {
      active: active.length,
      waiting: projects.filter((p) => p.state === 'waiting').length,
      editing: projects.filter((p) => p.state === 'work' && p.at === EDIT_AT).length,
      toCollect: projects.reduce((n, p) => n + openOf(p), 0),
    };
    return { queue, active, upcoming, stats, nextShoot: upcoming[0] };
  }, [projects]);

  /* "The desk is empty" is a claim about the studio, so it may only be made
   * once the studio has actually been read. Unreachable and empty look the same
   * from here and mean opposite things. */
  if (status === 'down') return <CannotRead what="את השולחן" fault={fault} />;
  if (status === 'loading' && projects.length === 0) {
    return <StillReading what="את השולחן" />;
  }

  // Nothing in the studio yet — say so, and point at the one action that starts
  // everything. Every other section is derived from projects, so they are all
  // empty too until the first one exists.
  if (projects.length === 0) {
    return (
      <div className="today">
        <header className="today-head">
          <h1>{day}<span className="today-date">{date}</span></h1>
        </header>
        <div className="today-blank">
          <h2>השולחן ריק</h2>
          <p>עוד אין פרויקטים. כל עבודה מתחילה בלקוח, אירוע ותאריך — הקבצים מגיעים אחר כך.</p>
          <button className="btn btn-primary" onClick={() => onSection('projects')}>
            <IcFolderOpen size={17} />
            צור פרויקט ראשון
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="today">
      <header className="today-head">
        <h1>{day}<span className="today-date">{date}</span></h1>
        <div className="today-shoot">
          <IcCamera size={15} />
          {nextShoot
            ? <span>הצילום הבא · <b>{nextShoot.client}</b> <span className="mono">{nextShoot.date}</span></span>
            : <span>אין צילום מתוכנן</span>}
        </div>
      </header>

      <div className="today-top">
        <section aria-label="דורש ממך משהו">
          <div className="sec-bar">
            <h2>דורש ממך משהו</h2>
            <span className="sec-n mono">{queue.length}</span>
          </div>
          {queue.length === 0 ? (
            <p className="sec-empty">אין משימות דחופות. שום לקוח לא ממתין ואין חוב פתוח.</p>
          ) : (
            <ul className="queue">
              {queue.map((item) => (
                <li key={item.id + item.urgency}>
                  <button className={`q-row u-${item.urgency}`} onClick={() => onOpen(item.id)}>
                    {item.thumb
                      ? <img className="q-thumb" src={item.thumb} alt="" style={{ objectPosition: item.pos }} loading="lazy" />
                      : <span className="q-thumb q-thumb-empty" aria-hidden="true" />}
                    <span className="q-main">
                      <b>{item.verb}</b>
                      <span className="q-sub">{item.line}</span>
                    </span>
                    <span className="q-action">{item.action}</span>
                  </button>
                </li>
              ))}
            </ul>
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
          {upcoming.length === 0 ? (
            <p className="sec-empty">אין צילומים מתוכננים.</p>
          ) : (
            <ul className="up-list">
              {upcoming.map((p) => (
                <li key={p.id}>
                  <button className="up-row" onClick={() => onOpen(p.id)}>
                    <span className="up-when"><b className="mono">{p.date}</b></span>
                    <span className="up-main">
                      <b>{p.client}</b>
                      <span>{[p.event, p.location].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <section className="desk" aria-label="העבודות שעל השולחן">
        <div className="sec-bar">
          <h2>על השולחן</h2>
          <span className="sec-n mono">{active.length}</span>
          <button className="sec-link" onClick={() => onSection('projects')}>
            כל הפרויקטים
          </button>
        </div>

        {active.length === 0 ? (
          <p className="sec-empty">אין עבודות פעילות כרגע.</p>
        ) : (
          <div className="jobs">
            {active.map((p) => (
              <JobTile key={p.id} project={p} onOpen={onOpen} />
            ))}
          </div>
        )}
      </section>

      <footer className="today-foot">
        <span><b className="mono">{stats.active}</b> פרויקטים פעילים</span>
        <i />
        <span><b className="mono">{stats.waiting}</b> ממתינים ללקוח</span>
        <i />
        <span><b className="mono">{stats.editing}</b> בעריכה</span>
        <i />
        <span><b className="mono">₪{stats.toCollect.toLocaleString('he-IL')}</b> לגבייה</span>
      </footer>
    </div>
  );
}
