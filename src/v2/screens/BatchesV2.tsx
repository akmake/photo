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
      <section className="tz-stage-header">
        <div className="tz-stage-header-copy">
          <div className="tz-stage-tag">שלב 2 · מקבצים</div>
          <h1>מקבצים</h1>
          <p>
            חלק את הצילום של <strong>{project.client}</strong> למקבצים שאפשר לבחור ולערוך יחד.
          </p>
        </div>

        <div className="tz-stage-actions">
          {onNext && (
            <button
              className="tz-btn-projects-primary"
              type="button"
              onClick={onNext}
            >
              המשך לשליחה ללקוח ←
            </button>
          )}
        </div>
      </section>

      <GroupWorkspace projectId={project.id} />
    </div>
  );
}
