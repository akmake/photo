import React from 'react';
import type { Project } from '../../studio/store';
import GroupWorkspace from '../../studio/screens/GroupWorkspace';
import './stages-v2.css';

export default function BatchesV2({
  project,
  onNext,
  onBack,
}: {
  project: Project;
  onNext?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="tz-stage-container tz-stage-groups">
      <section className="tz-stage-header" data-tour="batches-header">
        <div className="tz-stage-header-copy">
          <div className="tz-stage-tag">שלב 2 · סשנים</div>
          <h1>סשנים</h1>
          <p>
            חלק את הצילום של <strong>{project.client}</strong> לסשנים שאפשר לבחור ולערוך יחד.
          </p>
        </div>

        <div className="tz-stage-actions">
          {onNext && (
            <button
              className="tz-btn-projects-primary"
              type="button"
              onClick={onNext}
              data-tour="batches-next"
            >
              המשך לסינון ←
            </button>
          )}
        </div>
      </section>

      <GroupWorkspace projectId={project.id} />
    </div>
  );
}
