/* The photographer's side of the client gallery.
 *
 * Lives inside בחירה, because that is what it is: the client's half of the
 * selection. The stage already counted "הלקוח בחר" and already had a button
 * that did nothing — this is what it was waiting for.
 *
 * The whole screen is one loop, and it reads in one direction:
 *
 *   define the albums  →  publish  →  hand over a link  →  the answer comes
 *   back as a batch  →  their notes become a queue  →  corrections go out
 *
 * Nothing here polls faster than the couple decides, and nothing here writes
 * project.json except through the store — see galleryLink.ts for why.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  galleryCredentials,
  galleryDelete,
  galleryPublishVersion,
  galleryResolve,
  gallerySetStatus,
  galleryUnlock,
  createGallery,
} from '../../api';
import { framesOf, setGalleryLink, updateProject, useBatches, framesInBatch } from '../store';
import { publishAll, unlinkGallery, useGalleryWatch, type PublishProgress } from '../galleryLink';
import { IcCheckCircle, IcLink } from '../../design/Icons';
import './client-gallery.css';

const ENGINE = 'http://127.0.0.1:8756';

interface DraftAlbum {
  name: string;
  quota: number;
}

const DEFAULT_ALBUMS: DraftAlbum[] = [
  { name: 'הזוג', quota: 80 },
  { name: 'הורי החתן', quota: 40 },
  { name: 'הורי הכלה', quota: 40 },
];

export default function ClientGallery({
  projectId,
  clientName,
}: {
  projectId: string;
  clientName: string;
}) {
  const watch = useGalleryWatch(projectId);
  const { link, state } = watch;

  if (!link) {
    return <Create projectId={projectId} clientName={clientName} />;
  }
  return <Live projectId={projectId} watch={watch} state={state} link={link} />;
}

/* ── before there is a gallery ─────────────────────────────────────────── */

