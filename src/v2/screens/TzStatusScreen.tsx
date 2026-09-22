import React, { useState } from 'react';
import { useBatches, useCull, useGalleryOf } from '../../studio/store';
import type { Project } from '../../studio/store';
import { galleryPublicUrl, galleryShareText } from '../../studio/galleryShare';
import {
  TzIconBook, TzIconCalendar, TzIconCamera, TzIconCheck, TzIconCloud,
  TzIconExternal, TzIconFilter, TzIconGallery, TzIconGear,
  TzIconHeart, TzIconSliders, TzIconWhatsApp,
} from '../TzIcons';

type StepState = 'done' | 'active' | 'pending';
const STEP_WORD: Record<StepState, string> = { done: 'הושלם', active: 'בתהליך', pending: 'ממתין' };

/** An Israeli number as WhatsApp wants it: 972 and no leading zero. */
function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

export default function TzStatusScreen({
  project,
  onNavigateStage,
}: {
  project?: Project;
  onNavigateStage?: (stageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const batches = useBatches(project?.id ?? '');
  const link = useGalleryOf(project?.id ?? '');
  const cull = useCull(project?.id ?? '');

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

  // The published gallery, read from the project's own memory — the same
  // record the send-to-client screen writes.
  const galleryUrl = link ? galleryPublicUrl(link.slug) : null;
  const shareText = link && galleryUrl
    ? (link.password
      ? galleryShareText(clientName, galleryUrl, link.username, link.password)
      : galleryUrl)
    : '';

  function copyLink() {
    if (!shareText) return;
    void navigator.clipboard.writeText(shareText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const phone = project?.phone ? whatsappNumber(project.phone) : null;
  function sendMessage() {
    if (!phone || !message.trim()) return;
    window.open(
      `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message.trim())}`,
      '_blank',
      'noopener',
    );
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
    activity.push({ title: 'הלקוח בחר תמונות', detail: `נבחרו ${pickedPhotos.toLocaleString('he-IL')} תמונות`, done: true });
  }
  if (renderedPhotos > 0 || inProcessing > 0) {
    activity.push({
      title: renderedPhotos >= pickedPhotos && pickedPhotos > 0 ? 'עיבוד הושלם' : 'עיבוד גלריה',
      detail: `${renderedPhotos.toLocaleString('he-IL')} עובדו${inProcessing > 0 ? `, ${inProcessing.toLocaleString('he-IL')} ממתינות` : ''}`,
      done: pickedPhotos > 0 && renderedPhotos >= pickedPhotos,
    });
  }

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

  /* Each step is judged by what has happened, never by which screen was open
   * last. The gauge counts the same judgements, so the ring and the track
   * beneath it cannot disagree. */
  const imported = totalImported > 0;
  const grouped = batches.length > 0;
  const chose = Boolean(link?.importedAt) || pickedPhotos > 0;
  const edited = pickedPhotos > 0 && renderedPhotos >= pickedPhotos;
  const closed = project.state === 'done';
  // The work stage's own record: the photographer's keep/out decisions.
  const decisions = Object.values(cull);
  const decided = decisions.length;
  const rejected = decisions.filter((d) => d === 'reject').length;

  const steps: {
    id: string; label: string; icon: React.ReactNode; state: StepState; detail: string;
    title: string; counts: boolean;
  }[] = [
    {
      id: 'gallery-upload', label: 'העלאת גלריה', icon: <TzIconCloud size={19} />,
      state: imported ? 'done' : 'active',
      detail: imported ? `${totalImported.toLocaleString('he-IL')} תמונות` : 'טרם יובאו',
      title: 'מעבר לייבוא תמונות', counts: true,
    },
    {
      id: 'batches', label: 'יצירת סשנים', icon: <TzIconFilter size={18} />,
      state: grouped ? 'done' : imported ? 'active' : 'pending',
      detail: grouped ? `${batches.length.toLocaleString('he-IL')} סשנים` : 'טרם חולק',
      title: 'מעבר ליצירת סשנים', counts: true,
    },
    {
      id: 'work', label: 'סינון', icon: <TzIconGallery size={18} />,
      state: link || chose ? 'done' : decided > 0 || grouped ? 'active' : 'pending',
      detail: rejected > 0
        ? `${rejected.toLocaleString('he-IL')} הוצאו מהסט`
        : decided > 0 ? `${decided.toLocaleString('he-IL')} נבדקו` : 'טרם נבדק',
      title: 'מעבר לסינון', counts: true,
    },
    {
      id: 'send-to-client', label: 'שלח ללקוח', icon: <TzIconHeart size={18} />,
      state: chose ? 'done' : link ? 'active' : 'pending',
      detail: chose
        ? `${pickedPhotos.toLocaleString('he-IL')} נבחרו`
        : link ? 'ממתין ללקוח' : 'טרם נשלחה גלריה',
      title: 'מעבר לשליחה ללקוח', counts: true,
    },
    {
      id: 'gallery-edit', label: 'עיבוד גלריה', icon: <TzIconSliders size={18} />,
      state: edited ? 'done' : chose || renderedPhotos > 0 ? 'active' : 'pending',
      detail: renderedPhotos ? `${renderedPhotos.toLocaleString('he-IL')} עובדו` : 'בהמתנה',
      title: 'מעבר לעריכה', counts: true,
    },
    {
      id: 'album-design', label: 'עיצוב אלבום', icon: <TzIconBook size={18} />,
      state: !project.hasAlbum ? 'pending' : closed ? 'done' : edited ? 'active' : 'pending',
      detail: project.hasAlbum ? (closed ? 'הושלם' : 'כולל אלבום') : 'ללא אלבום',
      title: 'מעבר לעיצוב אלבום', counts: Boolean(project.hasAlbum),
    },
  ];
  const counted = steps.filter((s) => s.counts);
  const progressPercent = closed
    ? 100
    : Math.round((counted.filter((s) => s.state === 'done').length / counted.length) * 100);

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ((progressPercent / 100) * circumference);

  return (
    <div className="tz-status-screen">
      {/* 1. Overall Status Card (Top) */}
      <section className="tz-card">
        <div className="tz-overall-top">
          <div className="tz-overall-title">סטטוס כללי</div>
          <div className="tz-overall-sub">מעקב אחר התקדמות העבודה וסטטוס הלקוח</div>
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
              <span className="tz-gauge-val">{progressPercent}%</span>
              <span className="tz-gauge-txt">הושלם</span>
            </div>
          </div>

          {/* Milestones Track */}
          <div className="tz-milestones-track">
            <div className="tz-track-line" />

            {steps.map((step) => (
              <div
                key={step.id}
                className="tz-milestone-step"
                onClick={() => onNavigateStage?.(step.id)}
                style={{ cursor: onNavigateStage ? 'pointer' : 'default' }}
                title={step.title}
              >
                <div className={`tz-step-icon-wrap ${step.state}`}>{step.icon}</div>
                <span className="tz-step-label">{step.label}</span>
                <span className={`tz-step-status ${step.state}`}>
                  {step.counts ? STEP_WORD[step.state] : 'לא נדרש'}
                </span>
                <span className="tz-step-date">{step.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 2. Middle Row: 3 Columns */}
      <div className="tz-grid-3">
        {/* Col 1: Client Info */}
        <div className="tz-card">
          <div className="tz-panel-title">פרטי הלקוח</div>

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
              {/* The record carries these now — filled in when the job is
                  opened. Still never invented: a plausible-looking address
                  built from the client's name is worse than an empty line,
                  because an empty line does not get dialled. */}
              {project.email
                ? <p><a href={`mailto:${project.email}`} dir="ltr">{project.email}</a></p>
                : <p className="tz-muted">לא הוזן דוא״ל</p>}
              {project.phone
                ? <p><a href={`tel:${project.phone.replace(/[^\d+]/g, '')}`} dir="ltr">{project.phone}</a></p>
                : <p className="tz-muted">לא הוזן טלפון</p>}
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
                <span className="tz-summary-right">נבחרו על ידי הלקוח</span>
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

          <button
            className="tz-btn-peach"
            type="button"
            onClick={() => onNavigateStage?.('send-to-client')}
          >
            {link ? 'לגלריית הלקוח' : 'יצירת גלריה ללקוח'}
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
        {/* Message to Client — goes out through WhatsApp, to the number on
            the project. No number, no send: a button that pretends is worse
            than one that says why it cannot. */}
        <div className="tz-card">
          <div className="tz-box-title">הודעה ללקוח</div>
          <div className="tz-box-sub">
            {phone
              ? `ההודעה תיפתח בוואטסאפ, אל ${project.phone}`
              : 'לא הוזן טלפון ללקוח, ולכן אין לאן לשלוח'}
          </div>

          <div className="tz-input-action-row">
            <div className="tz-input-wrap">
              <input
                type="text"
                className="tz-input"
                placeholder="כתוב הודעה..."
                value={message}
                disabled={!phone}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
              />
              <button
                className="tz-input-icon-btn"
                type="button"
                title="שליחה בוואטסאפ"
                disabled={!phone || !message.trim()}
                onClick={sendMessage}
              >
                <TzIconWhatsApp size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Share Link */}
        <div className="tz-card">
          <div className="tz-box-title">קישור לגלריה</div>
          <div className="tz-box-sub">שלח ללקוח קישור לצפייה ובחירת תמונות</div>

          {!link ? (
            <p className="tz-muted" style={{ margin: '12px 4px' }}>
              עוד לא נוצרה גלריה לפרויקט הזה, ולכן אין קישור לשלוח.
            </p>
          ) : galleryUrl ? (
            <div className="tz-input-action-row">
              <input
                type="text"
                readOnly
                className="tz-input"
                value={galleryUrl}
                style={{ direction: 'ltr' }}
              />
              <button
                className="tz-btn-peach-inline"
                type="button"
                onClick={copyLink}
                title={link.password ? 'מעתיק את הקישור עם שם המשתמש והסיסמה' : 'מעתיק את הקישור'}
              >
                {copied ? '✓ הועתק' : 'העתק קישור'} <TzIconExternal size={14} />
              </button>
            </div>
          ) : (
            <p className="tz-muted" style={{ margin: '12px 4px' }}>
              הגלריה נוצרה, אבל עדיין אין לה כתובת ציבורית לשלוח ללקוח.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
