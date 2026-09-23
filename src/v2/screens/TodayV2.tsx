import { useMemo, useState } from 'react';
import '@fontsource/ibm-plex-sans-hebrew/400.css';
import '@fontsource/ibm-plex-sans-hebrew/700.css';
import { STAGES, useStudio } from '../../studio/store';
import type { Project } from '../../studio/store';
import { getProjectCover } from '../projectCovers';
import { shootDay } from './CalendarV2';
import './today-sharp.css';

type DashboardProps = {
  onNavigate: (section: string) => void;
  onOpenProject?: (id: string, stage?: string) => void;
  onNewProject?: () => void;
};

function projectStatus(project: Project) {
  if (project.state === 'done') return { label: 'נמסר', tone: 'done' };
  if (project.state === 'waiting') return { label: 'ממתין ללקוח', tone: 'waiting' };
  if (project.state === 'shoot') return { label: 'צילום מתוכנן', tone: 'planned' };
  if (project.at >= 5) return { label: 'עיצוב אלבום', tone: 'work' };
  if (project.at >= 4) return { label: 'עריכה', tone: 'work' };
  if (project.at >= 2) return { label: 'בחירה', tone: 'work' };
  return { label: 'בעבודה', tone: 'work' };
}

function progressOf(project: Project) {
  const last = Math.max(1, STAGES.length - 1);
  return Math.round((Math.min(last, Math.max(0, project.at)) / last) * 100);
}

function projectDate(project: Project) {
  const date = shootDay(project);
  return date ? date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'לא נקבע';
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return 'היום';
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  return date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' });
}

function monthGrid(view: Date) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(view.getFullYear(), view.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, current: date.getMonth() === view.getMonth() };
  });
}

function Cover({ project }: { project: Project }) {
  const image = getProjectCover(project, 160);
  if (image) {
    return <img className="tdash-cover" src={image} alt="" style={{ objectPosition: project.pos || 'center 30%' }} />;
  }
  return <span className="tdash-cover tdash-cover-empty" aria-hidden="true">{project.client.trim().charAt(0) || '—'}</span>;
}