function Create({ projectId, clientName }: { projectId: string; clientName: string }) {
  const frames = framesOf(projectId);
  const batches = useBatches(projectId);
  const [source, setSource] = useState<string>('all');
  const [albums, setAlbums] = useState<DraftAlbum[]>(DEFAULT_ALBUMS);
  const [progress, setProgress] = useState<PublishProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);

  const chosen = useMemo(
    () => (source === 'all' ? frames : framesInBatch(projectId, source)),
    [source, frames, projectId],
  );

  const create = useCallback(async () => {
    setError(null);
    const clean = albums
      .map((a) => ({ name: a.name.trim(), quota: Math.max(1, a.quota | 0) }))
      .filter((a) => a.name);
    if (!clean.length) return setError('צריך לפחות אלבום אחד');
    if (!chosen.length) return setError('אין תמונות לפרסם');

    try {
      const made = await createGallery(projectId, clientName || 'גלריה', clean);
      /* Written BEFORE the upload starts. A publish that dies halfway with no
       * link saved leaves a gallery on the server that the studio has no way
       * to find, and no way to delete. */
      setGalleryLink(projectId, {
        galleryId: made.id,
        slug: made.slug,
        username: made.username,
        createdAt: Date.now(),
        published: 0,
      });
      setPassword(made.password);

      const out = await publishAll(
        made.id,
        chosen.map((f) => ({ path: f.path, name: f.name })),
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
      setError(e instanceof Error ? e.message : 'לא ניתן ליצור את הגלריה');
    }
  }, [albums, chosen, clientName, projectId]);

  if (progress) {
    return (
      <div className="cg">
        <h3 className="cg-h">מפרסם לגלריה</h3>
        <Progress progress={progress} />
        {password && (
          <p className="cg-note">
            הסיסמה נוצרה: <code>{password}</code> — היא מוצגת פעם אחת.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="cg">
      <h3 className="cg-h">גלריה ללקוח</h3>
      <p className="cg-lead">
        הלקוח מקבל קישור, בוחר, והבחירה חוזרת לכאן כמקבץ מוכן לעריכה.
        <strong> המקור לא עולה לרשת</strong> — רק גרסת תצוגה.
      </p>

      <label className="cg-field">
        <span>אילו תמונות</span>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">כל התמונות בפרויקט ({frames.length})</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({framesInBatch(projectId, b.id).length})
            </option>
          ))}
        </select>
      </label>

      <div className="cg-albums">
        <span className="cg-field-label">אלבומים וכמות תמונות</span>
        <p className="cg-hint">
          הכמות היא מה שנמכר, והיא נאכפת: לקוח שהגיע לגבול מחליף תמונה או פונה
          אליך. הלקוח יכול לשנות את השם.
        </p>
        {albums.map((album, i) => (
          <div className="cg-album-row" key={i}>
            <input
              value={album.name}
              placeholder="שם האלבום"
              onChange={(e) =>
                setAlbums((list) =>
                  list.map((a, n) => (n === i ? { ...a, name: e.target.value } : a)),
                )
              }
            />
            <input
              type="number"
              min={1}
              value={album.quota}
              onChange={(e) =>
                setAlbums((list) =>
                  list.map((a, n) =>
                    n === i ? { ...a, quota: Number(e.target.value) } : a,
                  ),
                )
              }
            />
            <button
              type="button"
              className="cg-x"
              aria-label="הסר אלבום"
              onClick={() => setAlbums((list) => list.filter((_, n) => n !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          onClick={() => setAlbums((l) => [...l, { name: '', quota: 40 }])}
        >
          + אלבום
        </button>
      </div>

      {error && <p className="cg-error">{error}</p>}

      <div className="stage-actions">
        <button className="btn btn-primary" onClick={create} disabled={!chosen.length}>
          <IcLink size={16} />
          צור גלריה ופרסם {chosen.length} תמונות
        </button>
      </div>
    </div>
  );
}

function Progress({ progress }: { progress: PublishProgress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="cg-progress">
      <div className="cg-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="cg-count">
        {progress.done} / {progress.total}
      </span>
      {progress.failed.length > 0 && (
        <details className="cg-failed">
          <summary>{progress.failed.length} קבצים לא עלו</summary>
          <ul>
            {progress.failed.slice(0, 20).map((f) => (
              <li key={f.name}>
                <code>{f.name}</code> — {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ── once it is live ───────────────────────────────────────────────────── */

function Live({
  projectId,
  watch,
  state,
  link,
}: {
  projectId: string;
  watch: ReturnType<typeof useGalleryWatch>;
  state: ReturnType<typeof useGalleryWatch>['state'];
  link: NonNullable<ReturnType<typeof useGalleryWatch>['link']>;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/gallery.html?g=${link.slug}`;

  const copy = () => {
    void navigator.clipboard
      .writeText(`הגלריה שלכם:\n${url}\nשם משתמש: ${link.username}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
  };

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

  const remove = async () => {
    if (!confirm('למחוק את הגלריה ואת התמונות שהועלו? הקישור של הלקוח יפסיק לעבוד.'))
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
  const locked = Boolean(state?.gallery.lockedAt);

  return (
    <div className="cg">
      <div className="cg-head">
        <h3 className="cg-h">גלריה ללקוח</h3>
        <Status status={status} locked={locked} imported={Boolean(link.importedAt)} />
      </div>

      {watch.status === 'down' && (
        <p className="cg-error">
          לא ניתן להגיע לגלריה כרגע — {watch.fault}. זה לא אומר שאין בחירה, רק
          שלא הצלחנו לקרוא אותה.
        </p>
      )}

      <div className="cg-link">
        <code className="cg-url">{url}</code>
        <div className="cg-creds">
          <span>משתמש: <code>{link.username}</code></span>
          {password && <span>סיסמה: <code>{password}</code></span>}
        </div>
        <div className="cg-link-actions">
          <button className="btn" onClick={copy}>
            {copied ? <IcCheckCircle size={16} /> : <IcLink size={16} />}
            {copied ? 'הועתק' : 'העתק קישור'}
          </button>
          <button className="btn" onClick={reissue} disabled={busy}>
            הנפק פרטים מחדש
          </button>
        </div>
        {!password && (
          <p className="cg-hint">
            הסיסמה מוצגת פעם אחת בלבד. שכחת? הנפק פרטים מחדש — הקודמים יפסיקו
            לעבוד.
          </p>
        )}
      </div>

      {state?.gallery.keptUntil && (
        <p className="cg-error">
          הגלריה מוקפאת. התמונות נשמרות עוד{' '}
          <strong>
            {Math.max(
              0,
              Math.ceil((state.gallery.keptUntil * 1000 - Date.now()) / 86_400_000),
            )}{' '}
            ימים
          </strong>{' '}
          ואז נמחקות. החזרת גישה מבטלת את הספירה.
        </p>
      )}

      {state && <Meters state={state} />}

      {link.importedAt && <Imported projectId={projectId} link={link} />}

      {state && locked && <Queue projectId={projectId} state={state} link={link} />}

      <div className="cg-danger">
        {status === 'active' ? (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void gallerySetStatus(link.galleryId, 'frozen').then(watch.refresh)}
          >
            הקפא גישה
          </button>
        ) : (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void gallerySetStatus(link.galleryId, 'active').then(watch.refresh)}
          >
            החזר גישה
          </button>
        )}
        {locked && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => void galleryUnlock(link.galleryId).then(watch.refresh)}
          >
            פתח את הבחירה מחדש
          </button>
        )}
        <button className="btn cg-delete" onClick={remove} disabled={busy}>
          מחק גלריה
        </button>
      </div>
    </div>
  );
}

function Status({
  status,
  locked,
  imported,
}: {
  status: string;
  locked: boolean;
  imported: boolean;
}) {
  const [tone, label] =
    status === 'frozen'
      ? ['frozen', 'מוקפאת — הקישור לא עובד']
      : imported
        ? ['done', 'הבחירה נכנסה לפרויקט']
        : locked
          ? ['ready', 'הלקוח סיים לבחור']
          : ['wait', 'ממתין לבחירת הלקוח'];
  return <span className={`cg-status is-${tone}`}>{label}</span>;
}

function Meters({ state }: { state: NonNullable<ReturnType<typeof useGalleryWatch>['state']> }) {
  return (
    <div className="cg-meters">
      {state.gallery.albums.map((album) => {
        const used = state.counts[album.id] ?? 0;
        return (
          <div key={album.id} className={`cg-meter${used >= album.quota ? ' is-full' : ''}`}>
            <span className="cg-meter-name">
              {album.name}
              {album.nameSetByClient && <i title="הלקוח שינה את השם"> ✎</i>}
            </span>
            <span className="cg-meter-count">
              {used}<i>/</i>{album.quota}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Imported({
  projectId,
  link,
}: {
  projectId: string;
  link: NonNullable<ReturnType<typeof useGalleryWatch>['link']>;
}) {
  const count = useMemo(
    () => Object.values(link.albums ?? {}).reduce((n, a) => Math.max(n, a.frames.length), 0),
    [link.albums],
  );
  const missing = link.missing ?? [];
  return (
    <div className="cg-imported">
      <p>
        <IcCheckCircle size={16} />
        הבחירה נכנסה כמקבץ <strong>בחירת הלקוח</strong>
        {count ? ` · ${count} תמונות באלבום הגדול` : ''}
      </p>
      {missing.length > 0 && (
        <div className="cg-missing">
          <strong>{missing.length} תמונות שהלקוח בחר אינן בתיקייה.</strong>
          <p className="cg-hint">
            כנראה שונה שמן או הועברו אחרי הפרסום. הן לא נכנסו למקבץ, ולא נמחקו
            משום מקום.
          </p>
          <ul>
            {missing.slice(0, 20).map((name) => (
              <li key={name}><code>{name}</code></li>
            ))}
          </ul>
        </div>
      )}
      <p className="cg-hint">
        השיוך לאלבומים נשמר בפרויקט. תמונה נערכת פעם אחת גם אם היא בשלושה
        אלבומים.
      </p>
      {void projectId}
    </div>
  );
}

/* ── the notes ─────────────────────────────────────────────────────────── */

function Queue({
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

  const open = state.comments.filter((c) => !c.resolvedAt && !done[c.id]);
  if (!state.comments.length) {
    return <p className="cg-hint cg-quiet">אין הערות מהלקוח.</p>;
  }

  return (
    <div className="cg-queue">
      <h4>
        הערות מהלקוח
        <span className="cg-pill">{open.length} פתוחות</span>
      </h4>
      {state.comments.map((comment) => {
        const frame = frames.find((f) => f.name === comment.frameId);
        const resolved = Boolean(comment.resolvedAt) || done[comment.id];
        return (
          <div className={`cg-note-row${resolved ? ' is-done' : ''}`} key={comment.id}>
            <div className="cg-note-thumb">
              {frame ? (
                <>
                  <img
                    src={`${ENGINE}/thumb?path=${encodeURIComponent(frame.shown)}&w=160`}
                    alt=""
                  />
                  {/* The pin, where the client actually touched. Without it
                      "take that out" is a guess, and a guess is another round. */}
                  <i
                    className="cg-pin"
                    style={{ left: `${comment.x * 100}%`, top: `${comment.y * 100}%` }}
                  />
                </>
              ) : (
                <span className="cg-note-gone">הקובץ לא בתיקייה</span>
              )}
            </div>
            <div className="cg-note-body">
              <code className="cg-note-file">{comment.frameId}</code>
              <p>{comment.text}</p>
              <div className="cg-note-actions">
                {!resolved && (
                  <button
                    className="btn"
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
                    סמן שטופל
                  </button>
                )}
                {frame?.edited && (
                  <button
                    className="btn btn-primary"
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
                    שלח גרסה מעודכנת
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Keep the stage's own counter honest once the choice lands. */
export function syncPickedCount(projectId: string, picked: number) {
  updateProject(projectId, { picked });
}
