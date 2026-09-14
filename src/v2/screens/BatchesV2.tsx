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
          <div className="tz-stage-tag">שלב 2 · רצפים</div>
          <h1>רצפים</h1>
          <p>
            חלק את יום הצילום של <strong>{project.client}</strong> לרגעים שאפשר לבחור, לערוך ולעצב מהם.
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
