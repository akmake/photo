import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project } from '../../studio/store';
import {
  galleryCredentials,
  galleryDelete,
  galleryPublishVersion,
  galleryResolve,
  gallerySetStatus,
  getBrand,
  setBrand,
  clearBrand,
  galleryUnlock,
  createGallery,
} from '../../api';
import {
  framesOf,
  framesInBatch,
  setGalleryLink,
  useBatches,
  useProjectFiles,
} from '../../studio/store';
import type { Frame } from '../../api';
import { publishAll, unlinkGallery, useGalleryWatch, type PublishProgress } from '../../studio/galleryLink';
import {
  TzIconSend,
  TzIconCopy,
  TzIconWhatsApp,
  TzIconPlus,
  TzIconMinus,
  TzIconTrash,
  TzIconLock,
  TzIconUnlock,
  TzIconCheckCircle,
  TzIconUpload,
  TzIconLayers,
  TzIconExternal,
  TzIconRefresh,
} from '../TzIcons';
import './stages-v2.css';
import './send-to-client-v2.css';

const ENGINE = 'http://127.0.0.1:8756';

interface DraftAlbum {
  name: string;
  quota: number;
}

const DEFAULT_ALBUMS: DraftAlbum[] = [
  { name: 'האלבום הראשי (הזוג)', quota: 80 },
  { name: 'אלבום הורי החתן', quota: 40 },
  { name: 'אלבום הורי הכלה', quota: 40 },
];

