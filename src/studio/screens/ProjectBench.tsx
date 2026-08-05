/* המעבדה, על תמונה של הפרויקט.
 *
 * This file is deliberately thin, and that is its whole design. It chooses a
 * photograph and hands it to `Lab` — it does not re-implement any part of the
 * bench, style it differently, or wrap it in a second set of controls. The
 * screen the photographer works in IS the lab: same three regions, same tool
 * list with its switches, same result/diff/marks, same marking geometry, same
 * brush, same zoom.
 *
 * WHY IT IS NOT A COPY. There was a second editing screen here already, with
 * its own version of the marking overlay — and that copy silently reintroduced
 * the exact defect the lab had already paid to find (`non-scaling-stroke` on a
 * stage that zooms with a CSS transform, so every outline thickens with the
 * zoom). Ports lose the reasoning and keep only the feature. So the lab is
 * parameterised, not duplicated: there is one bench, and fixing it fixes both
 * places it appears.
 *
 * The strip of the batch, applying to a whole batch, and the pipeline-order
 * warning still live in SetWorkbench, which stays reachable. Nothing was
 * deleted to make room for this.
 */

import { useState } from 'react';
import Lab from '../../lab/Lab';
import FramePicker from './FramePicker';
import { useProjectFiles } from '../store';
import type { Project } from '../store';

function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p;
}

export default function ProjectBench({
  project,
  batchId = null,
  onBack,
}: {
  project: Project;
  /** The layer this session belongs to — a batch is a light, and a look learned
   *  under one has no business under another. */
  batchId?: string | null;
  onBack: () => void;
}) {
  const { frames } = useProjectFiles(project.id);
  const [path, setPath] = useState<string | null>(null);
  /* Open on the picker: a bench with no photograph on it has nothing to show,
   * and asking first is one click rather than an empty screen with a button. */
  const [picking, setPicking] = useState(true);

  const name = path
    ? frames.find((f) => f.path === path)?.name ?? baseName(path)
    : '';

  return (
    <div className="bench">
      {/* The only thing added around the lab, and only because a full-bleed
        * screen with the rail collapsed needs a way back that is not the
        * browser's. One line, no controls that belong to editing. */}
      <header className="bench-bar">
        <button className="btn btn-ghost" onClick={onBack}>← חזרה לפרויקט</button>
        <strong>{project.client}</strong>
        {name && <span className="bench-frame mono" dir="ltr">{name}</span>}
      </header>

      <div className="bench-body">
        {path ? (
          <Lab
            frame={{
              projectId: project.id,
              path,
              name,
              batchId,
              onChange: () => setPicking(true),
            }}
          />
        ) : (
          <div className="bench-blank">
            <p>בחר תמונה מהפרויקט כדי להתחיל.</p>
            <button className="btn btn-primary" onClick={() => setPicking(true)}>
              בחר תמונה
            </button>
          </div>
        )}
      </div>

      {picking && (
        <div className="scrim" onMouseDown={() => path && setPicking(false)}>
          <div
            className="dialog cm-picker"
            role="dialog"
            aria-modal="true"
            aria-label="בחר מקבץ ותמונה"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="dialog-head">
              <h2>בחר מקבץ, ואז תמונה</h2>
              {path && (
                <button className="dialog-x" onClick={() => setPicking(false)} aria-label="סגור">
                  ✕
                </button>
              )}
            </div>
            <div className="dialog-body cm-picker-body">
              <FramePicker
                projectId={project.id}
                /* `null` means the LOOSE pool to the picker, not "no batch in
                 * particular" — arriving here without a batch (a hash, a
                 * bookmark) opened on the frames nobody had filed yet, which on
                 * a fully-filed set is an empty grid over a project that has
                 * photographs. `undefined` is the whole set. */
                batchId={batchId ?? undefined}
                label="ערוך את זו"
                onPick={(picked) => {
                  setPath(picked);
                  setPicking(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
