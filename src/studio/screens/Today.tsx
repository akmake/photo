import { useMemo, useState } from 'react';
import type { SectionId } from '../nav';
import { STAGES, useStudio } from '../store';
import type { Project } from '../store';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function progressOf(project: Project) {
  return Math.round((clamp(project.at, 0, STAGES.length - 1) / (STAGES.length - 1)) * 100);
}

function statusOf(project: Project): { label: string; className: string } {
  if (project.state === 'done') return { label: 'נמסר', className: 'delivered' };
  if (project.state === 'shoot') return { label: 'מתוכנן', className: 'scheduled' };
  if (project.state === 'waiting') return { label: 'אישור לקוח', className: 'review' };
  if (project.at >= 5) return { label: 'עיצוב אלבום', className: 'album' };
  if (project.at >= 4) return { label: 'עריכה', className: 'editing' };
  if (project.at >= 2) return { label: 'בחירה', className: 'culling' };
  return { label: 'יובא', className: 'imported' };
}

function formatShootDate(value: string) {
  const [day, month] = value.split('.').map(Number);
  if (!day || !month) return value || 'טרם נקבע';
  return new Date(new Date().getFullYear(), month - 1, day).toLocaleDateString('he-IL', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function relativeDate(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'לאחרונה';
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days === 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(value).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function ProjectThumb({ project, compact = false }: { project: Project; compact?: boolean }) {
  if (!project.thumb) return <span className={`pd-thumb pd-thumb-empty ${compact ? 'pd-thumb-compact' : ''}`} />;
  return (
    <img
      className={`pd-thumb ${compact ? 'pd-thumb-compact' : ''}`}
      src={project.thumb}
      alt=""
      style={{ objectPosition: project.pos }}
      loading="lazy"
    />
  );
}

function monthGrid(view: Date) {
  const year = view.getFullYear();
  const month = view.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, current: date.getMonth() === month };
  });
}

