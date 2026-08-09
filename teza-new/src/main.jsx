import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function Icon({ name, size = 16 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    folder: <path d="M3 7.5h7l2-2h9v13H3z" />,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/></>,
    flow: <><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7.5 7.5l3.5 8M16.5 7.5l-3.5 8"/></>,
    live: <><path d="M8 5a9 9 0 0 0 0 14M16 5a9 9 0 0 1 0 14"/><circle cx="12" cy="12" r="2"/></>,
    archive: <><path d="M4 7h16v13H4zM3 4h18v4H3z"/><path d="M9 12h6"/></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    users: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20c0-4 2-6 6-6s6 2 6 6M15 15c4 0 6 2 6 5"/></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.3 2.2c-.8.4-1.1.9-1.1 1.8M12 17h.01"/></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></>,
    sparkle: <><path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="m18 15 .8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const mainNav = [
  ['grid', 'ראשי'], ['folder', 'פרויקטים'], ['image', 'עריכה'],
  ['flow', 'תהליכים'], ['live', 'שידור חי'],
];

const assetNav = [
  ['archive', 'כל העבודות'], ['lock', 'פרטי'], ['users', 'משותף איתי'], ['star', 'מועדפים'],
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="account">
        <span className="account-avatar">י</span>
        <span><strong>יוסי</strong><small>הסטודיו שלי</small></span>
        <button aria-label="תפריט חשבון">⌄</button>
      </div>
      <button className="invite"><Icon name="users" /> הזמנת חברי צוות</button>

      <nav className="nav-group" aria-label="ניווט ראשי">
        {mainNav.map(([icon, label], index) => (
          <button key={label} className={index === 0 ? 'active' : ''}><Icon name={icon} /> <span>{label}</span></button>
        ))}
      </nav>

      <div className="nav-label">נכסים</div>
      <nav className="nav-group compact" aria-label="נכסים">
        {assetNav.map(([icon, label]) => <button key={label}><Icon name={icon} /><span>{label}</span></button>)}
      </nav>

      <div className="nav-label">יצירה</div>
      <nav className="nav-group compact create-links" aria-label="יצירה">
        <button><Icon name="plus" /><span>פתיחת פרויקט</span></button>
        <button><Icon name="video" /><span>יצירת וידאו</span></button>
        <button><Icon name="image" /><span>ייבוא תמונות</span></button>
      </nav>

      <button className="help"><Icon name="help" /><span>מרכז העזרה</span></button>
      <small className="legal">תנאי שימוש · פרטיות</small>
    </aside>
  );
}

function ProjectPlaceholder({ muted = false }) {
  return (
    <button className={`project-card ${muted ? 'muted' : ''}`}>
      <span className="project-preview"><Icon name={muted ? 'image' : 'plus'} size={20} /></span>
      <strong>{muted ? 'העבודות שלך יופיעו כאן' : 'פרויקט חדש'}</strong>
      <small>{muted ? 'עדיין לא נוצרו פרויקטים' : 'פתיחת סביבת עבודה חדשה'}</small>
    </button>
  );
}

function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <header className="topbar">
          <label className="search"><Icon name="search" /><input aria-label="חיפוש" placeholder="חיפוש בפרויקטים ובנכסים" /></label>
          <div className="top-actions"><button>שדרוג</button><span className="credit">0 קרדיטים</span><span className="mini-avatar">י</span></div>
        </header>

        <div className="dashboard" dir="rtl">
          <section className="new-session">
            <div className="session-actions">
              <span className="section-kicker">עבודה חדשה</span>
              <h1>מה יוצרים היום?</h1>
              <button><Icon name="image" /> ייבוא ועריכת תמונות <span>←</span></button>
              <button><Icon name="video" /> יצירת וידאו <span>←</span></button>
              <button><Icon name="sparkle" /> פתיחת פרויקט AI <span>←</span></button>
            </div>

            <div className="recent-projects">
              <div className="section-title"><h2>פרויקטים אחרונים</h2><button>הצגת הכול</button></div>
              <div className="project-grid">
                <ProjectPlaceholder />
                <ProjectPlaceholder muted />
                <div className="project-card blank" aria-hidden="true" />
              </div>
            </div>
          </section>

          <section className="recent-assets">
            <div className="section-title"><h2>עריכות אחרונות</h2><button>הצגת הכול</button></div>
            <div className="asset-strip">
              <button className="asset-empty"><Icon name="image" size={22}/><span>התמונות האחרונות יופיעו כאן</span></button>
              <div className="asset-blank"/><div className="asset-blank"/><div className="asset-blank"/>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
