/* מסך הפרויקט.
 *
 * The frame is fixed and the stage's workspace is the only thing that changes,
 * which is what makes this one continuous system instead of six screens
 * (docs/UX-SKELETON.md §3):
 *
 *   header      who this is for, and whether the files are reachable
 *   MEASURE     where the job stands + the counter chain, as one instrument
 *   workspace   the stage
 *   context     client, money, files — collapsible, out of the way in deep work
 *
 * The measure rail is the product's signature element: segments carry the stage
 * AND its number, so "where am I" and "how much is left" are one glance rather
 * than a tab row plus a stat row. It shows only the stages this project has —
 * a family session without an album never shows an album stage.
 */

import { useState } from 'react';
import type { Project as ProjectModel } from '../store';
import { STATE_LABEL, stagesOf } from '../store';
import type { StageKey } from '../store';
import ProjectFiles from './ProjectFiles';
import AlbumStudio from '../../album/AlbumStudio';
import { useAlbums } from '../../album/albumStorage';
import type { AlbumSummary } from '../../album/albumStorage';
import {
  IcCalendar, IcCamera, IcCheckCircle, IcFolderOpen, IcLink, IcSliders,
  IcSparkle,
} from '../../design/Icons';

/** What the album stage is worth on the measure rail: real spreads from real
 *  albums. It used to read "18 כפולות" for every project past stage four —
 *  a number nobody had made, on a rail whose whole job is to be trusted. */
function albumValue(albums: AlbumSummary[]): string {
  if (!albums.length) return '—';
  const spreads = albums.reduce((sum, album) => sum + album.spreadCount, 0);
  return albums.length > 1
    ? `${albums.length} אלבומים · ${spreads} כפולות`
    : `${spreads} כפולות`;
}

/** The number a stage is responsible for. Empty means the stage has no count of
 *  its own — a dash is honest, a zero is not. */
function stageValue(p: ProjectModel, key: StageKey, albums: AlbumSummary[]): string {
  switch (key) {
    case 'setup': return p.date;
    case 'import': return p.imported ? p.imported.toLocaleString('he-IL') : '—';
    case 'select': return p.picked ? `${p.picked}/${p.kept.toLocaleString('he-IL')}` : p.kept ? p.kept.toLocaleString('he-IL') : '—';
    case 'edit': return p.picked ? `${p.rendered}/${p.picked}` : '—';
    case 'album': return albumValue(albums);
    case 'deliver': return p.state === 'done' ? 'נמסר' : '—';
  }
}

