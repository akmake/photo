/* The gallery the couple opens.
 *
 * One screen, one decision, repeated: do we want this frame. Everything else on
 * it — the counters, the chips, the lock — exists to keep that decision honest
 * against what was actually sold to them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import type { Album, Item, Manifest } from './api';
import Grid from './Grid';
import Lightbox from './Lightbox';
import './gallery.css';

type Phase = 'loading' | 'login' | 'ready' | 'dead';

export default function App() {
  const slug = useMemo(() => api.slugFromUrl(), []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [token, setToken] = useState(() => api.savedToken(slug));
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [fatal, setFatal] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const noticeTimer = useRef<number>();

  const say = useCallback((message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 3500);
  }, []);

  const load = useCallback(
    async (withToken: string) => {
      try {
        setManifest(await api.manifest(slug, withToken));
        setPhase('ready');
      } catch (e) {
        const err = e as api.ApiError;
        if (err.status === 401) {
          api.clearToken(slug);
          setToken('');
          setPhase('login');
          return;
        }
        /* Anything else is NOT an empty gallery. A gallery that could not be
         * read has to say so — showing nothing would be a lie the client acts
         * on, and they would tell the photographer the photos are missing. */
        setFatal(err.message || 'לא ניתן לטעון את הגלריה');
        setPhase('dead');
      }
    },
    [slug],
  );

  useEffect(() => {
    if (!slug) {
      setFatal('הקישור אינו שלם. בקשו מהצלם את הקישור המלא.');
      setPhase('dead');
      return;
    }
    if (token) void load(token);
    else setPhase('login');
  }, [slug, token, load]);

  const albums = manifest?.gallery.albums ?? [];
  const items = manifest?.items ?? [];
  const locked = manifest?.gallery.locked ?? false;

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    albums.forEach((a) => (out[a.id] = 0));
    items.forEach((i) => i.albumIds.forEach((id) => { if (id in out) out[id]++; }));
    return out;
  }, [albums, items]);

  const chosen = useMemo(
    () => items.filter((i) => i.albumIds.length).length,
    [items],
  );

  const patch = useCallback((itemId: string, albumIds: string[]) => {
    setManifest((m) =>
      m
        ? { ...m, items: m.items.map((i) => (i.id === itemId ? { ...i, albumIds } : i)) }
        : m,
    );
  }, []);

  /* Optimistic, and it has to be: a heart that waits for a round trip before it
   * fills reads as a gallery that did not register the tap, and the client taps
   * again. The server is still the authority — a refusal puts it straight back
   * and says why. */
  const choose = useCallback(
    async (item: Item, albumIds: string[]) => {
      if (locked) return;
      const before = item.albumIds;
      patch(item.id, albumIds);
      try {
        await api.select(slug, token, item.id, albumIds);
      } catch (e) {
        patch(item.id, before);
        const err = e as api.ApiError;
        const body = err.body as api.AlbumFull | null;
        if (body && body.error === 'album_full') {
          say(`"${body.name}" מלא (${body.quota}). הסירו תמונה אחרת כדי להוסיף.`);
        } else {
          say(err.message);
        }
      }
    },
    [locked, patch, slug, token, say],
  );

  const toggleHeart = useCallback(
    (item: Item) =>
      choose(item, item.albumIds.length ? [] : albums.map((a) => a.id)),
    [albums, choose],
  );

  const rename = useCallback(
    async (album: Album, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === album.name) return;
      const before = albums;
      setManifest((m) =>
        m
          ? {
              ...m,
              gallery: {
                ...m.gallery,
                albums: m.gallery.albums.map((a) =>
                  a.id === album.id ? { ...a, name: trimmed } : a,
                ),
              },
            }
          : m,
      );
      try {
        await api.renameAlbum(slug, token, album.id, trimmed);
      } catch (e) {
        setManifest((m) => (m ? { ...m, gallery: { ...m.gallery, albums: before } } : m));
        say((e as api.ApiError).message);
      }
    },
    [albums, slug, token, say],
  );

  const finish = useCallback(async () => {
    try {
      await api.lock(slug, token);
      setManifest((m) => (m ? { ...m, gallery: { ...m.gallery, locked: true } } : m));
      setAsking(false);
      setOpen(null);
    } catch (e) {
      say((e as api.ApiError).message);
    }
  }, [slug, token, say]);

  if (phase === 'loading') return <Splash>טוען…</Splash>;
  if (phase === 'dead') return <Splash tone="bad">{fatal}</Splash>;
  if (phase === 'login')
    return (
      <Login
        slug={slug}
        onIn={(t) => {
          api.saveToken(slug, t);
          setToken(t);
          setPhase('loading');
        }}
      />
    );

  return (
    <div className="gal">
      <header className="gal-head">
        <div className="gal-title">
          <h1>{manifest?.gallery.name}</h1>
          <span className="gal-sub">
            {locked ? 'הבחירה נשלחה לצלם' : `${chosen} נבחרו מתוך ${items.length}`}
          </span>
        </div>
        <div className="gal-meters">
          {albums.map((album) => (
            <Meter
              key={album.id}
              album={album}
              used={counts[album.id] ?? 0}
              locked={locked}
              onRename={(name) => rename(album, name)}
            />
          ))}
        </div>
      </header>

      {notice && <div className="gal-toast">{notice}</div>}

      <Grid items={items} onOpen={setOpen} onToggle={toggleHeart} locked={locked} />

      {!locked && (
        <footer className="gal-foot">
          <button
            className="gal-done"
            type="button"
            disabled={!chosen}
            onClick={() => setAsking(true)}
          >
            סיימנו לבחור
          </button>
        </footer>
      )}

      {open !== null && (
        <Lightbox
          items={items}
          index={open}
          albums={albums}
          locked={locked}
          notice={notice}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onSelect={choose}
        />
      )}

      {asking && (
        <div className="gal-ask" role="dialog" aria-modal="true">
          <div className="gal-ask-card">
            <h2>לסיים את הבחירה?</h2>
            <p>
              בחרתם {chosen} תמונות. אחרי האישור הצלם מתחיל לעבוד, ושינוי בבחירה
              יעבור דרכו.
            </p>
            <div className="gal-ask-row">
              <button type="button" className="gal-ghost" onClick={() => setAsking(false)}>
                עוד לא
              </button>
              <button type="button" className="gal-done" onClick={finish}>
                כן, סיימנו
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Meter({
  album,
  used,
  locked,
  onRename,
}: {
  album: Album;
  used: number;
  locked: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const full = used >= album.quota;
  return (
    <div className={`gal-meter${full ? ' is-full' : ''}`}>
      {editing ? (
        <input
          className="gal-meter-input"
          defaultValue={album.name}
          autoFocus
          maxLength={60}
          onBlur={(e) => {
            onRename(e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="gal-meter-name"
          disabled={locked}
          title="שנו את השם כרצונכם"
          onClick={() => setEditing(true)}
        >
          {album.name}
        </button>
      )}
      <span className="gal-meter-count">
        {used}<i>/</i>{album.quota}
      </span>
    </div>
  );
}

function Login({ slug, onIn }: { slug: string; onIn: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api.login(slug, username.trim(), password.trim());
      onIn(token);
    } catch (err) {
      setError((err as api.ApiError).message);
      setBusy(false);
    }
  };

  return (
    <div className="gal-gate">
      <form className="gal-gate-card" onSubmit={submit}>
        <h1>הגלריה שלכם</h1>
        <p>הזינו את שם המשתמש והסיסמה שקיבלתם מהצלם.</p>
        <label>
          שם משתמש
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            dir="ltr"
          />
        </label>
        <label>
          סיסמה
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            dir="ltr"
          />
        </label>
        {error && <p className="gal-error">{error}</p>}
        <button type="submit" className="gal-done" disabled={busy}>
          {busy ? 'רגע…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}

function Splash({ children, tone }: { children: React.ReactNode; tone?: 'bad' }) {
  return (
    <div className="gal-gate">
      <p className={tone === 'bad' ? 'gal-splash gal-error' : 'gal-splash'}>{children}</p>
    </div>
  );
}
