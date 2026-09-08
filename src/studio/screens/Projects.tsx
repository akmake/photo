import { useMemo, useState } from 'react';
import { useStudio, stagesOf } from '../store';
import type { Project, ProjectState } from '../store';
import NewProject from './NewProject';
import { CannotRead, StillReading } from './Screens';
import { IcBook, IcCamera, IcChart, IcFolder, IcGallery, IcUpload } from '../../design/Icons';

type Filter = 'all' | ProjectState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'הכול' },
  { id: 'work', label: 'בעבודה' },
  { id: 'waiting', label: 'אישור לקוח' },
  { id: 'shoot', label: 'מתוכנן' },
  { id: 'done', label: 'נמסר' },
];

const SORT: Record<ProjectState, number> = { work: 0, waiting: 1, shoot: 2, done: 3 };

const STATE_COPY: Record<ProjectState, { label: string }> = {
  work: { label: 'עריכה' },
  waiting: { label: 'אישור לקוח' },
  shoot: { label: 'מתוכנן' },
  done: { label: 'נמסר' },
};

function openBalance(project: Project): number {
  return Math.max(0, (project.price ?? 0) - (project.paid ?? 0));
}

function progressOf(project: Project): number {
  if (project.state === 'done') return 100;
  const stages = stagesOf(project);
  if (!stages.length) return 0;
  return Math.max(8, Math.min(95, Math.round(((project.at + 1) / stages.length) * 100)));
}

function stageLabel(project: Project): string {
  if (project.state === 'waiting') return 'ממתין לאישור הלקוח';
  if (project.state === 'shoot') return `צילום ב־${project.date}`;
  if (project.state === 'done') return 'הפרויקט נמסר';
  const stages = stagesOf(project);
  return stages[Math.min(project.at, stages.length - 1)]?.label ?? 'בהכנה';
}

function ProjectImage({ project, featured = false }: { project: Project; featured?: boolean }) {
  if (project.thumb) {
    return <img src={project.thumb} alt="" style={{ objectPosition: project.pos }} loading={featured ? 'eager' : 'lazy'} />;
  }

  return (
    <div className="projects-empty-image" aria-label="טרם הועלו תמונות">
      <IcCamera size={featured ? 32 : 26} />
      <span>טרם הועלו תמונות</span>
    </div>
  );
}

