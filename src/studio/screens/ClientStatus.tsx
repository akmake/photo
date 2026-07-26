import { useState } from 'react';
import { STAGES } from '../nav';
import type { StageId } from '../nav';
import { ACTIVITY, MESSAGE_TEMPLATES, PROJECT } from '../demo';
import { Icon } from '../Shell';
import {
  IcCalendar, IcCamera, IcCheckCircle, IcCopy, IcGallery, IcHeart, IcLink,
  IcMail, IcSend, IcSliders,
} from '../../design/Icons';

/** The donut. An SVG arc rather than a chart library — one number, one ring. */
function Donut({ pct }: { pct: number }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" width="160" height="160">
        <circle cx="80" cy="80" r={r} className="donut-track" />
        <circle
          cx="80"
          cy="80"
          r={r}
          className="donut-arc"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 80 80)"
        />
      </svg>
      <div className="donut-mid">
        <b>{pct}%</b>
        <span>הושלם</span>
      </div>
    </div>
  );
}

function Stepper({ onStage }: { onStage: (s: StageId) => void }) {
  const flow = STAGES.filter((s) => s.id !== 'client-status');
  return (
    <ol className="stepper">
      {flow.map((s) => {
        const st = PROJECT.stages.find((x) => x.id === s.id);
        const state = st?.state ?? 'idle';
        return (
          <li key={s.id} className={`step ${state}`}>
            <button className="step-dot" onClick={() => onStage(s.id)}>
              <Icon name={s.icon} size={22} />
            </button>
            <div className="step-label">{s.label}</div>
            <div className="step-state">
              {state === 'done' ? 'הושלם' : state === 'active' ? 'בתהליך' : 'ממתין'}
            </div>
            <div className="step-meta">{st?.date ?? st?.note ?? ''}</div>
          </li>
        );
      })}
    </ol>
  );
}

const COUNTS = [
  { icon: IcGallery, label: 'סה"כ תמונות שהועלו', key: 'originals' },
  { icon: IcHeart, label: 'לאחר סינון אוטומטי', key: 'afterCull' },
  { icon: IcCheckCircle, label: 'נבחרו על ידי הלקוחה', key: 'clientPicked' },
  { icon: IcSliders, label: 'בתהליך עיבוד', key: 'inEditing' },
  { icon: IcCheckCircle, label: 'הושלמו', key: 'finished' },
] as const;

export default function ClientStatus({ onStage }: { onStage: (s: StageId) => void }) {
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);

  return (
    <>
      <section className="card card-pad">
        <div className="card-title">סטטוס כללי</div>
        <div className="card-sub">מעקב אחר התקדמות העבודה וסטטוס הלקוחה</div>
        <div className="status-body">
          <Donut pct={PROJECT.progress} />
          <Stepper onStage={onStage} />
        </div>
      </section>

      <div className="grid cols-3">
        <section className="card card-pad">
          <div className="card-title">פרטי הלקוחה</div>
          <div className="client">
            <span className="avatar big">{PROJECT.client[0]}</span>
            <div>
              <b>{PROJECT.client}</b>
              <div className="muted small">{PROJECT.email}</div>
              <div className="muted small">{PROJECT.phone}</div>
            </div>
          </div>
          <dl className="deflist">
            <Row icon={<IcCalendar size={17} />} k="תאריך צילום" v={PROJECT.shootDate} />
            <Row icon={<IcCamera size={17} />} k="סוג צילום" v={PROJECT.shootType} />
            <Row
              icon={<IcGallery size={17} />}
              k="מספר תמונות מקוריות"
              v={PROJECT.originals.toLocaleString('he-IL')}
            />
          </dl>
          <button className="btn btn-wide">צפייה בפרטי הלקוחה</button>
        </section>

        <section className="card card-pad">
          <div className="card-title">סיכום תמונות</div>
          <ul className="counts">
            {COUNTS.map((c) => {
              const I = c.icon;
              return (
                <li key={c.label}>
                  <span className="count-ico">
                    <I size={17} />
                  </span>
                  <b>{(PROJECT[c.key] as number).toLocaleString('he-IL')}</b>
                  <span className="count-label">{c.label}</span>
                </li>
              );
            })}
          </ul>
          <button className="btn btn-wide" onClick={() => onStage('gallery-cull')}>
            צפייה בגלריה
          </button>
        </section>

        <section className="card card-pad">
          <div className="card-title">פעילות אחרונה</div>
          <ul className="feed">
            {ACTIVITY.map((a, i) => (
              <li key={i} className={a.state}>
                <span className="feed-ico">
                  <Icon name={a.icon} size={17} />
                </span>
                <div className="feed-body">
                  <b>{a.title}</b>
                  <div className="muted small">{a.detail}</div>
                </div>
                <div className="feed-when">
                  <div>{a.date}</div>
                  <div className="muted small">{a.time}</div>
                </div>
                <span className="feed-mark" />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid cols-2">
        <section className="card card-pad">
          <div className="card-title">הודעה ללקוחה</div>
          <div className="card-sub">שלחי הודעה או עדכון ללקוחה</div>
          <div className="msg-row">
            <textarea
              className="field"
              placeholder="כתבי הודעה…"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
            <div className="msg-side">
              <button className="btn" onClick={() => setMsg(MESSAGE_TEMPLATES[0])}>
                <IcMail size={17} />
                תבניות הודעות
              </button>
              <button className="btn btn-primary" disabled={!msg.trim()}>
                <IcSend size={17} />
                שליחה
              </button>
            </div>
          </div>
        </section>

        <section className="card card-pad">
          <div className="card-title">קישור לגלריה</div>
          <div className="card-sub">שלחי ללקוחה קישור לצפייה ובחירת תמונות</div>
          <div className="link-row">
            <div className="link-box">
              <IcLink size={17} />
              <span>{PROJECT.galleryUrl}</span>
            </div>
            <button
              className="btn"
              onClick={() => {
                navigator.clipboard?.writeText(PROJECT.galleryUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              <IcCopy size={17} />
              {copied ? 'הועתק' : 'העתק קישור'}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function Row({ icon, k, v }: { icon: JSX.Element; k: string; v: string }) {
  return (
    <div className="def-row">
      <dt>
        {icon}
        {k}
      </dt>
      <dd>{v}</dd>
    </div>
  );
}
