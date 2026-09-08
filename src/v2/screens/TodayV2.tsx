import { useMemo } from 'react';
import { useStudio } from '../../studio/store';
import type { Project } from '../../studio/store';
import './today.css';

function statusBadge(project: Project) {
  if (project.state === 'done') return { label: 'נמסר', cls: 'done' };
  if (project.state === 'shoot') return { label: 'מתוכנן', cls: 'shoot' };
  if (project.state === 'waiting') return { label: 'אישור לקוח', cls: 'waiting' };
  if (project.at >= 5) return { label: 'עיצוב אלבום', cls: 'work' };
  if (project.at >= 4) return { label: 'עריכה', cls: 'work' };
  if (project.at >= 2) return { label: 'בחירה', cls: 'work' };
  return { label: 'יובא', cls: 'work' };
}

export default function TodayV2({
  onNavigate,
  onOpenProject,
}: {
  onNavigate: (section: string) => void;
  onOpenProject: (id: string) => void;
}) {
  const { projects, status, fault } = useStudio();

  const data = useMemo(() => {
    const active = projects.filter((p) => p.state !== 'done');
    const waiting = projects.filter((p) => p.state === 'waiting');
    const shoots = projects
      .filter((p) => p.state === 'shoot')
      .sort((a, b) => a.date.localeCompare(b.date, undefined, { numeric: true }));
    const photosPending = active.reduce(
      (sum, p) => sum + Math.max(0, (p.imported || 0) - (p.rendered || 0)), 0,
    );
    const albums = active.filter((p) => p.hasAlbum && p.at >= 4).length;
    const delivered = projects.filter((p) => p.state === 'done').length;
    const tasks = [...waiting, ...shoots, ...active.filter((p) => p.state === 'work')].slice(0, 4);

    return {
      active,
      waiting,
      shoots,
      photosPending,
      albums,
      delivered,
      tasks,
    };
  }, [projects]);

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'בוקר טוב' : now.getHours() < 18 ? 'צהריים טובים' : 'ערב טוב';

  return (
    <div className="v2-today">
      {/* Hero Header */}
      <section className="v2-today-hero">
        <div className="v2-today-greeting">
          <h1>{greeting}, יוסי 👋</h1>
          <p>מרכז השליטה שלך — תמונת מצב חיה של הסטודיו והעבודות הפעילות.</p>
        </div>
        <div className="v2-today-actions">
          <button className="v2-btn v2-btn-primary" onClick={() => onNavigate('projects')}>
            <span>＋</span> פרויקט חדש
          </button>
          <button className="v2-btn" onClick={() => onNavigate('projects')}>
            <span>⇧</span> ייבוא תמונות
          </button>
          <button className="v2-btn" onClick={() => onNavigate('albums')}>
            <span>▣</span> יצירת אלבום
          </button>
        </div>
      </section>

      {/* Metrics Row */}
      <section className="v2-metrics-grid">
        <div className="v2-metric-card">
          <div className="v2-metric-header">
            <span>פרויקטים פעילים</span>
            <div className="v2-metric-icon" style={{ background: 'var(--v2-brand-surface)', color: 'var(--v2-brand)' }}>
              ▱
            </div>
          </div>
          <div className="v2-metric-value">{data.active.length}</div>
          <div className="v2-metric-sub">
            <span style={{ color: 'var(--v2-accent-emerald)' }}>●</span> בעבודה שוטפת כעת
          </div>
        </div>

        <div className="v2-metric-card">
          <div className="v2-metric-header">
            <span>תמונות ממתינות</span>
            <div className="v2-metric-icon" style={{ background: 'var(--v2-stage-cull-bg)', color: 'var(--v2-stage-cull)' }}>
              ◩
            </div>
          </div>
          <div className="v2-metric-value">{data.photosPending.toLocaleString('he-IL')}</div>
          <div className="v2-metric-sub">
            <span>בכל הפרויקטים הפעילים</span>
          </div>
        </div>

        <div className="v2-metric-card">
          <div className="v2-metric-header">
            <span>אלבומים בעבודה</span>
            <div className="v2-metric-icon" style={{ background: 'var(--v2-stage-album-bg)', color: 'var(--v2-stage-album)' }}>
              ▣
            </div>
          </div>
          <div className="v2-metric-value">{data.albums}</div>
          <div className="v2-metric-sub">
            <span style={{ color: 'var(--v2-accent-emerald)' }}>●</span> אלבומים פתוחים
          </div>
        </div>

        <div className="v2-metric-card">
          <div className="v2-metric-header">
            <span>פרויקטים שנמסרו</span>
            <div className="v2-metric-icon" style={{ background: 'var(--v2-accent-emerald-bg)', color: 'var(--v2-accent-emerald)' }}>
              ✓
            </div>
          </div>
          <div className="v2-metric-value">{data.delivered}</div>
          <div className="v2-metric-sub">
            <span>הושלמו ונמסרו ללקוח</span>
          </div>
        </div>
      </section>

      {/* Main & Side Columns */}
      <div className="v2-today-layout">
        {/* Main Column */}
        <div className="v2-today-main-col">
          <div className="v2-card">
            <div className="v2-card-header">
              <span className="v2-card-title">תיקים פעילים בעבודה</span>
              <button className="v2-card-link" onClick={() => onNavigate('projects')}>לכל הפרויקטים ←</button>
            </div>
            <table className="v2-table">
              <thead>
                <tr>
                  <th>פרויקט / לקוח</th>
                  <th>תאריך צילום</th>
                  <th>התקדמות</th>
                  <th>סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {data.active.slice(0, 5).map((p) => {
                  const badge = statusBadge(p);
                  const progress = Math.round(((p.at + 1) / 6) * 100);
                  return (
                    <tr key={p.id} onClick={() => onOpenProject(p.id)}>
                      <td>
                        <div className="v2-project-row-info">
                          {p.thumb ? (
                            <img src={p.thumb} alt="" className="v2-project-avatar" />
                          ) : (
                            <div className="v2-project-avatar" style={{ display: 'grid', placeItems: 'center', color: 'var(--v2-text-muted)' }}>📷</div>
                          )}
                          <div className="v2-project-names">
                            <strong>{p.client}</strong>
                            <small>{p.event || 'פרויקט צילום'}</small>
                          </div>
                        </div>
                      </td>
                      <td>{p.date || 'טרם נקבע'}</td>
                      <td>
                        <div className="v2-progress-bar-wrap">
                          <div className="v2-progress-track">
                            <div className="v2-progress-fill" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="v2-progress-percent">{progress}%</span>
                        </div>
                      </td>
                      <td>
                        <span className={`v2-status-pill ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {data.active.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: 'var(--v2-text-muted)' }}>
                      אין כרגע פרויקטים פעילים בסטודיו.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side Column */}
        <div className="v2-today-side-col">
          <div className="v2-card">
            <div className="v2-card-header">
              <span className="v2-card-title">משימות להיום</span>
              <button className="v2-card-link" onClick={() => onNavigate('projects')}>הכול</button>
            </div>
            <div className="v2-task-list">
              {data.tasks.map((task) => (
                <div className="v2-task-item" key={task.id} onClick={() => onOpenProject(task.id)}>
                  <div className="v2-task-right">
                    <span className="v2-task-dot" />
                    <span className="v2-task-title">
                      {task.state === 'shoot' ? `הכנה ל-${task.event}` : task.state === 'waiting' ? `לחזור אל ${task.client}` : `המשך עבודה על ${task.client}`}
                    </span>
                  </div>
                  <span className="v2-task-due">{task.date || 'היום'}</span>
                </div>
              ))}
              {data.tasks.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--v2-text-muted)', fontSize: '13px' }}>
                  אין משימות דחופות כרגע.
                </div>
              )}
            </div>
          </div>

          <div className="v2-card">
            <div className="v2-card-header">
              <span className="v2-card-title">צילומים קרובים ביומן</span>
              <button className="v2-card-link" onClick={() => onNavigate('calendar')}>ליומן</button>
            </div>
            <div className="v2-task-list">
              {data.shoots.slice(0, 3).map((shoot) => (
                <div className="v2-task-item" key={shoot.id} onClick={() => onOpenProject(shoot.id)}>
                  <div className="v2-task-right">
                    <span style={{ fontSize: '16px' }}>🗓️</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <strong style={{ color: 'var(--v2-text-primary)', fontSize: '13px' }}>{shoot.event}</strong>
                      <small style={{ color: 'var(--v2-text-muted)', fontSize: '12px' }}>{shoot.client}</small>
                    </div>
                  </div>
                  <span className="v2-task-due">{shoot.date}</span>
                </div>
              ))}
              {data.shoots.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--v2-text-muted)', fontSize: '13px' }}>
                  אין צילומים קרובים ביומן.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
