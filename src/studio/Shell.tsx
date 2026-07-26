import type { ReactNode } from 'react';
import { SECTIONS, STAGES } from './nav';
import type { SectionId, StageId } from './nav';
import { STORAGE } from './demo';
import {
  IcBag, IcBell, IcBook, IcChart, IcChevron, IcCloud, IcFilter, IcFolder,
  IcGallery, IcGear, IcHeart, IcHelp, IcHome, IcSliders, IcSparkle, IcUpload,
  IcUsers,
} from '../design/Icons';

const ICONS: Record<string, (p: { size?: number }) => JSX.Element> = {
  home: IcHome, folder: IcFolder, gallery: IcGallery, filter: IcFilter,
  sliders: IcSliders, book: IcBook, users: IcUsers, bag: IcBag,
  chart: IcChart, gear: IcGear, upload: IcUpload, heart: IcHeart,
  lab: IcSparkle, compare: IcFilter,
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? IcFolder;
  return <C size={size} />;
}

export function Sidebar({
  section,
  onSection,
}: {
  section: SectionId;
  onSection: (s: SectionId) => void;
}) {
  const pct = Math.round((STORAGE.usedGb / STORAGE.totalGb) * 100);
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">
          TEZA <em>AI</em>
        </div>
        <div className="logo-sub">מערכת ההפעלה של הצלמות</div>
      </div>

      {SECTIONS.map((s) => (
        <button
          key={s.id}
          className={`nav-item ${s.id === section ? 'on' : ''}`}
          onClick={() => onSection(s.id)}
        >
          <Icon name={s.icon} />
          <span>{s.label}</span>
        </button>
      ))}

      <div className="sidebar-foot">
        <div className="storage">
          <div className="storage-head">
            <IcCloud size={17} />
            <span>אחסון בענן</span>
          </div>
          <div className="meter">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="storage-note">
            {STORAGE.usedGb} GB מתוך {STORAGE.totalGb / 1024} TB
          </div>
          <button className="btn btn-wide" style={{ marginTop: 12 }}>
            שדרוג חבילה
          </button>
        </div>
        <button className="nav-item">
          <IcHelp />
          <span>מרכז עזרה</span>
        </button>
      </div>
    </aside>
  );
}

export function TopBar({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="topbar">
      <button className="back" onClick={onBack}>
        <IcChevron size={17} />
        <span>חזרה לפרויקט</span>
      </button>

      <h1 className="topbar-title">{title}</h1>

      <div className="topbar-right">
        <button className="icon-btn" aria-label="התראות">
          <IcBell size={18} />
          <span className="dot">3</span>
        </button>
        <button className="icon-btn" aria-label="עזרה">
          <IcHelp size={18} />
        </button>
        <button className="who">
          <span className="avatar">ש</span>
          <span>שירה</span>
          <IcChevron size={15} style={{ transform: 'rotate(90deg)' }} />
        </button>
      </div>
    </header>
  );
}

export function StageTabs({
  stage,
  onStage,
}: {
  stage: StageId;
  onStage: (s: StageId) => void;
}) {
  return (
    <nav className="stages">
      {STAGES.map((s) => (
        <button
          key={s.id}
          className={`stage-tab ${s.id === stage ? 'on' : ''}`}
          onClick={() => onStage(s.id)}
        >
          <Icon name={s.icon} size={18} />
          <span>{s.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Shell({
  section,
  onSection,
  stage,
  onStage,
  title,
  flush,
  bare,
  children,
}: {
  section: SectionId;
  onSection: (s: SectionId) => void;
  stage: StageId;
  onStage: (s: StageId) => void;
  title: string;
  flush?: boolean;
  /** Drop the project stage tabs — a screen that is not part of a project's
   *  lifecycle should not pretend to be, and the row is 60px of working
   *  height the lab would rather spend on the photo. */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="shell">
      <Sidebar section={section} onSection={onSection} />
      <div className="main">
        <TopBar title={title} onBack={() => onSection('projects')} />
        {!bare && <StageTabs stage={stage} onStage={onStage} />}
        <div className={`content ${flush ? 'flush' : ''}`}>
          {flush ? children : <div className="sheet">{children}</div>}
        </div>
      </div>
    </div>
  );
}
