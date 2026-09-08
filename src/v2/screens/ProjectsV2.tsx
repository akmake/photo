import React, { useMemo, useState } from 'react';
import { useStudio, stagesOf } from '../../studio/store';
import type { Project, ProjectState } from '../../studio/store';
import NewProject from '../../studio/screens/NewProject';
import {
  TzIconBook, TzIconCalendar, TzIconCamera, TzIconChart, TzIconFolder,
  TzIconGallery, TzIconSearch, TzIconUpload, TzIconUsers,
} from '../TzIcons';
import { getProjectCover } from '../projectCovers';
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
  const { projects, status, fault } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const active = useMemo(() => projects.filter((p) => p.state !== 'done'), [projects]);
  
  const featured = useMemo(
    () => [...active].sort((a, b) => SORT[a.state] - SORT[b.state] || b.imported - a.imported)[0] ?? projects[0],
    [active, projects],
  );

  const filtered = useMemo(() => {
    let list = filter === 'all' ? projects : projects.filter((p) => p.state === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.client.toLowerCase().includes(q) ||
          p.event.toLowerCase().includes(q) ||
          (p.location && p.location.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => SORT[a.state] - SORT[b.state]);
  }, [projects, filter, search]);

  const waitingPhotos = active.reduce((sum, p) => sum + Math.max(0, p.imported - p.rendered), 0);
  const activeAlbums = active.filter((p) => p.hasAlbum).length;
  const balance = projects.reduce((sum, p) => sum + openBalance(p), 0);

  return (
    <div className="tz-projects-container">
      {/* 1. Header with Title & Quick Actions */}
      <section className="tz-projects-header">
        <div className="tz-projects-header-title">
          <div className="tz-projects-badge-tag">ניהול תיקים</div>
          <h1>פרויקטים</h1>
          <p>כל התיקים בסטודיו, מנוהלים וממוינים לפי השלב שבו הם נמצאים כעת.</p>
        </div>
        <div className="tz-projects-header-actions">
          <button className="tz-btn-projects-primary" type="button" onClick={() => setCreating(true)}>
            <span className="tz-btn-icon">＋</span> פרויקט חדש
          </button>
          <button
            className="tz-btn-projects-sec"
            type="button"
            onClick={() => featured ? onOpenProject(featured.id) : setCreating(true)}
          >
            <TzIconUpload size={16} /> ייבוא תמונות
          </button>
        </div>
      </section>

      {/* 2. Key Metrics Row */}
      <section className="tz-projects-metrics">
        <div className="tz-pmetric-card">
          <div className="tz-pmetric-head">
            <span>פרויקטים פעילים</span>
            <div className="tz-pmetric-icon-box" style={{ background: '#fff1ec', color: 'var(--tz-brand)' }}>
              <TzIconFolder size={17} />
            </div>
          </div>
          <div className="tz-pmetric-value">{active.length}</div>
          <div className="tz-pmetric-footer good">
            <span className="tz-dot active" /> {active.length} תיקים בעבודה שוטפת
          </div>
        </div>

        <div className="tz-pmetric-card">
          <div className="tz-pmetric-head">
            <span>תמונות ממתינות</span>
            <div className="tz-pmetric-icon-box" style={{ background: '#eff6ff', color: '#2563eb' }}>
              <TzIconGallery size={17} />
            </div>
          </div>
          <div className="tz-pmetric-value">{waitingPhotos.toLocaleString('he-IL')}</div>
          <div className="tz-pmetric-footer">
            <span>בכל הפרויקטים הפעילים</span>
          </div>
        </div>

        <div className="tz-pmetric-card">
          <div className="tz-pmetric-head">
            <span>אלבומים בעבודה</span>
            <div className="tz-pmetric-icon-box" style={{ background: '#fdf2f8', color: '#db2777' }}>
              <TzIconBook size={17} />
            </div>
          </div>
          <div className="tz-pmetric-value">{activeAlbums}</div>
          <div className="tz-pmetric-footer good">
            <span className="tz-dot active" /> אלבומים פתוחים לעיצוב
          </div>
        </div>

        <div className="tz-pmetric-card">
          <div className="tz-pmetric-head">
            <span>יתרה לגבייה</span>
            <div className="tz-pmetric-icon-box" style={{ background: balance ? '#fff8eb' : '#ecfdf5', color: balance ? '#d97706' : '#059669' }}>
              <TzIconChart size={17} />
            </div>
          </div>
          <div className="tz-pmetric-value">₪{balance.toLocaleString('he-IL')}</div>
          <div className="tz-pmetric-footer" style={{ color: balance ? '#d97706' : '#059669' }}>
            <span className="tz-dot" style={{ background: balance ? '#d97706' : '#059669' }} /> {balance ? 'ממתין לתשלום' : 'הכול שולם במלואו'}
          </div>
        </div>
      </section>

      {/* 3. Featured Active Project Hero Card */}
      {featured && (
        <section className="tz-pfeatured-card">
          <div className="tz-pfeatured-img-wrap">
            <img
              src={getProjectCover(featured, 0)}
              alt={featured.client}
              className="tz-pfeatured-img"
              style={{ objectPosition: featured.pos || 'center 30%' }}
            />
            <div className="tz-pfeatured-img-gradient" />
            <span className={`tz-status-badge ${STATE_COPY[featured.state].className} tz-pfeatured-state-badge`}>
              {STATE_COPY[featured.state].label}
            </span>
            {featured.date && (
              <span className="tz-pfeatured-date-badge">
                <TzIconCalendar size={13} /> {featured.date}
              </span>
            )}
          </div>

          <div className="tz-pfeatured-content">
            <div className="tz-pfeatured-top">
              <div className="tz-pfeatured-kicker">
                <span className="tz-pfeatured-kicker-dot" /> התיק הפעיל המרכזי
              </div>
              <h2 className="tz-pfeatured-title">{featured.client}</h2>
              <div className="tz-pfeatured-subtitle">
                {[featured.event, featured.location].filter(Boolean).join(' · ')}
              </div>

              <div className="tz-pfeatured-stats-row">
                <div className="tz-pfeatured-stat">
                  <strong>{featured.imported.toLocaleString('he-IL')}</strong>
                  <span>תמונות גלם</span>
                </div>
                <div className="tz-pfeatured-stat">
                  <strong>{featured.kept.toLocaleString('he-IL')}</strong>
                  <span>נבחרו לעריכה</span>
                </div>
                <div className="tz-pfeatured-stat">
                  <strong style={{ color: openBalance(featured) ? 'var(--tz-brand)' : '#059669' }}>
                    ₪{openBalance(featured).toLocaleString('he-IL')}
                  </strong>
                  <span>נותרו לתשלום</span>
                </div>
              </div>
            </div>

            <div className="tz-pfeatured-bottom">
              <div className="tz-pfeatured-prog">
                <div className="tz-pfeatured-prog-label">
                  <span>{stageLabel(featured)}</span>
                  <span className="tz-prog-pct">{progressOf(featured)}%</span>
                </div>
                <div className="tz-pprog-track">
                  <div className="tz-pprog-fill" style={{ width: `${progressOf(featured)}%` }} />
                </div>
              </div>

              <button
                className="tz-btn-projects-primary"
                type="button"
                onClick={() => onOpenProject(featured.id)}
              >
                המשך עבודה על התיק ←
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 4. Toolbar: Search & Filter Pills */}
      <div className="tz-ptoolbar">
        <div className="tz-ptoolbar-right">
          <div className="tz-psearch-box">
            <TzIconSearch size={16} />
            <input
              type="text"
              placeholder="חיפוש לפי שם לקוח או אירוע..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="tz-psearch-input"
            />
            {search && (
              <button className="tz-psearch-clear" type="button" onClick={() => setSearch('')}>
                ✕
              </button>
            )}
          </div>

          <div className="tz-pfilter-pills">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tz-pfilter-pill ${filter === item.id ? 'active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="tz-ptoolbar-count">
          מציג <strong>{filtered.length}</strong> מתוך {projects.length} פרויקטים
        </div>
      </div>

      {/* 5. Projects Grid with Unique Covers */}
      {filtered.length > 0 ? (
        <div className="tz-projects-grid">
          {filtered.map((project, idx) => {
            const prog = progressOf(project);
            const bal = openBalance(project);
            const st = STATE_COPY[project.state];
            // Assign a unique cover photo to every project
            const coverUrl = getProjectCover(project, idx);

            return (
              <div
                key={project.id}
                className="tz-project-card"
                onClick={() => onOpenProject(project.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onOpenProject(project.id);
                  }
                }}
              >
                <div className="tz-pcard-img-wrap">
                  <img
                    src={coverUrl}
                    alt={project.client}
                    className="tz-pcard-img"
                    style={{ objectPosition: project.pos || 'center 30%' }}
                    loading="lazy"
                  />
                  <div className="tz-pcard-img-overlay" />

                  {/* Top Status & Album Badges */}
                  <div className="tz-pcard-badges-top">
                    <span className={`tz-status-badge ${st.className}`}>
                      {st.label}
                    </span>
                    {project.hasAlbum && (
                      <span className="tz-pcard-album-badge" title="כולל אלבום מעוצב">
                        <TzIconBook size={12} /> אלבום
                      </span>
                    )}
                  </div>

                  {/* Bottom Date Overlay */}
                  {project.date && (
                    <div className="tz-pcard-date-badge">
                      <TzIconCalendar size={12} />
                      <span>{project.date}</span>
                    </div>
                  )}
                </div>

                <div className="tz-pcard-body">
                  <div className="tz-pcard-main-info">
                    <h3 className="tz-pcard-title">{project.client}</h3>
                    <p className="tz-pcard-subtitle">
                      {[project.event, project.location].filter(Boolean).join(' · ') || 'פרויקט צילום'}
                    </p>
                  </div>

                  <div className="tz-pcard-progress-wrap">
                    <div className="tz-pprog-track">
                      <div className="tz-pprog-fill" style={{ width: `${prog}%` }} />
                    </div>
                    <span className="tz-pcard-prog-pct">{prog}%</span>
                  </div>

                  <div className={`tz-pcard-footer ${bal > 0 ? 'has-balance' : ''}`}>
                    <div className="tz-pcard-stage-info">
                      {bal > 0 ? (
                        <span className="tz-balance-tag">יתרה לתשלום: ₪{bal.toLocaleString('he-IL')}</span>
                      ) : (
                        <span className="tz-stage-tag">{stageLabel(project)}</span>
                      )}
                    </div>
                    <div className="tz-pcard-photo-count">
                      <TzIconGallery size={13} />
                      <span>{project.imported.toLocaleString('he-IL')} תמ׳</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tz-pempty-state">
          <div className="tz-pempty-icon">
            <TzIconFolder size={36} />
          </div>
          <h3>לא נמצאו פרויקטים</h3>
          <p>
            {search
              ? `אין פרויקטים התואמים את החיפוש "${search}". נסה ביטוי אחר או נקה את החיפוש.`
              : 'אין כרגע פרויקטים בקטגוריה שנבחרה.'}
          </p>
          {search ? (
            <button className="tz-btn-projects-sec" type="button" onClick={() => setSearch('')}>
              נקה חיפוש
            </button>
          ) : (
            <button className="tz-btn-projects-primary" type="button" onClick={() => setCreating(true)}>
              <span>＋</span> פרויקט חדש
            </button>
          )}
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
