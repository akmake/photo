import React, { useState } from 'react';
import { useStudio } from '../studio/store';
import TzStatusScreen from './screens/TzStatusScreen';
import TodayV2 from './screens/TodayV2';
import {
  TzIconBell, TzIconBook, TzIconCalendar, TzIconFilter, TzIconFlask,
  TzIconFolder, TzIconGear, TzIconHeart, TzIconHelp, TzIconHome,
  TzIconSliders, TzIconSparkle, TzIconUpload, TzIconUsers,
} from './TzIcons';
import './tz-exact.css';

interface V2AppProps {
  onSwitchToV1: () => void;
  onOpenProjectV1?: (id: string) => void;
}

export default function V2App({ onSwitchToV1, onOpenProjectV1 }: V2AppProps) {
  const [activeNav, setActiveNav] = useState('projects');
  const [activeStage, setActiveStage] = useState('client-status');
  const studio = useStudio();

  // Pick first project from store or fallback
  const currentProject = studio.projects[0];
  const imported = studio.projects.reduce((sum, p) => sum + (p.imported || 0), 0);
  const rendered = studio.projects.reduce((sum, p) => sum + (p.rendered || 0), 0);
  const processedPercent = imported ? Math.min(100, Math.round((rendered / imported) * 100)) : 39;

  // The actual business sections of TEZA
  const BUSINESS_NAV = [
    { id: 'today', label: 'היום', icon: TzIconHome },
    { id: 'projects', label: 'פרויקטים', icon: TzIconFolder, count: studio.projects.length },
    { id: 'clients', label: 'לקוחות', icon: TzIconUsers },
    { id: 'calendar', label: 'יומן', icon: TzIconCalendar },
    { id: 'albums', label: 'אלבומים', icon: TzIconBook },
  ];

  // The actual workshop / lab tools of TEZA
  const WORKSHOP_NAV = [
    { id: 'smart-cleanup', label: 'ניקוי חכם', icon: TzIconSparkle, isAi: true },
    { id: 'lab', label: 'מעבדה', icon: TzIconSliders },
    { id: 'experiments', label: 'כלים בניסיון', icon: TzIconFlask },
  ];

  // The actual stages of a project in TEZA
  const PROJECT_STAGES = [
    { id: 'client-status', label: 'סטטוס לקוח', icon: TzIconUsers },
    { id: 'gallery-upload', label: 'ייבוא', icon: TzIconUpload },
    { id: 'gallery-cull', label: 'בחירה', icon: TzIconFilter },
    { id: 'gallery-picked', label: 'תמונות שנבחרו', icon: TzIconHeart },
    { id: 'gallery-edit', label: 'עריכה', icon: TzIconSliders },
    { id: 'album-design', label: 'אלבום', icon: TzIconBook },
  ];

  const projectTitle = currentProject
    ? `${currentProject.client} – ${currentProject.event || 'בת מצווה'}`
    : 'מלי כץ – בת מצווה';

  function renderMainContent() {
    if (activeNav === 'today') {
      return (
        <TodayV2
          onNavigate={(sec) => {
            if (sec === 'projects') setActiveNav('projects');
            else setActiveNav(sec);
          }}
          onOpenProject={(id) => onOpenProjectV1?.(id)}
        />
      );
    }

    if (activeNav === 'projects') {
      return <TzStatusScreen />;
    }

    return (
      <div style={{ padding: '80px', textAlign: 'center', color: 'var(--tz-text-muted)' }}>
        <h2 style={{ color: 'var(--tz-text-main)', marginBottom: '8px', fontSize: '20px' }}>
          מסך {BUSINESS_NAV.find((i) => i.id === activeNav)?.label || WORKSHOP_NAV.find((i) => i.id === activeNav)?.label || activeNav}
        </h2>
        <p>המסך הזה יעוצב בהמשך לפי הסדר ובאותה שפה נקייה ומדויקת.</p>
        <button
          className="tz-btn-peach"
          style={{ width: 'auto', padding: '8px 20px', marginTop: '16px' }}
          onClick={() => setActiveNav('projects')}
        >
          חזרה למסך פרויקט
        </button>
      </div>
    );
  }

  return (
    <div className="tz-app">
      {/* 1. SIDEBAR (Placed on Left matching exact layout) */}
      <aside className="tz-sidebar">
        {/* Logo */}
        <div className="tz-logo-wrap">
          <div className="tz-logo-title">
            <span>TEZA</span>
            <span className="tz-logo-ai">AI</span>
          </div>
          <div className="tz-logo-subtitle">מערכת ההפעלה של הצלמת</div>
        </div>

        {/* Business Navigation items */}
        <nav className="tz-nav-list">
          {BUSINESS_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`tz-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setActiveNav(item.id)}
              >
                <span className="tz-nav-icon"><Icon size={17} /></span>
                <span>{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span className="tz-nav-counter">{item.count}</span>
                )}
              </button>
            );
          })}

          <div className="tz-nav-sep" />

          {/* Workshop items */}
          {WORKSHOP_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`tz-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setActiveNav(item.id)}
              >
                <span className="tz-nav-icon"><Icon size={17} /></span>
                <span>{item.label}</span>
                {item.isAi && <span className="tz-ai-badge">AI</span>}
              </button>
            );
          })}
        </nav>

        {/* Library Storage / Engine Card */}
        <div className="tz-storage-card">
          <div className="tz-storage-title">
            <span style={{ fontSize: '13px' }}>◉</span>
            <span>מצב ספרייה ומנוע</span>
          </div>
          <div className="tz-storage-bar">
            <div className="tz-storage-fill" style={{ width: `${processedPercent}%` }} />
          </div>
          <div className="tz-storage-numbers" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{studio.projects.length} פרויקטים</span>
            <strong style={{ color: studio.status === 'ready' ? 'var(--tz-green)' : 'var(--tz-brand)' }}>
              {studio.status === 'ready' ? 'מנוע מחובר' : 'מנוע מקומי'}
            </strong>
          </div>
          <button className="tz-btn-storage-upgrade" type="button">
            שדרוג חבילה
          </button>
        </div>

        {/* Settings */}
        <button
          type="button"
          className={`tz-nav-item ${activeNav === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveNav('settings')}
          style={{ marginBottom: '4px' }}
        >
          <span className="tz-nav-icon"><TzIconGear size={17} /></span>
          <span>הגדרות</span>
        </button>

        {/* User profile (יוסי) */}
        <button className="tz-nav-user-item" type="button" title="החשבון שלי">
          <div className="tz-user-avatar-initial">י</div>
          <div className="tz-nav-user-copy">
            <strong>יוסי</strong>
            <small>החשבון שלי</small>
          </div>
        </button>

        {/* Switch back to V1 */}
        <button
          className="tz-help-link"
          type="button"
          onClick={onSwitchToV1}
          style={{ marginTop: '10px', fontSize: '11.5px', color: '#a1a1aa' }}
        >
          <span>↺</span> חזרה לעיצוב קודם
        </button>
      </aside>

      {/* 2. MAIN CONTENT WRAPPER */}
      <div className="tz-main-wrapper">
        {/* Top Header */}
        <header className="tz-topbar">
          <button className="tz-topbar-back" type="button" onClick={() => setActiveNav('today')}>
            <span>‹</span> חזרה לדף הבית
          </button>

          <div className="tz-topbar-title">
            {activeNav === 'today' ? 'היום בסטודיו' : projectTitle}
          </div>

          <div className="tz-topbar-user-area">
            <button className="tz-icon-button" type="button" title="התראות">
              <TzIconBell size={18} />
              <span className="tz-badge-dot">3</span>
            </button>
            <button className="tz-icon-button" type="button" title="עזרה">
              <TzIconHelp size={18} />
            </button>
            <div className="tz-user-avatar-wrap" title="יוסי">
              <div className="tz-user-avatar-initial" style={{ width: 28, height: 28, fontSize: 13 }}>י</div>
              <span className="tz-user-name">יוסי</span>
            </div>
          </div>
        </header>

        {/* Stage Tabs Bar (shown in project mode) */}
        {activeNav === 'projects' && (
          <nav className="tz-tabs-bar">
            {PROJECT_STAGES.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeStage === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`tz-tab ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveStage(tab.id)}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Content Area */}
        <main className="tz-content-scroll">
          {renderMainContent()}
        </main>
      </div>
    </div>
  );
}
