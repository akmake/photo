import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import './license-gate.css';

type DesktopBridge = { desktop?: boolean; dev?: boolean; engineOrigin?: string };
type State = { ok: boolean; mode?: string; error?: string; expires_at?: number };

const bridge = (window as Window & { teza?: DesktopBridge }).teza;
const origin = bridge?.engineOrigin || 'http://127.0.0.1:8756';

export default function LicenseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [register, setRegister] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    try {
      const response = await fetch(`${origin}/license/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error('המנוע המקומי אינו זמין');
      setState(await response.json() as State);
    } catch {
      setState({ ok: false, error: 'המנוע המקומי אינו זמין. נסה שוב בעוד רגע.' });
    }
  }, []);

  useEffect(() => {
    if (!bridge?.desktop || bridge.dev) return;
    void check();
    const timer = window.setInterval(() => { void check(); }, 60_000);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [check]);

  if (!bridge?.desktop || bridge.dev) return <>{children}</>;
  if (state?.ok) return <>{children}</>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${origin}/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, register }),
      });
      const answer = await response.json();
      if (!response.ok || !answer.ok) throw new Error(answer.error || 'ההפעלה לא הושלמה');
      setState(answer as State);
      setPassword('');
    } catch (cause) {
      setError(cause instanceof TypeError ? 'לא ניתן להתחבר למנוע המקומי. נסה שוב בעוד רגע.'
        : cause instanceof Error ? cause.message : 'ההפעלה לא הושלמה');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tz-license-screen" dir="rtl">
      <section className="tz-license-card" aria-labelledby="tz-license-title">
        <div className="tz-license-mark">T</div>
        <p className="tz-license-eyebrow">TEZA STUDIO</p>
        <h1 id="tz-license-title">{state === null ? 'בודקים את הרישיון…' : 'הפעלת התוכנה'}</h1>
        {state === null ? <p>עוד רגע ואפשר להתחיל.</p> : <>
          <p className="tz-license-desc">
            {state.error || 'תקופת הניסיון מסתיימת 30 יום מההפעלה הראשונה.'}
          </p>
          <div className="tz-license-switch" role="group" aria-label="סוג ההפעלה">
            <button type="button" className={register ? 'selected' : ''} onClick={() => setRegister(true)}>חשבון חדש</button>
            <button type="button" className={!register ? 'selected' : ''} onClick={() => setRegister(false)}>יש לי חשבון</button>
          </div>
          <form onSubmit={submit}>
            {register && <label>שם<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>}
            <label>כתובת מייל<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label>סיסמה<input type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={e => setPassword(e.target.value)} /></label>
            {error && <p className="tz-license-error" role="alert">{error}</p>}
            <button className="tz-license-submit" type="submit" disabled={busy}>{busy ? 'מפעילים…' : 'הפעל את TEZA'}</button>
          </form>
          <button className="tz-license-retry" type="button" onClick={() => void check()}>בדוק רישיון שוב</button>
          <small>הפעלה ראשונה דורשת חיבור לאינטרנט. התמונות המקוריות נשארות במחשב שלך.</small>
        </>}
      </section>
    </main>
  );
}
