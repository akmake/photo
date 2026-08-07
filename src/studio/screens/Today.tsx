import { useMemo } from 'react';
import type { SectionId } from '../nav';
import { useStudio, stagesOf } from '../store';
import { CannotRead, StillReading } from './Screens';
import type { Project } from '../store';
import { IcCalendar, IcCamera, IcFolderOpen } from '../../design/Icons';

function openOf(p: Project): number {
  return p.price ? p.price - (p.paid ?? 0) : 0;
}

function dateKey(d: string): number {
  const [dd, mm] = d.split('.').map(Number);
  return (mm || 0) * 100 + (dd || 0);
}

type Kind = 'waiting' | 'shoot' | 'work' | 'money';

interface Item {
  key: string;
  kind: Kind;
  project: Project;
  title: string;
  meta: string;
  action: string;
}

const KIND_LABEL: Record<Kind, string> = {
  waiting: 'אצל לקוח',
  shoot: 'צילום קרוב',
  work: 'בעבודה',
  money: 'גבייה',
};

function stateItems(projects: Project[]) {
  const waiting: Item[] = [];
  const shoots: Item[] = [];
  const work: Item[] = [];
  const money: Item[] = [];

  for (const p of projects) {
    const stage = stagesOf(p)[p.at]?.label ?? 'בעבודה';

    if (p.state === 'waiting') {
      waiting.push({
        key: `${p.id}-waiting`,
        kind: 'waiting',
        project: p,
        title: p.client,
        meta: p.waitingSince ? `נשלח ${p.waitingSince}` : 'ממתין לאישור',
        action: p.at >= 4 ? 'פתח אלבום' : 'פתח בחירה',
      });
    }

    if (p.state === 'shoot') {
      shoots.push({
        key: `${p.id}-shoot`,
        kind: 'shoot',
        project: p,
        title: `${p.client} · ${p.event}`,
        meta: [p.date, p.location].filter(Boolean).join(' · '),
        action: 'פתח פרויקט',
      });
    }

    if (p.state === 'work') {
      work.push({
        key: `${p.id}-work`,
        kind: 'work',
        project: p,
        title: p.client,
        meta: `${stage}${p.counts ? ` · ${p.counts}` : ''}`,
        action: 'המשך עבודה',
      });
    }

    const owed = openOf(p);
    if (p.state === 'done' && owed > 0) {
      money.push({
        key: `${p.id}-money`,
        kind: 'money',
        project: p,
        title: p.client,
        meta: `₪${owed.toLocaleString('he-IL')} פתוחים`,
        action: 'פתח פרויקט',
      });
    }
  }

  shoots.sort((a, b) => dateKey(a.project.date) - dateKey(b.project.date));
  money.sort((a, b) => openOf(b.project) - openOf(a.project));

  return { waiting, shoots, work, money };
}

function ProjectFrame({ project, className = '' }: { project: Project; className?: string }) {
  if (!project.thumb) {
    return (
      <span className={`today-photo today-photo-empty ${className}`} aria-hidden="true">
        <IcCamera size={18} />
      </span>
    );
  }

  return (
    <img
      className={`today-photo ${className}`}
      src={project.thumb}
      alt=""
      style={{ objectPosition: project.pos }}
      loading="lazy"
    />
  );
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

  const desk = useMemo(() => {
    const groups = stateItems(projects);
    const open = projects.filter((p) => p.state !== 'done').length;
    const owed = projects.reduce((n, p) => n + openOf(p), 0);
    return { ...groups, open, owed };
  }, [projects]);

  if (status === 'down') return <CannotRead what="את השולחן" fault={fault} />;
  if (status === 'loading' && projects.length === 0) {
    return <StillReading what="את השולחן" />;
  }

  if (projects.length === 0) {
    return (
      <div className="today-workdesk">
        <header className="today-head">
          <p>{day} · {date}</p>
          <h1>היום</h1>
        </header>

        <section className="today-empty">
          <h2>אין עדיין פרויקטים</h2>
          <p>המסך הזה מתמלא רק מעבודות אמיתיות. כדי להתחיל, צור פרויקט ראשון.</p>
          <button className="today-action" onClick={() => onSection('projects')}>
            <IcFolderOpen size={17} />
            צור פרויקט ראשון
          </button>
        </section>
      </div>
    );
  }

  const allItems = [
    ...desk.waiting,
    ...desk.money,
    ...desk.shoots,
    ...desk.work,
  ];

  return (
    <div className="today-ledgerdesk">
      <aside className="today-date-rail">
        <span>{day}</span>
        <strong>{date}</strong>
        <button onClick={() => onSection('calendar')}>
          <IcCalendar size={17} />
          יומן
        </button>
      </aside>

      <main className="today-register">
        <header className="today-register-head">
          <div>
            <h1>סדר עבודה</h1>
            <p>מה לפתוח, למי לחזור, ומה מחכה לצילום.</p>
          </div>
          <button onClick={() => onSection('projects')}>
            <IcFolderOpen size={17} />
            פרויקטים
          </button>
        </header>

        <div className="today-register-table" role="table" aria-label="סדר עבודה יומי">
          <div className="today-register-row today-register-labels" role="row">
            <span>#</span>
            <span>מצב</span>
            <span>לקוח</span>
            <span>פרויקט</span>
            <span>פרט</span>
            <span />
          </div>

          {allItems.length ? allItems.map((item, index) => (
            <button
              key={item.key}
              className={`today-register-row today-${item.kind}`}
              onClick={() => onOpen(item.project.id)}
              role="row"
            >
              <span className="today-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="today-state">{KIND_LABEL[item.kind]}</span>
              <span className="today-client">
                <ProjectFrame project={item.project} />
                <b>{item.project.client}</b>
              </span>
              <span>{item.project.event}</span>
              <span>{item.meta}</span>
              <span className="today-open">{item.action}</span>
            </button>
          )) : (
            <p className="today-muted">אין משימות פתוחות להיום.</p>
          )}
        </div>
      </main>

      <aside className="today-summary-strip">
        <div>
          <span>פתוחים</span>
          <b>{desk.open}</b>
        </div>
        <div>
          <span>אצל לקוחות</span>
          <b>{desk.waiting.length}</b>
        </div>
        <div>
          <span>לגבייה</span>
          <b dir="ltr">₪{desk.owed.toLocaleString('he-IL')}</b>
        </div>
      </aside>
    </div>
  );
}
