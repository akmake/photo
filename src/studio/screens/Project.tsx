/* מסך הפרויקט.
 *
 * Opening a job lands on its OVERVIEW — the cockpit from which one job is
 * operated: where it stands, the money, the client, and above all the single
 * next move. It no longer drops the photographer into a half-built middle stage
 * (docs/UX-SKELETON.md §3). The measure rail is the spine that runs through
 * everything:
 *
 *   header      who this is for, and whether the files are reachable
 *   MEASURE     סקירה + the stage/count chain, as one instrument
 *   overview    the job cockpit  — OR —  a stage's workspace
 *
 * The measure rail is the product's signature: segments carry the stage AND its
 * number, so "where am I" and "how much is left" are one glance. Its first cell
 * is סקירה — the home of the job — and it reports overall progress as its own
 * count, so the instrument logic holds. The stage the job is standing on is
 * marked current with a copper dot, whatever is being viewed.
 *
 * The one place boldness is spent on the light end is הצעד הבא: a single raised,
 * copper-edged directive that turns "which segment is live" into an instruction
 * you can act on. Every button on it routes to a surface that actually exists —
 * a dead button is the whole reason the screen used to read as a spec.
 */

import { useState } from 'react';
import type { Project as ProjectModel } from '../store';
import { STAGES, STATE_LABEL, framesInBatch, stagesOf, useBatches } from '../store';
import type { StageKey } from '../store';
import ProjectFiles from './ProjectFiles';
import Batches from './Batches';
import SetRecipe from './SetRecipe';
import ApplySet from './ApplySet';
import DeliverSet from './DeliverSet';
import ClientGallery from './ClientGallery';
import {
  IcCalendar, IcCamera, IcLink, IcMail, IcSliders, IcSparkle,
} from '../../design/Icons';

/** `bench` is the lab on a frame of this project — the primary way to edit a
 *  photograph. `edit` is SetWorkbench, kept and still reachable for the batch
 *  strip and applying to a whole batch. */
type ToolWhat = 'bench' | 'edit' | 'album' | 'color';
type View = 'overview' | StageKey;

/** The number a stage is responsible for. Empty means the stage has no count of
 *  its own — a dash is honest, a zero is not. */
function stageValue(p: ProjectModel, key: StageKey): string {
  switch (key) {
    case 'setup': return p.date;
    case 'import': return p.imported ? p.imported.toLocaleString('he-IL') : '—';
    /* Counted where it is decided — in the store, from project.json — because
     * this function only has the business record and a batch is a fact
     * about the folder. The stage reports itself once opened. */
    case 'batches': return p.imported ? '·' : '—';
    case 'select': return p.picked ? `${p.picked}/${p.kept.toLocaleString('he-IL')}` : p.kept ? p.kept.toLocaleString('he-IL') : '—';
    case 'edit': return p.picked ? `${p.rendered}/${p.picked}` : '—';
    case 'album': return p.hasAlbum && p.at >= 4 ? '18 כפולות' : '—';
    case 'deliver': return p.state === 'done' ? 'נמסר' : '—';
  }
}

/* ------------------------------------------------------------- the next move
 *
 * The one instruction the overview leads with, derived from where the job
 * actually stands. Its target is always a real surface: a stage's workspace, or
 * one of the editing tools. */

type MoveTarget =
  | { kind: 'stage'; id: StageKey }
  | { kind: 'tool'; id: ToolWhat };

interface Move {
  eyebrow: string;
  title: string;
  detail?: string;
  tone: 'act' | 'wait' | 'done';
  primary?: { label: string; target: MoveTarget };
  secondary?: { label: string; target: MoveTarget };
}

