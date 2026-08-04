/* One job as a frame — the shape of a project, learned once and used in both
 * places it appears: the desk on היום and the grid on פרויקטים. Before this it
 * was copied markup running on two different data sources, which is how the same
 * job could read one way here and another there.
 *
 * A job with no imported files yet has no cover, so the frame falls back to a
 * neutral plate rather than a broken image. */

import { STATE_LABEL, stagesOf } from '../store';
import type { Project } from '../store';
import { IcCamera } from '../../design/Icons';

export default function JobTile({
  project: p,
  onOpen,
}: {
  project: Project;
  onOpen: (id: string) => void;
}) {
  return (
    <button className="job" onClick={() => onOpen(p.id)}>
      <span className="job-frame">
        {p.thumb ? (
          <img src={p.thumb} alt="" style={{ objectPosition: p.pos }} loading="lazy" />
        ) : (
          <span className="job-frame-empty" aria-hidden="true"><IcCamera size={24} /></span>
        )}
        {p.state === 'waiting' && <span className="job-wait">{STATE_LABEL.waiting}</span>}
        {p.state === 'done' && <span className="job-done">{STATE_LABEL.done}</span>}
      </span>
      <span className="job-name">{p.client}</span>
      <span className="job-meta">
        {p.event}
        <i>·</i>
        <span className="mono">{p.date}</span>
      </span>
      <span className="job-measure" aria-hidden="true">
        {stagesOf(p).map((s, i) => (
          <span
            key={s.id}
            className={`seg ${i < p.at ? 'done' : ''} ${i === p.at && p.state !== 'done' ? 'on' : ''}`}
            title={s.label}
          />
        ))}
      </span>
      <span className="job-counts">{p.counts}</span>
    </button>
  );
}
