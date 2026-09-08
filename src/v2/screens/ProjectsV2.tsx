import React, { useMemo, useState } from 'react';
import { useStudio, stagesOf } from '../../studio/store';
import type { Project, ProjectState } from '../../studio/store';
import NewProject from '../../studio/screens/NewProject';
import {
  TzIconBook, TzIconCamera, TzIconChart, TzIconFolder, TzIconGallery,
  TzIconUpload, TzIconUsers,
} from '../TzIcons';
import './projects-redesign.css';

type Filter = 'all' | ProjectState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'הכול' },
  { id: 'work', label: 'בעבודה' },
  { id: 'waiting', label: 'אישור לקוח' },
  { id: 'shoot', label: 'מתוכנן' },
  { id: 'done', label: 'נמסר' },
];

const SORT: Record<ProjectState, number> = { work: 0, waiting: 1, shoot: 2, done: 3 };

const STATE_COPY: Record<ProjectState, { label: string; className: string }> = {
  work: { label: 'עריכה', className: 'editing' },
  waiting: { label: 'אישור לקוח', className: 'review' },
  shoot: { label: 'מתוכנן', className: 'scheduled' },
  done: { label: 'נמסר', className: 'delivered' },
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

export default function ProjectsV2({
  onOpenProject,
}: {
  onOpenProject: (id: string) => void;
}) {
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

  return (
    <div className="tz-projects-container">
      {/* 1. Hero Header */}
      <section className="tz-today-hero">
        <div className="tz-today-hero-title">
          <h1>פרויקטים 📁</h1>
          <p>כל התיקים בסטודיו, מנוהלים וממוינים לפי השלב שבו הם נמצאים כעת.</p>
        </div>
        <div className="tz-today-hero-actions">
          <button className="tz-btn-hero-primary" type="button" onClick={() => setCreating(true)}>
            <span>＋</span> פרויקט חדש
          </button>
          <button
            className="tz-btn-hero-sec"
            type="button"
            onClick={() => featured ? onOpenProject(featured.id) : setCreating(true)}
          >
            <TzIconUpload size={15} /> ייבוא תמונות
          </button>
        </div>
      </section>

      {/* 2. Key Metrics Row */}
      <section className="tz-metrics-row">
        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>פרויקטים פעילים</span>
            <div className="tz-metric-icon-box" style={{ background: 'var(--tz-brand-light)', color: 'var(--tz-brand)' }}>
              <TzIconFolder size={17} />
            </div>
          </div>
          <div className="tz-metric-value">{active.length}</div>
          <div className="tz-metric-footer good">
            <span>●</span> נמצאים כעת בעבודה
          </div>
        </div>

        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>תמונות ממתינות</span>
            <div className="tz-metric-icon-box" style={{ background: '#eff6ff', color: '#2563eb' }}>
              <TzIconGallery size={17} />
            </div>
          </div>
          <div className="tz-metric-value">{waitingPhotos.toLocaleString('he-IL')}</div>
          <div className="tz-metric-footer">
            <span>בכל הפרויקטים הפעילים</span>
          </div>
        </div>

        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>אלבומים בעבודה</span>
            <div className="tz-metric-icon-box" style={{ background: '#fdf2f8', color: '#db2777' }}>
              <TzIconBook size={17} />
            </div>
          </div>
          <div className="tz-metric-value">{activeAlbums}</div>
          <div className="tz-metric-footer good">
            <span>●</span> אלבומים פתוחים
          </div>
        </div>

        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>יתרה לגבייה</span>
            <div className="tz-metric-icon-box" style={{ background: balance ? '#fff8eb' : 'var(--tz-green-bg)', color: balance ? '#d97706' : 'var(--tz-green)' }}>
              <TzIconChart size={17} />
            </div>
          </div>
          <div className="tz-metric-value">₪{balance.toLocaleString('he-IL')}</div>
          <div className="tz-metric-footer" style={{ color: balance ? '#d97706' : 'var(--tz-green)' }}>
            <span>●</span> {balance ? 'ממתין לתשלום' : 'הכול שולם'}
          </div>
        </div>
      </section>

      {/* 3. Featured Project Card */}
      {featured && (
        <section className="tz-featured-card">
          <div className="tz-featured-img-wrap">
            {featured.thumb ? (
              <img src={featured.thumb} alt="" className="tz-featured-img" style={{ objectPosition: featured.pos }} />
            ) : (
              <div className="tz-featured-img-empty">
                <TzIconCamera size={34} />
                <span>טרם הועלו תמונות</span>
              </div>
            )}
            <span className={`tz-status-badge ${STATE_COPY[featured.state].className} tz-featured-state-badge`}>
              {STATE_COPY[featured.state].label}
            </span>
          </div>

          <div className="tz-featured-content">
            <div>
              <div className="tz-featured-kicker">התיק הפעיל המרכזי</div>
              <div className="tz-featured-title">{featured.client}</div>
              <div className="tz-featured-subtitle">
                {[featured.event, featured.location, featured.date].filter(Boolean).join(' · ')}
              </div>

              <div className="tz-featured-stats-row">
                <div className="tz-featured-stat">
                  <strong>{featured.imported.toLocaleString('he-IL')}</strong>
                  <span>תמונות גלם</span>
                </div>
                <div className="tz-featured-stat">
                  <strong>{featured.kept.toLocaleString('he-IL')}</strong>
                  <span>נבחרו לעריכה</span>
                </div>
                <div className="tz-featured-stat">
                  <strong style={{ color: openBalance(featured) ? 'var(--tz-brand)' : 'var(--tz-green)' }}>
                    ₪{openBalance(featured).toLocaleString('he-IL')}
                  </strong>
                  <span>נותרו לתשלום</span>
                </div>
              </div>
            </div>

            <div className="tz-featured-foot">
              <div className="tz-featured-prog">
                <div className="tz-featured-prog-label">
                  <span>{stageLabel(featured)}</span>
                  <span>{progressOf(featured)}%</span>
                </div>
                <div className="tz-cell-prog-track">
                  <div className="tz-cell-prog-fill" style={{ width: `${progressOf(featured)}%` }} />
                </div>
              </div>

              <div className="tz-featured-actions">
                <button
                  className="tz-btn-hero-primary"
                  type="button"
                  onClick={() => onOpenProject(featured.id)}
                >
                  המשך עבודה על התיק ←
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 4. Toolbar & Filter Pills */}
      <div className="tz-projects-toolbar">
        <div className="tz-projects-count-label">
          כל הפרויקטים <span>({shown.length})</span>
        </div>

        <div className="tz-filter-pills">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`tz-filter-pill ${filter === item.id ? 'active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 5. Projects Grid */}
      {shown.length > 0 ? (
        <div className="tz-projects-grid">
          {shown.map((project) => {
            const prog = progressOf(project);
            const bal = openBalance(project);
            const st = STATE_COPY[project.state];
            return (
              <div
                key={project.id}
                className="tz-project-card"
                onClick={() => onOpenProject(project.id)}
              >
                <div className="tz-project-card-img-wrap">
                  {project.thumb ? (
                    <img src={project.thumb} alt="" className="tz-project-card-img" style={{ objectPosition: project.pos }} />
                  ) : (
                    <div className="tz-featured-img-empty">
                      <TzIconCamera size={26} />
                      <span style={{ fontSize: '11px' }}>אין תמונה</span>
                    </div>
                  )}
                  <span
                    className={`tz-status-badge ${st.className}`}
                    style={{ position: 'absolute', top: 10, right: 10 }}
                  >
                    {st.label}
                  </span>
                </div>

                <div className="tz-project-card-body">
                  <h3>{project.client}</h3>
                  <p>{[project.event, project.location].filter(Boolean).join(' · ') || 'פרויקט צילום'}</p>

                  <div className="tz-project-card-progress">
                    <div className="tz-cell-prog-track">
                      <div className="tz-cell-prog-fill" style={{ width: `${prog}%` }} />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--tz-text-sub)' }}>{prog}%</span>
                  </div>

                  <div className={`tz-project-card-foot ${bal > 0 ? 'has-balance' : ''}`}>
                    <span>{bal > 0 ? `יתרה ₪${bal.toLocaleString('he-IL')}` : stageLabel(project)}</span>
                    <strong style={{ fontFamily: 'var(--tz-font-mono)' }}>{project.imported.toLocaleString('he-IL')} תמ׳</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tz-card" style={{ textAlign: 'center', padding: '48px', color: 'var(--tz-text-muted)' }}>
          אין כרגע פרויקטים במצב שנבחר.
        </div>
      )}

      {/* New Project Dialog */}
      {creating && (
        <NewProject
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            onOpenProject(created.id);
          }}
        />
      )}
    </div>
  );
}
