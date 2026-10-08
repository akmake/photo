/* היום — the FrameOps.dc.html handoff (claude.ai/design), 09.10.2026.
 *
 * Three questions, in the order a morning asks them: where was I (המשך מאיפה
 * שעצרת), what is waiting on me (תור עבודה), and what is coming (the next two
 * weeks, and the business in four numbers, in the side panel).
 *
 * The handoff was a demo. What the studio does not record is not drawn: a
 * shoot has a date and no hour, so the agenda shows no times; nothing tracks
 * background jobs, so there is no jobs table. "Where was I" is remembered on
 * this machine from the moment this screen shipped — until a project has been
 * opened once, that card is simply not there. */
import { useEffect, useMemo } from 'react';
import { STAGES, useStudio, useProjectFiles } from '../../studio/store';
import type { Project } from '../../studio/store';
import { thumbUrl } from '../../api';
import { getProjectCover } from '../projectCovers';
import { PROJECT_STAGE_LABEL, readLastOpen } from '../Frame';
import { shootDay } from './CalendarV2';
import './today-frame.css';

type DashboardProps = {
  onNavigate: (section: string) => void;
  onOpenProject?: (id: string, stage?: string) => void;
  onNewProject?: () => void;
  inspector: boolean;
};

const DAY = 86_400_000;

function shekels(n: number) {
  return `₪${n.toLocaleString('en-US')}`;
}

function openBalance(project: Project): number {
  return Math.max(0, (project.price ?? 0) - (project.paid ?? 0));
}

function ddmm(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function ago(ms: number) {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 2) return 'נפתח עכשיו';
  if (min < 60) return `נפתח לפני ${min} דקות`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? 'נפתח לפני שעה' : h === 2 ? 'נפתח לפני שעתיים' : `נפתח לפני ${h} שעות`;
  const d = Math.round(h / 24);
  return d === 1 ? 'נפתח אתמול' : `נפתח לפני ${d} ימים`;
}

function dayName(date: Date, midnight: number) {
  const diff = Math.round((date.getTime() - midnight) / DAY);
  if (diff === 0) return 'היום';
  if (diff === 1) return `מחר · ${date.toLocaleDateString('he-IL', { weekday: 'long' })}`;
  return date.toLocaleDateString('he-IL', { weekday: 'long' });
}

const STATE_COLOR: Record<Project['state'], string> = {
  shoot: 'var(--fo-blue)',
  work: 'var(--fo-text3)',
  waiting: 'var(--fo-accent)',
  done: 'var(--fo-green)',
};

/** A strip of the project's own frames, spread across the shoot. */
function Filmstrip({ project }: { project: Project }) {
  const { frames, ready } = useProjectFiles(project.id);
  const picks = useMemo(() => {
    if (frames.length <= 9) return frames;
    return Array.from({ length: 9 }, (_, i) => frames[Math.round((i * (frames.length - 1)) / 8)]);
  }, [frames]);
  if (!ready) {
    const n = Math.min(9, project.imported || 0);
    return n ? <div className="fo-td-film">{Array.from({ length: n }, (_, i) => <span key={i} />)}</div> : null;
  }
  if (!picks.length) return null;
  return (
    <div className="fo-td-film">
      {picks.map((f) => (
        <span key={f.path}><img src={thumbUrl(f.shown || f.path, 120, f.version)} alt="" /></span>
      ))}
    </div>
  );
}

