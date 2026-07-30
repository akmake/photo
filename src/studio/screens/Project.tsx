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
import {
  IcCalendar, IcCamera, IcCheckCircle, IcFolderOpen, IcLink, IcMail, IcSliders,
  IcSparkle,
} from '../../design/Icons';

/** The number a stage is responsible for. Empty means the stage has no count of
 *  its own — a dash is honest, a zero is not. */
function stageValue(p: ProjectModel, key: StageKey): string {
  switch (key) {
    case 'setup': return p.date;
    case 'import': return p.imported ? p.imported.toLocaleString('he-IL') : '—';
    case 'select': return p.picked ? `${p.picked}/${p.kept.toLocaleString('he-IL')}` : p.kept ? p.kept.toLocaleString('he-IL') : '—';
    case 'edit': return p.picked ? `${p.rendered}/${p.picked}` : '—';
    case 'album': return p.at >= 4 ? '18 כפולות' : '—';
    case 'deliver': return p.state === 'done' ? 'נמסר' : '—';
  }
}

export default function Project({
  project,
  initialStage,
  onBack,
  onOpenTool,
}: {
  project: ProjectModel;
  /** From the hash, so a stage can be linked and reloaded. */
  initialStage?: StageKey;
  onBack: () => void;
  onOpenTool: (what: 'edit' | 'album' | 'color') => void;
}) {
  const stages = stagesOf(project);
  const [stage, setStage] = useState<StageKey>(
    initialStage && stages.some((s) => s.id === initialStage)
      ? initialStage
      : stages[Math.min(project.at, stages.length - 1)].id,
  );
  const [context, setContext] = useState(true);

  const open = project.price ? (project.price - (project.paid ?? 0)) : 0;

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
              <span className="ms-value mono">{stageValue(project, s.id)}</span>
            </button>
          );
        })}
      </nav>

      <div className={`prj-body ${context ? 'with-ctx' : ''}`}>
        <main className="prj-work">
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

          {stage === 'album' && (
            <Stage title="אלבום" sub="כפולות, הגהה ללקוח, ואז דפוס">
              <Numbers items={[['כפולות', 18], ['גרסאות שנשלחו', 1]]} />
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={() => onOpenTool('album')}>
                  פתח את עיצוב האלבום
                </button>
                <button className="btn"><IcMail size={16} />שלח הגהה</button>
              </div>
            </Stage>
          )}

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
            * is never an empty room while the stage tools are being built. */}
          <Activity project={project} />
        </main>

        {context && (
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