function nextMove(p: ProjectModel): Move {
  const open = p.price ? p.price - (p.paid ?? 0) : 0;

  if (p.state === 'done') {
    return {
      eyebrow: 'העבודה נמסרה',
      title: open > 0 ? `נותרו ₪${open.toLocaleString('he-IL')} לגבייה` : 'הפרויקט הושלם ונמסר',
      detail: `${p.rendered.toLocaleString('he-IL')} קבצים נמסרו ללקוח`,
      tone: 'done',
      primary: { label: 'פתח את המסירה', target: { kind: 'stage', id: 'deliver' } },
    };
  }

  /* Waiting on the client is the one state where the work is out of the
   * photographer's hands — it reads the same whatever stage it happened on, and
   * it is the state that quietly eats weeks, so it leads with itself. */
  if (p.state === 'waiting') {
    const onAlbum = p.at >= 4;
    return {
      eyebrow: 'ממתין ללקוח',
      title: onAlbum ? 'הלקוח בודק את הגהת האלבום' : 'הלקוח בוחר תמונות מהגלריה',
      detail: onAlbum
        ? `נשלח ${p.waitingSince ?? ''} · גרסה 1`
        : `נשלח ${p.waitingSince ?? ''} · ${p.kept.toLocaleString('he-IL')} בגלריה`,
      tone: 'wait',
      primary: onAlbum
        ? { label: 'פתח את האלבום', target: { kind: 'tool', id: 'album' } }
        : { label: 'פתח את הבחירה', target: { kind: 'stage', id: 'select' } },
    };
  }

  const key = STAGES[Math.min(p.at, STAGES.length - 1)].id;

  switch (key) {
    case 'setup':
      return {
        eyebrow: 'לפני צילום',
        title: `הצילום מתוכנן ל-${p.date}`,
        detail: [p.event, p.location].filter(Boolean).join(' · '),
        tone: 'act',
        primary: { label: 'ייבא תמונות', target: { kind: 'stage', id: 'import' } },
        secondary: { label: 'פרטי הפרויקט', target: { kind: 'stage', id: 'setup' } },
      };
    case 'import':
      return {
        eyebrow: 'הצעד הבא',
        title: p.imported ? `${p.imported.toLocaleString('he-IL')} תמונות בפרויקט` : 'ייבוא התמונות מהצילום',
        detail: p.imported
          ? 'סנן כדי להשאיר את הנבחרות'
          : 'הצבע על התיקיות מהמחשב — הקבצים נשארים במקומם',
        tone: 'act',
        primary: p.imported
          ? { label: 'המשך לבחירה', target: { kind: 'stage', id: 'select' } }
          : { label: 'הוסף תיקייה', target: { kind: 'stage', id: 'import' } },
      };
    case 'select':
      return {
        eyebrow: 'הצעד הבא',
        title: `${p.kept.toLocaleString('he-IL')} תמונות אחרי סינון`,
        detail: p.hasGallery ? 'שלח גלריה ללקוח לבחירה' : 'המשך לעריכה',
        tone: 'act',
        primary: { label: 'פתח את הבחירה', target: { kind: 'stage', id: 'select' } },
      };
    case 'edit':
      return {
        eyebrow: 'בעבודה',
        title: 'עריכת הסט',
        detail: p.picked
          ? `${p.rendered.toLocaleString('he-IL')}/${p.picked.toLocaleString('he-IL')} עברו רינדור`
          : undefined,
        tone: 'act',
        primary: { label: 'התאמת צבעים', target: { kind: 'tool', id: 'color' } },
        secondary: { label: 'עריכה כלי אחר כלי', target: { kind: 'tool', id: 'edit' } },
      };
    case 'album':
      return {
        eyebrow: 'הצעד הבא',
        title: p.hasAlbum ? 'עיצוב האלבום' : 'אפשר ליצור אלבום מהפרויקט',
        detail: p.hasAlbum ? '18 כפולות · גרסה ללקוח' : undefined,
        tone: 'act',
        primary: {
          label: p.hasAlbum ? 'פתח את האלבום' : 'צור אלבום',
          target: { kind: 'tool', id: 'album' },
        },
      };
    case 'deliver':
    default:
      return {
        eyebrow: 'הצעד הבא',
        title: 'מסירה ללקוח',
        detail: `${p.rendered.toLocaleString('he-IL')} קבצים מוכנים`,
        tone: 'act',
        primary: { label: 'פתח את המסירה', target: { kind: 'stage', id: 'deliver' } },
      };
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
  onOpenTool: (what: ToolWhat, batchId?: string | null) => void;
}) {
  const stages = stagesOf(project);
  const [view, setView] = useState<View>(
    initialStage && stages.some((s) => s.id === initialStage) ? initialStage : 'overview',
  );
  const [context, setContext] = useState(false);

  const open = project.price ? project.price - (project.paid ?? 0) : 0;
  const doneCount = project.state === 'done' ? stages.length : project.at;

  function run(target: MoveTarget) {
    if (target.kind === 'tool') onOpenTool(target.id);
    else setView(target.id);
  }

  return (
    <div className="project-flow">
      <nav className="project-flow-steps" aria-label="שלבי הפרויקט">
        <button
          className={`project-flow-step is-overview ${view === 'overview' ? 'is-active' : ''}`}
          onClick={() => setView('overview')}
        >
          <span className="project-flow-step-dot">✓</span>
          <span className="project-flow-step-copy"><strong>סקירה</strong><small>{doneCount}/{stages.length} הושלמו</small></span>
        </button>
        {stages.map((s, i) => {
          const done = i < project.at;
          const on = s.id === view;
          const current = i === project.at && project.state !== 'done';
          return (
            <button
              key={s.id}
              className={`project-flow-step ${on ? 'is-active' : ''} ${done ? 'is-done' : ''} ${current ? 'is-current' : ''} ${i > project.at ? 'is-future' : ''}`}
              onClick={() => setView(s.id)}
            >
              <span className="project-flow-step-dot">{i + 1}</span>
              <span className="project-flow-step-copy"><strong>{s.label}</strong><small>{stageValue(project, s.id)}</small></span>
            </button>
          );
        })}
      </nav>

      {view === 'overview' ? (
        <Overview
          project={project}
          open={open}
          doneCount={doneCount}
          totalStages={stages.length}
          currentStage={stages[Math.min(project.at, stages.length - 1)]?.label ?? 'הושלם'}
          onRun={run}
        />
      ) : (
        <div className="project-flow-body">
          <main className="project-flow-workspace">
            {view === 'setup' && (
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

            {view === 'import' && (
              <Stage
                title="ייבוא"
                sub="התמונות נכנסות לפרויקט ונשארות שלו"
              >
                <ProjectFiles project={project} />
              </Stage>
            )}

            {view === 'batches' && (
              <Stage
                title="מקבצים"
                sub="חלוקה לפי אור, לא לפי תיקייה. לכל מקבץ יהיה הצבע שלו בעריכה."
              >
                <Batches projectId={project.id} />
              </Stage>
            )}

            {view === 'select' && (
              <Stage title="בחירה" sub="סינון שלך, ואז בחירת הלקוח">
                <Numbers items={[
                  ['נכנסו', project.imported],
                  ['נשארו', project.kept],
                  ['הלקוח בחר', project.picked],
                ]} />
                <div className="stage-actions">
                  <button className="btn"><IcCamera size={16} />פתח סינון</button>
                </div>
                {project.waitingSince && (
                  <p className="waiting-line">נשלח ללקוח ב-{project.waitingSince} · טרם הסתיימה הבחירה</p>
                )}
                {/* The client's half of the selection. The button that used to
                    sit here said "שלח גלריה ללקוח" and did nothing; this is the
                    thing it was waiting for. */}
                <ClientGallery projectId={project.id} clientName={project.client} />
              </Stage>
            )}

            {view === 'edit' && (
              <Stage title="עריכה" sub="בחר מקבץ, קבע לו את הצבע שלו, ואז החל">
                <EditStage project={project} onOpenTool={onOpenTool} />
              </Stage>
            )}

            {view === 'album' && (
              <Stage title="אלבום" sub="כפולות, הגהה ללקוח, ואז דפוס">
                {project.albumPlan && (
                  <div className="project-album-plan">
                    <div>
                      <span>מידה סגורה</span>
                      <strong>{project.albumPlan.closedWidthCm}×{project.albumPlan.closedHeightCm} ס״מ</strong>
                    </div>
                    <div>
                      <span>סגנון</span>
                      <strong>{project.albumPlan.styleName}</strong>
                    </div>
                    <div>
                      <span>כריכה</span>
                      <strong>{project.albumPlan.coverStyle === 'photo' ? 'כריכת תמונה' : project.albumPlan.coverStyle === 'linen' ? 'כריכת בד' : 'נקייה'}</strong>
                    </div>
                  </div>
                )}
                {project.hasAlbum ? (
                  <Numbers items={[['כפולות', 18], ['גרסאות שנשלחו', 1]]} />
                ) : (
                  <p className="hint">
                    לא נכלל אלבום בהזמנה — אבל אפשר ליצור אחד מתמונות הפרויקט בכל רגע.
                  </p>
                )}
                <div className="stage-actions">
                  <button className="btn btn-primary" onClick={() => onOpenTool('album')}>
                    {project.hasAlbum ? 'פתח את עיצוב האלבום' : 'צור אלבום מהפרויקט'}
                  </button>
                  {project.hasAlbum && (
                    <button className="btn"><IcMail size={16} />שלח הגהה</button>
                  )}
                </div>
              </Stage>
            )}

            {view === 'deliver' && (
              <Stage title="מסירה" sub="מה יוצא, לאן, ומה נשאר אצלך">
                <Numbers items={[['מוכן למסירה', project.rendered], ['נמסר', project.state === 'done' ? project.rendered : 0]]} />
                <p className="hint">
                  רק גרסאות תצוגה עולות לרשת. הקבצים המקוריים והמיוצאים נשארים על המחשב.
                </p>
                <DeliverSet projectId={project.id} />
                <div className="stage-actions">
                  <button className="btn"><IcLink size={16} />שלח קישור ללקוח</button>
                </div>
              </Stage>
            )}
          </main>

          {context && (
            <aside className="project-flow-details">
              <div className="project-flow-details-head">
                <strong>פרטי הפרויקט</strong>
                <button onClick={() => setContext(false)} aria-label="סגירה">×</button>
              </div>
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
      )}
    </div>
  );
}

/* ============================================================== the edit stage
 *
 * One batch at a time, and that is the point: the colour learned in the
 * garden has no business on the dance floor. Choosing here is what decides
 * which layer of the recipe every tool writes to — the batch's own, or the
 * project's base when the frames belong to no batch.
 *
 * Tools that read CONTENT rather than light (cleanup, skin, noise) belong on
 * the base and are set from the workbench; the selector below governs the
 * light. The rule is in types.ts::ProjectRecipe, so a tool added later has an
 * answer without a new argument.
 */
function EditStage({
  project,
  onOpenTool,
}: {
  project: ProjectModel;
  onOpenTool: (what: ToolWhat, batchId?: string | null) => void;
}) {
  const batches = useBatches(project.id);
  const [at, setAt] = useState<string | null>(null);

  // A project nobody has cut up yet still edits — through the base. Offering a
  // selector with nothing in it would be a dead control.
  const current = batches.find((s) => s.id === at) ?? null;

  return (
    <>
      {batches.length > 0 ? (
        <div className="bat-pick">
          <button className={`bat-tab ${at === null ? 'on' : ''}`} onClick={() => setAt(null)}>
            כל הסט
            <span className="bat-tab-sub">בסיס</span>
          </button>
          {batches.map((s) => (
            <button
              key={s.id}
              className={`bat-tab ${at === s.id ? 'on' : ''}`}
              onClick={() => setAt(s.id)}
            >
              {s.name}
              <span className="bat-tab-sub">{framesInBatch(project.id, s.id).length}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">
          הפרויקט עוד לא חולק למקבצים. אפשר לערוך את כל הסט יחד — או לחלק קודם,
          וכך לתת לכל אור את הצבע שלו.
        </p>
      )}

      <div className="stage-actions">
        <button className="btn btn-primary" onClick={() => onOpenTool('bench', at)}>
          <IcSliders size={16} />
          פתח את המעבדה
        </button>
        <button className="btn" onClick={() => onOpenTool('color', at)}>
          <IcSparkle size={16} />
          התאמת צבעים{current ? ` · ${current.name}` : ''}
        </button>
        {/* Kept, not replaced. It still holds the batch strip, applying to a
          * whole batch, and the pipeline-order warning. */}
        <button className="btn" onClick={() => onOpenTool('edit', at)}>
          שולחן העבודה הישן
        </button>
      </div>

      <p className="hint">
        התאמת צבעים לומדת את הצבע שלך מזוג אחד — מקור וערוך — וקובעת אותו על
        {current ? ` המקבץ "${current.name}"` : ' כל הסט'}. המתכון הידני הוא
        הדרך השנייה: סליידרים על תמונת ייחוס.
      </p>

      <SetRecipe projectId={project.id} batchId={at} />
      <ApplySet projectId={project.id} batchId={at} />
    </>
  );
}

/* ============================================================== the overview
 * The job cockpit: the next move first, then the business at a glance, then
 * what has happened. Composed from hairlines and space — the one raised element
 * is הצעד הבא, and it is the only place copper fills a region on the light end. */
function Overview({
  project,
  open,
  doneCount,
  totalStages,
  currentStage,
  onRun,
}: {
  project: ProjectModel;
  open: number;
  doneCount: number;
  totalStages: number;
  currentStage: string;
  onRun: (t: MoveTarget) => void;
}) {
  const move = nextMove(project);

  return (
    <main className="project-overview">
      <section className="project-overview-focus">
        <div className="project-overview-copy">
          <span>{move.eyebrow}</span>
          <h2>{move.title}</h2>
          {move.detail && <p>{move.detail}</p>}
          <div className="project-overview-actions">
            {move.primary && <button className="is-primary" onClick={() => onRun(move.primary!.target)}>{move.primary.label}<b>←</b></button>}
            {move.secondary && <button onClick={() => onRun(move.secondary!.target)}>{move.secondary.label}</button>}
          </div>
        </div>

        <div className="project-overview-visual">
          {project.thumb ? <img src={project.thumb} alt="" style={{ objectPosition: project.pos }} /> : <span>{project.client.trim().charAt(0)}</span>}
          <div className="project-overview-stage">
            <small>הפרויקט נמצא בשלב</small>
            <strong>{currentStage}</strong>
          </div>
        </div>
      </section>

      <section className="project-overview-progress" aria-label={`${doneCount} מתוך ${totalStages} שלבים הושלמו`}>
        <div><span>התקדמות הפרויקט</span><strong>{doneCount} מתוך {totalStages}</strong></div>
        <div aria-hidden="true"><span style={{ width: `${totalStages ? (doneCount / totalStages) * 100 : 0}%` }} /></div>
      </section>

      <section className="project-overview-facts">
        <div>
          <span>יתרה לתשלום</span>
          <strong>{open > 0 ? `₪${open.toLocaleString('he-IL')}` : 'שולם במלואו'}</strong>
          <small>מתוך ₪{(project.price ?? 0).toLocaleString('he-IL')}</small>
        </div>
        <div>
          <span>תמונות בפרויקט</span>
          <strong>{project.imported.toLocaleString('he-IL')}</strong>
          <small>{project.picked ? `${project.picked.toLocaleString('he-IL')} נבחרו` : 'עדיין לא בוצעה בחירה'}</small>
        </div>
        <div>
          <span>פרטי הצילום</span>
          <strong>{project.date}</strong>
          <small>{[project.event, project.location].filter(Boolean).join(' · ')}</small>
        </div>
      </section>
    </main>
  );
}

function Stage({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="project-stage">
      <div className="project-stage-head">
        <span>שלב בתהליך</span>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      <div className="project-stage-content">{children}</div>
    </section>
  );
}

function Numbers({ items }: { items: [string, number][] }) {
  return (
    <div className="project-stage-numbers">
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
    <dl className="project-stage-facts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
