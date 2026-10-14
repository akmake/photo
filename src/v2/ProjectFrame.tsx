/* Inside a project: the line that says which project this is, and the bar of
 * its stages. From the FrameOps.dc.html handoff (claude.ai/design), 09.10.2026
 * — with all seven of THIS program's stages, where the handoff drew six of its
 * own and had no place for the gallery of every imported frame (ייבוא תמונות).
 *
 * Every stage says where it stands, from the project's own records: frames on
 * disk, sessions, decisions, what the client picked, frames marked ready. A
 * stage with nothing to measure says so; none is marked done on a guess. */
import React, { useMemo } from 'react';
import { STATE_LABEL, frameKey, useBatches, useCull, useProjectFiles } from '../studio/store';
import type { Project } from '../studio/store';
import { PROJECT_STAGE_LABEL } from './Frame';

export const STAGE_ORDER = [
  'client-status', 'gallery-upload', 'batches', 'work', 'send-to-client', 'gallery-edit', 'album-design',
] as const;

function n(x: number) {
  return x.toLocaleString('en-US');
}

export function ProjectFrame({
  project,
  stage,
  onStage,
  onBack,
}: {
  project: Project;
  stage: string;
  onStage: (id: string) => void;
  onBack: () => void;
}) {
  const { frames, ready } = useProjectFiles(project.id);
  const batches = useBatches(project.id);
  const cull = useCull(project.id);

  const total = ready ? frames.length : project.imported;
  const { decided, kept } = useMemo(() => {
    let d = 0;
    let k = 0;
    for (const f of frames) {
      const v = cull[frameKey(f.name)];
      if (v) d += 1;
      if (v === 'keep') k += 1;
    }
    return { decided: d, kept: k };
  }, [frames, cull]);

  // `part` is how far along the stage is, 0..1 — the thin line under its name.
  const facts: Record<string, { sub: string; done: boolean; part: number }> = {
    'client-status': { sub: STATE_LABEL[project.state], done: total > 0, part: total > 0 ? 1 : 0 },
    'gallery-upload': { sub: total ? `${n(total)} תמונות` : 'טרם יובאו', done: total > 0, part: total > 0 ? 1 : 0 },
    batches: {
      sub: batches.length ? `${n(batches.length)} סשנים` : 'טרם חולק',
      done: batches.length > 0,
      part: batches.length > 0 ? 1 : 0,
    },
    work: {
      sub: !total ? 'טרם התחיל' : !ready ? 'קורא…' : `${n(decided)}/${n(total)} הוחלטו`,
      done: ready && total > 0 && decided === total,
      part: ready && total > 0 ? decided / total : 0,
    },
    'send-to-client': {
      sub: project.picked > 0 ? `הלקוח בחר ${n(project.picked)}` : project.state === 'waiting' ? 'ממתין ללקוח' : 'טרם נשלח',
      done: project.picked > 0,
      part: project.picked > 0 ? 1 : project.state === 'waiting' ? 0.5 : 0,
    },
    'gallery-edit': {
      sub: project.rendered > 0 ? `${n(project.rendered)} מוכנות` : 'טרם התחיל',
      done: project.picked > 0 && project.rendered >= project.picked,
      part: project.picked > 0 ? Math.min(1, project.rendered / project.picked) : 0,
    },
    'album-design': { sub: project.hasAlbum ? 'בתוצרים' : 'לא הוגדר בתוצרים', done: false, part: 0 },
  };
  const active = STAGE_ORDER.find((id) => !facts[id].done);

  /* One row (14.10.2026, "נראה תקוע, לא קשור"): the project and its stages
   * are the same line — a path through the work, not a separate slab above
   * it. Where each stage stands is the thin line under its name; the words
   * are on the current stage and in every stage's tooltip. */
  return (
    <div className="fo-pf">
      <div className="fo-pf-head">
        <button type="button" className="fo-pf-back" onClick={onBack} title="חזרה לפרויקטים">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
          פרויקטים
        </button>
        <span className="fo-pf-title" title={[project.client, project.event, project.location, project.date].filter(Boolean).join(' · ')}>
          {project.client}
        </span>

        <nav className="fo-pf-stages" data-tour="project-stages" aria-label="שלבי הפרויקט">
          {STAGE_ORDER.map((id, i) => {
            const f = facts[id];
            const cur = id === stage;
            const isActive = id === active;
            return (
              <React.Fragment key={id}>
                {i > 0 && <i className="fo-pf-join" aria-hidden />}
                <button
                  type="button"
                  className={`fo-pf-stage${cur ? ' is-cur' : ''}${f.done ? ' is-done' : ''}${isActive ? ' is-active' : ''}`}
                  aria-current={cur ? 'step' : undefined}
                  data-tour={`stage-${id}`}
                  title={`${PROJECT_STAGE_LABEL[id]} — ${f.sub}`}
                  onClick={() => onStage(id)}
                >
                  <span className="fo-pf-label">
                    {f.done && <span className="fo-pf-check" aria-hidden>✓</span>}
                    {PROJECT_STAGE_LABEL[id]}
                    {cur && <span className="fo-pf-stage-sub">{f.sub}</span>}
                  </span>
                  <span className="fo-pf-meter" aria-hidden>
                    <span style={{ width: `${Math.round(f.part * 100)}%` }} />
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <span className="fo-pf-spacer" />
        {total > 0 && (
          <span className="fo-pf-funnel">
            <span className="fo-mono">{n(total)}</span>יובאו
            <i>›</i>
            <span className="fo-mono">{ready ? n(decided) : '…'}</span>הוחלטו
            <i>›</i>
            <span className="fo-mono">{ready ? n(kept) : '…'}</span>נשמרו
          </span>
        )}
        {project.home && (
          <span className="fo-pf-path" title={project.home} aria-label={`תיקיית הפרויקט: ${project.home}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          </span>
        )}
      </div>
    </div>
  );
}

export default React.memo(ProjectFrame);