export default function Today({
  onSection,
  onOpen,
}: {
  onSection: (section: SectionId) => void;
  onOpen: (id: string) => void;
}) {
  const { projects, status, fault } = useStudio();
  const [calendarView, setCalendarView] = useState(() => new Date());

  const data = useMemo(() => {
    const active = projects.filter((project) => project.state !== 'done');
    const visible = active;
    const waiting = projects.filter((project) => project.state === 'waiting');
    const shoots = projects
      .filter((project) => project.state === 'shoot')
      .sort((a, b) => a.date.localeCompare(b.date, undefined, { numeric: true }));
    const imported = projects.reduce((sum, project) => sum + (project.imported || 0), 0);
    const kept = projects.reduce((sum, project) => sum + (project.kept || 0), 0);
    const picked = projects.reduce((sum, project) => sum + (project.picked || 0), 0);
    const rendered = projects.reduce((sum, project) => sum + (project.rendered || 0), 0);
    const photosPending = active.reduce(
      (sum, project) => sum + Math.max(0, (project.imported || 0) - (project.rendered || 0)), 0,
    );
    const albums = active.filter((project) => project.hasAlbum && project.at >= 4).length;
    const delivered = projects.filter((project) => project.state === 'done').length;
    const tasks = [...waiting, ...shoots, ...active.filter((project) => project.state === 'work')]
      .filter((project, index, list) => list.findIndex((candidate) => candidate.id === project.id) === index)
      .slice(0, 3);
    return {
      active,
      visible,
      waiting,
      shoots,
      imported,
      kept,
      picked,
      rendered,
      photosPending,
      albums,
      delivered,
      tasks,
    };
  }, [projects]);

  const calendar = monthGrid(calendarView);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const greeting = now.getHours() < 12 ? 'בוקר טוב' : now.getHours() < 18 ? 'צהריים טובים' : 'ערב טוב';

  function openProject(project: Project) {
    onOpen(project.id);
  }

  return (
    <div className="photo-dashboard" dir="rtl">
      <main className="pd-main">
        <section className="pd-content">
          <div className="pd-hero">
            <div>
              <h1>{greeting}, יוסי <span aria-hidden="true">👋</span></h1>
              <div className="pd-sub">זה מה שקורה היום בעסק הצילום שלך.</div>
            </div>
            <div className="pd-actions">
              <button className="pd-btn primary" type="button" onClick={() => onSection('projects')}>＋ פרויקט חדש</button>
              <button className="pd-btn" type="button" onClick={() => onSection('projects')}>⇧ ייבוא תמונות</button>
              <button className="pd-btn" type="button" onClick={() => onSection('albums')}>▣ יצירת אלבום</button>
              <button className="pd-btn" type="button" onClick={() => onSection('projects')}>⌯ שיתוף גלריה</button>
            </div>
          </div>

          {status === 'down' ? (
            <div className="pd-alert" role="alert">
              נתוני הסטודיו אינם זמינים כרגע. {fault || 'יש לבדוק את החיבור למנוע המקומי.'}
            </div>
          ) : null}

          <div className="pd-grid">
            <div className="pd-leftcol">
              <section className="pd-metrics" aria-label="סיכום הסטודיו">
                <div className="pd-metric">
                  <div className="pd-metric-top"><span className="pd-icon">▱</span>פרויקטים פעילים</div>
                  <strong>{data.active.length.toLocaleString('he-IL')}</strong><div className="pd-delta up">● נמצאים כעת בעבודה</div>
                </div>
                <div className="pd-metric">
                  <div className="pd-metric-top"><span className="pd-icon">◩</span>תמונות ממתינות</div>
                  <strong>{data.photosPending.toLocaleString('he-IL')}</strong><div className="pd-delta down">בכל הפרויקטים הפעילים</div>
                </div>
                <div className="pd-metric">
                  <div className="pd-metric-top"><span className="pd-icon">▣</span>אלבומים בעבודה</div>
                  <strong>{data.albums.toLocaleString('he-IL')}</strong><div className="pd-delta up">● אלבומים פעילים</div>
                </div>
                <div className="pd-metric">
                  <div className="pd-metric-top"><span className="pd-icon">➤</span>פרויקטים שנמסרו</div>
                  <strong>{data.delivered.toLocaleString('he-IL')}</strong><div className="pd-delta up">● הושלמו בסטודיו</div>
                </div>
              </section>

              <section className="pd-panel pd-projects-panel">
                <div className="pd-panel-head">
                  <span>פרויקטים פעילים</span>
                  <button className="pd-link" type="button" onClick={() => onSection('projects')}>לכל הפרויקטים</button>
                </div>
                <div className="pd-table-scroll">
                  <table>
                    <thead><tr><th>פרויקט</th><th>לקוח</th><th>תאריך צילום</th><th>התקדמות</th><th>סטטוס</th><th>עודכן</th></tr></thead>
                    <tbody>
                      {data.visible.slice(0, 5).map((project) => {
                        const projectStatus = statusOf(project);
                        const progress = progressOf(project);
                        return (
                          <tr key={project.id} onClick={() => openProject(project)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') openProject(project); }}>
                            <td><div className="pd-project-cell"><ProjectThumb project={project} /><div><b>{project.event || project.client}</b><div className="pd-small pd-muted">{project.location || 'פרויקט צילום'}</div></div></div></td>
                            <td>{project.client}</td>
                            <td>{formatShootDate(project.date)}</td>
                            <td><div className="pd-progress-cell"><div className="pd-bar"><span style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div></td>
                            <td><span className={`pd-status ${projectStatus.className}`}>{projectStatus.label}</span></td>
                            <td>{relativeDate(project.createdAt)} <span aria-hidden="true">⋮</span></td>
                          </tr>
                        );
                      })}
                      {data.visible.length === 0 ? (
                        <tr className="pd-empty-row"><td colSpan={6}>{status === 'loading' ? 'טוען פרויקטים…' : 'אין עדיין פרויקטים פעילים.'}</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="pd-bottom-grid">
                <section className="pd-panel pd-calendar">
                  <div className="pd-cal-head">
                    <button type="button" onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() - 1, 1))}>‹</button>
                    <span className="pd-cal-title">יומן</span>
                    <button type="button" onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() + 1, 1))}>›</button>
                  </div>
                  <div className="pd-month">{calendarView.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</div>
                  <div className="pd-cal-grid">
                    {['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((day) => <span className="pd-dow" key={day}>{day}</span>)}
                    {calendar.map(({ date, current }) => {
                      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                      return <span className={`pd-day ${current ? '' : 'pd-muted'} ${key === todayKey ? 'active' : ''}`} key={key}>{date.getDate()}</span>;
                    })}
                  </div>
                </section>

                <section className="pd-panel pd-activity">
                  <div className="pd-panel-head"><span>פעילות אחרונה</span><button className="pd-link" type="button" onClick={() => onSection('projects')}>הצגת הכול</button></div>
                  {projects.slice(0, 3).map((project) => (
                    <button className="pd-activity-item" type="button" key={project.id} onClick={() => openProject(project)}>
                      <ProjectThumb project={project} compact />
                      <span><b>{project.client}</b> · {statusOf(project).label}<small>{relativeDate(project.createdAt)}</small></span>
                    </button>
                  ))}
                  {projects.length === 0 ? <div className="pd-panel-empty">הפעילות תופיע לאחר הוספת פרויקטים.</div> : null}
                </section>
              </div>
            </div>

            <aside className="pd-rightcol">
              <section className="pd-panel pd-side-panel">
                <div className="pd-panel-head"><span>המשימות להיום</span><button className="pd-link" type="button" onClick={() => onSection('projects')}>הצגת הכול</button></div>
                {data.tasks.map((project) => (
                  <button className="pd-task" type="button" key={project.id} onClick={() => openProject(project)}>
                    <span className="pd-checkbox" />
                    <span>{project.state === 'shoot' ? `הכנה לקראת ${project.event}` : project.state === 'waiting' ? `לחזור אל ${project.client}` : `להמשיך את ${project.event}`}</span>
                    <span className="pd-due">{project.state === 'shoot' ? project.date : 'להיום'}</span>
                  </button>
                ))}
                {data.tasks.length === 0 ? <div className="pd-panel-empty">אין משימות פתוחות להיום.</div> : null}
                <button className="pd-add-task" type="button" onClick={() => onSection('projects')}>＋ פתיחת פרויקטים</button>
              </section>

              <section className="pd-panel pd-side-panel">
                <div className="pd-panel-head"><span>צילומים קרובים</span><button className="pd-link" type="button" onClick={() => onSection('calendar')}>ליומן</button></div>
                {data.shoots.slice(0, 3).map((project) => {
                  const [day, month] = project.date.split('.').map(Number);
                  const monthName = month ? new Date(2024, month - 1, 1).toLocaleDateString('he-IL', { month: 'short' }) : 'טרם נקבע';
                  return (
                    <button className="pd-shoot" type="button" key={project.id} onClick={() => openProject(project)}>
                      <span className="pd-datebox">{monthName}<b>{day || '—'}</b></span>
                      <span><b>{project.event}</b><small>{project.client}</small></span>
                      <span>{project.location || 'מיקום טרם נקבע'} <i className="pd-ok">●</i></span>
                    </button>
                  );
                })}
                {data.shoots.length === 0 ? <div className="pd-panel-empty">אין צילומים קרובים ביומן.</div> : null}
              </section>

              <section className="pd-panel pd-side-panel">
                <div className="pd-panel-head"><span>פעילות לקוחות</span><button className="pd-link" type="button" onClick={() => onSection('clients')}>הצגת הכול</button></div>
                {data.waiting.slice(0, 3).map((project) => (
                  <button className="pd-message" type="button" key={project.id} onClick={() => openProject(project)}>
                    <span className="pd-mini-avatar">{project.client.slice(0, 1).toUpperCase()}</span>
                    <span><b>{project.client}</b><small>{project.waitingSince ? `ממתין מאז ${project.waitingSince}` : 'ממתין לאישור הלקוח'}</small></span>
                    <span className="pd-small pd-muted">{statusOf(project).label}</span>
                  </button>
                ))}
                {data.waiting.length === 0 ? <div className="pd-panel-empty">אין פרויקטים שממתינים ללקוח.</div> : null}
              </section>

              <section className="pd-panel pd-side-panel">
                <div className="pd-panel-head"><span>מצב המערכת</span></div>
                <div className="pd-status-row"><span className={status === 'ready' ? 'pd-ok' : 'pd-warn'}>● {status === 'ready' ? 'כל המערכות פועלות' : status === 'loading' ? 'מתחבר למנוע המקומי' : 'המנוע המקומי אינו זמין'}</span></div>
                <div className="pd-status-row"><span>◌ פרויקטים מקומיים</span><b>{projects.length}</b></div>
                <div className="pd-status-row"><span>◌ תמונות שיובאו</span><b>{data.imported.toLocaleString('he-IL')}</b></div>
                <div className="pd-status-row"><span>◌ תמונות שעובדו</span><b>{data.rendered.toLocaleString('he-IL')}</b></div>
              </section>
            </aside>
          </div>
        </section>
      </main>
    </div>
  );
}