export default function TodayV2({ onNavigate, onOpenProject, onNewProject, inspector }: DashboardProps) {
  const { projects, status, fault } = useStudio();

  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const remembered = readLastOpen();
  const rememberedProject = remembered
    ? projects.find((p) => p.id === remembered.id && p.state !== 'done')
    : undefined;
  /* With no "where was I" yet — a new install, or a project since delivered —
   * the card shows the active project instead, and says so in its label. It is
   * the work in hand, not a guess at where he stopped: in progress first, then
   * waiting on the client, then before the shoot; the newest among equals. */
  const activeProject = rememberedProject
    ? undefined
    : [...projects]
        .filter((p) => p.state !== 'done')
        .sort((a, b) =>
          ({ work: 0, waiting: 1, shoot: 2, done: 3 }[a.state] - { work: 0, waiting: 1, shoot: 2, done: 3 }[b.state])
          || (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  const lastProject = rememberedProject ?? activeProject;
  const last = rememberedProject ? remembered : null;

  const data = useMemo(() => {
    const active = projects.filter((p) => p.state !== 'done');
    const dated = projects
      .map((project) => ({ project, when: shootDay(project) }))
      .filter((x): x is { project: Project; when: Date } => x.when !== null);
    const todayShoots = dated.filter((x) => x.project.state !== 'done' && x.when.getTime() === midnight);
    const next = dated
      .filter((x) => x.project.state !== 'done' && x.when.getTime() > midnight)
      .sort((a, b) => a.when.getTime() - b.when.getTime())[0];
    const twoWeeks = dated
      .filter((x) => x.when.getTime() >= midnight && x.when.getTime() < midnight + 14 * DAY)
      .sort((a, b) => a.when.getTime() - b.when.getTime());
    const agenda: { date: Date; items: Project[] }[] = [];
    for (const x of twoWeeks) {
      const day = agenda.find((d) => d.date.getTime() === x.when.getTime());
      if (day) day.items.push(x.project);
      else agenda.push({ date: x.when, items: [x.project] });
    }

    type Row = { project: Project; kind: 'client' | 'shoot' | 'money' | 'work'; title: string; when: string; action: string; stage: string };
    const queue: Row[] = [];
    for (const p of active.filter((x) => x.state === 'waiting')) {
      queue.push({ project: p, kind: 'client', title: 'ממתין לתשובת הלקוח', when: p.waitingSince || '—', action: 'לשליחה ללקוח', stage: 'send-to-client' });
    }
    for (const { project: p, when } of dated) {
      if (p.state === 'done' || when.getTime() < midnight || when.getTime() >= midnight + 7 * DAY) continue;
      const d = Math.round((when.getTime() - midnight) / DAY);
      queue.push({
        project: p,
        kind: 'shoot',
        title: [`צילום ${d === 0 ? 'היום' : d === 1 ? 'מחר' : `בעוד ${d} ימים`}`, p.location].filter(Boolean).join(' · '),
        when: ddmm(when),
        action: 'פתח הכנה',
        stage: 'client-status',
      });
    }
    for (const p of projects.filter((x) => x.state === 'done' && openBalance(x) > 0)) {
      queue.push({ project: p, kind: 'money', title: `יתרה פתוחה אחרי מסירה · ${shekels(openBalance(p))}`, when: '—', action: 'לפרויקט', stage: 'client-status' });
    }
    for (const p of active.filter((x) => x.state === 'work')) {
      const stage = STAGES[Math.min(p.at, STAGES.length - 1)]?.label;
      queue.push({ project: p, kind: 'work', title: stage ? `בעבודה · ${stage}` : 'בעבודה', when: '—', action: 'פתח', stage: 'client-status' });
    }

    return {
      active,
      todayShoots,
      next,
      agenda,
      queue,
      waiting: active.filter((p) => p.state === 'waiting').length,
      balance: projects.reduce((sum, p) => sum + openBalance(p), 0),
      delivered: projects.filter((p) => p.state === 'done').length,
    };
  }, [projects, midnight]);

  /* Enter continues where you stopped — the button carries the ↵ hint. */
  useEffect(() => {
    if (!lastProject) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const el = document.activeElement;
      if (el && el !== document.body) return;
      e.preventDefault();
      onOpenProject?.(lastProject.id, last?.stage);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lastProject, last?.stage, onOpenProject]);

  const open = (p: Project, stage?: string) => onOpenProject?.(p.id, stage);
  const dot = { client: 'var(--fo-accent)', shoot: 'var(--fo-blue)', money: 'var(--fo-gold)', work: 'var(--fo-text3)' };

  return (
    <div className="fo-today" dir="rtl">
      <main className="fo-td-main">
        <div className="fo-td-bar">
          <span className="fo-td-heading">היום</span>
          <span className="fo-td-date">{now.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
          <span className="fo-td-spacer" />
          <span className="fo-td-pill">
            {data.todayShoots.length
              ? <><span className="fo-dot" style={{ background: 'var(--fo-blue)' }} />צילום היום · {data.todayShoots.map((x) => x.project.client).join(', ')}</>
              : 'אין צילום היום'}
          </span>
          {data.next && (
            <button type="button" className="fo-td-pill is-link" onClick={() => open(data.next!.project)}>
              <span className="fo-dot" style={{ background: 'var(--fo-blue)' }} />
              הבא:{data.next.when.getTime() < midnight + 7 * DAY ? ` ${dayName(data.next.when, midnight).split(' · ')[0]}` : ''}{' '}
              <span className="fo-mono">{ddmm(data.next.when)}</span> · {data.next.project.client}
            </button>
          )}
        </div>

        <div className="fo-td-scroll">
          {status === 'down' && (
            <div className="fo-td-fault" role="alert">
              <strong>לא ניתן לקרוא את הסטודיו</strong>
              <span>המנוע המקומי לא ענה, אז מה שמופיע כאן חסר — זה לא אומר שאין עבודה.{fault ? ` (${fault})` : ''}</span>
            </div>
          )}

          {lastProject && (
            <section className="fo-td-card fo-td-continue" data-tour="today-continue">
              <div className="fo-td-cover">
                {getProjectCover(lastProject, 640)
                  ? <img src={getProjectCover(lastProject, 640)!} alt="" style={{ objectPosition: lastProject.pos || 'center 40%' }} />
                  : <span className="fo-td-cover-empty">טרם יובאו תמונות</span>}
                {lastProject.imported > 0 && <span className="fo-td-chip fo-mono">{lastProject.imported.toLocaleString('en-US')}</span>}
              </div>
              <div className="fo-td-continue-copy">
                <span className="fo-td-label">{last ? 'המשך מאיפה שעצרת' : 'הפרויקט הפעיל'}</span>
                <div className="fo-td-continue-title">
                  <strong>{lastProject.client}</strong>
                  <span>
                    {(last
                      ? [lastProject.event, PROJECT_STAGE_LABEL[last.stage], ago(last.at)]
                      : [lastProject.event, lastProject.location, STAGES[Math.min(lastProject.at, STAGES.length - 1)]?.label, lastProject.date]
                    ).filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="fo-td-stats">
                  <span><span>יובאו </span><span className="fo-mono">{lastProject.imported.toLocaleString('en-US')}</span> תמונות</span>
                  {lastProject.picked > 0 && <span><span>הלקוח בחר </span><span className="fo-mono">{lastProject.picked.toLocaleString('en-US')}</span></span>}
                  {lastProject.rendered > 0 && <span><span>מוכנות </span><span className="fo-mono">{lastProject.rendered.toLocaleString('en-US')}</span></span>}
                </div>
                <Filmstrip project={lastProject} />
                <div className="fo-td-spacer" />
                <div className="fo-td-actions">
                  {last ? (
                    <>
                      <button type="button" className="fo-btn is-primary" onClick={() => open(lastProject, last.stage)}>
                        המשך · {PROJECT_STAGE_LABEL[last.stage] || 'הפרויקט'}<span className="fo-mono fo-td-enter">↵</span>
                      </button>
                      <button type="button" className="fo-btn" onClick={() => open(lastProject)}>פתח פרויקט</button>
                    </>
                  ) : (
                    <button type="button" className="fo-btn is-primary" onClick={() => open(lastProject)}>
                      פתח פרויקט<span className="fo-mono fo-td-enter">↵</span>
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="fo-td-card" data-tour="today-queue">
            <div className="fo-td-card-head">
              <span className="fo-td-card-title">תור עבודה</span>
              <span className="fo-mono fo-td-count">{data.queue.length}</span>
              <span className="fo-td-spacer" />
              <span className="fo-td-hint">לפי דחיפות · לקוח ממתין › צילום קרוב › כסף › עבודה פתוחה</span>
            </div>
            {data.queue.length > 0 && (
              <div className="fo-td-row is-head"><span /><span>מה</span><span>פרויקט</span><span>מתי</span><span /></div>
            )}
            {data.queue.map((q, i) => (
              <div
                key={`${q.kind}-${q.project.id}`}
                className={`fo-td-row ${q.kind === 'client' ? 'is-hot' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => open(q.project, q.stage)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); open(q.project, q.stage); } }}
              >
                <span className="fo-td-dot" style={{ background: dot[q.kind], borderRadius: q.kind === 'money' ? 2 : '50%' }} />
                <span className="fo-td-what">{q.title}</span>
                <span className="fo-td-proj">{[q.project.client, q.project.event].filter(Boolean).join(' · ')}</span>
                <span className="fo-mono fo-td-when">{q.when}</span>
                <button
                  type="button"
                  className={`fo-btn fo-td-act ${i === 0 && q.kind === 'client' ? 'is-primary' : ''}`}
                  onClick={(e) => { e.stopPropagation(); open(q.project, q.stage); }}
                >
                  {q.action}
                </button>
              </div>
            ))}
            {!data.queue.length && (
              <div className="fo-td-none">
                {status === 'loading' && !projects.length
                  ? 'קורא את הסטודיו…'
                  : status === 'down'
                  ? 'לא ניתן לקרוא את הפרויקטים כרגע.'
                  : projects.length
                  ? 'אין כרגע דבר שממתין לך.'
                  : <>אין עדיין פרויקטים. <button type="button" className="fo-btn is-primary" onClick={onNewProject}>פרויקט חדש</button></>}
              </div>
            )}
          </section>
        </div>
      </main>

      {inspector && (
        <aside className="fo-td-aside">
          <div className="fo-td-aside-head">
            <span>14 הימים הקרובים</span>
            <span className="fo-mono">{ddmm(now)} — {ddmm(new Date(midnight + 13 * DAY))}</span>
          </div>
          <div className="fo-td-agenda" data-tour="today-agenda">
            {data.agenda.map(({ date, items }) => (
              <div key={date.getTime()} className="fo-td-day">
                <div className="fo-td-day-head">
                  <span className={date.getTime() - midnight <= DAY ? 'is-near' : ''}>{dayName(date, midnight)}</span>
                  <span className="fo-mono">{ddmm(date)}</span>
                </div>
                {items.map((p) => (
                  <button key={p.id} type="button" className="fo-td-event" onClick={() => open(p)}>
                    <span className="fo-td-event-bar" style={{ background: STATE_COLOR[p.state] }} />
                    <span className="fo-td-event-copy">
                      <strong>{[p.event || 'צילום', p.client].join(' · ')}</strong>
                      {p.location && <small>{p.location}</small>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!data.agenda.length && <p className="fo-td-none">אין צילומים ביומן בשבועיים הקרובים.</p>}
            <button type="button" className="fo-td-link" onClick={() => onNavigate('calendar')}>ליומן המלא ←</button>
          </div>
          <div className="fo-td-biz" data-tour="today-business">
            <span className="fo-td-label">מצב עסקי</span>
            <button type="button" onClick={() => onNavigate('projects')}><span>פרויקטים פעילים</span><span className="fo-mono">{data.active.length}</span></button>
            <button type="button" onClick={() => onNavigate('projects')}><span>ממתינים ללקוח</span><span className="fo-mono">{data.waiting}</span></button>
            <button type="button" onClick={() => onNavigate('clients')}><span>יתרה פתוחה</span><span className="fo-mono" style={{ color: data.balance ? 'var(--fo-accent)' : undefined }}>{shekels(data.balance)}</span></button>
            <button type="button" onClick={() => onNavigate('projects')}><span>נמסרו</span><span className="fo-mono">{data.delivered}</span></button>
          </div>
        </aside>
      )}
    </div>
  );
}
