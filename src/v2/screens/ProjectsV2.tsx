/* פרויקטים — the FrameOps.dc.html handoff (claude.ai/design), 09.10.2026.
 *
 * A list you work FROM: what needs handling sits on top, the projects below as
 * a grid or a table, and a details panel beside them. One click selects and
 * shows the details; a double click, Enter or the panel's button opens. With
 * the panel closed there is nothing for a selection to show, so one click
 * opens directly.
 *
 * The handoff's contents were a demo. Every figure here is the project's own;
 * what this program does not record yet (a project code, size on disk) is not
 * on the screen at all. */
import React, { useEffect, useMemo, useState } from 'react';
import { useStudio, removeProject, fillMissingCovers, STAGES } from '../../studio/store';
import type { Project, ProjectState } from '../../studio/store';
import { getProjectCover } from '../projectCovers';
import { shootDay } from './CalendarV2';
import './projects-redesign.css';
import './projects-frame.css';

type Filter = 'all' | ProjectState;
type Sort = 'state' | 'created' | 'shoot' | 'client';
type View = 'grid' | 'list';

/* המחיקה בשני שלבים ובכוונה. פרויקט נושא חודשי עבודה, ומחיקה בקליק אחד
 * על כרטיס שכולו לחיץ היא תאונה שמחכה לקרות. */
interface Pending {
  id: string;
  client: string;
}

const STATE: Record<ProjectState, { label: string; dot: string }> = {
  work: { label: 'בעבודה', dot: 'var(--fo-text2)' },
  waiting: { label: 'ממתין ללקוח', dot: 'var(--fo-accent)' },
  shoot: { label: 'לפני צילום', dot: 'var(--fo-blue)' },
  done: { label: 'נמסר', dot: 'var(--fo-green)' },
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'הכל' },
  { id: 'work', label: 'בעבודה' },
  { id: 'waiting', label: 'ממתין ללקוח' },
  { id: 'shoot', label: 'לפני צילום' },
  { id: 'done', label: 'נמסר' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'state', label: 'לפי שלב' },
  { id: 'created', label: 'נפתח לאחרונה' },
  { id: 'shoot', label: 'תאריך צילום' },
  { id: 'client', label: 'שם לקוח' },
];

const STATE_ORDER: Record<ProjectState, number> = { waiting: 0, work: 1, shoot: 2, done: 3 };

const VIEW_KEY = 'frameops_projects_view';

function readView(): { view: View; size: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    return {
      view: saved.view === 'list' ? 'list' : 'grid',
      size: Number.isFinite(saved.size) ? Math.min(320, Math.max(180, saved.size)) : 230,
    };
  } catch {
    return { view: 'grid', size: 230 };
  }
}

function openBalance(project: Project): number {
  return Math.max(0, (project.price ?? 0) - (project.paid ?? 0));
}

function shekels(n: number) {
  return `₪${n.toLocaleString('en-US')}`;
}

function sub(project: Project) {
  return [project.event, project.location].filter(Boolean).join(' · ');
}

/** What wants the photographer, from the projects themselves. Three things the
 *  studio records: a client the photographer is waiting on, a shoot within the
 *  week, and money still open on a job already delivered. */
function needsHandling(projects: Project[]) {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const week = midnight + 7 * 86_400_000;
  const out: { project: Project; title: string; detail: string; action: string; stage: string; primary?: boolean }[] = [];

  for (const p of projects.filter((x) => x.state === 'waiting')) {
    out.push({
      project: p,
      title: `${p.client} — ממתין ללקוח`,
      detail: [p.event, p.waitingSince ? `נשלח ${p.waitingSince}` : ''].filter(Boolean).join(' · '),
      action: 'לשליחה ללקוח',
      stage: 'send-to-client',
      primary: true,
    });
  }
  for (const p of projects.filter((x) => x.state !== 'done')) {
    const when = shootDay(p);
    if (!when || when.getTime() < midnight || when.getTime() > week) continue;
    const days = Math.round((when.getTime() - midnight) / 86_400_000);
    out.push({
      project: p,
      title: `צילום ${days === 0 ? 'היום' : days === 1 ? 'מחר' : `בעוד ${days} ימים`} · ${p.client}`,
      detail: [p.event, p.location, p.date].filter(Boolean).join(' · '),
      action: 'פתח הכנה',
      stage: 'client-status',
    });
  }
  for (const p of projects.filter((x) => x.state === 'done' && openBalance(x) > 0)) {
    out.push({
      project: p,
      title: `יתרה פתוחה אחרי מסירה · ${shekels(openBalance(p))}`,
      detail: [p.client, p.event].filter(Boolean).join(' · '),
      action: 'לפרטי הלקוח',
      stage: 'client-status',
    });
  }
  return out;
}

