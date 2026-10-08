/* סטטוס לקוח — the project's front page, in the FrameOps.dc.html language
 * (09.10.2026). The steps card it used to open with is gone: the stage bar above
 * every project screen now says where each stage stands, and two progress
 * tracks one above the other only invite the question which one is right.
 *
 * What is left is what the photographer comes here for: who the client is and
 * what was agreed, the photographs in numbers, what has happened, a message to
 * the client, and the gallery link. */
import React, { useState } from 'react';
import { useBatches, useCull, useGalleryOf } from '../../studio/store';
import type { Project } from '../../studio/store';
import { galleryPublicUrl, galleryShareText } from '../../studio/galleryShare';
import { getProjectCover } from '../projectCovers';
import { TzIconWhatsApp } from '../TzIcons';
import './status-frame.css';

/** An Israeli number as WhatsApp wants it: 972 and no leading zero. */
function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('972')) return digits;
  if (digits.startsWith('0')) return `972${digits.slice(1)}`;
  return digits;
}

function n(x: number) {
  return x.toLocaleString('en-US');
}

function shekels(x: number) {
  return `₪${n(x)}`;
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
  const total = project?.imported ?? 0;
  const picked = project?.picked ?? 0;
  const rendered = project?.rendered ?? 0;
  // What is actually still in the queue, not the selection over again.
  const inProcessing = Math.max(0, picked - rendered);

  /* The work stage's own record: the photographer's keep/out decisions. "After
   * culling" used to read `project.kept`, a counter nothing writes — it said 0
   * on a project with hundreds of frames decided. */
  const decisions = Object.values(cull);
  const decided = decisions.length;
  const rejected = decisions.filter((d) => d === 'reject').length;

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

  if (!project) {
    return (
      <div className="fo-st">
        <div className="fo-st-none">לא נבחר פרויקט. בחר פרויקט כדי לראות את הסטטוס שלו.</div>
      </div>
    );
  }

  // Only steps that actually happened, described by their own counters.
  const activity: { title: string; detail: string; done: boolean }[] = [];
  if (total > 0) activity.push({ title: 'יובאו תמונות', detail: `${n(total)} תמונות`, done: true });
  if (batches.length > 0) activity.push({ title: 'חולק לסשנים', detail: `${n(batches.length)} סשנים`, done: true });
  if (decided > 0) {
    activity.push({
      title: decided >= total ? 'הסינון הושלם' : 'סינון',
      detail: `הוחלטו ${n(decided)} מתוך ${n(total)}${rejected ? ` · ${n(rejected)} הוסרו` : ''}`,
      done: decided >= total,
    });
  }
  if (link) activity.push({ title: 'נוצרה גלריה ללקוח', detail: galleryUrl ? 'יש קישור לשליחה' : 'עדיין בלי כתובת ציבורית', done: true });
  if (picked > 0) activity.push({ title: 'הלקוח בחר תמונות', detail: `${n(picked)} תמונות`, done: true });
  if (rendered > 0 || inProcessing > 0) {
    activity.push({
      title: rendered >= picked && picked > 0 ? 'העריכה הושלמה' : 'עריכה',
      detail: `${n(rendered)} מוכנות${inProcessing > 0 ? ` · ${n(inProcessing)} ממתינות` : ''}`,
      done: picked > 0 && rendered >= picked,
    });
  }

  const rows: { label: string; value: number | null; of?: number; tone?: string }[] = [
    { label: 'יובאו', value: total, of: total },
    { label: 'הוחלטו בסינון', value: decided, of: total },
    { label: 'הוסרו בסינון', value: rejected, of: total, tone: 'out' },
    { label: 'נשארו אחרי הסינון', value: decided > 0 ? total - rejected : null, of: total },
    { label: 'בחר הלקוח', value: picked, of: total, tone: 'accent' },
    { label: 'בעריכה', value: inProcessing, of: picked || total },
    { label: 'מוכנות', value: rendered, of: picked || total, tone: 'good' },
  ];

  const cover = getProjectCover(project, 640);
  const price = project.price ?? 0;
  const paid = project.paid ?? 0;

  return (
    <div className="fo-st" data-tour="project-status">
      <div className="fo-st-grid">
        <div className="fo-st-main">
          <section className="fo-st-card" data-tour="project-summary">
            <div className="fo-st-head"><span>התמונות</span></div>
            <div className="fo-st-rows">
              {rows.map((r) => (
                <div key={r.label} className="fo-st-row">
                  <span className="fo-st-row-label">{r.label}</span>
                  <span className="fo-st-bar">
                    {r.value !== null && r.of ? (
                      <i className={r.tone ? `is-${r.tone}` : ''} style={{ width: `${Math.min(100, (r.value / r.of) * 100)}%` }} />
                    ) : null}
                  </span>
                  <span className="fo-mono fo-st-row-val">{r.value === null ? '—' : n(r.value)}</span>
                </div>
              ))}
            </div>
            <div className="fo-st-foot">
              <button type="button" className="fo-btn is-primary" onClick={() => onNavigateStage?.('send-to-client')}>
                {link ? 'לגלריית הלקוח' : 'יצירת גלריה ללקוח'}
              </button>
              <button type="button" className="fo-btn" onClick={() => onNavigateStage?.('work')}>לסינון</button>
            </div>
          </section>

          <section className="fo-st-card" data-tour="project-activity">
            <div className="fo-st-head"><span>מה קרה בפרויקט</span></div>
            {activity.length === 0 ? (
              <p className="fo-st-empty">אין עדיין פעילות בפרויקט הזה.</p>
            ) : (
              <div className="fo-st-activity">
                {activity.map((a) => (
                  <div key={a.title} className="fo-st-act">
                    <span className={`fo-st-act-dot${a.done ? ' is-done' : ''}`} />
                    <span className="fo-st-act-title">{a.title}</span>
                    <span className="fo-st-act-detail">{a.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="fo-st-pair">
            {/* Goes out through WhatsApp, to the number on the project. No
                number, no send: a button that pretends is worse than one that
                says why it cannot. */}
            <section className="fo-st-card" data-tour="project-message">
              <div className="fo-st-head"><span>הודעה ללקוח</span></div>
              <p className="fo-st-sub">
                {phone ? <>ההודעה תיפתח בוואטסאפ, אל <span className="fo-mono">{project.phone}</span></> : 'לא הוזן טלפון ללקוח, ולכן אין לאן לשלוח'}
              </p>
              <div className="fo-st-inputrow">
                <input
                  type="text"
                  className="fo-st-input"
                  placeholder="כתוב הודעה…"
                  value={message}
                  disabled={!phone}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
                />
                <button type="button" className="fo-btn" title="שליחה בוואטסאפ" disabled={!phone || !message.trim()} onClick={sendMessage}>
                  <TzIconWhatsApp size={14} />שלח
                </button>
              </div>
            </section>

            <section className="fo-st-card" data-tour="project-link">
              <div className="fo-st-head"><span>קישור לגלריה</span></div>
              <p className="fo-st-sub">הקישור שהלקוח פותח כדי לצפות ולבחור.</p>
              {!link ? (
                <p className="fo-st-empty">עוד לא נוצרה גלריה לפרויקט הזה, ולכן אין קישור לשלוח.</p>
              ) : galleryUrl ? (
                <div className="fo-st-inputrow">
                  <input type="text" readOnly className="fo-st-input fo-mono" value={galleryUrl} dir="ltr" />
                  <button
                    type="button"
                    className="fo-btn"
                    onClick={copyLink}
                    title={link.password ? 'מעתיק את הקישור עם שם המשתמש והסיסמה' : 'מעתיק את הקישור'}
                  >
                    {copied ? '✓ הועתק' : 'העתק'}
                  </button>
                </div>
              ) : (
                <p className="fo-st-empty">הגלריה נוצרה, אבל עדיין אין לה כתובת ציבורית לשלוח ללקוח.</p>
              )}
            </section>
          </div>
        </div>

        <aside className="fo-st-card fo-st-client" data-tour="project-client">
          <div className="fo-st-cover">
            {cover
              ? <img src={cover} alt="" style={{ objectPosition: project.pos || 'center 40%' }} />
              : <span>טרם יובאו תמונות</span>}
          </div>
          <div className="fo-st-who">
            <strong>{clientName || 'ללא שם'}</strong>
            <span>{[project.event, project.location].filter(Boolean).join(' · ') || 'פרויקט צילום'}</span>
          </div>
          {/* Filled in when the job was opened. Never invented: a plausible
              address built from the client's name is worse than an empty
              line, because an empty line does not get dialled. */}
          <div className="fo-st-contact">
            {project.phone
              ? <a href={`tel:${project.phone.replace(/[^\d+]/g, '')}`} className="fo-mono" dir="ltr">{project.phone}</a>
              : <span className="fo-st-missing">לא הוזן טלפון</span>}
            {project.email
              ? <a href={`mailto:${project.email}`} className="fo-mono" dir="ltr">{project.email}</a>
              : <span className="fo-st-missing">לא הוזן דוא״ל</span>}
          </div>

          <div className="fo-st-sect">
            <span className="fo-st-label">פרטים</span>
            <div className="fo-st-kv"><span>תאריך צילום</span><span className="fo-mono">{project.date || '—'}</span></div>
            <div className="fo-st-kv"><span>סוג צילום</span><span>{project.event || 'לא הוגדר'}</span></div>
            {project.location && <div className="fo-st-kv"><span>מקום</span><span>{project.location}</span></div>}
            <div className="fo-st-kv"><span>אלבום</span><span>{project.hasAlbum ? 'בתוצרים' : 'לא בתוצרים'}</span></div>
          </div>

          <div className="fo-st-sect">
            <span className="fo-st-label">תשלומים</span>
            {price > 0 ? (
              <>
                <div className="fo-st-kv"><span>סוכם</span><span className="fo-mono">{shekels(price)}</span></div>
                <div className="fo-st-kv"><span>שולם</span><span className="fo-mono">{shekels(paid)}</span></div>
                <div className="fo-st-kv"><span>פתוח</span><span className={`fo-mono${price - paid > 0 ? ' is-open' : ''}`}>{shekels(Math.max(0, price - paid))}</span></div>
              </>
            ) : (
              <span className="fo-st-missing">לא הוזן סכום לפרויקט.</span>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