export default function Project({
  project,
  initialStage,
  albumId,
  onAlbum,
  onStage,
  onBack,
  onOpenTool,
}: {
  project: ProjectModel;
  /** From the hash, so a stage can be linked and reloaded. */
  initialStage?: StageKey;
  /** Which album is open, from the hash — an hour of album work has to survive
   *  a reload and be linkable. */
  albumId?: string | null;
  onAlbum: (id: string | null) => void;
  onStage: (stage: StageKey) => void;
  onBack: () => void;
  onOpenTool: (what: 'edit' | 'color') => void;
}) {
  const stages = stagesOf(project);
  const [stage, setStageState] = useState<StageKey>(
    initialStage && stages.some((s) => s.id === initialStage)
      ? initialStage
      : stages[Math.min(project.at, stages.length - 1)].id,
  );
  const [context, setContext] = useState(true);
  /* The editor inside the project, or the editor with the whole window. The
   * spread is the widest thing in the product and the project frame costs it
   * about a fifth of its width — but the frame is also what answers "was this
   * frame even edited yet", which is the question the album stage raises most.
   * So: both, one key apart. */
  const [albumFull, setAlbumFull] = useState(false);
  // subscribed, so the measure rail's spread count updates as the album is built
  const albums = useAlbums(project.id);

  function setStage(next: StageKey) {
    setStageState(next);
    onStage(next);
    // leaving the album stage closes the album; the URL must not keep claiming one
    if (next !== 'album' && albumId) onAlbum(null);
  }

  const open = project.price ? (project.price - (project.paid ?? 0)) : 0;

  const albumStudio = (
    <AlbumStudio
      projectId={project.id}
      projectName={project.client}
      albumId={albumId ?? null}
      onOpenAlbum={onAlbum}
      onCloseAlbum={() => { onAlbum(null); setAlbumFull(false); }}
      fullscreen={albumFull}
      onToggleFullscreen={() => setAlbumFull((value) => !value)}
    />
  );

  /* Full screen is the ONLY case where the project frame is gone, so it gets
   * its own return: a header that still names the job, and nothing else. */
  if (stage === 'album' && albumFull && albumId) {
    return (
      <div className="prj-album-full">
        <header className="prj-album-bar">
          <button className="prj-back" onClick={() => setAlbumFull(false)}>
            ← {project.client} · {project.event}
          </button>
          <span className="prj-album-hint">F לחזרה למסגרת הפרויקט</span>
        </header>
        {albumStudio}
      </div>
    );
  }

  return (
    <div className="prj">
      {/* ---- identity: always visible, never scrolls away ---- */}
      <header className="prj-head">
        <button className="prj-back" onClick={onBack}>← פרויקטים</button>
        <h1>{project.client}</h1>
        <span className="prj-dot">·</span>
        <span className="prj-event">{project.event}</span>
        <span className="prj-dot">·</span>
        <span className="mono prj-date">{project.date}</span>

        <span className={`prj-state s-${project.state}`}>{STATE_LABEL[project.state]}</span>

        <span className="prj-files">
          <IcCheckCircle size={15} />
          הקבצים זמינים
        </span>
        <button className="btn prj-ctx-toggle" onClick={() => setContext((v) => !v)}>
          {context ? 'הסתר פרטים' : 'פרטי הפרויקט'}
        </button>
      </header>

      {/* ---- the measure: stage + count, one instrument ---- */}
      <nav className="measure" aria-label="שלבי הפרויקט">
        {stages.map((s, i) => {
          const done = i < project.at;
          const on = s.id === stage;
          return (
            <button
              key={s.id}
              className={`ms ${on ? 'on' : ''} ${done ? 'done' : ''} ${i > project.at ? 'idle' : ''}`}
              onClick={() => setStage(s.id)}
            >
              <span className="ms-label">{s.label}</span>
              <span className="ms-value mono">{stageValue(project, s.id, albums)}</span>
            </button>
          );
        })}
      </nav>

      {/* The album is a workspace, not a document: it brings its own scrolling
        * panels and must fill the area exactly, so the stage padding and the
        * outer scrollbar come off for it. */}
      <div className={`prj-body ${context && stage !== 'album' ? 'with-ctx' : ''}`}>
        <main className={`prj-work ${stage === 'album' ? 'flush' : ''}`}>
          {stage === 'setup' && (
            <Stage title="הכנה" sub="מה העבודה הזאת, ומה יוצא ממנה">
              <Facts rows={[
                ['לקוח', project.client],
                ['סוג צילום', project.event],
                ['תאריך צילום', project.date],
                ['מיקום', project.location ?? '—'],
                ['מחיר מוסכם', project.price ? `₪${project.price.toLocaleString('he-IL')}` : '—'],
                ['שולם', `₪${(project.paid ?? 0).toLocaleString('he-IL')}`],
              ]} />
              <div className="deliverables">
                <h3>תוצרים</h3>
                <ul>
                  <li className={project.hasGallery ? 'yes' : ''}>גלריה לבחירת הלקוח</li>
                  <li className={project.hasAlbum ? 'yes' : ''}>אלבום מודפס</li>
                  <li className="yes">קבצים סופיים</li>
                </ul>
                <p className="hint">התוצרים קובעים אילו שלבים הפרויקט מציג.</p>
              </div>
            </Stage>
          )}

          {stage === 'import' && (
            <Stage
              title="התיקיות של הפרויקט"
              sub="לפרויקט יכולות להיות כמה תיקיות. התמונות נשארות על המחשב — המערכת מצביעה עליהן."
            >
              <ProjectFiles projectId={project.id} />
            </Stage>
          )}

          {stage === 'select' && (
            <Stage title="בחירה" sub="סינון שלך, ואז בחירת הלקוח">
              <Numbers items={[
                ['נכנסו', project.imported],
                ['נשארו', project.kept],
                ['הלקוח בחר', project.picked],
              ]} />
              <div className="stage-actions">
                <button className="btn"><IcCamera size={16} />פתח סינון</button>
                {project.hasGallery && (
                  <button className="btn btn-primary"><IcLink size={16} />שלח גלריה ללקוח</button>
                )}
              </div>
              {project.waitingSince && (
                <p className="waiting-line">נשלח ללקוח ב-{project.waitingSince} · טרם הסתיימה הבחירה</p>
              )}
            </Stage>
          )}

          {stage === 'edit' && (
            <Stage title="עריכה" sub="מתכון על תמונת ייחוס, ואז אצווה על הסט">
              <Numbers items={[
                ['בסט', project.picked],
                ['רונדרו בפועל', project.rendered],
              ]} />
              <p className="hint">
                השלב נחשב גמור רק כשכל תמונות הסט עברו רינדור — לא כשהוקצה להן מתכון.
              </p>
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={() => onOpenTool('color')}>
                  <IcSparkle size={16} />התאמת צבעים מזוג תמונות
                </button>
                <button className="btn" onClick={() => onOpenTool('edit')}>
                  <IcSliders size={16} />מתכון ידני
                </button>
              </div>
              <p className="hint">
                התאמת צבעים לומדת את הצבע שלך מזוג אחד — מקור וערוך — ומחילה אותו על כל
                התיקייה. המתכון הידני הוא הדרך השנייה: סליידרים על תמונת ייחוס.
              </p>
            </Stage>
          )}

          {/* The stage IS the album. There used to be a button here that threw
            * the photographer onto a separate route, where the album knew
            * nothing about the job it belonged to and asked for the photos to
            * be uploaded a second time. */}
          {stage === 'album' && albumStudio}

          {stage === 'deliver' && (
            <Stage title="מסירה" sub="מה יוצא, לאן, ומה נשאר אצלך">
              <Numbers items={[['מוכן למסירה', project.rendered], ['נמסר', project.state === 'done' ? project.rendered : 0]]} />
              <p className="hint">
                רק גרסאות תצוגה עולות לרשת. הקבצים המקוריים והמיוצאים נשארים על המחשב.
              </p>
              <div className="stage-actions">
                <button className="btn btn-primary"><IcFolderOpen size={16} />ייצא לתיקייה</button>
                <button className="btn"><IcLink size={16} />שלח קישור ללקוח</button>
              </div>
            </Stage>
          )}

          {/* A project always has a history, at every stage — so the workspace
            * is never an empty room while the stage tools are being built. The
            * album is the exception: it fills the workspace itself, and a log
            * hanging below it would be a second scroll region in a screen that
            * already owns its own. */}
          {stage !== 'album' && <Activity project={project} />}
        </main>

        {context && stage !== 'album' && (
          <aside className="prj-ctx">
            <section>
              <h3>לקוח</h3>
              <div className="ctx-row"><span>שם</span><b>{project.client}</b></div>
              <div className="ctx-row"><span>אירוע</span><b>{project.event}</b></div>
              <div className="ctx-row"><span>מיקום</span><b>{project.location ?? '—'}</b></div>
            </section>

            <section>
              <h3>תשלומים</h3>
              <div className="ctx-row"><span>סוכם</span><b className="mono">₪{(project.price ?? 0).toLocaleString('he-IL')}</b></div>
              <div className="ctx-row"><span>שולם</span><b className="mono">₪{(project.paid ?? 0).toLocaleString('he-IL')}</b></div>
              <div className={`ctx-row ${open > 0 ? 'due' : ''}`}>
                <span>פתוח</span><b className="mono">₪{open.toLocaleString('he-IL')}</b>
              </div>
            </section>

            <section>
              <h3>קבצים</h3>
              <p className="ctx-path mono">D:\Shoots\{project.id}\</p>
              <div className="ctx-row"><span>מקור</span><b className="mono">{project.imported.toLocaleString('he-IL')}</b></div>
            </section>

            <section>
              <h3>לוח זמנים</h3>
              <div className="ctx-row"><IcCalendar size={14} /><span>צילום</span><b className="mono">{project.date}</b></div>
              <div className="ctx-row"><span>נוצר</span><b className="mono">{project.createdAt}</b></div>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}

function Activity({ project }: { project: ProjectModel }) {
  const rows: [string, string, string][] = [];
  if (project.rendered) rows.push(['הרינדור הסתיים', `${project.rendered} קבצים`, 'הבוקר 07:12']);
  if (project.waitingSince) rows.push(['הגלריה נשלחה ללקוח', `${project.kept} תמונות`, project.waitingSince]);
  if (project.picked) rows.push(['הלקוח סיים לבחור', `${project.picked} מתוך ${project.kept}`, '12.07']);
  if (project.kept) rows.push(['הסינון הסתיים', `נשארו ${project.kept}`, '11.07']);
  if (project.imported) rows.push(['הייבוא הסתיים', `${project.imported} קבצים`, '11.07']);
  rows.push(['הפרויקט נוצר', project.event, project.createdAt]);

  return (
    <section className="activity">
      <h3>פעילות</h3>
      <ul>
        {rows.map(([what, detail, when]) => (
          <li key={what + when}>
            <b>{what}</b>
            <span>{detail}</span>
            <span className="mono when">{when}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stage({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="stage">
      <div className="stage-head">
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {children}
    </section>
  );
}

function Numbers({ items }: { items: [string, number][] }) {
  return (
    <div className="numbers">
      {items.map(([label, n]) => (
        <div key={label}>
          <b className="mono">{n.toLocaleString('he-IL')}</b>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
