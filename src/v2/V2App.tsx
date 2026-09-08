import React, { useState } from 'react';
import TzStatusScreen from './screens/TzStatusScreen';
import {
  TzIconBag, TzIconBell, TzIconBook, TzIconChart, TzIconCloud,
  TzIconFilter, TzIconFolder, TzIconGallery, TzIconGear, TzIconHeart,
  TzIconHelp, TzIconHome, TzIconSliders, TzIconUsers,
} from './TzIcons';
import './tz-exact.css';

interface V2AppProps {
  onSwitchToV1: () => void;
  onOpenProjectV1?: (id: string) => void;
}

export default function V2App({ onSwitchToV1 }: V2AppProps) {
  const [activeNav, setActiveNav] = useState('projects');
  const [activeTab, setActiveTab] = useState('status');

  const NAV_ITEMS = [
    { id: 'home', label: 'דף הבית', icon: TzIconHome },
    { id: 'projects', label: 'פרויקטים', icon: TzIconFolder },
    { id: 'galleries', label: 'גלריות', icon: TzIconGallery },
    { id: 'culling', label: 'סינון גלריה', icon: TzIconFilter, isAi: true },
    { id: 'editing', label: 'עיבוד גלריה', icon: TzIconSliders },
    { id: 'albums', label: 'עיצוב אלבומים', icon: TzIconBook },
    { id: 'clients', label: 'לקוחות', icon: TzIconUsers },
    { id: 'orders', label: 'הזמנות ומוצרים', icon: TzIconBag },
    { id: 'reports', label: 'דוחות', icon: TzIconChart },
    { id: 'settings', label: 'הגדרות', icon: TzIconGear },
  ];

  const STAGE_TABS = [
    { id: 'status', label: 'סטטוס לקוח', icon: TzIconUsers },
    { id: 'upload', label: 'העלאת גלריה', icon: TzIconCloud },
    { id: 'cull', label: 'סינון גלריה', icon: TzIconFilter },
    { id: 'picked', label: 'תמונות שנבחרו', icon: TzIconHeart },
    { id: 'edit', label: 'עיבוד גלריה', icon: TzIconSliders },
    { id: 'album', label: 'עיצוב אלבום', icon: TzIconBook },
  ];

  return (
    <div className="tz-app">
      {/* 1. SIDEBAR (Placed on Left) */}
      <aside className="tz-sidebar">
        {/* Logo */}
        <div className="tz-logo-wrap">
          <div className="tz-logo-title">
            <span>TEZA</span>
            <span className="tz-logo-ai">AI</span>
          </div>
          <div className="tz-logo-subtitle">מערכת ההפעלה של הצלמת</div>
        </div>

        {/* Navigation items */}
        <nav className="tz-nav-list">
          {NAV_ITEMS.map((item) => {
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

        {/* Cloud Storage Card */}
        <div className="tz-storage-card">
          <div className="tz-storage-title">
            <TzIconCloud size={14} /> אחסון בענן
          </div>
          <div className="tz-storage-bar">
            <div className="tz-storage-fill" style={{ width: '39%' }} />
          </div>
          <div className="tz-storage-numbers">782 GB מתוך 2 TB</div>
          <button className="tz-btn-storage-upgrade" type="button">
            שדרוג חבילה
          </button>
        </div>

        {/* Switch back to V1 */}
        <button
          className="tz-help-link"
          type="button"
          onClick={onSwitchToV1}
          style={{ marginBottom: '4px', fontSize: '11.5px', color: '#a1a1aa' }}
        >
          <span>↺</span> חזרה לעיצוב קודם
        </button>

        {/* Help Center */}
        <button className="tz-help-link" type="button">
          <TzIconHelp size={15} /> מרכז עזרה
        </button>
      </aside>

      {/* 2. MAIN CONTENT WRAPPER */}
      <div className="tz-main-wrapper">
        {/* Top Header */}
        <header className="tz-topbar">
          <button className="tz-topbar-back" type="button" onClick={onSwitchToV1}>
            <span>‹</span> חזרה לפרויקט
          </button>

          <div className="tz-topbar-title">
            מלי כץ – בת מצווה
          </div>

          <div className="tz-topbar-user-area">
            <button className="tz-icon-button" type="button" title="התראות">
              <TzIconBell size={18} />
              <span className="tz-badge-dot">3</span>
            </button>
            <button className="tz-icon-button" type="button" title="עזרה">
              <TzIconHelp size={18} />
            </button>
            <div className="tz-user-avatar-wrap">
              <img
                src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=80&q=80"
                alt="שירה"
                className="tz-user-img"
              />
              <span className="tz-user-name">שירה</span>
            </div>
          </div>
        </header>

        {/* Stage Tabs Bar */}
        <nav className="tz-tabs-bar">
          {STAGE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`tz-tab ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Content Area */}
        <main className="tz-content-scroll">
          <TzStatusScreen />
        </main>
      </div>
    </div>
  );
}
