import React, { useEffect, useMemo, useState } from 'react';
import { useStudio, stagesOf, removeProject, fillMissingCovers } from '../../studio/store';
import type { Project, ProjectState } from '../../studio/store';
import NewProject from '../../studio/screens/NewProject';
import { TzIconSearch, TzIconUpload } from '../TzIcons';
import { getProjectCover } from '../projectCovers';
import './projects-redesign.css';

type Filter = 'all' | ProjectState;

/* המחיקה בשני שלבים ובכוונה. פרויקט נושא חודשי עבודה, ומחיקה בקליק אחד
 * על כרטיס שכולו לחיץ היא תאונה שמחכה לקרות. */
interface Pending {
  id: string;
  client: string;
}

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
  onOpenProject: (id: string, stage?: string) => void;
}) {
  const { projects } = useStudio();
  /* Covers for shoots imported before a project had one. Runs once the list is
   * in hand, in the background, and writes nothing for a project it cannot
   * read — see studio/store.ts::fillMissingCovers. */
  const missingCovers = projects.some((p) => !p.cover && p.home);
  useEffect(() => {
    if (missingCovers) void fillMissingCovers();
  }, [missingCovers]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    setDelError(null);
    try {
      await removeProject(pending.id);
      setPending(null);
    } catch (e) {
      /* כישלון אינו ביטול. מחיקה שנכשלה במסד ונעלמה מהמסך הייתה חוזרת
       * בטעינה הבאה, והצלם לא היה יודע. */
      setDelError((e as Error).message || 'המחיקה נכשלה.');
    } finally {
      setDeleting(false);
    }
  };

  const active = useMemo(() => projects.filter((p) => p.state !== 'done'), [projects]);

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
            onClick={() => projects[0] ? onOpenProject(projects[0].id, 'gallery-upload') : setCreating(true)}
          >
            <TzIconUpload size={16} /> ייבוא תמונות
          </button>
        </div>
      </section>

      {/* 2. Key Metrics Row — Clean, Luxury Studio Typography, No Cheap Colored Boxes */}
      <section className="tz-projects-metrics">
        <div className="tz-pmetric-card">
          <div className="tz-pmetric-label">פרויקטים פעילים</div>
          <div className="tz-pmetric-value">{active.length}</div>
          <div className="tz-pmetric-footer good">
            <span className="tz-dot active" /> תיקים בעבודה שוטפת
          </div>
        </div>

        <div className="tz-pmetric-card">
          <div className="tz-pmetric-label">תמונות ממתינות</div>
          <div className="tz-pmetric-value">{waitingPhotos.toLocaleString('he-IL')}</div>
          <div className="tz-pmetric-footer">
            <span>בכל הפרויקטים הפעילים</span>
          </div>
        </div>

        <div className="tz-pmetric-card">
          <div className="tz-pmetric-label">אלבומים בעבודה</div>
          <div className="tz-pmetric-value">{activeAlbums}</div>
          <div className="tz-pmetric-footer good">
            <span className="tz-dot active" /> אלבומים פתוחים לעיצוב
          </div>
        </div>

        <div className="tz-pmetric-card">
          <div className="tz-pmetric-label">יתרה לגבייה</div>
          <div className="tz-pmetric-value">₪{balance.toLocaleString('he-IL')}</div>
          <div className="tz-pmetric-footer" style={{ color: balance ? '#d97706' : '#059669' }}>
            <span className="tz-dot" style={{ background: balance ? '#d97706' : '#059669' }} /> {balance ? 'ממתין לתשלום' : 'הכול שולם במלואו'}
          </div>
        </div>
      </section>

      {/* 3. Toolbar: Search & Filter Pills */}
      <div className="tz-ptoolbar">
        <div className="tz-ptoolbar-right">
          <div className="tz-psearch-box">
            <TzIconSearch size={15} />
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

      {/* 4. Projects Grid — Clean, High-End Photography First, No Clutter */}
      {filtered.length > 0 ? (
        <div className="tz-projects-grid">
          {filtered.map((project, idx) => {
            const prog = progressOf(project);
            const bal = openBalance(project);
            const st = STATE_COPY[project.state];
            const coverUrl = getProjectCover(project);

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
                  {/* A shoot that has not been imported has no cover, and says
                      so. It used to borrow a stranger's photograph for the
                      slot — see v2/projectCovers.ts. */}
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={project.client}
                      className="tz-pcard-img"
                      style={{ objectPosition: project.pos || 'center 30%' }}
                      loading="lazy"
                    />
                  ) : (
                    <div className="tz-pcard-img tz-pcard-img-empty">
                      <span>{project.client.trim().charAt(0)}</span>
                      <small>טרם יובאו תמונות</small>
                    </div>
                  )}
                  <div className="tz-pcard-img-overlay" />

                  {/* מחיקה. יושבת על התמונה ולא בתוך גוף הכרטיס, כי כל
                    * הכרטיס לחיץ ופתיחת פרויקט היא הפעולה הרגילה. */}
                  <button
                    type="button"
                    className="tz-pcard-del"
                    title="מחיקת הפרויקט"
                    aria-label={`מחיקת הפרויקט של ${project.client}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPending({ id: project.id, client: project.client });
                    }}
                  >
                    ✕
                  </button>

                  {/* Top Badges */}
                  <div className="tz-pcard-badges-top">
                    <span className={`tz-status-badge ${st.className}`}>
                      <span className="tz-status-dot" />
                      {st.label}
                    </span>
                    {project.hasAlbum && (
                      <span className="tz-pcard-album-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
                          <path d="M6 2v20"/>
                        </svg>
                        אלבום מעוצב
                      </span>
                    )}
                  </div>

                  {/* Date Overlay */}
                  {project.date && (
                    <div className="tz-pcard-date-badge">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
                        <line x1="16" x2="16" y1="2" y2="6"/>
                        <line x1="8" x2="8" y1="2" y2="6"/>
                        <line x1="3" x2="21" y1="10" y2="10"/>
                      </svg>
                      <span>{project.date}</span>
                    </div>
                  )}

                  {/* Hover Quick Action */}
                  <div className="tz-pcard-hover-action">
                    <span>פתח פרויקט</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6"/>
                    </svg>
                  </div>
                </div>

                <div className="tz-pcard-body">
                  {/* Category & Location */}
                  <div className="tz-pcard-meta-chips">
                    {project.event && (
                      <span className="tz-pcard-event-chip">{project.event}</span>
                    )}
                    {project.location && (
                      <span className="tz-pcard-loc-chip">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                          <circle cx="12" cy="10" r="3"/>
                        </svg>
                        {project.location}
                      </span>
                    )}
                  </div>

                  {/* Client Title Row */}
                  <div className="tz-pcard-title-row">
                    <h3 className="tz-pcard-title">{project.client}</h3>
                    <div className="tz-pcard-arrow-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6"/>
                      </svg>
                    </div>
                  </div>

                  {/* 3-Cell Metrics Capsule Strip */}
                  <div className="tz-pcard-stats-strip">
                    <div className="tz-pcard-stat-box">
                      <span className="tz-pstat-val">{project.imported.toLocaleString('he-IL')}</span>
                      <span className="tz-pstat-lbl">תמונות</span>
                    </div>
                    <div className="tz-pcard-stat-box">
                      <span className="tz-pstat-val">
                        {project.picked > 0 ? project.picked.toLocaleString('he-IL') : (project.kept > 0 ? project.kept.toLocaleString('he-IL') : '—')}
                      </span>
                      <span className="tz-pstat-lbl">{project.picked > 0 ? 'נבחרו' : 'סוננו'}</span>
                    </div>
                    <div className="tz-pcard-stat-box">
                      <span className={`tz-pstat-val ${bal > 0 ? 'has-balance' : 'is-cleared'}`}>
                        {bal > 0 ? `₪${bal.toLocaleString('he-IL')}` : 'שולם'}
                      </span>
                      <span className="tz-pstat-lbl">{bal > 0 ? 'יתרה' : 'הושלם'}</span>
                    </div>
                  </div>

                  {/* Progress Section */}
                  <div className="tz-pcard-progress-section">
                    <div className="tz-pcard-prog-info">
                      <span className="tz-pcard-stage-name">{stageLabel(project)}</span>
                      <span className="tz-pcard-prog-pct">{prog}%</span>
                    </div>
                    <div className="tz-pprog-track">
                      <div className="tz-pprog-fill" style={{ width: `${prog}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tz-pempty-state">
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
              מה שיימחק: פרטי הפרויקט, המקבצים, מתכוני העריכה, סטטוסי התמונות
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
