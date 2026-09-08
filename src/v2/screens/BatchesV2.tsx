import React from 'react';
import type { Project } from '../../studio/store';
import Batches from '../../studio/screens/Batches';
import { TzIconLayers, TzIconSend } from '../TzIcons';
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
    <div className="tz-stage-container">
      <section className="tz-stage-header">
        <div className="tz-stage-header-copy">
          <div className="tz-stage-tag">שלב 2 · יצירת מקבצים</div>
          <h1>חלוקת תמונות למקבצים</h1>
          <p>
            חלק את יום הצילום של <strong>{project.client}</strong> למקבצי תאורה ואווירה (כגון: צילומי חוץ, קבלת פנים, חופה, ריקודים).
            לכל מקבץ נקבע פרופיל עריכה וסגנון צבע משלו.
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

      <div className="tz-stage-card">
        <Batches projectId={project.id} />
      </div>
    </div>
  );
}
