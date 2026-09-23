import { useEffect, useState, type FormEvent } from 'react';
import './settings.css';

/* Settings. For now it holds one real thing: which website this copy talks to
 * for its license and its updates. Normally nobody touches it — when the domain
 * moves, the app follows by itself (electron/serverOrigin.cjs). The field is
 * for a photographer who did not open TEZA while the old domain was still up. */

type Server = { origin: string; installed: string | null } | null;
type Answer = { ok: true; origin: string } | { ok: false; error: string };
type SettingsBridge = {
  getServer?: () => Promise<Server>;
  setServer?: (origin: string) => Promise<Answer>;
};

const bridge = (window as Window & { teza?: SettingsBridge }).teza;

function ServerAddress() {
  const [server, setServer] = useState<Server>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void bridge?.getServer?.().then(s => { setServer(s); if (s) setValue(s.origin); });
  }, []);

  if (!bridge?.getServer || !server) {
    return <p className="settings-note">כתובת השרת זמינה רק בתוכנה המותקנת.</p>;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bridge?.setServer) return;
    setBusy(true);
    setMessage(null);
    try {
      const answer = await bridge.setServer(value);
      if (answer.ok) {
        setServer(s => (s ? { ...s, origin: answer.origin } : s));
        setValue(answer.origin);
        setMessage({ ok: true, text: 'נשמר. התוכנה מחוברת לשרת בכתובת הזו.' });
      } else {
        setMessage({ ok: false, text: answer.error });
      }
    } catch {
      setMessage({ ok: false, text: 'השמירה נכשלה. נסה שוב.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="settings-server" onSubmit={submit}>
      <label htmlFor="settings-server-origin">כתובת השרת</label>
      <p className="settings-note">
        מכאן FrameOps מקבלת את הרישיון ואת העדכונים. אין צורך לשנות אותה — אם הכתובת
        תשתנה, התוכנה תעבור אליה לבד. שנה רק אם קיבלת כתובת חדשה והתוכנה לא מתחברת.
      </p>
      <div className="settings-server-row">
        <input
          id="settings-server-origin"
          dir="ltr"
          spellCheck={false}
          value={value}
          onChange={e => { setValue(e.target.value); setMessage(null); }}
        />
        <button type="submit" disabled={busy || value.trim() === server.origin}>
          {busy ? 'בודק…' : 'שמור'}
        </button>
      </div>
      {message && <p className={message.ok ? 'settings-ok' : 'settings-error'} role="status">{message.text}</p>}
    </form>
  );
}

export default function Settings() {
  return (
    <div className="soon settings">
      <h1>הגדרות</h1>
      <section className="settings-card">
        <h2>חיבור</h2>
        <ServerAddress />
      </section>
      <p className="soon-note">חשבון, מנוי, אחסון ותבניות ייבנו בשלב הבא.</p>
    </div>
  );
}
