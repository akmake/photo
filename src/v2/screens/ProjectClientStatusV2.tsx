import React, { useState } from 'react';
import type { Project } from '../../studio/store';
import './project-status.css';

interface ProjectClientStatusV2Props {
  project?: Project;
  onNavigateStage?: (stage: string) => void;
}

export default function ProjectClientStatusV2({
  project,
  onNavigateStage,
}: ProjectClientStatusV2Props) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  // Fallback / demo data if project fields are empty
  const clientName = project?.client || 'מלי כץ';
  const eventName = project?.event || 'בת מצווה';
  const shootDate = project?.date || '10.05.2024';
  const totalImported = project?.imported || 1842;
  const cullingRemaining = project?.kept || 1246;
  const pickedPhotos = project?.picked || 214;
  const renderedPhotos = project?.rendered || 0;
  const shareUrl = `https://teza.ai/gallery/${encodeURIComponent(clientName.replace(/\s+/g, '').toLowerCase())}`;

  // 75% progress
  const progressPercent = 75;
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  function copyLink() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="v2-status-screen">
      {/* Overall Status Card */}
      <section className="v2-overall-card">
        <div className="v2-overall-header">
          <span className="v2-overall-title">סטטוס כללי</span>
          <span className="v2-overall-subtitle">מעקב אחר התקדמות העבודה וסטטוס הלקוחה</span>
        </div>

        <div className="v2-overall-body">
          {/* Radial Progress Gauge */}
          <div className="v2-gauge-wrap">
            <svg className="v2-gauge-svg" viewBox="0 0 120 120">
              <circle
                className="v2-gauge-circle-bg"
                cx="60"
                cy="60"
                r={radius}
              />
              <circle
                className="v2-gauge-circle-fill"
                cx="60"
                cy="60"
                r={radius}
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset,
                }}
              />
            </svg>
            <div className="v2-gauge-copy">
              <span className="v2-gauge-percent">{progressPercent}%</span>
              <span className="v2-gauge-label">הושלם</span>
            </div>
          </div>

          {/* Milestones Horizontal Track */}
          <div className="v2-milestones-track">
            <div className="v2-milestones-line" />

            {/* Step 1: Upload */}
            <div className="v2-milestone-step">
              <div className="v2-milestone-node done">
                <span>☁️</span>
              </div>
              <span className="v2-milestone-name">העלאת גלריה</span>
              <span className="v2-milestone-status-text done">הושלם</span>
              <span className="v2-milestone-date">11.05.2024</span>
            </div>

            {/* Step 2: Culling */}
            <div className="v2-milestone-step">
              <div className="v2-milestone-node done">
                <span>🌪️</span>
              </div>
              <span className="v2-milestone-name">סינון גלריה</span>
              <span className="v2-milestone-status-text done">הושלם</span>
              <span className="v2-milestone-date">11.05.2024</span>
            </div>

            {/* Step 3: Picked */}
            <div className="v2-milestone-step">
              <div className="v2-milestone-node done">
                <span>💚</span>
              </div>
              <span className="v2-milestone-name">תמונות שנבחרו</span>
              <span className="v2-milestone-status-text done">הושלם</span>
              <span className="v2-milestone-date">12.05.2024</span>
            </div>

            {/* Step 4: Editing */}
            <div className="v2-milestone-step">
              <div className="v2-milestone-node in-progress">
                <span>⚙️</span>
              </div>
              <span className="v2-milestone-name">עיבוד גלריה</span>
              <span className="v2-milestone-status-text in-progress">בתהליך</span>
              <span className="v2-milestone-date" style={{ color: 'var(--v2-brand)', fontWeight: 600 }}>50%</span>
            </div>

            {/* Step 5: Album */}
            <div className="v2-milestone-step">
              <div className="v2-milestone-node pending">
                <span>📖</span>
              </div>
              <span className="v2-milestone-name">עיצוב אלבום</span>
              <span className="v2-milestone-status-text pending">ממתין</span>
              <span className="v2-milestone-date">—</span>
            </div>
          </div>
        </div>
      </section>

      {/* Middle 3 Columns */}
      <div className="v2-status-grid-3">
        {/* Col 1: Client Info */}
        <div className="v2-panel-card">
          <div>
            <div className="v2-panel-card-title">פרטי הלקוחה</div>
            <div className="v2-client-info-top" style={{ marginTop: '16px' }}>
              <img
                src={project?.thumb || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'}
                alt=""
                className="v2-client-avatar"
              />
              <div className="v2-client-name-block">
                <strong>{clientName}</strong>
                <span>mali.katz@email.com</span>
                <span>050-1234567</span>
              </div>
            </div>

            <div className="v2-meta-rows" style={{ marginTop: '16px' }}>
              <div className="v2-meta-row">
                <span className="v2-meta-row-label"><span>📅</span> תאריך צילום</span>
                <span className="v2-meta-row-val">{shootDate}</span>
              </div>
              <div className="v2-meta-row">
                <span className="v2-meta-row-label"><span>📷</span> סוג צילום</span>
                <span className="v2-meta-row-val">{eventName}</span>
              </div>
              <div className="v2-meta-row">
                <span className="v2-meta-row-label"><span>🖼️</span> מספר תמונות מקוריות</span>
                <span className="v2-meta-row-val">{totalImported.toLocaleString('he-IL')}</span>
              </div>
            </div>
          </div>

          <button className="v2-action-pill" type="button">
            צפייה בפרטי הלקוחה
          </button>
        </div>

        {/* Col 2: Photo Summary */}
        <div className="v2-panel-card">
          <div>
            <div className="v2-panel-card-title">סיכום תמונות</div>
            <div className="v2-summary-rows" style={{ marginTop: '16px' }}>
              <div className="v2-summary-row">
                <span className="v2-summary-row-right"><span>🖼️</span> סה״כ תמונות שהועלו</span>
                <span className="v2-summary-row-num">{totalImported.toLocaleString('he-IL')}</span>
              </div>
              <div className="v2-summary-row">
                <span className="v2-summary-row-right"><span>🌪️</span> לאחר סינון אוטומטי</span>
                <span className="v2-summary-row-num">{cullingRemaining.toLocaleString('he-IL')}</span>
              </div>
              <div className="v2-summary-row">
                <span className="v2-summary-row-right"><span>❤️</span> נבחרו על ידי הלקוחה</span>
                <span className="v2-summary-row-num">{pickedPhotos.toLocaleString('he-IL')}</span>
              </div>
              <div className="v2-summary-row">
                <span className="v2-summary-row-right"><span>⚙️</span> בתהליך עיבוד</span>
                <span className="v2-summary-row-num">{pickedPhotos.toLocaleString('he-IL')}</span>
              </div>
              <div className="v2-summary-row">
                <span className="v2-summary-row-right"><span>✓</span> הושלמו</span>
                <span className="v2-summary-row-num">{renderedPhotos.toLocaleString('he-IL')}</span>
              </div>
            </div>
          </div>

          <button className="v2-action-pill" type="button" onClick={() => onNavigateStage?.('gallery-upload')}>
            צפייה בגלריה
          </button>
        </div>

        {/* Col 3: Recent Activity */}
        <div className="v2-panel-card">
          <div>
            <div className="v2-panel-card-title">פעילות אחרונה</div>
            <div className="v2-activity-timeline" style={{ marginTop: '16px' }}>
              <div className="v2-activity-timeline-line" />

              <div className="v2-activity-entry">
                <div className="v2-activity-dot-and-copy">
                  <span className="v2-activity-dot done">✓</span>
                  <div className="v2-activity-copy">
                    <strong>העלאה הושלמה</strong>
                    <small>הועלו 1,842 תמונות</small>
                  </div>
                </div>
                <div className="v2-activity-date">
                  11.05.2024<br />14:30
                </div>
              </div>

              <div className="v2-activity-entry">
                <div className="v2-activity-dot-and-copy">
                  <span className="v2-activity-dot done">✓</span>
                  <div className="v2-activity-copy">
                    <strong>סינון אוטומטי הושלם</strong>
                    <small>נותרו 1,246 תמונות</small>
                  </div>
                </div>
                <div className="v2-activity-date">
                  11.05.2024<br />15:10
                </div>
              </div>

              <div className="v2-activity-entry">
                <div className="v2-activity-dot-and-copy">
                  <span className="v2-activity-dot done">✓</span>
                  <div className="v2-activity-copy">
                    <strong>הלקוחה בחרה תמונות</strong>
                    <small>נבחרו 214 תמונות</small>
                  </div>
                </div>
                <div className="v2-activity-date">
                  12.05.2024<br />10:25
                </div>
              </div>

              <div className="v2-activity-entry">
                <div className="v2-activity-dot-and-copy">
                  <span className="v2-activity-dot in-progress">⚙️</span>
                  <div className="v2-activity-copy">
                    <strong>עיבוד גלריה התחיל</strong>
                    <small>בתהליך…</small>
                  </div>
                </div>
                <div className="v2-activity-date">
                  12.05.2024<br />11:00
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom 2 Columns: Message & Share */}
      <div className="v2-status-grid-2">
        {/* Message to Client */}
        <div className="v2-panel-card">
          <div>
            <div className="v2-panel-card-title">הודעה ללקוחה</div>
            <div style={{ fontSize: '13px', color: 'var(--v2-text-muted)', marginTop: '4px' }}>
              שלחי הודעה או עדכון ללקוחה
            </div>
            <div className="v2-message-box">
              <div className="v2-message-input-wrap">
                <input
                  type="text"
                  className="v2-message-input"
                  placeholder="כתבי הודעה..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <button className="v2-message-send-btn" type="button" title="שליחה">
                  ➤
                </button>
              </div>
              <button className="v2-action-pill" type="button">
                <span>✉️</span> תבניות הודעות
              </button>
            </div>
          </div>
        </div>

        {/* Share Gallery Link */}
        <div className="v2-panel-card">
          <div>
            <div className="v2-panel-card-title">קישור לגלריה</div>
            <div style={{ fontSize: '13px', color: 'var(--v2-text-muted)', marginTop: '4px' }}>
              שלחי ללקוחה קישור לצפייה ובחירת תמונות
            </div>
            <div className="v2-share-box">
              <input
                type="text"
                readOnly
                className="v2-share-input"
                value={shareUrl}
              />
              <button className="v2-action-pill" type="button" onClick={copyLink}>
                <span>{copied ? '✓ הועתק!' : 'העתק קישור ❐'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
