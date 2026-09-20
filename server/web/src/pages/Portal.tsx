import { useEffect, useState } from 'react';
import { Nav, Footer } from '../components';
import { api } from '../api';
import { useAuth } from '../auth';

type Status = { plan: string | null; status: string; current_period_end: string | null; is_current: boolean };
type Gallery = { id: number; title: string; client_name: string; token: string; status: string; images: number };

export default function Portal() {
  const { me } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [devices, setDevices] = useState<{ max_devices: number; devices: { device_id: string; name: string; last_seen: string }[] }>();
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    const [s, d, g] = await Promise.all([api.billingStatus(), api.devices(), api.galleries()]);
    setStatus(s);
    setDevices(d);
    setGalleries(g.galleries);
  }
  useEffect(() => { load().catch(() => {}); }, []);

  async function subscribe() {
    setBusy(true);
    try { await api.subscribe('monthly'); await load(); }
    finally { setBusy(false); }
  }

  const active = status?.is_current;

  return (
    <>
      <Nav />
      <div className="wrap portal">
        <div className="portal-head">
          <div>
            <h1>שלום, {me?.name || me?.email} 👋</h1>
            <p style={{ color: 'var(--ink-soft)', margin: '6px 0 0' }}>האזור האישי שלך — מנוי, מכשירים וגלריות.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>+ גלריה חדשה</button>
        </div>

        {/* status cards */}
        <div className="cards">
          <div className="pcard">
            <div className="k">מצב מנוי</div>
            <div className="v">
              {active
                ? <span className="badge ok">פעיל</span>
                : <span className="badge off">לא פעיל</span>}
            </div>
            {status?.current_period_end && (
              <div style={{ color: 'var(--ink-faint)', fontSize: 14, marginTop: 8 }}>
                בתוקף עד {new Date(status.current_period_end).toLocaleDateString('he-IL')}
              </div>
            )}
            {!active && (
              <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={subscribe} disabled={busy}>
                {busy ? 'מפעיל…' : 'הפעלת מנוי'}
              </button>
            )}
          </div>

          <div className="pcard">
            <div className="k">מכשירים</div>
            <div className="v">{devices?.devices.length ?? 0}<span style={{ fontSize: 16, color: 'var(--ink-faint)' }}> / {devices?.max_devices ?? 2}</span></div>
            <div style={{ color: 'var(--ink-faint)', fontSize: 14, marginTop: 8 }}>
              {devices && devices.devices.length > 0
                ? devices.devices.map((d) => d.name || d.device_id).join(', ')
                : 'עדיין לא הופעל מחשב'}
            </div>
          </div>

          <div className="pcard">
            <div className="k">גלריות</div>
            <div className="v">{galleries.length}</div>
            <div style={{ color: 'var(--ink-faint)', fontSize: 14, marginTop: 8 }}>
              {galleries.filter((g) => g.status === 'published').length} פורסמו ללקוחות
            </div>
          </div>
        </div>

        {showNew && <NewGallery onDone={() => { setShowNew(false); load(); }} />}

        <h2 style={{ fontSize: 22, marginTop: 36 }}>הגלריות שלי</h2>
        {galleries.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)' }}>עדיין אין גלריות. צור אחת כדי לשלוח ללקוח.</p>
        ) : (
          <div className="gallery-list">
            {galleries.map((g) => {
              const link = `${window.location.origin}/g/${g.token}`;
              return (
                <div className="gitem" key={g.id}>
                  <div className="top">
                    <h3>{g.title || 'ללא שם'}</h3>
                    <div className="meta">{g.client_name || '—'} · {g.images} תמונות</div>
                  </div>
                  <div className="foot">
                    <span className={`badge ${g.status === 'published' ? 'ok' : 'warn'}`}>
                      {g.status === 'published' ? 'פורסמה' : 'טיוטה'}
                    </span>
                    <button className="btn btn-ghost" style={{ padding: '6px 12px' }}
                      onClick={() => navigator.clipboard?.writeText(link)}>
                      העתק קישור
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </>
  );
}

function NewGallery({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function create() {
    setBusy(true); setErr('');
    try { await api.createGallery(title, client, code || undefined); onDone(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="pcard" style={{ marginTop: 22 }}>
      <h3 style={{ marginBottom: 14 }}>גלריה חדשה</h3>
      {err && <div className="error">{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        <div className="field"><label>שם הגלריה</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="חתונה של דנה ויוסי" /></div>
        <div className="field"><label>שם הלקוח</label><input value={client} onChange={(e) => setClient(e.target.value)} placeholder="דנה" /></div>
        <div className="field"><label>קוד גישה (אופציונלי)</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="1234" /></div>
      </div>
      <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'יוצר…' : 'יצירה'}</button>
      <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginTop: 10 }}>
        התמונות מועלות מתוך התוכנה במחשב (תצוגות בלבד — המקור לא עוזב את הדיסק).
      </p>
    </div>
  );
}
