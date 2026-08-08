/* כלים בניסיון — the experimental-tools room.
 *
 * A separate place from the project flow: a whole capability is built and tried
 * here, decoupled from the working tools, before it earns a way into a project.
 * This hub is just the door list. Each experiment opens full-bleed and carries
 * its own way back — the hub never has to know what any of them does.
 *
 * First and only resident so far: the AI album.
 */

import { useState } from 'react';
import AlbumAI from './AlbumAI';
import { IcSparkle } from '../design/Icons';
import './experiments.css';

type ExpId = 'album-ai';

export default function Experiments() {
  const [open, setOpen] = useState<ExpId | null>(null);

  if (open === 'album-ai') return <AlbumAI onBack={() => setOpen(null)} />;

  return (
    <div className="exp scroll-y">
      <header className="exp-head">
        <p className="label">כלים בניסיון</p>
        <h1>מה שנבנה עכשיו</h1>
        <p className="exp-lede">
          כלים חדשים בשלב פיתוח, מנותקים מזרימת העבודה הרגילה. כאן בונים ובודקים
          לפני שהם נכנסים אל תוך הפרויקט.
        </p>
      </header>

      <div className="exp-grid">
        <button className="exp-card" onClick={() => setOpen('album-ai')}>
          <span className="exp-badge">בבנייה</span>
          <span className="exp-card-mark"><IcSparkle size={22} /></span>
          <h2>אלבום חכם</h2>
          <p className="exp-card-tag">בינה מלאכותית מקומית</p>
          <p className="exp-card-blurb">
            המנוע מבין את התמונות ובונה אלבום — בוחר מה נכנס, מי הגיבור, מה כפול,
            ואיך מסתדרות הכפולות. הכול רץ על המחשב, שום תמונה לא עוזבת את הדיסק.
          </p>
          <span className="exp-open">פתח ←</span>
        </button>
      </div>
    </div>
  );
}