function Metric({ icon, label, value, note, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: 'good' | 'warn';
}) {
  return (
    <div className="projects-metric">
      <div className="projects-metric-label"><span>{icon}</span>{label}</div>
      <strong>{value}</strong>
      <small className={tone ? `is-${tone}` : ''}>{note}</small>
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const progress = progressOf(project);
  const balance = openBalance(project);
  const detail = balance > 0
    ? `יתרה לתשלום ₪${balance.toLocaleString('he-IL')}`
    : project.state === 'waiting' && project.waitingSince
    ? `נשלחה גלריה · ${project.waitingSince}`
    : stageLabel(project);

  return (
    <button className="projects-card" type="button" onClick={() => onOpen(project.id)}>
      <div className="projects-card-image">
        <ProjectImage project={project} />
        <span className={`projects-state is-${project.state}`}>{STATE_COPY[project.state].label}</span>
      </div>
      <div className="projects-card-body">
        <h2>{project.client}</h2>
        <p>{[project.event, project.location].filter(Boolean).join(' · ') || 'פרויקט צילום'}</p>
        <div className="projects-card-progress">
          <i><span style={{ width: `${progress}%` }} /></i>
          <b>{progress}%</b>
        </div>
        <div className={`projects-card-foot ${balance > 0 ? 'has-balance' : ''}`}>
          <span>{detail}</span>
          <b>{project.imported.toLocaleString('he-IL')}</b>
        </div>
      </div>
    </button>
  );
}

export default function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const { projects, status, fault, saveFault } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  const active = useMemo(() => projects.filter((project) => project.state !== 'done'), [projects]);
  const featured = useMemo(
    () => [...active].sort((a, b) => SORT[a.state] - SORT[b.state] || b.imported - a.imported)[0] ?? projects[0],
    [active, projects],
  );
  const shown = useMemo(() => {
    const list = filter === 'all' ? projects : projects.filter((project) => project.state === filter);
    return [...list].sort((a, b) => SORT[a.state] - SORT[b.state]);
  }, [projects, filter]);

  const waitingPhotos = active.reduce((sum, project) => sum + Math.max(0, project.imported - project.rendered), 0);
  const activeAlbums = active.filter((project) => project.hasAlbum).length;
  const balance = projects.reduce((sum, project) => sum + openBalance(project), 0);

  if (status === 'down') return <CannotRead what="את הפרויקטים" fault={fault} />;
  if (status === 'loading' && projects.length === 0) return <StillReading what="את הפרויקטים" />;

  return (
    <main className="projects-dashboard" dir="rtl">
      <header className="projects-hero">
        <div>
          <h1>פרויקטים</h1>
          <p>כל התיקים בסטודיו, לפי השלב שבו הם נמצאים עכשיו.</p>
        </div>
        <div className="projects-actions">
          <button className="projects-button is-primary" type="button" onClick={() => setCreating(true)}>
            <span>＋</span> פרויקט חדש
          </button>
          <button
            className="projects-button"
            type="button"
            onClick={() => featured ? onOpen(featured.id) : setCreating(true)}
          >
            <IcUpload size={17} /> ייבוא תמונות
          </button>
        </div>
      </header>

      <section className="projects-metrics" aria-label="סיכום הפרויקטים">
        <Metric icon={<IcFolder size={17} />} label="פרויקטים פעילים" value={String(active.length)} note="נמצאים כעת בעבודה" tone="good" />
        <Metric icon={<IcGallery size={17} />} label="תמונות ממתינות" value={waitingPhotos.toLocaleString('he-IL')} note="בכל הפרויקטים הפעילים" />
        <Metric icon={<IcBook size={17} />} label="אלבומים בעבודה" value={String(activeAlbums)} note="בפרויקטים הפעילים" />
        <Metric icon={<IcChart size={17} />} label="יתרה לגבייה" value={`₪${balance.toLocaleString('he-IL')}`} note={balance ? 'ממתינה לתשלום' : 'הכול שולם'} tone={balance ? 'warn' : 'good'} />
      </section>

      {saveFault && <div className="projects-fault" role="alert">השינוי האחרון לא נשמר — {saveFault}</div>}

      {featured && (
        <section className="projects-featured">
          <div className="projects-featured-image">
            <ProjectImage project={featured} featured />
            <span className={`projects-state is-${featured.state}`}>{STATE_COPY[featured.state].label}</span>
          </div>
          <div className="projects-featured-copy">
            <div className="projects-featured-kicker">
              <span>התיק הפעיל</span>
              <button type="button" onClick={() => setFilter('all')}>כל הפעילות</button>
            </div>
            <h2>{featured.client}</h2>
            <p>{[featured.event, featured.location, featured.date].filter(Boolean).join(' · ')}</p>

            <div className="projects-featured-stats">
              <div><strong>{featured.imported.toLocaleString('he-IL')}</strong><span>תמונות גלם</span></div>
              <div><strong>{featured.kept.toLocaleString('he-IL')}</strong><span>נבחרו לעריכה</span></div>
              <div><strong className={openBalance(featured) ? 'is-warn' : ''}>₪{openBalance(featured).toLocaleString('he-IL')}</strong><span>נותרו לתשלום</span></div>
            </div>

            <div className="projects-featured-spacer" />
            <div className="projects-featured-progress-copy">
              <strong>{stageLabel(featured)}</strong>
              <span>{progressOf(featured)}%</span>
            </div>
            <div className="projects-progress"><span style={{ width: `${progressOf(featured)}%` }} /></div>
            <div className="projects-featured-actions">
              <button className="projects-button is-primary" type="button" onClick={() => onOpen(featured.id)}>המשך עבודה</button>
              <button className="projects-button" type="button" onClick={() => onOpen(featured.id)}>פתיחת התיק</button>
            </div>
          </div>
        </section>
      )}

      <div className="projects-toolbar">
        <strong>כל הפרויקטים <span>· {projects.length}</span></strong>
        <nav aria-label="סינון לפי מצב">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === filter ? 'is-active' : ''}
              onClick={() => setFilter(item.id)}
              aria-pressed={item.id === filter}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {projects.length === 0 ? (
        <section className="projects-empty">
          <IcCamera size={34} />
          <h2>הסטודיו עדיין ריק</h2>
          <p>הפרויקט הראשון מתחיל בתיק מסודר ללקוח.</p>
          <button className="projects-button is-primary" type="button" onClick={() => setCreating(true)}>פרויקט חדש</button>
        </section>
      ) : shown.length ? (
        <section className="projects-grid">
          {shown.map((project) => <ProjectCard key={project.id} project={project} onOpen={onOpen} />)}
        </section>
      ) : (
        <p className="projects-no-results">אין כרגע פרויקטים במצב הזה.</p>
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
    </main>
  );
}