function Cover({ project, width }: { project: Project; width: number }) {
  const url = getProjectCover(project, width);
  if (url) {
    return <img src={url} alt="" loading="lazy" style={{ objectPosition: project.pos || 'center 40%' }} />;
  }
  return null;
}

function IcCamera() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

export default function ProjectsV2({
  onOpenProject,
  onNewProject,
  selectedId,
  onSelect,
  inspector,
}: {
  onOpenProject: (id: string, stage?: string) => void;
  onNewProject: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  inspector: boolean;
}) {
  const { projects, status, fault } = useStudio();
  /* Covers for shoots imported before a project had one. Runs once the list is
   * in hand, in the background, and writes nothing for a project it cannot
   * read — see studio/store.ts::fillMissingCovers. */
  const missingCovers = projects.some((p) => !p.cover && p.home);
  useEffect(() => {
    if (missingCovers) void fillMissingCovers();
  }, [missingCovers]);

  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('state');
  const [{ view, size }, setLook] = useState(readView);
  const [pending, setPending] = useState<Pending | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  const setView = (next: Partial<{ view: View; size: number }>) => setLook((cur) => {
    const merged = { ...cur, ...next };
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(merged)); } catch { /* this session only */ }
    return merged;
  });

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    setDelError(null);
    try {
      await removeProject(pending.id);
      if (selectedId === pending.id) onSelect(null);
      setPending(null);
    } catch (e) {
      /* כישלון אינו ביטול. מחיקה שנכשלה במסד ונעלמה מהמסך הייתה חוזרת
       * בטעינה הבאה, והצלם לא היה יודע. */
      setDelError((e as Error).message || 'המחיקה נכשלה.');
    } finally {
      setDeleting(false);
    }
  };

  const shown = useMemo(() => {
    const list = filter === 'all' ? projects : projects.filter((p) => p.state === filter);
    const by: Record<Sort, (a: Project, b: Project) => number> = {
      state: (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state],
      created: (a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''),
      shoot: (a, b) => (shootDay(b)?.getTime() ?? 0) - (shootDay(a)?.getTime() ?? 0),
      client: (a, b) => a.client.localeCompare(b.client, 'he'),
    };
    return [...list].sort(by[sort]);
  }, [projects, filter, sort]);

  const queue = useMemo(() => needsHandling(projects), [projects]);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const pick = (id: string) => (inspector ? onSelect(id) : onOpenProject(id));

  /* Enter opens what is selected — the panel's button carries the ↵ hint. */
  useEffect(() => {
    if (!selected || !inspector) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || pending) return;
      const el = document.activeElement;
      if (el && el !== document.body && !(el as HTMLElement).closest?.('.fo-projects')) return;
      if (el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)) return;
      e.preventDefault();
      onOpenProject(selected.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, inspector, pending, onOpenProject]);

  const counts = (id: Filter) => (id === 'all' ? projects.length : projects.filter((p) => p.state === id).length);

  let body: React.ReactNode;
  if (status === 'down') {
    body = (
      <div className="fo-pj-empty">
        <strong>לא ניתן לקרוא את הפרויקטים</strong>
        <span>המנוע המקומי לא ענה, אז אין כאן מה להציג — זה לא אומר שהפרויקטים נמחקו.{fault ? ` (${fault})` : ''}</span>
      </div>
    );
  } else if (status === 'loading' && projects.length === 0) {
    body = <div className="fo-pj-empty"><span>קורא את הפרויקטים…</span></div>;
  } else if (projects.length === 0) {
    body = (
      <div className="fo-pj-empty">
        <IcCamera />
        <strong>אין עדיין פרויקטים</strong>
        <span>כל צילום ללקוח הוא פרויקט אחד.</span>
        <button type="button" className="fo-btn is-primary" onClick={onNewProject}>פרויקט חדש</button>
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className="fo-pj-empty">
        <span>אין פרויקטים במצב "{FILTERS.find((f) => f.id === filter)?.label}".</span>
        <button type="button" className="fo-btn" onClick={() => setFilter('all')}>הצג הכל</button>
      </div>
    );
  } else if (view === 'grid') {
    body = (
      <div className="fo-pj-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
        {shown.map((p) => {
          const on = inspector && p.id === selectedId;
          const hasCover = Boolean(getProjectCover(p));
          return (
            <div
              key={p.id}
              className={`fo-pj-tile ${on ? 'is-on' : ''}`}
              data-tour="projects-card"
              role="button"
              tabIndex={0}
              aria-pressed={on}
              onClick={() => pick(p.id)}
              onDoubleClick={() => onOpenProject(p.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpenProject(p.id); } }}
            >
              <div className="fo-pj-img">
                {hasCover ? (
                  <Cover project={p} width={Math.round(size * 1.6)} />
                ) : (
                  <div className="fo-pj-img-empty">
                    <IcCamera />
                    <span>{p.date ? <span className="fo-mono">{p.date}</span> : 'טרם יובאו תמונות'}</span>
                  </div>
                )}
                {p.imported > 0 && <span className="fo-pj-chip is-count fo-mono">{p.imported.toLocaleString('en-US')}</span>}
                <span className="fo-pj-chip is-state">
                  <span className="fo-dot" style={{ background: STATE[p.state].dot }} />
                  {STATE[p.state].label}
                </span>
              </div>
              <div className="fo-pj-copy">
                <span className="fo-pj-title">{p.client}</span>
                <span className="fo-pj-sub">
                  <span>{sub(p) || 'פרויקט צילום'}</span>
                  {p.date && <span className="fo-mono">{p.date}</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  } else {
    body = (
      <div className="fo-pj-table">
        <div className="fo-pj-row is-head">
          <span /><span>לקוח</span><span>אירוע</span><span>מצב</span><span>תמונות</span><span>תאריך</span>
        </div>
        {shown.map((p) => {
          const on = inspector && p.id === selectedId;
          return (
            <div
              key={p.id}
              className={`fo-pj-row ${on ? 'is-on' : ''}`}
              data-tour="projects-card"
              role="button"
              tabIndex={0}
              onClick={() => pick(p.id)}
              onDoubleClick={() => onOpenProject(p.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpenProject(p.id); } }}
            >
              <span className="fo-pj-row-thumb"><Cover project={p} width={120} /></span>
              <span className="fo-pj-row-title">{p.client}</span>
              <span className="fo-pj-row-dim">{sub(p)}</span>
              <span className="fo-pj-row-state"><span className="fo-dot" style={{ background: STATE[p.state].dot }} />{STATE[p.state].label}</span>
              <span className="fo-mono fo-pj-row-num">{p.imported ? p.imported.toLocaleString('en-US') : '—'}</span>
              <span className="fo-mono fo-pj-row-date">{p.date || '—'}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="fo-projects" dir="rtl">
      <main className="fo-pj-main">
        <div className="fo-pj-bar">
          <span className="fo-pj-heading">כל הפרויקטים</span>
          <div className="fo-pj-filters" data-tour="projects-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`fo-pj-filter ${filter === f.id ? 'is-on' : ''}`}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                <span className="fo-dot" style={{ background: f.id === 'all' ? 'transparent' : STATE[f.id].dot }} />
                {f.label}
                <span className="fo-mono fo-pj-filter-n">{counts(f.id)}</span>
              </button>
            ))}
          </div>
          <span className="fo-pj-spacer" />
          <label className="fo-pj-sort">
            מיון:
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <span className="fo-pj-sep" />
          {view === 'grid' && (
            <input
              type="range"
              min={180}
              max={320}
              value={size}
              title="גודל הכרטיסים"
              aria-label="גודל הכרטיסים"
              onChange={(e) => setView({ size: Number(e.target.value) })}
              className="fo-pj-size"
            />
          )}
          <div className="fo-pj-views">
            <button type="button" className={view === 'grid' ? 'is-on' : ''} title="רשת" aria-pressed={view === 'grid'} onClick={() => setView({ view: 'grid' })}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
            </button>
            <button type="button" className={view === 'list' ? 'is-on' : ''} title="רשימה" aria-pressed={view === 'list'} onClick={() => setView({ view: 'list' })}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
            </button>
          </div>
        </div>

        <div className="fo-pj-scroll">
          {queue.length > 0 && (
            <section className="fo-pj-queue" data-tour="projects-queue">
              <div className="fo-pj-queue-head">דורש טיפול<span className="fo-mono">{queue.length}</span></div>
              <div className="fo-pj-queue-grid">
                {queue.map((q) => (
                  <div
                    key={`${q.project.id}-${q.stage}-${q.action}`}
                    className={`fo-pj-q ${q.primary ? 'is-primary' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => pick(q.project.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpenProject(q.project.id, q.stage); }}
                  >
                    <span className="fo-pj-q-thumb"><Cover project={q.project} width={96} /></span>
                    <div className="fo-pj-q-copy">
                      <span className="fo-pj-q-title">{q.title}</span>
                      <span className="fo-pj-q-detail">{q.detail}</span>
                    </div>
                    <button
                      type="button"
                      className={`fo-btn fo-pj-q-btn ${q.primary ? 'is-primary' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onOpenProject(q.project.id, q.stage); }}
                    >
                      {q.action}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {body}
        </div>
      </main>

      {inspector && (
        <aside className="fo-pj-aside">
          <div className="fo-pj-aside-head">פרטי פרויקט</div>
          {selected ? (
            <>
              <div className="fo-pj-aside-body">
                <div className="fo-pj-aside-img">
                  <Cover project={selected} width={640} />
                  {!getProjectCover(selected) && <div className="fo-pj-img-empty"><IcCamera /><span>טרם יובאו תמונות</span></div>}
                </div>
                <div className="fo-pj-aside-title">
                  <strong>{selected.client}</strong>
                  <span>{sub(selected) || 'פרויקט צילום'}</span>
                </div>

                <div className="fo-pj-aside-sect">
                  <span className="fo-pj-aside-label">שלבים</span>
                  {STAGES.map((st, i) => {
                    const done = selected.state === 'done' || i < selected.at;
                    const cur = !done && i === selected.at;
                    return (
                      <div key={st.id} className={`fo-pj-stage ${done ? 'is-done' : ''} ${cur ? 'is-cur' : ''}`}>
                        <span className="fo-pj-stage-ring" />
                        <span>{st.label}</span>
                        <span className="fo-mono fo-pj-stage-meta">
                          {st.id === 'import' && selected.imported ? selected.imported.toLocaleString('en-US') : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="fo-pj-aside-sect is-meta">
                  {selected.date && <div><span>תאריך צילום</span><span className="fo-mono">{selected.date}</span></div>}
                  <div><span>מצב</span><span>{STATE[selected.state].label}</span></div>
                  {Boolean(selected.price) && (
                    <div>
                      <span>תשלום</span>
                      <span className="fo-mono" style={{ color: openBalance(selected) ? 'var(--fo-accent)' : undefined }}>
                        {shekels(selected.paid ?? 0)} / {shekels(selected.price ?? 0)}
                      </span>
                    </div>
                  )}
                  <div><span>תמונות</span><span className="fo-mono">{selected.imported.toLocaleString('en-US')}</span></div>
                  {selected.home && <div><span>תיקייה</span><span className="fo-mono" title={selected.home}>{selected.home}</span></div>}
                  {selected.phone && <div><span>טלפון</span><span className="fo-mono">{selected.phone}</span></div>}
                </div>
              </div>
              <div className="fo-pj-aside-foot">
                <button type="button" className="fo-btn is-primary fo-pj-open" onClick={() => onOpenProject(selected.id)}>
                  פתח פרויקט<span className="fo-mono fo-pj-enter">↵</span>
                </button>
                <div className="fo-pj-aside-pair">
                  <button type="button" className="fo-btn" onClick={() => onOpenProject(selected.id, 'gallery-upload')}>ייבוא תמונות</button>
                  <button
                    type="button"
                    className="fo-btn fo-pj-del"
                    data-tour="projects-delete"
                    onClick={() => setPending({ id: selected.id, client: selected.client })}
                  >
                    מחיקת הפרויקט
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="fo-pj-aside-none">
              {projects.length ? 'לחיצה על פרויקט מציגה כאן את פרטיו.' : 'אין עדיין פרויקט להציג.'}
            </div>
          )}
        </aside>
      )}

      {pending && (
        <div
          className="tz-del-backdrop"
          onClick={() => { if (!deleting) { setPending(null); setDelError(null); } }}
        >
          <div className="tz-del" onClick={(e) => e.stopPropagation()}>
            <h3>למחוק את הפרויקט של {pending.client}?</h3>
            <p className="tz-del-keep">
              <strong>התמונות שלך לא ייגעו.</strong> הן נשארות בתיקייה שבה שמת אותן,
              על הדיסק, בדיוק כמו עכשיו.
            </p>
            <p className="tz-del-lose">
              מה שיימחק: פרטי הפרויקט, הסשנים, מתכוני העריכה, סטטוסי התמונות
              והקישור לגלריה. אין לזה ביטול.
            </p>
            {delError && <p className="tz-del-err">{delError}</p>}
            <div className="tz-del-actions">
              <button
                className="tz-del-cancel"
                onClick={() => { setPending(null); setDelError(null); }}
                disabled={deleting}
              >
                ביטול
              </button>
              <button className="tz-del-go" onClick={confirmDelete} disabled={deleting}>
                {deleting ? 'מוחק…' : 'מחק את הפרויקט'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
