/* יומן.
 *
 * Every mark on this month comes from a project. There is no separate list of
 * events anywhere in this product, and there must not be one: an entry that is
 * not a job is a date nobody is paid for, and two lists of dates drift apart
 * the week after they are created.
 *
 * WHICH YEAR A SHOOT IS IN. A project carries its shoot date as `dd.mm` and no
 * year — that is the model, and this screen does not get to invent the missing
 * digits. It derives them: the year the job was opened in, and the next one if
 * that would put the shoot before the job existed (a January wedding booked in
 * December). The date shown is therefore always the same date twice over, and
 * never a guess that changes on New Year's Eve.
 */

import React, { useMemo, useState } from 'react';
import { useStudio } from '../../studio/store';
import type { Project } from '../../studio/store';
import { TzIconCalendar } from '../TzIcons';
import './today-redesign.css';
import './business-v2.css';

/** The shoot, as a real day. Null when `date` is not a `dd.mm` at all — an
 *  unparsable date is left off the grid rather than dropped on the 1st. */
export function shootDay(project: Project): Date | null {
  const [day, month] = (project.date || '').split('.').map(Number);
  if (!day || !month || day > 31 || month > 12) return null;
  const opened = new Date(project.createdAt);
  const year = Number.isFinite(opened.getTime()) ? opened.getFullYear() : new Date().getFullYear();
  const candidate = new Date(year, month - 1, day);
  if (Number.isFinite(opened.getTime()) && candidate < opened) {
    return new Date(year + 1, month - 1, day);
  }
  return candidate;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
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

const DOW = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export default function CalendarV2({
  onOpenProject,
}: {
  onOpenProject: (id: string, stage?: string) => void;
}) {
  const { projects, status, fault } = useStudio();
  const [view, setView] = useState(() => new Date());
  const [picked, setPicked] = useState<string | null>(null);

  /* Every project that has a readable shoot date, filed under the day it falls
   * on. A job with no date is not hidden — it is listed below the grid, which
   * is the only honest place for "this is real work with no date yet". */
  const { byDay, dated, undated } = useMemo(() => {
    const map = new Map<string, Project[]>();
    const withDate: { project: Project; when: Date }[] = [];
    const without: Project[] = [];
    for (const project of projects) {
      const when = shootDay(project);
      if (!when) {
        without.push(project);
        continue;
      }
      withDate.push({ project, when });
      const key = dayKey(when);
      const bucket = map.get(key);
      if (bucket) bucket.push(project);
      else map.set(key, [project]);
    }
    withDate.sort((a, b) => a.when.getTime() - b.when.getTime());
    return { byDay: map, dated: withDate, undated: without };
  }, [projects]);

  const grid = monthGrid(view);
  const today = new Date();
  const todayKey = dayKey(today);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const upcoming = dated.filter((item) => item.when.getTime() >= midnight).slice(0, 8);
  const pickedList = picked ? byDay.get(picked) ?? [] : [];

  if (status === 'down') {
    return (
      <div className="tz-biz-container">
        <div className="tz-biz-fault">
          <h2>לא ניתן לקרוא את היומן</h2>
          <p>{fault || 'המנוע המקומי אינו עונה.'}</p>
          <small>היומן בנוי מהפרויקטים, ואותם לא הצלחנו לקרוא — זה לא אומר שאין צילומים.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="tz-biz-container">
      <section className="tz-biz-head">
        <div>
          <div className="tz-biz-eyebrow">לוח הצילומים</div>
          <h1>יומן</h1>
          <p>כל צילום שקבעת, לפי התאריך שרשום בפרויקט עצמו.</p>
        </div>
        <div className="tz-biz-head-figures">
          <div>
            <small>צילומים קרובים</small>
            <strong>{upcoming.length}</strong>
          </div>
          <div className={undated.length ? 'is-due' : ''}>
            <small>בלי תאריך</small>
            <strong>{undated.length}</strong>
          </div>
        </div>
      </section>

      <div className="tz-cal-layout">
        <div className="tz-card tz-cal-month">
          <div className="tz-cal-top-row">
            <button
              type="button"
              className="tz-cal-nav-btn"
              title="החודש הקודם"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            >
              ›
            </button>
            <div className="tz-cal-title-block">
              {view.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
            </div>
            <button
              type="button"
              className="tz-cal-nav-btn"
              title="החודש הבא"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            >
              ‹
            </button>
          </div>

          <button
            type="button"
            className="tz-cal-today-btn"
            onClick={() => { setView(new Date()); setPicked(todayKey); }}
          >
            קפיצה להיום
          </button>

          <div className="tz-cal-grid-dows">
            {DOW.map((day) => <span key={day}>{day}</span>)}
          </div>

          <div className="tz-cal-grid-days is-large">
            {grid.map(({ date, current }) => {
              const key = dayKey(date);
              const shoots = byDay.get(key) ?? [];
              return (
                <button
                  key={key}
                  type="button"
                  className={`tz-cal-day-cell ${current ? '' : 'muted'} ${key === todayKey ? 'today' : ''} ${shoots.length ? 'has-shoot' : ''} ${key === picked ? 'picked' : ''}`}
                  onClick={() => setPicked(key === picked ? null : key)}
                  title={shoots.length ? shoots.map((p) => `${p.client} · ${p.event}`).join('\n') : undefined}
                >
                  <span>{date.getDate()}</span>
                  {shoots.length > 0 && <i className="tz-cal-dot">{shoots.length > 1 ? shoots.length : ''}</i>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="tz-cal-side">
          {picked && (
            <div className="tz-card">
              <div className="tz-panel-head-row">
                <span className="tz-panel-head-title">
                  {new Date(Number(picked.split('-')[0]), Number(picked.split('-')[1]), Number(picked.split('-')[2]))
                    .toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
                <button className="tz-panel-link-btn" type="button" onClick={() => setPicked(null)}>נקה</button>
              </div>
              {pickedList.length === 0 ? (
                <p className="tz-cal-none">אין צילום ביום הזה.</p>
              ) : (
                pickedList.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="tz-cal-entry"
                    onClick={() => onOpenProject(project.id)}
                  >
                    <strong>{project.event || 'צילום'}</strong>
                    <small>{project.client}{project.location ? ` · ${project.location}` : ''}</small>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="tz-card">
            <div className="tz-panel-head-row">
              <span className="tz-panel-head-title">הצילומים הבאים</span>
            </div>
            {upcoming.length === 0 ? (
              <div className="tz-biz-empty is-inline">
                <span className="tz-biz-empty-icon"><TzIconCalendar size={20} /></span>
                <p>{status === 'loading' ? 'קוראים את הפרויקטים…' : 'אין צילום קבוע קדימה.'}</p>
              </div>
            ) : (
              upcoming.map(({ project, when }) => (
                <button
                  key={project.id}
                  type="button"
                  className="tz-cal-entry is-row"
                  onClick={() => onOpenProject(project.id)}
                >
                  <span className="tz-cal-datebox">
                    <small>{when.toLocaleDateString('he-IL', { month: 'short' })}</small>
                    <b>{when.getDate()}</b>
                  </span>
                  <span className="tz-cal-entry-copy">
                    <strong>{project.event || 'צילום'}</strong>
                    <small>{project.client}{project.location ? ` · ${project.location}` : ''}</small>
                  </span>
                </button>
              ))
            )}
          </div>

          {undated.length > 0 && (
            <div className="tz-card">
              <div className="tz-panel-head-row">
                <span className="tz-panel-head-title">בלי תאריך צילום</span>
              </div>
              <p className="tz-cal-none">
                הפרויקטים האלה קיימים אבל אין בהם תאריך, ולכן אינם על הלוח.
              </p>
              {undated.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="tz-cal-entry"
                  onClick={() => onOpenProject(project.id)}
                >
                  <strong>{project.event || 'צילום'}</strong>
                  <small>{project.client}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
