import React, { useMemo, useState } from 'react';
import { STAGES, useStudio } from '../../studio/store';
import type { Project } from '../../studio/store';
import {
  TzIconBook, TzIconCalendar, TzIconCamera, TzIconCheck, TzIconCloud,
  TzIconFilter, TzIconFolder, TzIconGallery, TzIconHeart, TzIconSliders,
  TzIconSparkle, TzIconUpload, TzIconUsers,
} from '../TzIcons';
import { getProjectCover } from '../projectCovers';
/* One derivation of "which real day is this shoot on", shared with the full
 * יומן — two answers to that question is two calendars that disagree. */
import { shootDay } from './CalendarV2';
import './today-redesign.css';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** A project's own photograph, small. A shoot with nothing imported yet gets
 *  the client's initial rather than a borrowed picture — see
 *  v2/projectCovers.ts for what this replaced. */
function CoverThumb({ project, size }: { project: Project; size?: number }) {
  const url = getProjectCover(project, 160);
  const box = size ? { width: size, height: size } : undefined;
  if (!url) {
    return (
      <span className="tz-cell-thumb tz-cell-thumb-empty" style={box} aria-hidden>
        {project.client.trim().charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="tz-cell-thumb"
      style={{ ...box, objectPosition: project.pos || 'center 30%' }}
    />
  );
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

export default function TodayV2({
  onNavigate,
  onOpenProject,
  onNewProject,
}: {
  onNavigate: (section: string) => void;
  onOpenProject?: (id: string, stage?: string) => void;
  /** Opens the new-project form. The button used to walk the photographer to
   *  the projects screen and leave him to find the same button again. */
  onNewProject?: () => void;
}) {
  const { projects, status, fault } = useStudio();
  const [calendarView, setCalendarView] = useState(() => new Date());

  const data = useMemo(() => {
    const active = projects.filter((project) => project.state !== 'done');
    const visible = active;
    const waiting = projects.filter((project) => project.state === 'waiting');
    /* Ordered by the real day, not by the text of `dd.mm`. As a string "05.01"
     * sorts before "18.09", so a January shoot booked for next year climbed to
     * the top of "צילומים קרובים" every time. */
    const shoots = projects
      .filter((project) => project.state === 'shoot')
      .map((project) => ({ project, when: shootDay(project) }))
      .sort((a, b) => (a.when?.getTime() ?? Infinity) - (b.when?.getTime() ?? Infinity))
      .map((item) => item.project);
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
      .slice(0, 4);

    /* Which projects fall on which day, so the month below marks real shoots
     * instead of printing numbers. */
    const byDay = new Map<string, Project[]>();
    for (const project of projects) {
      const when = shootDay(project);
      if (!when) continue;
      const key = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
      const bucket = byDay.get(key);
      if (bucket) bucket.push(project);
      else byDay.set(key, [project]);
    }

    return {
      active,
      visible,
      waiting,
      shoots,
      byDay,
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

  function handleOpenProject(p: Project) {
    onOpenProject?.(p.id);
  }

  return (
    <div className="tz-today-container">
      {/* 1. Hero Block */}
      {/* The greeting no longer carries a name. There is no account in this
          product and nobody ever typed one, so "יוסי" was a literal in the
          markup that would have greeted anyone who opened the program. */}
      <section className="tz-today-hero">
        <div className="tz-today-hero-title">
          <h1>{greeting} 👋</h1>
          <p>זה מה שקורה היום בעסק הצילום שלך — תמונת מצב מדויקת בזמן אמת.</p>
        </div>
        <div className="tz-today-hero-actions">
          <button
            className="tz-btn-hero-primary"
            type="button"
            onClick={() => (onNewProject ? onNewProject() : onNavigate('projects'))}
          >
            <span>＋</span> פרויקט חדש
          </button>

          {/* The three below act ON a project. With no project open, each one
              opens the form that creates one instead of dropping the
              photographer on a list to work out what went wrong. */}
          <button
            className="tz-btn-hero-sec"
            type="button"
            onClick={() => {
              const target = data.visible[0] || projects[0];
              if (target && onOpenProject) onOpenProject(target.id, 'gallery-upload');
              else if (onNewProject) onNewProject();
              else onNavigate('projects');
            }}
          >
            <TzIconUpload size={15} /> ייבוא תמונות
          </button>
          <button
            className="tz-btn-hero-sec"
            type="button"
            onClick={() => {
              const target = data.visible.find((p) => p.hasAlbum) || data.visible[0] || projects[0];
              if (target && onOpenProject) onOpenProject(target.id, 'album-design');
              else if (onNewProject) onNewProject();
              else onNavigate('albums');
            }}
          >
            <TzIconBook size={15} /> יצירת אלבום
          </button>
          <button
            className="tz-btn-hero-sec"
            type="button"
            onClick={() => {
              const target = data.visible.find((p) => p.hasGallery) || data.visible[0] || projects[0];
              if (target && onOpenProject) onOpenProject(target.id, 'send-to-client');
              else if (onNewProject) onNewProject();
              else onNavigate('projects');
            }}
          >
            <TzIconGallery size={15} /> שיתוף גלריה
          </button>
        </div>
      </section>

      {/* 2. Four Key Metrics Row */}
      <section className="tz-metrics-row">
        {/* Metric 1 */}
        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>פרויקטים פעילים</span>
            <div className="tz-metric-icon-box" style={{ background: 'var(--tz-brand-light)', color: 'var(--tz-brand)' }}>
              <TzIconFolder size={17} />
            </div>
          </div>
          <div className="tz-metric-value">{data.active.length.toLocaleString('he-IL')}</div>
          <div className="tz-metric-footer good">
            <span>●</span> נמצאים כעת בעבודה
          </div>
        </div>

        {/* Metric 2 */}
        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>תמונות ממתינות</span>
            <div className="tz-metric-icon-box" style={{ background: '#eff6ff', color: '#2563eb' }}>
              <TzIconGallery size={17} />
            </div>
          </div>
          <div className="tz-metric-value">{data.photosPending.toLocaleString('he-IL')}</div>
          <div className="tz-metric-footer">
            <span>בכל הפרויקטים הפעילים</span>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>אלבומים בעבודה</span>
            <div className="tz-metric-icon-box" style={{ background: '#fdf2f8', color: '#db2777' }}>
              <TzIconBook size={17} />
            </div>
          </div>
          <div className="tz-metric-value">{data.albums.toLocaleString('he-IL')}</div>
          <div className="tz-metric-footer good">
            <span>●</span> אלבומים פעילים
          </div>
        </div>

        {/* Metric 4 */}
        <div className="tz-metric-card">
          <div className="tz-metric-head">
            <span>פרויקטים שנמסרו</span>
            <div className="tz-metric-icon-box" style={{ background: 'var(--tz-green-bg)', color: 'var(--tz-green)' }}>
              <TzIconCheck size={17} />
            </div>
          </div>
          <div className="tz-metric-value">{data.delivered.toLocaleString('he-IL')}</div>
          <div className="tz-metric-footer good">
            <span>●</span> הושלמו בסטודיו
          </div>
        </div>
      </section>

      {/* 3. Main Split Layout */}
      <div className="tz-today-layout">
        {/* Main Column */}
        <div className="tz-today-main-col">
          {/* Active Projects Table */}
          <div className="tz-card">
            <div className="tz-panel-head-row">
              <span className="tz-panel-head-title">פרויקטים פעילים</span>
              <button className="tz-panel-link-btn" type="button" onClick={() => onNavigate('projects')}>
                לכל הפרויקטים ←
              </button>
            </div>

            <div className="tz-table-wrap">
              <table className="tz-projects-table">
                <thead>
                  <tr>
                    <th>פרויקט</th>
                    <th>לקוח</th>
                    <th>תאריך צילום</th>
                    <th>התקדמות</th>
                    <th>סטטוס</th>
                    <th>עודכן</th>
                  </tr>
                </thead>
                <tbody>
                  {data.visible.slice(0, 5).map((project, idx) => {
                    const st = statusOf(project);
                    const prog = progressOf(project);
                    return (
                      <tr key={project.id} onClick={() => handleOpenProject(project)}>
                        <td>
                          <div className="tz-cell-project">
                            <CoverThumb project={project} />
                            <div className="tz-cell-titles">
                              <strong>{project.event || project.client}</strong>
                              <small>{project.location || 'פרויקט צילום'}</small>
                            </div>
                          </div>
                        </td>
                        <td>{project.client}</td>
                        <td>{formatShootDate(project.date)}</td>
                        <td>
                          <div className="tz-cell-prog-wrap">
                            <div className="tz-cell-prog-track">
                              <div className="tz-cell-prog-fill" style={{ width: `${prog}%` }} />
                            </div>
                            <span className="tz-cell-prog-txt">{prog}%</span>
                          </div>
                        </td>
                        <td>
                          <span className={`tz-status-badge ${st.className}`}>{st.label}</span>
                        </td>
                        <td>{relativeDate(project.createdAt)}</td>
                      </tr>
                    );
                  })}
                  {data.visible.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: 'var(--tz-text-muted)' }}>
                        {status === 'loading' ? 'טוען פרויקטים מהמנוע...' : 'אין כרגע פרויקטים פעילים בסטודיו.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Split: Calendar & Recent Activity */}
          <div className="tz-bottom-split">
            {/* Calendar Widget */}
            <div className="tz-card">
              <div className="tz-cal-top-row">
                <button
                  type="button"
                  className="tz-cal-nav-btn"
                  onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() - 1, 1))}
                >
                  ›
                </button>
                <div className="tz-cal-title-block">
                  {calendarView.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
                </div>
                <button
                  type="button"
                  className="tz-cal-nav-btn"
                  onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() + 1, 1))}
                >
                  ‹
                </button>
              </div>

              <div className="tz-cal-grid-dows">
                {['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              {/* Marked days are shoots that exist in the studio. The month
                  used to be pure decoration: forty-two numbers with nothing
                  behind any of them. */}
              <div className="tz-cal-grid-days">
                {calendar.map(({ date, current }) => {
                  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                  const isToday = key === todayKey;
                  const shoots = data.byDay.get(key) ?? [];
                  const cls = `tz-cal-day-cell ${current ? '' : 'muted'} ${isToday ? 'today' : ''} ${shoots.length ? 'shoot' : ''}`;
                  if (!shoots.length) {
                    return <div key={key} className={cls}>{date.getDate()}</div>;
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      className={cls}
                      title={shoots.map((p) => `${p.client} · ${p.event}`).join('\n')}
                      onClick={() => handleOpenProject(shoots[0])}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>

              <button
                className="tz-panel-link-btn tz-cal-all"
                type="button"
                onClick={() => onNavigate('calendar')}
              >
                ליומן המלא ←
              </button>
            </div>

            {/* Recent Activity */}
            <div className="tz-card">
              <div className="tz-panel-head-row">
                <span className="tz-panel-head-title">פעילות אחרונה</span>
                <button className="tz-panel-link-btn" type="button" onClick={() => onNavigate('projects')}>
                  הכול
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {projects.slice(0, 3).map((project, idx) => (
                  <button
                    key={project.id}
                    type="button"
                    className="tz-act-item"
                    onClick={() => handleOpenProject(project)}
                  >
                    <CoverThumb project={project} size={34} />
                    <div className="tz-act-copy">
                      <strong>{project.client} · {statusOf(project).label}</strong>
                      <small>{relativeDate(project.createdAt)}</small>
                    </div>
                  </button>
                ))}
                {projects.length === 0 && (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--tz-text-muted)', fontSize: '13px' }}>
                    הפעילות תופיע לאחר פתיחת פרויקטים.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Side Column */}
        <div className="tz-today-side-col">
          {/* Tasks for Today */}
          <div className="tz-card">
            <div className="tz-panel-head-row">
              <span className="tz-panel-head-title">המשימות להיום</span>
              <button className="tz-panel-link-btn" type="button" onClick={() => onNavigate('projects')}>
                הכול
              </button>
            </div>

            <div>
              {data.tasks.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="tz-task-row"
                  onClick={() => handleOpenProject(project)}
                >
                  <div className="tz-task-right">
                    <span className="tz-task-checkbox" />
                    <span className="tz-task-text">
                      {project.state === 'shoot'
                        ? `הכנה לקראת ${project.event}`
                        : project.state === 'waiting'
                        ? `לחזור אל ${project.client}`
                        : `להמשיך את ${project.event}`}
                    </span>
                  </div>
                  <span className="tz-task-date">
                    {project.state === 'shoot' ? project.date : 'להיום'}
                  </span>
                </button>
              ))}
              {data.tasks.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--tz-text-muted)', fontSize: '12.5px' }}>
                  אין משימות פתוחות להיום.
                </div>
              )}
            </div>

            <button
              className="tz-btn-peach"
              style={{ marginTop: '12px' }}
              type="button"
              onClick={() => (onNewProject ? onNewProject() : onNavigate('projects'))}
            >
              ＋ פרויקט חדש
            </button>
          </div>

          {/* Upcoming Shoots */}
          <div className="tz-card">
            <div className="tz-panel-head-row">
              <span className="tz-panel-head-title">צילומים קרובים</span>
              <button className="tz-panel-link-btn" type="button" onClick={() => onNavigate('calendar')}>
                ליומן
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {data.shoots.slice(0, 3).map((project) => {
                const [day, month] = project.date.split('.').map(Number);
                const monthName = month
                  ? new Date(2024, month - 1, 1).toLocaleDateString('he-IL', { month: 'short' })
                  : 'טרם נקבע';
                return (
                  <button
                    key={project.id}
                    type="button"
                    className="tz-shoot-row"
                    onClick={() => handleOpenProject(project)}
                  >
                    <div className="tz-shoot-datebox">
                      <span>{monthName}</span>
                      <strong>{day || '—'}</strong>
                    </div>
                    <div className="tz-shoot-meta">
                      <strong>{project.event}</strong>
                      <small>{project.client}</small>
                    </div>
                    <div className="tz-shoot-loc">
                      <span style={{ color: 'var(--tz-green)' }}>●</span>
                    </div>
                  </button>
                );
              })}
              {data.shoots.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--tz-text-muted)', fontSize: '12.5px' }}>
                  אין צילומים קרובים ביומן.
                </div>
              )}
            </div>
          </div>

          {/* Client Activity / Waiting */}
          <div className="tz-card">
            <div className="tz-panel-head-row">
              <span className="tz-panel-head-title">פעילות לקוחות</span>
              <button className="tz-panel-link-btn" type="button" onClick={() => onNavigate('clients')}>
                הכול
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {data.waiting.slice(0, 3).map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="tz-shoot-row"
                  onClick={() => handleOpenProject(project)}
                >
                  <div className="tz-shoot-datebox" style={{ background: '#f4f4f5' }}>
                    <strong style={{ color: 'var(--tz-brand)' }}>{project.client.slice(0, 1).toUpperCase()}</strong>
                  </div>
                  <div className="tz-shoot-meta">
                    <strong>{project.client}</strong>
                    <small>{project.waitingSince ? `ממתין מאז ${project.waitingSince}` : 'ממתין לאישור הלקוח'}</small>
                  </div>
                  <span className="tz-status-badge review" style={{ fontSize: '10.5px' }}>
                    {statusOf(project).label}
                  </span>
                </button>
              ))}
              {data.waiting.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--tz-text-muted)', fontSize: '12.5px' }}>
                  אין פרויקטים שממתינים ללקוח.
                </div>
              )}
            </div>
          </div>

          {/* System & Local Engine Status */}
          <div className="tz-card">
            <div className="tz-panel-head-row" style={{ marginBottom: '10px' }}>
              <span className="tz-panel-head-title" style={{ fontSize: '13.5px' }}>מצב המערכת והמנוע</span>
            </div>

            <div className="tz-sys-status-row">
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="tz-sys-dot" style={{ background: status === 'ready' ? 'var(--tz-green)' : 'var(--tz-brand)' }} />
                <span>{status === 'ready' ? 'כל המערכות פועלות' : 'מתחבר למנוע המקומי'}</span>
              </span>
              <strong style={{ color: status === 'ready' ? 'var(--tz-green)' : 'var(--tz-brand)' }}>
                {status === 'ready' ? 'מחובר' : 'בטעינה'}
              </strong>
            </div>
            <div className="tz-sys-status-row">
              <span>פרויקטים מקומיים</span>
              <strong>{projects.length}</strong>
            </div>
            <div className="tz-sys-status-row">
              <span>תמונות שיובאו</span>
              <strong>{data.imported.toLocaleString('he-IL')}</strong>
            </div>
            <div className="tz-sys-status-row">
              <span>תמונות שעובדו</span>
              <strong>{data.rendered.toLocaleString('he-IL')}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
