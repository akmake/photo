import React, { useState } from 'react';
import {
  TzIconBook, TzIconCalendar, TzIconCamera, TzIconCheck, TzIconCloud,
  TzIconCopy, TzIconExternal, TzIconFilter, TzIconGallery, TzIconGear,
  TzIconHeart, TzIconMail, TzIconSend, TzIconSliders,
} from '../TzIcons';

export default function TzStatusScreen() {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  const shareUrl = 'https://teza.ai/gallery/malikatz';

  function copyLink() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // 75% circle stroke
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (0.75 * circumference);

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
            <div className="tz-milestone-step">
              <div className="tz-step-icon-wrap done">
                <TzIconCloud size={19} />
              </div>
              <span className="tz-step-label">העלאת גלריה</span>
              <span className="tz-step-status done">הושלם</span>
              <span className="tz-step-date">11.05.2024</span>
            </div>

            {/* 2. Culling */}
            <div className="tz-milestone-step">
              <div className="tz-step-icon-wrap done">
                <TzIconFilter size={18} />
              </div>
              <span className="tz-step-label">סינון גלריה</span>
              <span className="tz-step-status done">הושלם</span>
              <span className="tz-step-date">11.05.2024</span>
            </div>

            {/* 3. Picked */}
            <div className="tz-milestone-step">
              <div className="tz-step-icon-wrap done">
                <TzIconHeart size={18} />
              </div>
              <span className="tz-step-label">תמונות שנבחרו</span>
              <span className="tz-step-status done">הושלם</span>
              <span className="tz-step-date">12.05.2024</span>
            </div>

            {/* 4. Editing */}
            <div className="tz-milestone-step">
              <div className="tz-step-icon-wrap active">
                <TzIconSliders size={18} />
              </div>
              <span className="tz-step-label">עיבוד גלריה</span>
              <span className="tz-step-status active">בתהליך</span>
              <span className="tz-step-date" style={{ color: '#e86338', fontWeight: 600 }}>50%</span>
            </div>

            {/* 5. Album */}
            <div className="tz-milestone-step">
              <div className="tz-step-icon-wrap pending">
                <TzIconBook size={18} />
              </div>
              <span className="tz-step-label">עיצוב אלבום</span>
              <span className="tz-step-status pending">ממתין</span>
              <span className="tz-step-date">&nbsp;</span>
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
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80"
                alt="מלי כץ"
                className="tz-client-photo"
              />
              <div className="tz-client-meta">
                <h3>מלי כץ</h3>
                <p>mali.katz@email.com</p>
                <p>050-1234567</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="tz-data-row">
                <span>תאריך צילום</span>
                <span>10.05.2024 <TzIconCalendar size={14} /></span>
              </div>
              <div className="tz-data-row">
                <span>סוג צילום</span>
                <span>בת מצווה <TzIconCamera size={14} /></span>
              </div>
              <div className="tz-data-row">
                <span>מספר תמונות מקוריות</span>
                <span>1,842 <TzIconGallery size={14} /></span>
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
                <span className="tz-summary-left"><TzIconGallery size={15} /> 1,842</span>
                <span className="tz-summary-right">סה״כ תמונות שהועלו</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconFilter size={15} /> 1,246</span>
                <span className="tz-summary-right">לאחר סינון אוטומטי</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconHeart size={15} /> 214</span>
                <span className="tz-summary-right">נבחרו על ידי הלקוחה</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconSliders size={15} /> 214</span>
                <span className="tz-summary-right">בתהליך עיבוד</span>
              </div>
              <div className="tz-summary-row">
                <span className="tz-summary-left"><TzIconCheck size={15} /> 0</span>
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
