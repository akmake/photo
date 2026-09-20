import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Nav, Footer } from '../components';
import { BRAND, TAGLINE, SUBLINE } from '../brand';
import { api } from '../api';

type Plan = { id: string; name: string; price_ils: number; period: string };

const FEATURES = [
  { ic: '🎨', h: 'עריכה חכמה', p: 'ריטוש, ניקוי עור והתאמת צבע — מדויק, על המחשב שלך, בלי שהתמונות עוזבות אותו.' },
  { ic: '📖', h: 'אלבומים', p: 'פריסה אוטומטית שמכבדת את התמונה, מוכנה לדפוס, בכל גודל.' },
  { ic: '🔒', h: 'גלריות מאובטחות', p: 'הלקוח מקבל קישור פרטי, בוחר ומעיר — והבחירה נוחתת ישר אצלך לעריכה.' },
  { ic: '⚡', h: 'הכל מקומי', p: 'המקור נשאר על הדיסק שלך. מהיר, פרטי, בשליטתך המלאה.' },
  { ic: '👥', h: 'ניהול לקוחות', p: 'כל צילום, כל בחירה וכל אלבום — מסודרים במקום אחד.' },
  { ic: '☁️', h: 'סנכרון חכם', p: 'רק מה שצריך עולה לענן: תצוגות קלות ללקוח, לא הגלם הכבד.' },
];

export default function Landing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dev, setDev] = useState(false);

  useEffect(() => {
    api.plans().then((r) => { setPlans(r.plans); setDev(r.dev); }).catch(() => {});
  }, []);

  return (
    <>
      <Nav />

      <header className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">✦ הסטודיו החדש של הצלם</span>
            <h1>{TAGLINE.split(' ').slice(0, 2).join(' ')} <span className="grad">{TAGLINE.split(' ').slice(2).join(' ')}</span></h1>
            <p className="lead">{SUBLINE}</p>
            <div className="hero-cta">
              <Link to="/register" className="btn btn-primary btn-lg">התחלה חינם</Link>
              <a href="#pricing" className="btn btn-ghost btn-lg">לחבילות</a>
            </div>
            <div className="hero-note">בלי כרטיס אשראי להתחלה · עובד על Windows</div>
          </div>

          <div className="stage">
            <div className="orb a" />
            <div className="orb b" />
            <div className="card3d">
              <div className="bar">
                <span className="dot" style={{ background: '#ff6058' }} />
                <span className="dot" style={{ background: '#ffbd2e' }} />
                <span className="dot" style={{ background: '#28c840' }} />
              </div>
              <div className="canvas">
                <span style={{ fontSize: 46, fontWeight: 800, color: 'rgba(20,21,26,.25)' }}>{BRAND}</span>
              </div>
              <div className="thumbs">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} />)}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section id="features" className="section">
        <div className="wrap">
          <h2>כל מה שצלם צריך, במקום אחד</h2>
          <p className="sub">מהרגע שהתמונה נכנסת ועד שהאלבום מודפס — צינור אחד, בלי לקפוץ בין תוכנות.</p>
          <div className="features">
            {FEATURES.map((f) => (
              <div className="feature" key={f.h}>
                <div className="ic">{f.ic}</div>
                <h3>{f.h}</h3>
                <p>{f.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="section" style={{ background: 'var(--surface-2)' }}>
        <div className="wrap">
          <h2>חבילה אחת פשוטה</h2>
          <p className="sub">כל היכולות. בלי דרגות מבלבלות.</p>
          {dev && (
            <p className="sub" style={{ color: 'var(--accent-strong)', fontWeight: 700 }}>
              (סביבת פיתוח — התשלום הוא דמה ואינו מחייב)
            </p>
          )}
          <div className="pricing">
            {plans.map((p, i) => (
              <div className={`plan ${i === 1 ? 'featured' : ''}`} key={p.id}>
                {i === 1 && <span className="tag">משתלם</span>}
                <h3>{p.name}</h3>
                <div className="price">₪{p.price_ils}<small> / {p.period}</small></div>
                <ul>
                  <li>עריכה וריטוש מלא</li>
                  <li>אלבומים ללא הגבלה</li>
                  <li>גלריות לקוח מאובטחות</li>
                  <li>2 מכשירים</li>
                </ul>
                <Link to="/register" className={`btn ${i === 1 ? 'btn-primary' : 'btn-ghost'} btn-block btn-lg`}>בחירה</Link>
              </div>
            ))}
            {plans.length === 0 && <p className="sub">טוען חבילות…</p>}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
