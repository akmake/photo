import { useMemo, useState } from 'react';
import { useStudio, STATE_LABEL, stagesOf } from '../store';
import type { Project, ProjectState } from '../store';
import NewProject from './NewProject';
import { CannotRead, StillReading } from './Screens';
import { IcFolderOpen } from '../../design/Icons';

type Filter = 'all' | ProjectState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'כל הפרויקטים' },
  { id: 'work', label: STATE_LABEL.work },
  { id: 'waiting', label: STATE_LABEL.waiting },
  { id: 'shoot', label: STATE_LABEL.shoot },
  { id: 'done', label: STATE_LABEL.done },
];

const SORT: Record<ProjectState, number> = { waiting: 0, work: 1, shoot: 2, done: 3 };

function moneyOpen(project: Project): number {
  return project.price ? project.price - (project.paid ?? 0) : 0;
}

function currentStage(project: Project): string {
  if (project.state === 'waiting') return 'ממתין לאישור הלקוח';
  if (project.state === 'done') return 'הפרויקט הושלם';
  return stagesOf(project)[Math.min(project.at, stagesOf(project).length - 1)]?.label ?? 'הכנה';
}

function ProjectLine({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const stages = stagesOf(project);
  const current = Math.max(0, Math.min(project.at, stages.length - 1));
  const open = moneyOpen(project);

  return (
    <article className="project-index-line">
      <button
        className="project-index-hit"
        onClick={() => onOpen(project.id)}
        aria-label={`פתיחת ${project.client} — ${project.event}`}
      />

      <div className="project-index-photo" aria-hidden={!project.thumb}>
        {project.thumb ? (
          <img src={project.thumb} alt="" style={{ objectPosition: project.pos }} loading="lazy" />
        ) : (
          <span>{project.client.trim().charAt(0)}</span>
        )}
      </div>

      <div className="project-index-main">
        <div className="project-index-state-row">
          <span className={`project-index-state is-${project.state}`}>{STATE_LABEL[project.state]}</span>
          <span>{project.date}</span>
        </div>
        <h2>{project.client}</h2>
        <p>{[project.event, project.location].filter(Boolean).join(' · ')}</p>
      </div>

      <div className="project-index-journey">
        <div className="project-index-journey-copy">
          <span>השלב הנוכחי</span>
          <strong>{currentStage(project)}</strong>
        </div>
        <div className="project-index-track" aria-label={`שלב ${current + 1} מתוך ${stages.length}`}>
          {stages.map((stage, index) => (
            <i key={stage.id} className={index < current ? 'is-done' : index === current ? 'is-current' : ''} />
          ))}
        </div>
      </div>

      <div className="project-index-summary">
        <div>
          <span>תמונות</span>
          <strong>{project.counts}</strong>
        </div>
        <div>
          <span>יתרה</span>
          <strong>{project.price ? (open > 0 ? `₪${open.toLocaleString('he-IL')}` : 'שולם') : '—'}</strong>
        </div>
      </div>

      <span className="project-index-open" aria-hidden="true">
        פתיחת הפרויקט
        <span>←</span>
      </span>
    </article>
  );
}

export default function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const { projects, status, fault, saveFault } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: projects.length };
    for (const project of projects) next[project.state] = (next[project.state] ?? 0) + 1;
    return next;
  }, [projects]);

  const shown = useMemo(() => {
    const list = filter === 'all' ? projects : projects.filter((project) => project.state === filter);
    return [...list].sort((a, b) => SORT[a.state] - SORT[b.state]);
  }, [projects, filter]);

  if (status === 'down') return <CannotRead what="את הפרויקטים" fault={fault} />;
  if (status === 'loading' && projects.length === 0) return <StillReading what="את הפרויקטים" />;

  return (
    <main className="project-index">
      <header className="project-index-hero">
        <div>
          <span className="project-index-eyebrow">הסטודיו שלי</span>
          <h1>פרויקטים</h1>
          <p>כל עבודות הסטודיו, מסודרות לפי המקום שבו הן עומדות עכשיו.</p>
        </div>
        <button className="project-index-create" onClick={() => setCreating(true)}>
          <IcFolderOpen size={19} />
          יצירת פרויקט חדש
        </button>
      </header>

      <section className="project-index-overview" aria-label="סיכום הפרויקטים">
        <div><strong>{counts.work ?? 0}</strong><span>פרויקטים בעבודה</span></div>
        <div><strong>{counts.waiting ?? 0}</strong><span>ממתינים ללקוח</span></div>
        <div><strong>{counts.shoot ?? 0}</strong><span>צילומים קרובים</span></div>
      </section>

      {saveFault && <div className="project-index-fault" role="alert">השינוי האחרון לא נשמר — {saveFault}</div>}

      {projects.length === 0 ? (
        <section className="project-index-empty">
          <span>הפרויקט הראשון מתחיל כאן</span>
          <h2>הסטודיו עדיין ריק</h2>
          <p>ניצור תיק מסודר ללקוח, ולאחר מכן נכניס אליו את התמונות והתוצרים.</p>
          <button className="project-index-create" onClick={() => setCreating(true)}>יצירת פרויקט</button>
        </section>
      ) : (
        <>
          <div className="project-index-toolbar">
            <div>
              <span className="project-index-section-label">העבודות שלי</span>
              <strong>{shown.length} פרויקטים</strong>
            </div>
            <nav className="project-index-filters" aria-label="סינון לפי מצב">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  className={item.id === filter ? 'is-active' : ''}
                  onClick={() => setFilter(item.id)}
                  aria-pressed={item.id === filter}
                >
                  {item.label}
                  <span>{counts[item.id] ?? 0}</span>
                </button>
              ))}
            </nav>
          </div>

          {shown.length ? (
            <section className="project-index-list">
              {shown.map((project) => <ProjectLine key={project.id} project={project} onOpen={onOpen} />)}
            </section>
          ) : (
            <p className="project-index-no-results">אין כרגע פרויקטים במצב הזה.</p>
          )}
        </>
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
