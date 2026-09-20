import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Nav } from '../components';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Register() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (password.length < 8) { setErr('הסיסמה חייבת להיות באורך 8 תווים לפחות'); return; }
    setBusy(true);
    try {
      const r = await api.register(email, password, name);
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
          <h1>יצירת חשבון</h1>
          <p className="muted">כמה שניות, ומתחילים.</p>
          {err && <div className="error">{err}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label>שם</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>אימייל</label>
              <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>סיסמה</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
              {busy ? 'נרשם…' : 'יצירת חשבון'}
            </button>
          </form>
          <div className="divider">או</div>
          <button className="google-btn" onClick={() => { window.location.href = '/api/auth/google/login'; }}>
            המשך עם גוגל
          </button>
          <div className="switchline">
            כבר יש חשבון? <Link to="/login">לכניסה</Link>
          </div>
        </div>
      </div>
    </>
  );
}
