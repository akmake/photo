import { useState } from 'react';
import { useStudio } from '../studio/store';
import TodayV2 from './screens/TodayV2';
import './v2.css';

interface V2AppProps {
  onSwitchToV1: () => void;
  onOpenProjectV1: (id: string) => void;
}

export default function V2App({ onSwitchToV1, onOpenProjectV1 }: V2AppProps) {
  const [activeSection, setActiveSection] = useState('today');
  const studio = useStudio();

  const NAV_ITEMS = [
    { id: 'today', label: 'היום', icon: '⚡' },
    { id: 'projects', label: 'פרויקטים', icon: '📁', count: studio.projects.length },
    { id: 'clients', label: 'לקוחות', icon: '👥' },
    { id: 'calendar', label: 'יומן', icon: '📅' },
    { id: 'albums', label: 'אלבומים', icon: '📖' },
  ];

  const WORKSHOP_ITEMS = [
    { id: 'smart-cleanup', label: 'ניקוי חכם', icon: '✨' },
    { id: 'lab', label: 'מעבדה', icon: '🧪' },
  ];

  function renderContent() {
    switch (activeSection) {
      case 'today':
        return (
          <TodayV2
            onNavigate={(sec) => setActiveSection(sec)}
            onOpenProject={(id) => onOpenProjectV1(id)}
          />
        );
      default:
        return (
          <div style={{ padding: '60px', textAlign: 'center', color: 'var(--v2-text-muted)' }}>
            <h2 style={{ color: 'var(--v2-text-primary)', marginBottom: '8px' }}>
              מסך {NAV_ITEMS.find((i) => i.id === activeSection)?.label || activeSection} בעיצוב V2
            </h2>
            <p>המסך הזה יעוצב בהמשך לפי הסדר מסך-אחר-מסך.</p>
          </div>
        );
    }
  }

  return (
    <div className="v2-app">
      {/* Navigation Rail */}
      <aside className="v2-rail">
        <div className="v2-rail-header">
          <div className="v2-logo">
            <div className="v2-logo-icon">◉</div>
            <span>PHOTO</span>
          </div>
          <span className="v2-version-badge">V2 BETA</span>
        </div>

        <div className="v2-nav-section">
          <span className="v2-nav-title">העסק שלי</span>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`v2-nav-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <div className="v2-nav-item-left">
                <span className="v2-nav-item-icon">{item.icon}</span>
                <span>{item.label}</span>
              </div>
              {item.count !== undefined && <span className="v2-nav-count">{item.count}</span>}
            </button>
          ))}
        </div>

        <div className="v2-nav-section">
          <span className="v2-nav-title">סדנאות עבודה</span>
          {WORKSHOP_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`v2-nav-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <div className="v2-nav-item-left">
                <span className="v2-nav-item-icon">{item.icon}</span>
                <span>{item.label}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="v2-rail-footer">
          <div className="v2-engine-status">
            <div className="v2-engine-indicator">
              <span className={`v2-dot ${studio.status === 'ready' ? 'online' : 'offline'}`} />
              <span>מנוע מקומי</span>
            </div>
            <strong style={{ color: studio.status === 'ready' ? 'var(--v2-accent-emerald)' : 'var(--v2-text-muted)' }}>
              {studio.status === 'ready' ? 'מחובר' : 'לא זמין'}
            </strong>
          </div>

          <button className="v2-switch-back" onClick={onSwitchToV1} title="חזרה לעיצוב V1 המקורי">
            <span>↺</span>
            <span>חזרה לעיצוב V1 הקלאסי</span>
          </button>
        </div>
      </aside>

      {/* Main Area */}
      <div className="v2-main-area">
        <header className="v2-top-header">
          <div className="v2-header-title">
            {NAV_ITEMS.find((i) => i.id === activeSection)?.label || 'סטודיו V2'}
          </div>
          <div className="v2-header-actions">
            <button className="v2-btn" onClick={onSwitchToV1}>
              ↺ גרסה קלאסית (V1)
            </button>
          </div>
        </header>

        <main className="v2-content-scroll">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
