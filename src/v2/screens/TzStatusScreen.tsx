import React, { useState } from 'react';
import type { Project } from '../../studio/store';
import {
  TzIconBook, TzIconCalendar, TzIconCamera, TzIconCheck, TzIconCloud,
  TzIconCopy, TzIconExternal, TzIconFilter, TzIconGallery, TzIconGear,
  TzIconHeart, TzIconMail, TzIconSend, TzIconSliders,
} from '../TzIcons';
import { getProjectCover } from '../projectCovers';

export default function TzStatusScreen({
  project,
  onNavigateStage,
}: {
  project?: Project;
  onNavigateStage?: (stageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  const clientName = project?.client || 'מלי כץ';
  const eventName = project?.event || 'בת מצווה';
  const shootDate = project?.date || '10.05.2024';
  const totalImported = project ? (project.imported ?? 0) : 1842;
  const cullingRemaining = project ? (project.kept ?? 0) : 1246;
  const pickedPhotos = project ? (project.picked ?? 0) : 214;
  const renderedPhotos = project ? (project.rendered ?? 0) : 0;
  const shareUrl = `https://teza.ai/gallery/${encodeURIComponent(clientName.replace(/\s+/g, '').toLowerCase())}`;

  function copyLink() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Progress percentage based on project.at or 75%
  const progressPercent = project
    ? project.state === 'done'
      ? 100
      : Math.max(10, Math.min(95, Math.round(((project.at + 1) / 5) * 100)))
    : 75;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ((progressPercent / 100) * circumference);

  return (
    <div className="tz-status-screen">
      {/* 1. Overall Status Card (Top) */}
      <section className="tz-card">
        <div className="tz-overall-top">
          <div className="tz-overall-title">סטטוס כללי</div>
          <div className="tz-overall-sub">מעקב אחר התקדמות העבודה וסטטוס הלקוחה</div>
        </div>

        <div className="tz-overall-content">
          {/* Gauge Left */}
          <div className="tz-gauge-box">
            <svg viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="#feebe3"
                strokeWidth="7"
              />
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="#e86338"
                strokeWidth="7"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </svg>
            <div className="tz-gauge-center">
              <span className="tz-gauge-val">75%</span>
              <span className="tz-gauge-txt">הושלם</span>
            </div>
          </div>

          {/* Milestones Track */}
          <div className="tz-milestones-track">
            <div className="tz-track-line" />

            {/* 1. Upload */}
            <div
              className="tz-milestone-step"
              onClick={() => onNavigateStage?.('gallery-upload')}
              style={{ cursor: onNavigateStage ? 'pointer' : 'default' }}
              title="לחץ למעבר לייבוא תמונות"
            >
              <div className="tz-step-icon-wrap done">
                <TzIconCloud size={19} />
              </div>
              <span className="tz-step-label">העלאת גלריה</span>
              <span className="tz-step-status done">
                {project?.imported ? `${project.imported} תמונות` : 'ייבוא תמונות'}
              </span>
              <span className="tz-step-date">{shootDate}</span>
            </div>

            {/* 2. Culling */}
            <div className="tz-milestone-step">
              <div className={`tz-step-icon-wrap ${(project && (project.at >= 2 || project.kept > 0)) ? 'done' : (project && project.at === 1) ? 'active' : 'pending'}`}>
                <TzIconFilter size={18} />
              </div>
              <span className="tz-step-label">סינון גלריה</span>
              <span className={`tz-step-status ${(project && (project.at >= 2 || project.kept > 0)) ? 'done' : (project && project.at === 1) ? 'active' : 'pending'}`}>
                {(project && (project.at >= 2 || project.kept > 0)) ? 'הושלם' : (project && project.at === 1) ? 'בתהליך' : 'ממתין'}
              </span>
              <span className="tz-step-date">{project?.kept ? `${project.kept} סוננו` : '11.05.2024'}</span>
            </div>

            {/* 3. Picked */}
            <div className="tz-milestone-step">
              <div className={`tz-step-icon-wrap ${(project && project.picked > 0) ? 'done' : (project && project.state === 'waiting') ? 'active' : 'pending'}`}>
                <TzIconHeart size={18} />
              </div>
              <span className="tz-step-label">תמונות שנבחרו</span>
              <span className={`tz-step-status ${(project && project.picked > 0) ? 'done' : (project && project.state === 'waiting') ? 'active' : 'pending'}`}>
                {(project && project.picked > 0) ? 'הושלם' : (project && project.state === 'waiting') ? 'אישור לקוח' : 'ממתין'}
              </span>
              <span className="tz-step-date">{project?.picked ? `${project.picked} נבחרו` : '12.05.2024'}</span>
            </div>

            {/* 4. Editing */}
            <div className="tz-milestone-step">
              <div className={`tz-step-icon-wrap ${(project && project.rendered > 0 && project.rendered >= (project.picked || 1)) ? 'done' : (project && project.at >= 3) ? 'active' : 'pending'}`}>
                <TzIconSliders size={18} />
              </div>
              <span className="tz-step-label">עיבוד גלריה</span>
              <span className={`tz-step-status ${(project && project.rendered > 0 && project.rendered >= (project.picked || 1)) ? 'done' : (project && project.at >= 3) ? 'active' : 'pending'}`}>
                {(project && project.rendered > 0 && project.rendered >= (project.picked || 1)) ? 'הושלם' : (project && project.at >= 3) ? 'בתהליך' : 'ממתין'}
              </span>
              <span className="tz-step-date" style={{ color: '#e86338', fontWeight: 600 }}>
                {project ? (project.rendered ? `${project.rendered} עובדו` : 'בהמתנה') : '50%'}
              </span>
            </div>

            {/* 5. Album */}
            <div className="tz-milestone-step">
              <div className={`tz-step-icon-wrap ${(project && project.state === 'done') ? 'done' : (project && project.at >= 4) ? 'active' : 'pending'}`}>
                <TzIconBook size={18} />
              </div>
              <span className="tz-step-label">עיצוב אלבום</span>
              <span className={`tz-step-status ${(project && project.state === 'done') ? 'done' : (project && project.at >= 4) ? 'active' : 'pending'}`}>
                {(project && project.state === 'done') ? 'הושלם' : (project && project.at >= 4) ? 'בתהליך' : 'ממתין'}
              </span>
              <span className="tz-step-date">{project?.hasAlbum ? 'כולל אלבום' : 'ללא אלבום'}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Middle Row: 3 Columns */}
      <div className="tz-grid-3">
        {/* Col 1: Client Info */}
        <div className="tz-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="tz-panel-title">פרטי הלקוחה</div>

            <div className="tz-client-header">
              <img
                src={getProjectCover(project)}
                alt={clientName}
                className="tz-client-photo"
                style={{ objectPosition: project?.pos || 'center 30%' }}
              />
              <div className="tz-client-meta">
                <h3>{clientName}</h3>
                <p>{project ? `${clientName.replace(/\s+/g, '').toLowerCase()}@gmail.com` : 'mali.katz@email.com'}</p>
                <p>050-1234567</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="tz-data-row">
                <span>תאריך צילום</span>
                <span>{shootDate} <TzIconCalendar size={14} /></span>
              </div>
              <div className="tz-data-row">
                <span>סוג צילום</span>
                <span>{eventName} <TzIconCamera size={14} /></span>
              </div>
              <div className="tz-data-row">
                <span>מספר תמונות מקוריות</span>
                <span>{totalImported.toLocaleString('he-IL')} <TzIconGallery size={14} /></span>
              </div>
            </div>
          </div>

          <button className="tz-btn-peach" type="button">
            צפייה בפרטי הלקוחה
          </button>
        </div>

        {/* Col 2: Summary of Photos */}
        <div className="tz-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="tz-panel-title">סיכום תמונות</div>

            <div className="tz-summary-list">
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconGallery size={15} /> {totalImported.toLocaleString('he-IL')}</span>
                <span className="tz-summary-right">סה״כ תמונות שהועלו</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconFilter size={15} /> {cullingRemaining.toLocaleString('he-IL')}</span>
                <span className="tz-summary-right">לאחר סינון אוטומטי</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconHeart size={15} /> {pickedPhotos.toLocaleString('he-IL')}</span>
                <span className="tz-summary-right">נבחרו על ידי הלקוחה</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconSliders size={15} /> {pickedPhotos.toLocaleString('he-IL')}</span>
                <span className="tz-summary-right">בתהליך עיבוד</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconCheck size={15} /> {renderedPhotos.toLocaleString('he-IL')}</span>
                <span className="tz-summary-right">הושלמו</span>
              </div>
            </div>
          </div>

          <button className="tz-btn-peach" type="button">
            צפייה בגלריה
          </button>
        </div>

        {/* Col 3: Recent Activity */}
        <div className="tz-card">
          <div className="tz-panel-title">פעילות אחרונה</div>

          <div className="tz-timeline">
            <div className="tz-timeline-line" />

            <div className="tz-timeline-item">
              <div className="tz-timeline-left">
                <span className="tz-timeline-dot done"><TzIconCheck size={10} /></span>
                <div className="tz-timeline-text">
                  <h4>העלאה הושלמה</h4>
                  <p>הועלו 1,842 תמונות</p>
                </div>
              </div>
              <div className="tz-timeline-time">
                11.05.2024<br />14:30
              </div>
            </div>

            <div className="tz-timeline-item">
              <div className="tz-timeline-left">
                <span className="tz-timeline-dot done"><TzIconCheck size={10} /></span>
                <div className="tz-timeline-text">
                  <h4>סינון אוטומטי הושלם</h4>
                  <p>נותרו 1,246 תמונות</p>
                </div>
              </div>
              <div className="tz-timeline-time">
                11.05.2024<br />15:10
              </div>
            </div>

            <div className="tz-timeline-item">
              <div className="tz-timeline-left">
                <span className="tz-timeline-dot done"><TzIconCheck size={10} /></span>
                <div className="tz-timeline-text">
                  <h4>הלקוחה בחרה תמונות</h4>
                  <p>נבחרו 214 תמונות</p>
                </div>
              </div>
              <div className="tz-timeline-time">
                12.05.2024<br />10:25
              </div>
            </div>

            <div className="tz-timeline-item">
              <div className="tz-timeline-left">
                <span className="tz-timeline-dot active"><TzIconGear size={10} /></span>
                <div className="tz-timeline-text">
                  <h4>עיבוד גלריה התחיל</h4>
                  <p>בתהליך…</p>
                </div>
              </div>
              <div className="tz-timeline-time">
                12.05.2024<br />11:00
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bottom Row: 2 Columns (Message & Link) */}
      <div className="tz-grid-2">
        {/* Message to Client */}
        <div className="tz-card">
          <div className="tz-box-title">הודעה ללקוחה</div>
          <div className="tz-box-sub">שלחי הודעה או עדכון ללקוחה</div>

          <div className="tz-input-action-row">
            <div className="tz-input-wrap">
              <input
                type="text"
                className="tz-input"
                placeholder="...כתבי הודעה"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button className="tz-input-icon-btn" type="button" title="שליחה">
                <TzIconSend size={15} />
              </button>
            </div>
            <button className="tz-btn-peach-inline" type="button">
              <TzIconMail size={15} /> תבניות הודעות
            </button>
          </div>
        </div>

        {/* Share Link */}
        <div className="tz-card">
          <div className="tz-box-title">קישור לגלריה</div>
          <div className="tz-box-sub">שלחי ללקוחה קישור לצפייה ובחירת תמונות</div>

          <div className="tz-input-action-row">
            <input
              type="text"
              readOnly
              className="tz-input"
              value={shareUrl}
              style={{ direction: 'ltr' }}
            />
            <button className="tz-btn-peach-inline" type="button" onClick={copyLink}>
              {copied ? '✓ הועתק' : 'העתק קישור'} <TzIconExternal size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
