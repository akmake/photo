import { useEffect, useState } from 'react';
import './update-bar.css';

/* The one moment the photographer hears about an update: it is already
 * downloaded, and it will install when TEZA closes. The button only makes that
 * happen now. Nothing is shown while checking or downloading — see
 * electron/updater.cjs for why. */

type Ready = { version: string } | null;
type UpdateBridge = {
  updateStatus?: () => Promise<Ready>;
  onUpdateReady?: (cb: (info: Ready) => void) => () => void;
  installUpdate?: () => void;
};

const bridge = (window as Window & { teza?: UpdateBridge }).teza;

export default function UpdateBar() {
  const [ready, setReady] = useState<Ready>(null);
  const [hidden, setHidden] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!bridge?.updateStatus || !bridge.onUpdateReady) return;
    void bridge.updateStatus().then(info => { if (info) setReady(info); });
    return bridge.onUpdateReady(info => { setReady(info); setHidden(false); });
  }, []);

  if (!ready || hidden) return null;

  return (
    <aside className="tz-update" dir="rtl" role="status">
      <div className="tz-update-text">
        <strong>גרסה חדשה של FrameOps מוכנה</strong>
        <span>היא תותקן כשתסגור את התוכנה.</span>
      </div>
      <button
        type="button"
        className="tz-update-now"
        disabled={restarting}
        onClick={() => { setRestarting(true); bridge?.installUpdate?.(); }}
      >
        {restarting ? 'מפעיל מחדש…' : 'הפעל מחדש עכשיו'}
      </button>
      <button type="button" className="tz-update-later" aria-label="אחר כך" onClick={() => setHidden(true)}>
        אחר כך
      </button>
    </aside>
  );
}
