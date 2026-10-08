/* ייבוא מהענן, in the frame's language: the service's own mark in the header,
 * one clear screen per state — checking, not set up in this installation, not
 * yet connected, browsing — and a folder list that says how many photographs
 * and how much data an import will bring. The connection logic is the studio's
 * own (useCloudBrowser), shared with the older screen. */
import { useEffect, useMemo } from 'react';
import type { CloudEntry, CloudProvider } from '../../api';
import { CLOUD_NAMES, useCloudBrowser } from '../../studio/screens/CloudImportDialog';
import { CloudLogo } from '../BrandLogos';
import './cloud-import-v2.css';

function mb(bytes: number) {
  return bytes >= 1_073_741_824
    ? `${(bytes / 1_073_741_824).toFixed(1)} GB`
    : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function IcFolder() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function IcImage() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-8 9" />
    </svg>
  );
}

function IcChevron() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export default function CloudImportV2({
  provider,
  onClose,
  onImport,
}: {
  provider: CloudProvider;
  onClose: () => void;
  onImport: (entries: CloudEntry[]) => Promise<void>;
}) {
  const name = CLOUD_NAMES[provider];
  const {
    connection, entries, crumbs, checking, loading, connecting, importing, error,
    images, browsing, checkConnection, connect, openFolder, jump, runImport, disconnect,
  } = useCloudBrowser(provider, onImport, onClose);

  const bytes = useMemo(() => images.reduce((sum, e) => sum + (e.size ?? 0), 0), [images]);
  const folders = entries.filter((e) => e.kind === 'folder').length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !importing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [importing, onClose]);

  return (
    <div
      className="fo-cl-backdrop"
      role="presentation"
      onMouseDown={(e) => { if (e.currentTarget === e.target && !importing) onClose(); }}
    >
      <section
        className={`fo-cl${browsing ? ' is-browsing' : ''} is-${provider}`}
        data-tour="import-cloud"
        role="dialog"
        aria-modal="true"
        aria-label={`ייבוא מ־${name}`}
      >
        <header className="fo-cl-head">
          <span className="fo-cl-mark"><CloudLogo provider={provider} size={22} /></span>
          <div className="fo-cl-title">
            <strong>ייבוא מ־<bdi dir="ltr">{name}</bdi></strong>
            <span>{browsing ? 'בחר תיקייה — כל התמונות שבה יועתקו לפרויקט' : 'הרשאת קריאה בלבד · שום קובץ בענן לא משתנה'}</span>
          </div>
          <button type="button" className="fo-cl-x" onClick={onClose} disabled={importing} aria-label="סגירה">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>

        {checking ? (
          <div className="fo-cl-state" aria-live="polite">
            <span className="fo-cl-big is-pulse"><CloudLogo provider={provider} size={44} /></span>
            <strong>בודק את החיבור ל־<bdi dir="ltr">{name}</bdi>…</strong>
          </div>
        ) : !connection ? (
          <div className="fo-cl-state">
            <span className="fo-cl-big"><CloudLogo provider={provider} size={44} /></span>
            <strong>לא הצלחנו להגיע למנוע המקומי של FrameOps</strong>
            <p>הייבוא מהענן עובר דרך המנוע שרץ על המחשב. כשהוא לא עונה — אין דרך לבדוק את החיבור.</p>
            {error && <p className="fo-cl-detail">{error}</p>}
            <button type="button" className="fo-btn is-primary" onClick={checkConnection}>נסה שוב</button>
          </div>
        ) : !connection.configured ? (
          <div className="fo-cl-state">
            <span className="fo-cl-big is-dim"><CloudLogo provider={provider} size={44} /></span>
            <strong>החיבור ל־<bdi dir="ltr">{name}</bdi> עוד לא מוגדר בהתקנה הזו</strong>
            <p>זו הגדרה של התוכנה, לא בעיה בחשבון שלך. כשהחיבור יוגדר, יופיע כאן כפתור התחברות.</p>
            <button type="button" className="fo-btn" onClick={onClose}>סגור</button>
          </div>
        ) : !connection.connected ? (
          <div className="fo-cl-state">
            <span className="fo-cl-big"><CloudLogo provider={provider} size={44} /></span>
            <strong>מחברים פעם אחת, ומייבאים בכל פרויקט</strong>
            <ul className="fo-cl-points">
              <li>נפתח חלון של <bdi dir="ltr">{name}</bdi> — שם מאשרים את החשבון.</li>
              <li>FrameOps מבקשת הרשאת קריאה בלבד. שום קובץ בענן לא יימחק או ישתנה.</li>
              <li>התמונות מועתקות לתיקיית הפרויקט במחשב שלך.</li>
            </ul>
            <button type="button" className="fo-cl-connect" onClick={connect} disabled={connecting}>
              <CloudLogo provider={provider} size={18} />
              {connecting ? 'ממתין לאישור בחלון שנפתח…' : <>התחבר ל־<bdi dir="ltr">{name}</bdi></>}
            </button>
            {error && <p className="fo-cl-detail">{error}</p>}
          </div>
        ) : (
          <>
            <nav className="fo-cl-crumbs" aria-label="מיקום בענן">
              {crumbs.map((crumb, i) => (
                <span key={`${crumb.id ?? 'root'}-${i}`}>
                  {i > 0 && <IcChevron />}
                  <button
                    type="button"
                    className={i === crumbs.length - 1 ? 'is-here' : ''}
                    onClick={() => jump(i)}
                    disabled={loading || importing || i === crumbs.length - 1}
                  >
                    {i === 0 ? <><CloudLogo provider={provider} size={14} /><bdi dir="ltr">{crumb.name}</bdi></> : crumb.name}
                  </button>
                </span>
              ))}
            </nav>

            <div className="fo-cl-list">
              {error && <p className="fo-cl-detail is-inline">{error}</p>}
              {loading ? (
                <p className="fo-cl-note">קורא את התיקייה…</p>
              ) : entries.length === 0 ? (
                <p className="fo-cl-note">אין כאן תיקיות או תמונות נתמכות.</p>
              ) : entries.map((entry) => (
                entry.kind === 'folder' ? (
                  <button type="button" className="fo-cl-row is-folder" key={entry.id} onClick={() => openFolder(entry)} disabled={importing}>
                    <span className="fo-cl-ic"><IcFolder /></span>
                    <b>{entry.name}</b>
                    <IcChevron />
                  </button>
                ) : (
                  <div className="fo-cl-row" key={entry.id}>
                    <span className="fo-cl-ic"><IcImage /></span>
                    <b dir="ltr">{entry.name}</b>
                    <small className="fo-mono">{entry.size ? mb(entry.size) : ''}</small>
                  </div>
                )
              ))}
            </div>

            <footer className="fo-cl-foot">
              <button type="button" className="fo-cl-disconnect" onClick={disconnect} disabled={loading || importing}>נתק חשבון</button>
              <span className="fo-cl-sum">
                {images.length
                  ? <><b className="fo-mono">{images.length.toLocaleString('en-US')}</b> תמונות{bytes ? <> · <span className="fo-mono">{mb(bytes)}</span></> : null}</>
                  : folders ? 'אין תמונות בתיקייה הזו — היכנס לאחת התיקיות' : 'אין תמונות בתיקייה הזו'}
              </span>
              <button type="button" className="fo-btn is-primary" onClick={runImport} disabled={!images.length || loading || importing}>
                {importing ? 'מייבא…' : images.length ? `ייבא ${images.length.toLocaleString('en-US')} תמונות` : 'ייבא את התיקייה'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
