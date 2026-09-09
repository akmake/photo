import React, { useState } from 'react';
import type { Project } from '../../studio/store';
import {
  TzIconBook, TzIconCalendar, TzIconCamera, TzIconCheck, TzIconCloud,
  TzIconCopy, TzIconExternal, TzIconFilter, TzIconGallery, TzIconGear,
  TzIconHeart, TzIconMail, TzIconSend, TzIconSliders,
} from '../TzIcons';

export default function TzStatusScreen({
  project,
  onNavigateStage,
}: {
  project?: Project;
  onNavigateStage?: (stageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  // NOTHING on this screen is invented. It used to open on "מלי כץ · בת
  // מצווה" with 1,842 photographs uploaded on 11.05.2024, and a real project
  // with 31 frames still showed those dates because the fallbacks fired
  // whenever a counter was zero. A screen the photographer plans against must
  // not contain a number nobody measured — CLAUDE.md §5.
  const clientName = project?.client ?? '';
  const eventName = project?.event ?? '';
  const shootDate = project?.date ?? '';
  const totalImported = project?.imported ?? 0;
  const cullingRemaining = project?.kept ?? 0;
  const pickedPhotos = project?.picked ?? 0;
  const renderedPhotos = project?.rendered ?? 0;
  // What is actually still in the queue, not the selection over again.
  const inProcessing = Math.max(0, pickedPhotos - renderedPhotos);
  // The published gallery lives in the workspace state, not on the project, so
  // this screen does not have its address. It says so rather than printing a
  // teza.ai link that resolves to nothing.
  const galleryUrl = '';

  function copyLink() {
    if (!galleryUrl) return;
    navigator.clipboard.writeText(galleryUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Only steps that actually happened, described by their own counters.
  const activity: { title: string; detail: string; done: boolean }[] = [];
  if (totalImported > 0) {
    activity.push({ title: 'ייבוא הושלם', detail: `${totalImported.toLocaleString('he-IL')} תמונות`, done: true });
  }
  if (cullingRemaining > 0) {
    activity.push({ title: 'סינון הושלם', detail: `נותרו ${cullingRemaining.toLocaleString('he-IL')} תמונות`, done: true });
  }
  if (pickedPhotos > 0) {
    activity.push({ title: 'הלקוחה בחרה תמונות', detail: `נבחרו ${pickedPhotos.toLocaleString('he-IL')} תמונות`, done: true });
  }
  if (renderedPhotos > 0 || inProcessing > 0) {
    activity.push({
      title: renderedPhotos >= pickedPhotos && pickedPhotos > 0 ? 'עיבוד הושלם' : 'עיבוד גלריה',
      detail: `${renderedPhotos.toLocaleString('he-IL')} עובדו${inProcessing > 0 ? `, ${inProcessing.toLocaleString('he-IL')} ממתינות` : ''}`,
      done: pickedPhotos > 0 && renderedPhotos >= pickedPhotos,
    });
  }

  const progressPercent = !project
    ? 0
    : project.state === 'done'
      ? 100
      : Math.max(10, Math.min(95, Math.round(((project.at + 1) / 5) * 100)));
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ((progressPercent / 100) * circumference);

  if (!project) {
    return (
      <div className="tz-status-screen">
        <section className="tz-card">
          <div className="tz-overall-top">
            <div className="tz-overall-title">לא נבחר פרויקט</div>
            <div className="tz-overall-sub">
              בחר פרויקט כדי לראות את הסטטוס שלו. אין כאן נתוני דוגמה.
            </div>
          </div>
        </section>
      </div>
    );
  }

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
              {/* The arc below was already drawn from progressPercent; this
                  number was the string "75%", so the gauge and its own label
                  disagreed on every project in the studio. */}
              <span className="tz-gauge-val">{progressPercent}%</span>
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

            {/* 2. Culling / Batches */}
            <div
              className="tz-milestone-step"
              onClick={() => onNavigateStage?.('batches')}
              style={{ cursor: onNavigateStage ? 'pointer' : 'default' }}
              title="לחץ למעבר ליצירת מקבצים"
            >
              <div className={`tz-step-icon-wrap ${(project && (project.at >= 2 || project.kept > 0)) ? 'done' : (project && project.at === 1) ? 'active' : 'pending'}`}>
                <TzIconFilter size={18} />
              </div>
              <span className="tz-step-label">יצירת מקבצים</span>
              <span className={`tz-step-status ${(project && (project.at >= 2 || project.kept > 0)) ? 'done' : (project && project.at === 1) ? 'active' : 'pending'}`}>
                {(project && (project.at >= 2 || project.kept > 0)) ? 'הושלם' : (project && project.at === 1) ? 'בתהליך' : 'ממתין'}
              </span>
              <span className="tz-step-date">{project.kept ? `${project.kept} סוננו` : 'טרם סונן'}</span>
            </div>

            {/* 3. Picked / Send to client */}
            <div
              className="tz-milestone-step"
              onClick={() => onNavigateStage?.('send-to-client')}
              style={{ cursor: onNavigateStage ? 'pointer' : 'default' }}
              title="לחץ למעבר לשלח ללקוח"
            >
              <div className={`tz-step-icon-wrap ${(project && project.picked > 0) ? 'done' : (project && project.state === 'waiting') ? 'active' : 'pending'}`}>
                <TzIconHeart size={18} />
              </div>
              <span className="tz-step-label">שלח ללקוח</span>
              <span className={`tz-step-status ${(project && project.picked > 0) ? 'done' : (project && project.state === 'waiting') ? 'active' : 'pending'}`}>
                {(project && project.picked > 0) ? 'הושלם' : (project && project.state === 'waiting') ? 'אישור לקוח' : 'ממתין'}
              </span>
              <span className="tz-step-date">{project.picked ? `${project.picked} נבחרו` : 'טרם נבחרו'}</span>
            </div>

            {/* 4. Editing */}
            <div
              className="tz-milestone-step"
              onClick={() => onNavigateStage?.('gallery-edit')}
              style={{ cursor: onNavigateStage ? 'pointer' : 'default' }}
              title="לחץ למעבר לעריכת גלריה"
            >
              <div className={`tz-step-icon-wrap ${(project && project.rendered > 0 && project.rendered >= (project.picked || 1)) ? 'done' : (project && project.at >= 3) ? 'active' : 'pending'}`}>
                <TzIconSliders size={18} />
              </div>
              <span className="tz-step-label">עיבוד גלריה</span>
              <span className={`tz-step-status ${(project && project.rendered > 0 && project.rendered >= (project.picked || 1)) ? 'done' : (project && project.at >= 3) ? 'active' : 'pending'}`}>
                {(project && project.rendered > 0 && project.rendered >= (project.picked || 1)) ? 'הושלם' : (project && project.at >= 3) ? 'בתהליך' : 'ממתין'}
              </span>
              <span className="tz-step-date" style={{ color: '#e86338', fontWeight: 600 }}>
                {project.rendered ? `${project.rendered} עובדו` : 'בהמתנה'}
              </span>
            </div>

            {/* 5. Album */}
            <div
              className="tz-milestone-step"
              onClick={() => onNavigateStage?.('album-design')}
              style={{ cursor: onNavigateStage ? 'pointer' : 'default' }}
              title="לחץ למעבר לעיצוב אלבום"
            >
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
              {/* The project's OWN frame or nothing. getProjectCover falls
                  back to a stock library, and a stranger's face sitting under
                  the client's name, labelled with it, is the plainest kind of
                  invented data there is. */}
              {project.thumb ? (
                <img
                  src={project.thumb}
                  alt={clientName}
                  className="tz-client-photo"
                  style={{ objectPosition: project.pos || 'center 30%' }}
                />
              ) : (
                <div
                  className="tz-client-photo"
                  aria-hidden="true"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--tz-peach-soft, #f3ece8)',
                    color: 'var(--tz-ink-soft, #9b8b83)',
                    fontSize: 22, fontWeight: 600,
                  }}
                >
                  {(clientName.trim()[0] || '·')}
                </div>
              )}
              <div className="tz-client-meta">
                <h3>{clientName || 'ללא שם'}</h3>
                {/* There is no email or phone on the project record, so there
                    is none to show. A plausible-looking address built from the
                    client's name is worse than an empty line: it is dialled. */}
                <p className="tz-muted">לא הוזן דוא״ל</p>
                <p className="tz-muted">לא הוזן טלפון</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="tz-data-row">
                <span>תאריך צילום</span>
                <span>{shootDate || 'לא נקבע'} <TzIconCalendar size={14} /></span>
              </div>
              <div className="tz-data-row">
                <span>סוג צילום</span>
                <span>{eventName || 'לא הוגדר'} <TzIconCamera size={14} /></span>
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
                <span className="tz-summary-left"><TzIconSliders size={15} /> {inProcessing.toLocaleString('he-IL')}</span>
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

          {activity.length === 0 ? (
            <p className="tz-muted" style={{ margin: '12px 4px' }}>
              אין עדיין פעילות בפרויקט הזה.
            </p>
          ) : (
            <div className="tz-timeline">
              <div className="tz-timeline-line" />
              {activity.map((item) => (
                <div className="tz-timeline-item" key={item.title}>
                  <div className="tz-timeline-left">
                    <span className={`tz-timeline-dot ${item.done ? 'done' : 'active'}`}>
                      {item.done ? <TzIconCheck size={10} /> : <TzIconGear size={10} />}
                    </span>
                    <div className="tz-timeline-text">
                      <h4>{item.title}</h4>
                      <p>{item.detail}</p>
                    </div>
                  </div>
                  {/* No time column: the project record keeps counters, not a
                      timestamp per step. An invented hour is still invented. */}
                </div>
              ))}
            </div>
          )}
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

          {galleryUrl ? (
            <div className="tz-input-action-row">
              <input
                type="text"
                readOnly
                className="tz-input"
                value={galleryUrl}
                style={{ direction: 'ltr' }}
              />
              <button className="tz-btn-peach-inline" type="button" onClick={copyLink}>
                {copied ? '✓ הועתק' : 'העתק קישור'} <TzIconExternal size={14} />
              </button>
            </div>
          ) : (
            <p className="tz-muted" style={{ margin: '12px 4px' }}>
              עוד לא נוצרה גלריה לפרויקט הזה, ולכן אין קישור לשלוח.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
