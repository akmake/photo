import React, { useState } from 'react';
import { useStudio } from '../studio/store';
import ProjectClientStatusV2 from './screens/ProjectClientStatusV2';
import TodayV2 from './screens/TodayV2';
import './v2.css';

interface V2AppProps {
  onSwitchToV1: () => void;
  onOpenProjectV1: (id: string) => void;
}

export default function V2App({ onSwitchToV1, onOpenProjectV1 }: V2AppProps) {
  const [activeSection, setActiveSection] = useState<'home' | 'project-status' | string>('project-status');
  const [activeStage, setActiveStage] = useState('client-status');
  const studio = useStudio();

  // Pick first project from store or fallback
  const currentProject = studio.projects[0];

  const NAV_ITEMS = [
    { id: 'home', label: 'דף הבית', icon: '🏠' },
    { id: 'projects', label: 'פרויקטים', icon: '📁' },
    { id: 'galleries', label: 'גלריות', icon: '🖼️' },
    { id: 'culling', label: 'סינון גלריה', icon: '🌪️', ai: true },
    { id: 'editing', label: 'עיבוד גלריה', icon: '⚙️' },
    { id: 'albums', label: 'עיצוב אלבומים', icon: '📖' },
    { id: 'clients', label: 'לקוחות', icon: '👥' },
    { id: 'orders', label: 'הזמנות ומוצרים', icon: '🛍️' },
    { id: 'reports', label: 'דוחות', icon: '📊' },
    { id: 'settings', label: 'הגדרות', icon: '⚙️' },
  ];

  const STAGE_TABS = [
    { id: 'client-status', label: 'סטטוס לקוח', icon: '👥' },
    { id: 'gallery-upload', label: 'העלאת גלריה', icon: '☁️' },
    { id: 'gallery-cull', label: 'סינון גלריה', icon: '🌪️' },
    { id: 'gallery-picked', label: 'תמונות שנבחרו', icon: '💚' },
    { id: 'gallery-edit', label: 'עיבוד גלריה', icon: '⚙️' },
    { id: 'album-design', label: 'עיצוב אלבום', icon: '📖' },
  ];

  function renderContent() {
    if (activeSection === 'home') {
      return (
        <TodayV2
          onNavigate={(sec) => {
            if (sec === 'projects') setActiveSection('project-status');
            else setActiveSection(sec);
          }}
          onOpenProject={(id) => onOpenProjectV1(id)}
        />
      );
    }

    if (activeSection === 'project-status') {
      return (
        <ProjectClientStatusV2
          project={currentProject}
          onNavigateStage={(st) => setActiveStage(st)}
        />
      );
    }

    return (
      <div style={{ padding: '80px', textAlign: 'center', color: 'var(--v2-text-muted)' }}>
        <h2 style={{ color: 'var(--v2-text-primary)', marginBottom: '8px', fontSize: '22px' }}>
          {NAV_ITEMS.find((i) => i.id === activeSection)?.label || activeSection}
        </h2>
        <p>המסך הזה יעוצב בהמשך לפי הסדר ובאותה שפה ויזואלית מדויקת.</p>
        <button
          className="v2-action-pill"
          style={{ marginTop: '20px' }}
          onClick={() => setActiveSection('project-status')}
        >
          ← חזרה למסך סטטוס פרויקט
        </button>
      </div>
    );
  }

  const projectTitle = currentProject
    ? `${currentProject.client} – ${currentProject.event || 'בת מצווה'}`
    : 'מלי כץ – בת מצווה';

  return (
    <div className="v2-app">
      {/* Sidebar */}
      <aside className="v2-rail">
        <div className="v2-brand-block">
          <div className="v2-logo-row">
            <span>TEZA</span>
            <span className="v2-logo-ai">AI</span>
          </div>
          <span className="v2-logo-tagline">מערכת ההפעלה של הצלמת</span>
        </div>

        {/* Navigation items list */}
        <div className="v2-nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`v2-nav-item ${
                (item.id === 'home' && activeSection === 'home') ||
                (item.id === 'projects' && activeSection === 'project-status') ||
                activeSection === item.id
                  ? 'active'
                  : ''
              }`}
              onClick={() => {
                if (item.id === 'projects') setActiveSection('project-status');
                else setActiveSection(item.id);
              }}
            >
              <span className="v2-nav-item-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.ai && (
                <span
                  style={{
                    marginRight: 'auto',
                    fontSize: '10px',
                    fontWeight: 700,
                    color: 'var(--v2-brand)',
                    background: 'var(--v2-brand-soft)',
                    padding: '2px 5px',
                    borderRadius: '4px',
                  }}
                >
                  AI
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer with Cloud Storage & Help */}
        <div className="v2-rail-footer">
          <div className="v2-storage-card">
            <div className="v2-storage-header">
              <span>☁️</span>
              <span>אחסון בענן</span>
            </div>
            <div className="v2-storage-bar">
              <div className="v2-storage-bar-fill" style={{ width: '39%' }} />
            </div>
            <div className="v2-storage-info">
              <span>782 GB מתוך 2 TB</span>
            </div>
            <button className="v2-storage-upgrade-btn" type="button">
              שדרוג חבילה
            </button>
          </div>

          <button className="v2-help-link" type="button" onClick={onSwitchToV1} title="חזרה לעיצוב V1">
            <span>↺</span>
            <span>חזרה לעיצוב הקלאסי (V1)</span>
          </button>

          <button className="v2-help-link" type="button">
            <span>❓</span>
            <span>מרכז עזרה</span>
          </button>
        </div>
      </aside>

      {/* Main Area */}
      <div className="v2-main-area">
        {/* Top Header */}
        <header className="v2-top-header">
          <button
            className="v2-header-back"
            type="button"
            onClick={() => setActiveSection('home')}
          >
            <span>‹</span>
            <span>חזרה לפרויקט</span>
          </button>

          <div className="v2-header-center-title">
            {projectTitle}
          </div>

          <div className="v2-header-right">
            <button className="v2-header-icon-btn" type="button" title="התראות">
              <span>🔔</span>
              <span className="v2-notif-badge">3</span>
            </button>
            <button className="v2-header-icon-btn" type="button" title="עזרה">
              <span>❓</span>
            </button>
            <div className="v2-user-pill">
              <img
                src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=100&q=80"
                alt=""
                className="v2-user-avatar"
              />
              <span className="v2-user-name">שירה</span>
            </div>
          </div>
        </header>

        {/* Stages Tabs Bar (Only when in project view) */}
        {activeSection === 'project-status' && (
          <nav className="v2-stages-tabs-bar">
            {STAGE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`v2-stage-tab ${activeStage === tab.id ? 'active' : ''}`}
                onClick={() => setActiveStage(tab.id)}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        )}

        {/* Scrollable Content View */}
        <main className="v2-content-scroll">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