export default function SendToClientV2({
  project,
  onNext,
  onBack,
}: {
  project: Project;
  onNext?: () => void;
  onBack?: () => void;
}) {
  const { frames, ready } = useProjectFiles(project.id);
  const watch = useGalleryWatch(project.id);
  const { link, state } = watch;

  return (
    <div className="tz-stage-container">
      {/* Top Stage Header */}
      <section className="tz-stage-header">
        <div className="tz-stage-header-copy">
          <div className="tz-stage-tag">שלב 3 · שלח ללקוח</div>
          <h1>גלריית בחירה אישית ללקוח</h1>
          <p>
            יצירת קישור מעוצב ומאובטח עבור <strong>{project.client}</strong>. הלקוחה מסמנת את התמונות לאלבומים השונים ומעירה הערות ישירות מהנייד או המחשב,
            והבחירה מסתנכרנת ישירות לכאן.
          </p>
        </div>

        <div className="tz-stage-actions">
          {onBack && (
            <button
              className="tz-btn-projects-secondary"
              type="button"
              onClick={onBack}
            >
              ← חזרה למקבצים
            </button>
          )}
          {onNext && (
            <button
              className="tz-btn-projects-primary"
              type="button"
              onClick={onNext}
            >
              המשך לעריכה ←
            </button>
          )}
        </div>
      </section>

      {!ready ? (
        <div className="tz-sc-card">
          <p style={{ margin: 0, color: '#71717a' }}>טוען את נתוני הפרויקט והקבצים...</p>
        </div>
      ) : !link ? (
        <CreateGalleryFlow
          projectId={project.id}
          clientName={project.client}
          frames={frames}
        />
      ) : (
        <LiveGalleryFlow
          projectId={project.id}
          clientName={project.client}
          watch={watch}
          state={state}
          link={link}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   BEFORE GALLERY CREATED (STEP-BY-STEP PUBLISH)
   ========================================================================== */

function CreateGalleryFlow({
  projectId,
  clientName,
  frames,
}: {
  projectId: string;
  clientName: string;
  frames: Frame[];
}) {
  const batches = useBatches(projectId);
  const [source, setSource] = useState<string>('all');
  const [albums, setAlbums] = useState<DraftAlbum[]>(DEFAULT_ALBUMS);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);

  const chosenFrames = useMemo(
    () => (source === 'all' ? frames : framesInBatch(projectId, source)),
    [source, frames, projectId],
  );

  const totalQuota = useMemo(
    () => albums.reduce((acc, a) => acc + (a.quota || 0), 0),
    [albums],
  );

  const handleCreate = useCallback(async () => {
    setError(null);
    const clean = albums
      .map((a) => ({ name: a.name.trim(), quota: Math.max(1, a.quota | 0) }))
      .filter((a) => a.name);

    if (!clean.length) return setError('יש להגדיר לפחות אלבום אחד לבחירה');
    if (!chosenFrames.length) return setError('אין תמונות זמינות לפרסום במקור שנבחר');

    try {
      const made = await createGallery(projectId, clientName || 'גלריה', clean);
      setGalleryLink(projectId, {
        galleryId: made.id,
        slug: made.slug,
        username: made.username,
        createdAt: Date.now(),
        published: 0,
      });
      setOneTimePassword(made.password);

      const out = await publishAll(
        made.id,
        chosenFrames.map((f) => ({ path: f.path, name: f.name })),
        setProgress,
      );

      setGalleryLink(projectId, {
        galleryId: made.id,
        slug: made.slug,
        username: made.username,
        createdAt: Date.now(),
        published: out.done,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'יצירת הגלריה נכשלה');
    }
  }, [albums, chosenFrames, clientName, projectId]);

  if (progress) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="tz-sc-progress-card">
        <div className="tz-sc-card-header">
          <div className="tz-sc-card-title-wrap">
            <h3 className="tz-sc-card-title">
              <TzIconUpload size={20} />
              מפרסם תמונות לגלריית הלקוחה
            </h3>
            <p className="tz-sc-card-desc">
              התמונות מומרות לתצוגה קלה ומאובטחת ועולות לשרת הגלריה...
            </p>
          </div>
          <span className="tz-sc-status-pill active">{pct}% הושלמו</span>
        </div>

        <div className="tz-sc-progress-bar-bg">
          <div className="tz-sc-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="tz-sc-progress-meta">
          <span>
            הועלו {progress.done} מתוך {progress.total} תמונות
          </span>
          {oneTimePassword && (
            <span>
              סיסמת גישה שנוצרה: <strong>{oneTimePassword}</strong>
            </span>
          )}
        </div>

        {progress.failed.length > 0 && (
          <div style={{ background: '#fef2f2', padding: 12, borderRadius: 10, color: '#ef4444', fontSize: 13 }}>
            {progress.failed.length} תמונות לא עלו. בדוק את חיבור הרשת.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tz-sc-container">
      <div className="tz-sc-grid-2col">
        {/* Left Column: Source & Albums */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Card 1: Source */}
          <div className="tz-sc-card">
            <div className="tz-sc-card-header">
              <div className="tz-sc-card-title-wrap">
                <h3 className="tz-sc-card-title">
                  <TzIconLayers size={18} />
                  מקור התמונות לגלריה
                </h3>
                <p className="tz-sc-card-desc">
                  בחר אילו תמונות יפורסמו לבחירת הלקוח. המקור נשאר שמור אצלך, לגלריה עולות רק גרסאות תצוגה מוגנות.
                </p>
              </div>
            </div>

            <div className="tz-sc-source-pills">
              <button
                type="button"
                className={`tz-sc-source-pill ${source === 'all' ? 'active' : ''}`}
                onClick={() => setSource('all')}
              >
                כל תמונות הפרויקט
                <span className="tz-sc-pill-badge">{frames.length}</span>
              </button>

              {batches.map((b) => {
                const count = framesInBatch(projectId, b.id).length;
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`tz-sc-source-pill ${source === b.id ? 'active' : ''}`}
                    onClick={() => setSource(b.id)}
                  >
                    {b.name}
                    <span className="tz-sc-pill-badge">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Card 2: Albums & Quotas */}
          <div className="tz-sc-card">
            <div className="tz-sc-card-header">
              <div className="tz-sc-card-title-wrap">
                <h3 className="tz-sc-card-title">
                  <TzIconSend size={18} />
                  הגדרת מכסות אלבומים
                </h3>
                <p className="tz-sc-card-desc">
                  הכמויות שסוכמו עם הלקוח. המערכת תאכוף את המכסה ותאפשר ללקוח לבחור תמונות לכל אלבום בנפרד.
                </p>
              </div>
            </div>

            <div className="tz-sc-albums-list">
              {albums.map((album, i) => (
                <div key={i} className="tz-sc-album-row">
                  <input
                    type="text"
                    className="tz-sc-album-name-input"
                    value={album.name}
                    placeholder="שם האלבום (לדוגמה: הזוג)"
                    onChange={(e) =>
                      setAlbums((list) =>
                        list.map((a, n) => (n === i ? { ...a, name: e.target.value } : a)),
                      )
                    }
                  />

                  <div className="tz-sc-stepper">
                    <button
                      type="button"
                      className="tz-sc-step-btn"
                      onClick={() =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: Math.max(1, (a.quota || 0) - 5) } : a,
                          ),
                        )
                      }
                    >
                      <TzIconMinus size={14} />
                    </button>

                    <input
                      type="number"
                      min={1}
                      className="tz-sc-step-val"
                      value={album.quota}
                      onChange={(e) =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: Number(e.target.value) || 0 } : a,
                          ),
                        )
                      }
                    />
                    <span className="tz-sc-step-label">תמונות</span>

                    <button
                      type="button"
                      className="tz-sc-step-btn"
                      onClick={() =>
                        setAlbums((list) =>
                          list.map((a, n) =>
                            n === i ? { ...a, quota: (a.quota || 0) + 5 } : a,
                          ),
                        )
                      }
                    >
                      <TzIconPlus size={14} />
                    </button>
                  </div>

                  <button
                    type="button"
                    className="tz-sc-del-btn"
                    title="הסר אלבום"
                    onClick={() => setAlbums((list) => list.filter((_, n) => n !== i))}
                  >
                    <TzIconTrash size={15} />
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="tz-sc-add-album-btn"
                onClick={() => setAlbums((l) => [...l, { name: '', quota: 40 }])}
              >
                <TzIconPlus size={15} />
                הוסף אלבום נוסף לבחירה
              </button>
            </div>

            <div className="tz-sc-quota-summary">
              <span>סה״כ מכסת בחירה ללקוח:</span>
              <strong>{totalQuota} תמונות ב-{albums.length} אלבומים</strong>
            </div>

            {error && (
              <div style={{ background: '#fef2f2', padding: 12, borderRadius: 10, color: '#ef4444', fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="button"
              className="tz-sc-publish-btn"
              onClick={handleCreate}
              disabled={!chosenFrames.length}
            >
              <TzIconSend size={18} />
              צור גלריה ופרסם {chosenFrames.length} תמונות ל{clientName}
            </button>
          </div>
        </div>

        {/* Right Column: Studio Brand */}
        <div>
          <StudioBrandCard />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   LIVE GALLERY FLOW (ONCE PUBLISHED)
   ========================================================================== */

function LiveGalleryFlow({
  projectId,
  clientName,
  watch,
  state,
  link,
}: {
  projectId: string;
  clientName: string;
  watch: ReturnType<typeof useGalleryWatch>;
  state: ReturnType<typeof useGalleryWatch>['state'];
  link: NonNullable<ReturnType<typeof useGalleryWatch>['link']>;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = `${location.origin}/gallery.html?g=${link.slug}`;

  const copyLink = () => {
    const text = `היי ${clientName}, הגלריה שלכם מוכנה לצפייה ובחירת תמונות!\n${url}\nשם משתמש: ${link.username}`;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    });
  };

  const whatsappMessage = encodeURIComponent(
    `היי ${clientName}, שמחים לעדכן שהתמונות שלכם מוכנות לבחירה לאלבומים! 📸✨\n\nקישור ישיר לגלריה:\n${url}\n\nשם משתמש: ${link.username}\n\nבחירה מהנה!`,
  );
  const whatsappUrl = `https://api.whatsapp.com/send?text=${whatsappMessage}`;

  const reissue = async () => {
    setBusy(true);
    try {
      const out = await galleryCredentials(link.galleryId);
      setGalleryLink(projectId, { ...link, username: out.username });
      setPassword(out.password);
    } finally {
      setBusy(false);
    }
  };

  const removeGallery = async () => {
    if (!confirm('האם למחוק את הגלריה? הקישור של הלקוח יפסיק לעבוד והתמונות יוסרו משרת התצוגה.'))
      return;
    setBusy(true);
    try {
      await galleryDelete(link.galleryId);
      unlinkGallery(projectId);
    } finally {
      setBusy(false);
    }
  };

  const status = state?.gallery.status ?? 'active';
  const isLocked = Boolean(state?.gallery.lockedAt);
  const isImported = Boolean(link.importedAt);

  return (
    <div className="tz-sc-container">
      {/* Live Header Bar */}
      <div className="tz-sc-live-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {status === 'frozen' ? (
            <span className="tz-sc-status-pill frozen">הגלריה מוקפאת — הקישור אינו זמין</span>
          ) : isImported ? (
            <span className="tz-sc-status-pill active">
              <span className="tz-sc-pulse-dot" />
              הבחירה הושלמה ויובאה לפרויקט
            </span>
          ) : isLocked ? (
            <span className="tz-sc-status-pill locked">
              <span className="tz-sc-pulse-dot" />
              הלקוח סיים לבחור (נעול)
            </span>
          ) : (
            <span className="tz-sc-status-pill active">
              <span className="tz-sc-pulse-dot" />
              הגלריה באוויר וממתינה לבחירת הלקוח
            </span>
          )}
        </div>

        <div className="tz-sc-live-actions">
          {status === 'active' ? (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              disabled={busy}
              onClick={() => void gallerySetStatus(link.galleryId, 'frozen').then(watch.refresh)}
            >
              <TzIconLock size={14} />
              הקפא גישה
            </button>
          ) : (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              disabled={busy}
              onClick={() => void gallerySetStatus(link.galleryId, 'active').then(watch.refresh)}
            >
              <TzIconUnlock size={14} />
              החזר גישה
            </button>
          )}

          {isLocked && (
            <button
              type="button"
              className="tz-sc-subtle-btn"
              disabled={busy}
              onClick={() => void galleryUnlock(link.galleryId).then(watch.refresh)}
            >
              <TzIconUnlock size={14} />
              פתח בחירה מחדש
            </button>
          )}

          <button
            type="button"
            className="tz-sc-subtle-btn danger"
            disabled={busy}
            onClick={removeGallery}
          >
            <TzIconTrash size={14} />
            מחק גלריה
          </button>
        </div>
      </div>

      <div className="tz-sc-grid-2col">
        {/* Left Column: Share Card & Meters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Card 1: Direct Share & WhatsApp (Matching TEZA AI Reference) */}
          <div className="tz-sc-share-card">
            <div className="tz-sc-card-header">
              <div className="tz-sc-card-title-wrap">
                <h3 className="tz-sc-card-title">קישור ישיר לגלריה</h3>
                <p className="tz-sc-card-desc">
                  שתף את הגלריה בלחיצה אחת ישירות לוואטסאפ של {clientName} או העתק את הקישור.
                </p>
              </div>
            </div>

            <div className="tz-sc-link-row">
              <span className="tz-sc-url-text">{url}</span>
              <button
                type="button"
                className={`tz-sc-copy-btn ${copied ? 'copied' : ''}`}
                onClick={copyLink}
              >
                {copied ? <TzIconCheckCircle size={15} /> : <TzIconCopy size={15} />}
                {copied ? 'הועתק!' : 'העתק קישור'}
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="tz-sc-subtle-btn"
                title="פתח גלריה בחלון חדש"
              >
                <TzIconExternal size={14} />
              </a>
            </div>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="tz-sc-whatsapp-btn"
            >
              <TzIconWhatsApp size={20} />
              שלח קישור ישיר בוואטסאפ ל{clientName}
            </a>

            <div className="tz-sc-creds-row">
              <div className="tz-sc-creds-values">
                <span>משתמש: <code>{link.username}</code></span>
                {password && <span>סיסמה: <code>{password}</code></span>}
              </div>
              <button
                type="button"
                className="tz-sc-subtle-btn"
                disabled={busy}
                onClick={reissue}
              >
                <TzIconRefresh size={13} />
                הנפק פרטים מחדש
              </button>
            </div>
          </div>

          {/* Card 2: Live Album Selection Progress */}
          {state && state.gallery.albums.length > 0 && (
            <div className="tz-sc-card">
              <div className="tz-sc-card-header">
                <div className="tz-sc-card-title-wrap">
                  <h3 className="tz-sc-card-title">התקדמות בחירת האלבומים</h3>
                  <p className="tz-sc-card-desc">
                    מעקב חי אחר כמות התמונות שסומנו על ידי הלקוחה בכל אלבום.
                  </p>
                </div>
              </div>

              <div className="tz-sc-meters-grid">
                {state.gallery.albums.map((album) => {
                  const used = state.counts[album.id] ?? 0;
                  const isFull = used >= album.quota;
                  const pct = Math.min(100, Math.round((used / album.quota) * 100));

                  return (
                    <div key={album.id} className={`tz-sc-meter-card ${isFull ? 'full' : ''}`}>
                      <div className="tz-sc-meter-top">
                        <span>{album.name}</span>
                        <span className="tz-sc-meter-counts">
                          {used} / {album.quota}
                        </span>
                      </div>
                      <div className="tz-sc-meter-bar">
                        <div className="tz-sc-meter-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Card 3: Client Selections Imported */}
          {link.importedAt && (
            <div className="tz-sc-imported-card">
              <div className="tz-sc-imported-copy">
                <TzIconCheckCircle size={22} />
                <span>
                  הבחירה נכנסה בהצלחה לפרויקט כמקבץ <strong>בחירת הלקוח</strong>!
                </span>
              </div>
            </div>
          )}

          {/* Card 4: Client Feedback / Pinpoint Notes Queue */}
          {state && isLocked && (
            <ClientFeedbackQueue
              projectId={projectId}
              state={state}
              link={link}
            />
          )}
        </div>

        {/* Right Column: Studio Brand Preview */}
        <div>
          <StudioBrandCard />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   CLIENT COMMENTS & PINPOINTS QUEUE
   ========================================================================== */

function ClientFeedbackQueue({
  projectId,
  state,
  link,
}: {
  projectId: string;
  state: NonNullable<ReturnType<typeof useGalleryWatch>['state']>;
  link: NonNullable<ReturnType<typeof useGalleryWatch>['link']>;
}) {
  const frames = framesOf(projectId);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const openComments = state.comments.filter((c) => !c.resolvedAt && !done[c.id]);

  if (!state.comments.length) return null;

  return (
    <div className="tz-sc-comments-card">
      <div className="tz-sc-card-header">
        <div className="tz-sc-card-title-wrap">
          <h3 className="tz-sc-card-title">
            הערות ובקשות מיוחדות מהלקוח
            <span className="tz-sc-pill-badge">{openComments.length} פתוחות</span>
          </h3>
          <p className="tz-sc-card-desc">
            הלקוחה סימנה נקודות ספציפיות על התמונות וצירפה הערות לעריכה.
          </p>
        </div>
      </div>

      <div className="tz-sc-comments-list">
        {state.comments.map((comment) => {
          const frame = frames.find((f) => f.name === comment.frameId);
          const resolved = Boolean(comment.resolvedAt) || done[comment.id];

          return (
            <div key={comment.id} className={`tz-sc-comment-row ${resolved ? 'done' : ''}`}>
              <div className="tz-sc-comment-thumb">
                {frame ? (
                  <>
                    <img
                      src={`${ENGINE}/thumb?path=${encodeURIComponent(frame.shown)}&w=160`}
                      alt=""
                    />
                    <i
                      className="tz-sc-pin-dot"
                      style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
                    />
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: '#a1a1aa', padding: 4 }}>לא נמצא</span>
                )}
              </div>

              <div className="tz-sc-comment-content">
                <span className="tz-sc-comment-file">{comment.frameId}</span>
                <p className="tz-sc-comment-text">{comment.text}</p>

                <div className="tz-sc-comment-actions">
                  {!resolved && (
                    <button
                      type="button"
                      className="tz-sc-subtle-btn"
                      disabled={busy === comment.id}
                      onClick={async () => {
                        setBusy(comment.id);
                        try {
                          await galleryResolve(link.galleryId, comment.id);
                          setDone((d) => ({ ...d, [comment.id]: true }));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      סמן שטופל ✓
                    </button>
                  )}

                  {frame?.edited && (
                    <button
                      type="button"
                      className="tz-sc-subtle-btn"
                      style={{ color: 'var(--tz-brand)' }}
                      disabled={busy === comment.id}
                      onClick={async () => {
                        const itemId = state.selection.find(
                          (s) => s.frameId === comment.frameId,
                        )?.itemId;
                        if (!itemId) return;
                        setBusy(comment.id);
                        try {
                          await galleryPublishVersion(link.galleryId, itemId, frame.shown);
                          await galleryResolve(link.galleryId, comment.id);
                          setDone((d) => ({ ...d, [comment.id]: true }));
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      שלח גרסה מעודכנת ללקוח
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ==========================================================================
   STUDIO BRAND CARD
   ========================================================================== */

function StudioBrandCard() {
  const [logo, setLogo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBrand()
      .then((b) => setLogo(b.logo))
      .catch(() => setError('לא ניתן לקרוא את הלוגו'))
      .finally(() => setLoaded(true));
  }, []);

  const handlePickLogo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
        fr.readAsDataURL(file);
      });
      const out = await setBrand(data, file.name);
      setLogo(out.logo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'העלאת הלוגו נכשלה');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  return (
    <div className="tz-sc-card">
      <div className="tz-sc-card-header">
        <div className="tz-sc-card-title-wrap">
          <h3 className="tz-sc-card-title">מיתוג ולוגו הסטודיו</h3>
          <p className="tz-sc-card-desc">
            הלוגו שלך מופיע בכניסה ובראש הגלריה של הלקוח, מעניק מראה יוקרתי ומקצועי.
          </p>
        </div>
      </div>

      <div className="tz-sc-brand-grid">
        <div className="tz-sc-swatches">
          <div className="tz-sc-swatch light" title="תצוגה על רקע בהיר">
            {logo ? <img src={logo} alt="לוגו בהיר" /> : <span className="tz-sc-swatch-empty">רקע בהיר</span>}
          </div>
          <div className="tz-sc-swatch dark" title="תצוגה על רקע כהה">
            {logo ? <img src={logo} alt="לוגו כהה" /> : <span className="tz-sc-swatch-empty">רקע כהה</span>}
          </div>
        </div>

        <div className="tz-sc-brand-actions">
          <label className="tz-sc-upload-label">
            <TzIconUpload size={15} />
            {busy ? 'מעלה לוגו...' : logo ? 'החלף לוגו' : 'העלה לוגו סטודיו'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={busy}
              onChange={(e) => void handlePickLogo(e.target.files?.[0])}
            />
          </label>

          {logo && (
            <button
              type="button"
              className="tz-sc-remove-brand-btn"
              disabled={busy}
              onClick={() => void clearBrand().then(() => setLogo(null))}
            >
              הסר
            </button>
          )}
        </div>

        <p className="tz-sc-brand-tip">
          מומלץ להעלות קובץ PNG עם רקע שקוף. כך הלוגו ייראה חד ומדויק על כל רקע ומכשיר.
        </p>

        {error && (
          <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>
        )}
      </div>
    </div>
  );
}
