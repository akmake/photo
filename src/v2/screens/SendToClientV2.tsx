import React from 'react';
import type { Project } from '../../studio/store';
import ClientGallery from '../../studio/screens/ClientGallery';
import './stages-v2.css';

export default function SendToClientV2({
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
          <div className="tz-stage-tag">שלב 3 · שלח ללקוח</div>
          <h1>גלריה אישית ובחירת תמונות ללקוח</h1>
          <p>
            יצירת גלריית בחירה אישית ומאובטחת עבור <strong>{project.client}</strong>. הלקוחה מסמנת את התמונות לאלבומים,
            והבחירות מתעדכנות ישירות בסטודיו בזמן אמת.
          </p>
        </div>

        <div className="tz-stage-actions">
          {onNext && (
            <button
              className="tz-btn-projects-primary"
              type="button"
              onClick={onNext}
            >
              המשך לשלב העריכה ←
            </button>
          )}
        </div>
      </section>

      <div className="tz-stage-card">
        <ClientGallery projectId={project.id} clientName={project.client} />
      </div>
    </div>
  );
}
