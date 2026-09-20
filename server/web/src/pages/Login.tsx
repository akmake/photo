import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Nav } from '../components';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api.login(email, password);
      await signIn(r.token);
      nav('/portal');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Nav />
      <div className="authpage">
        <div className="authcard">
          <h1>כניסה</h1>
          <p className="muted">שמחים לראות אותך שוב.</p>
          {err && <div className="error">{err}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label>אימייל</label>
              <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>סיסמה</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
              {busy ? 'נכנס…' : 'כניסה'}
            </button>
          </form>
          <div className="divider">או</div>
          <button className="google-btn" onClick={() => { window.location.href = '/api/auth/google/login'; }}>
            <GoogleIcon /> המשך עם גוגל
          </button>
          <div className="switchline">
            עדיין אין חשבון? <Link to="/register">להרשמה</Link>
          </div>
        </div>
      </div>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-4 6.7-9.9 6.7-17.4z" />
      <path fill="#FBBC05" d="M10.4 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6.1C1 15.8 0 19.8 0 24s1 8.2 2.6 11.4l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.3-5.7c-2 1.4-4.6 2.2-7.9 2.2-6.4 0-11.8-4.1-13.7-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