export default function TodayV2({ onNavigate, onOpenProject, onNewProject }: DashboardProps) {
  const { projects, status, fault } = useStudio();
  const [calendarView, setCalendarView] = useState(() => new Date());

  const data = useMemo(() => {
    const active = projects.filter((project) => project.state !== 'done');
    const waiting = active.filter((project) => project.state === 'waiting');
    const today = new Date();
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const shoots = active
      .map((project) => ({ project, date: shootDay(project) }))
      .filter((item): item is { project: Project; date: Date } =>
        item.project.state === 'shoot' && item.date !== null && item.date.getTime() >= midnight)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    const work = active.filter((project) => project.state === 'work');
    const attention = [
      ...waiting.map((project) => ({ project, label: 'ממתין לתשובת לקוח', detail: project.waitingSince ? `מאז ${project.waitingSince}` : 'נדרשת בדיקה', tone: 'waiting' })),
      ...shoots.filter((item) => item.date.getTime() < midnight + 7 * 86_400_000)
        .map(({ project, date }) => ({ project, label: 'צילום קרוב', detail: date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }), tone: 'planned' })),
      ...work.map((project) => ({ project, label: 'להמשך עבודה', detail: projectStatus(project).label, tone: 'work' })),
    ].filter((item, index, list) => list.findIndex((entry) => entry.project.id === item.project.id) === index);
    const byDay = new Map<string, Project[]>();
    for (const project of projects) {
      const date = shootDay(project);
      if (!date) continue;
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      byDay.set(key, [...(byDay.get(key) || []), project]);
    }
    return {
      active,
      shoots,
      attention,
      byDay,
      photosPending: active.reduce((sum, project) => sum + Math.max(0, (project.imported || 0) - (project.rendered || 0)), 0),
      albums: active.filter((project) => project.hasAlbum && project.at >= 4).length,
      delivered: projects.filter((project) => project.state === 'done').length,
      imported: projects.reduce((sum, project) => sum + (project.imported || 0), 0),
      rendered: projects.reduce((sum, project) => sum + (project.rendered || 0), 0),
    };
  }, [projects]);

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const greeting = today.getHours() < 12 ? 'בוקר טוב' : today.getHours() < 18 ? 'צהריים טובים' : 'ערב טוב';
  const openProject = (project: Project) => onOpenProject?.(project.id);
  const newProject = () => (onNewProject ? onNewProject() : onNavigate('projects'));

  return (
    <div className="tdash" dir="rtl">
      <header className="tdash-header">
        <div>
          <div className="tdash-eyebrow">FrameOps / סקירת סטודיו <span>·</span> {today.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1>{greeting}. זה הסטודיו שלך.</h1>
          <p>העבודה הפתוחה, מה שמחכה לך והצילומים הבאים — במקום אחד.</p>
        </div>
        <button className="tdash-primary" type="button" onClick={newProject}>פרויקט חדש <span aria-hidden="true">＋</span></button>
      </header>

      {status === 'down' && (
        <div className="tdash-alert" role="alert">
          <strong>לא ניתן לעדכן את תמונת המצב</strong>
          <span>{fault || 'המנוע המקומי אינו זמין כרגע.'}</span>
        </div>
      )}

      <section className="tdash-metrics" aria-label="מדדי סטודיו">
        {[
          { label: 'פרויקטים פעילים', value: data.active.length, note: 'נמצאים בתהליך' },
          { label: 'תמונות ממתינות', value: data.photosPending, note: 'טרם עובדו' },
          { label: 'אלבומים בעבודה', value: data.albums, note: 'בפרויקטים פעילים' },
          { label: 'פרויקטים שנמסרו', value: data.delivered, note: 'מתחילת העבודה' },
        ].map((metric) => (
          <div className="tdash-metric" key={metric.label}>
            <span className="tdash-metric-label">{metric.label}</span>
            <strong>{metric.value.toLocaleString('he-IL')}</strong>
            <span className="tdash-metric-note">{metric.note}</span>
          </div>
        ))}
      </section>

      <div className="tdash-grid">
        <div className="tdash-main">
          <section className="tdash-panel tdash-projects">
            <div className="tdash-panel-head">
              <div><span className="tdash-kicker">תמונת עבודה</span><h2>פרויקטים פעילים</h2></div>
              <button className="tdash-text-link" type="button" onClick={() => onNavigate('projects')}>כל הפרויקטים <span aria-hidden="true">←</span></button>
            </div>
            <div className="tdash-table-wrap">
              <table className="tdash-table">
                <thead><tr><th>פרויקט</th><th>צילום</th><th>שלב</th><th>התקדמות</th><th>עודכן</th></tr></thead>
                <tbody>
                  {data.active.slice(0, 6).map((project) => {
                    const state = projectStatus(project);
                    const progress = progressOf(project);
                    return (
                      <tr key={project.id}>
                        <td><button className="tdash-project-link" type="button" onClick={() => openProject(project)}><Cover project={project} /><span><strong>{project.event || project.client}</strong><small>{project.client}</small></span></button></td>
                        <td className="tdash-cell-muted">{projectDate(project)}</td>
                        <td><span className={`tdash-state tdash-state-${state.tone}`}>{state.label}</span></td>
                        <td><div className="tdash-progress"><span className="tdash-progress-track"><span style={{ width: `${progress}%` }} /></span><small>{progress}%</small></div></td>
                        <td className="tdash-cell-muted">{relativeDate(project.createdAt)}</td>
                      </tr>
                    );
                  })}
                  {!data.active.length && <tr><td className="tdash-empty" colSpan={5}>{status === 'loading' ? 'טוען פרויקטים…' : status === 'down' ? 'הפרויקטים אינם זמינים כרגע.' : 'אין כרגע פרויקטים פעילים. אפשר להתחיל מפרויקט חדש.'}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="tdash-panel tdash-calendar">
            <div className="tdash-panel-head">
              <div><span className="tdash-kicker">לוח זמנים</span><h2>יומן צילומים</h2></div>
              <button className="tdash-text-link" type="button" onClick={() => onNavigate('calendar')}>ליומן המלא <span aria-hidden="true">←</span></button>
            </div>
            <div className="tdash-calendar-body">
              <div className="tdash-calendar-month">
                <div className="tdash-calendar-toolbar">
                  <strong>{calendarView.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</strong>
                  <div>
                    <button type="button" aria-label="החודש הקודם" onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() - 1, 1))}>›</button>
                    <button type="button" aria-label="החודש הבא" onClick={() => setCalendarView(new Date(calendarView.getFullYear(), calendarView.getMonth() + 1, 1))}>‹</button>
                  </div>
                </div>
                <div className="tdash-weekdays">{['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((day) => <span key={day}>{day}</span>)}</div>
                <div className="tdash-days">{monthGrid(calendarView).map(({ date, current }) => {
                  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                  const shoots = data.byDay.get(key) || [];
                  const className = `tdash-day${current ? '' : ' is-outside'}${key === todayKey ? ' is-today' : ''}${shoots.length ? ' has-shoot' : ''}`;
                  return shoots.length ? <button key={key} type="button" className={className} title={shoots.map((project) => project.client).join(', ')} onClick={() => openProject(shoots[0])}>{date.getDate()}</button> : <span key={key} className={className}>{date.getDate()}</span>;
                })}</div>
              </div>
              <div className="tdash-upcoming">
                <h3>הצילומים הקרובים</h3>
                {data.shoots.slice(0, 3).map(({ project, date }) => <button className="tdash-upcoming-row" type="button" key={project.id} onClick={() => openProject(project)}><span className="tdash-date-tile"><strong>{date.getDate()}</strong><small>{date.toLocaleDateString('he-IL', { month: 'short' })}</small></span><span><strong>{project.event || 'צילום'}</strong><small>{project.client}</small></span><span className="tdash-row-arrow" aria-hidden="true">←</span></button>)}
                {!data.shoots.length && <p className="tdash-empty-inline">אין צילומים קרובים ביומן.</p>}
              </div>
            </div>
          </section>
        </div>

        <aside className="tdash-side">
          <section className="tdash-panel tdash-attention">
            <div className="tdash-panel-head"><div><span className="tdash-kicker">סדר יום</span><h2>דורש תשומת לב</h2></div><span className="tdash-count">{data.attention.length}</span></div>
            <div className="tdash-attention-list">
              {data.attention.slice(0, 5).map(({ project, label, detail, tone }) => <button type="button" className="tdash-attention-row" key={project.id} onClick={() => openProject(project)}><span className={`tdash-attention-mark tdash-mark-${tone}`} /><span className="tdash-attention-copy"><strong>{label}</strong><small>{project.client} · {detail}</small></span><span className="tdash-row-arrow" aria-hidden="true">←</span></button>)}
              {!data.attention.length && <p className="tdash-empty-inline">אין כרגע פריטים שמצריכים טיפול.</p>}
            </div>
            <button className="tdash-side-link" type="button" onClick={() => onNavigate('projects')}>לניהול פרויקטים <span aria-hidden="true">←</span></button>
          </section>

          <section className="tdash-panel tdash-activity">
            <div className="tdash-panel-head"><div><span className="tdash-kicker">עדכונים</span><h2>פעילות אחרונה</h2></div></div>
            {projects.slice(0, 4).map((project) => <button className="tdash-activity-row" type="button" key={project.id} onClick={() => openProject(project)}><span className="tdash-activity-line" /><span><strong>{project.client}</strong><small>{projectStatus(project).label} · {relativeDate(project.createdAt)}</small></span><span className="tdash-row-arrow" aria-hidden="true">←</span></button>)}
            {!projects.length && <p className="tdash-empty-inline">פעילות הפרויקטים תופיע כאן.</p>}
          </section>

          <div className="tdash-system"><span className={`tdash-system-dot ${status === 'ready' ? 'is-ready' : status === 'down' ? 'is-down' : ''}`} /><span>{status === 'ready' ? 'המנוע המקומי מחובר' : status === 'down' ? 'המנוע המקומי מנותק' : 'מתחבר למנוע המקומי'}</span><small>{data.rendered.toLocaleString('he-IL')} / {data.imported.toLocaleString('he-IL')} תמונות עובדו</small></div>
        </aside>
      </div>
    </div>
  );
}
