import React, { Suspense, lazy, useMemo, useState } from 'react';
import { useStudio } from '../studio/store';
import NewProject from '../studio/screens/NewProject';
import TzStatusScreen from './screens/TzStatusScreen';
import TodayV2 from './screens/TodayV2';
import ProjectsV2 from './screens/ProjectsV2';
import ImportV2 from './screens/ImportV2';
import BatchesV2 from './screens/BatchesV2';
import SendToClientV2 from './screens/SendToClientV2';
import WorkStageV2 from './screens/WorkStageV2';
import GalleryEditV2 from './screens/GalleryEditV2';
import { shootDay } from './screens/CalendarV2';
import {
  TzIconBell, TzIconBook, TzIconCalendar, TzIconFilter, TzIconFlask,
  TzIconFolder, TzIconGear, TzIconHeart, TzIconHelp, TzIconHome,
  TzIconLayers, TzIconSend, TzIconSliders, TzIconSparkle, TzIconUpload, TzIconUsers,
} from './TzIcons';
import './tz-exact.css';

const AlbumStudio = lazy(() => import('../album/AlbumStudio'));

/* The rest of the rail. Every one of these used to land on "המסך הזה יעוצב
 * בהמשך" — a menu of eight items where three worked. They are lazy for the
 * same reason AlbumStudio is: none of them is what the app opens on, and the
 * three workshops below drag their own engines and stylesheets with them. */
const ClientsV2 = lazy(() => import('./screens/ClientsV2'));
const CalendarV2 = lazy(() => import('./screens/CalendarV2'));
const SettingsV2 = lazy(() => import('./screens/SettingsV2'));
const SmartCleanup = lazy(() => import('../smart-cleanup/SmartCleanup'));
const LabSection = lazy(() => import('../lab/LabSection'));
const Experiments = lazy(() => import('../experiments/Experiments'));

interface V2AppProps {
  onSwitchToV1: () => void;
  onOpenProjectV1?: (id: string) => void;
}

/** What the top bar says on each screen. */
const SCREEN_TITLE: Record<string, string> = {
  today: 'היום בסטודיו',
  projects: 'פרויקטים בסטודיו',
  clients: 'לקוחות',
  calendar: 'יומן הצילומים',
  'smart-cleanup': 'ניקוי חכם',
  lab: 'מעבדה',
  experiments: 'כלים בניסיון',
  settings: 'הגדרות',
};

/** A screen on its way in. Named, so a slow first load says which one. */
function Waiting({ what }: { what: string }) {
  return (
    <div className="tz-screen-wait" style={{ padding: 40, textAlign: 'center', color: '#71717a' }}>
      טוען {what}…
    </div>
  );
}

export default function V2App({ onSwitchToV1, onOpenProjectV1 }: V2AppProps) {
  const [activeNav, setActiveNav] = useState<'today' | 'projects' | 'project-detail' | string>('today');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState('client-status');
  const [editTargetFrame, setEditTargetFrame] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /* פרויקט חדש opens here rather than on the projects screen, so the button on
   * the dashboard opens the form instead of merely walking you to the screen
   * that has the button that opens the form. */
  const [creating, setCreating] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const [labView, setLabView] = useState<'tools' | 'compare'>('tools');
  const studio = useStudio();

  const isEditing = activeNav === 'project-detail' && activeStage === 'gallery-edit';
  const isGrouping = activeNav === 'project-detail' && activeStage === 'batches';
  // סינון wants every pixel for pictures, but scrolls like a page.
  const isWorking = activeNav === 'project-detail' && activeStage === 'work';
  const isAlbumMode = activeNav === 'project-detail' && activeStage === 'album-design';
  // ייבוא is the gallery itself: it owns the whole area and the only scroll.
  const isImporting = activeNav === 'project-detail' && activeStage === 'gallery-upload';
  const isSidebarCollapsed = sidebarCollapsed || isEditing || isGrouping || isWorking || isAlbumMode;

  // Active project selection
  const selectedProject = studio.projects.find((p) => p.id === selectedProjectId) || studio.projects[0];
  const imported = studio.projects.reduce((sum, p) => sum + (p.imported || 0), 0);
  const rendered = studio.projects.reduce((sum, p) => sum + (p.rendered || 0), 0);
  /* Nothing imported means an EMPTY bar. It used to mean 39% — a number with no
   * source, sitting under the words "מצב ספרייה ומנוע" on a studio where not a
   * single photograph had been read yet. */
  const processedPercent = imported ? Math.min(100, Math.round((rendered / imported) * 100)) : 0;

  // Storage for client gallery uploads (max 50 GB)
  const MAX_STORAGE_GB = 50;
  const galleryProjects = studio.projects.filter((p) => p.hasGallery || p.state === 'waiting' || p.at >= 3);
  const uploadedPhotosCount = galleryProjects.reduce((sum, p) => sum + (p.imported || 0), 0);
  const usedGb = Math.min(MAX_STORAGE_GB, Number(((uploadedPhotosCount * 1.8) / 1024).toFixed(1)));
  const storagePercent = Math.min(100, Math.round((usedGb / MAX_STORAGE_GB) * 100));

  /* What actually wants the photographer today. The bell used to carry a red
   * "3" that was written into the markup and never moved, on an installation
   * with one project — so it said the same thing on an empty studio as on a
   * full one. It now counts two real things, and shows nothing when there are
   * none of them. */
  const attention = useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const week = midnight + 7 * 86_400_000;
    const waiting = studio.projects.filter((p) => p.state === 'waiting');
    const soon = studio.projects
      .filter((p) => p.state !== 'done')
      .map((p) => ({ project: p, when: shootDay(p) }))
      .filter((x): x is { project: typeof studio.projects[number]; when: Date } =>
        Boolean(x.when) && x.when!.getTime() >= midnight && x.when!.getTime() <= week)
      .sort((a, b) => a.when.getTime() - b.when.getTime());
    return { waiting, soon, count: waiting.length + soon.length };
  }, [studio.projects]);

  // The actual business sections of TEZA
  const BUSINESS_NAV = [
    { id: 'today', label: 'היום', icon: TzIconHome },
    { id: 'projects', label: 'פרויקטים', icon: TzIconFolder, count: studio.projects.length },
    { id: 'clients', label: 'לקוחות', icon: TzIconUsers },
    { id: 'calendar', label: 'יומן', icon: TzIconCalendar },
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
    { id: 'gallery-upload', label: 'ייבוא תמונות', icon: TzIconUpload },
    { id: 'batches', label: 'סשנים', icon: TzIconLayers },
    { id: 'work', label: 'סינון', icon: TzIconFilter },
    { id: 'send-to-client', label: 'שלח ללקוח', icon: TzIconSend },
    { id: 'gallery-edit', label: 'עריכה', icon: TzIconSliders },
    { id: 'album-design', label: 'אלבום', icon: TzIconBook },
  ];

  const projectTitle = selectedProject
    ? [selectedProject.client, selectedProject.event].filter(Boolean).join(' – ')
    // No project selected: name the screen, do not name a client who does not
    // exist. "מלי כץ – בת מצווה" sat in this header over real projects.
    : 'לא נבחר פרויקט';

  const handleOpenProject = (id: string, stage: string = 'client-status') => {
    setSelectedProjectId(id);
    setActiveStage(stage);
    setActiveNav('project-detail');
  };

  function renderMainContent() {
    if (activeNav === 'today') {
      return (
        <TodayV2
          onNavigate={(sec) => {
            setActiveNav(sec);
          }}
          onOpenProject={handleOpenProject}
          onNewProject={() => setCreating(true)}
        />
      );
    }

    if (activeNav === 'clients') {
      return (
        <Suspense fallback={<Waiting what="לקוחות" />}>
          <ClientsV2 onOpenProject={handleOpenProject} />
        </Suspense>
      );
    }

    if (activeNav === 'calendar') {
      return (
        <Suspense fallback={<Waiting what="היומן" />}>
          <CalendarV2 onOpenProject={handleOpenProject} />
        </Suspense>
      );
    }

    if (activeNav === 'settings') {
      return (
        <Suspense fallback={<Waiting what="ההגדרות" />}>
          <SettingsV2 />
        </Suspense>
      );
    }

    if (activeNav === 'smart-cleanup') {
      return (
        <Suspense fallback={<Waiting what="הניקוי החכם" />}>
          <SmartCleanup />
        </Suspense>
      );
    }

    if (activeNav === 'lab') {
      return (
        <Suspense fallback={<Waiting what="המעבדה" />}>
          <LabSection view={labView} onView={setLabView} />
        </Suspense>
      );
    }

    if (activeNav === 'experiments') {
      return (
        <Suspense fallback={<Waiting what="הכלים בניסיון" />}>
          <Experiments />
        </Suspense>
      );
    }

    if (activeNav === 'projects') {
      return (
        <ProjectsV2
          onOpenProject={handleOpenProject}
        />
      );
    }

    if (activeNav === 'project-detail') {
      const proj = selectedProject || studio.projects[0];

      if (activeStage === 'gallery-upload' && proj) {
        return (
          <ImportV2
            project={proj}
            onBack={() => setActiveStage('client-status')}
          />
        );
      }

      if (activeStage === 'batches' && proj) {
        return (
          <BatchesV2
            project={proj}
            onNext={() => setActiveStage('work')}
            onBack={() => setActiveStage('gallery-upload')}
          />
        );
      }

      if (activeStage === 'work' && proj) {
        return (
          <WorkStageV2
            project={proj}
            onNext={() => setActiveStage('send-to-client')}
            onBack={() => setActiveStage('batches')}
          />
        );
      }

      if (activeStage === 'send-to-client' && proj) {
        return (
          <SendToClientV2
            project={proj}
            onNext={() => setActiveStage('gallery-edit')}
            onBack={() => setActiveStage('work')}
            onNavigateToEdit={(frameName) => {
              setEditTargetFrame(frameName ?? null);
              setActiveStage('gallery-edit');
            }}
            onNavigateToAlbum={() => setActiveStage('album-design')}
          />
        );
      }

      if (activeStage === 'gallery-edit' && proj) {
        return (
          <GalleryEditV2
            project={proj}
            initialFrameName={editTargetFrame}
            onNext={() => setActiveStage('album-design')}
            onBack={() => setActiveStage('send-to-client')}
            onExitGeneral={() => setActiveStage('client-status')}
          />
        );
      }

      if (activeStage === 'album-design' && proj) {
        return (
          <Suspense fallback={<div className="tz-screen-wait" style={{ padding: 40, textAlign: 'center', color: '#71717a' }}>טוען עיצוב אלבום...</div>}>
            <AlbumStudio
              job={proj}
              onBack={() => setActiveStage('gallery-edit')}
            />
          </Suspense>
        );
      }

      return (
        <TzStatusScreen
          project={selectedProject}
          onNavigateStage={(stage) => setActiveStage(stage)}
        />
      );
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
          חזרה לפרויקטים
        </button>
      </div>
    );
  }

  return (
    <div className={`tz-app ${isEditing ? 'is-editing' : ''} ${isGrouping ? 'is-grouping' : ''}`}>
      {/* 1. SIDEBAR (Placed on Right in natural RTL) */}
      <aside className={`tz-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        {/* Top Header Row of Sidebar: Toggle button + Bell */}
        <div className="tz-sidebar-top-row">
          <button
            type="button"
            className="tz-sidebar-toggle-btn"
            onClick={() => setSidebarCollapsed(!isSidebarCollapsed)}
            title={isSidebarCollapsed ? 'הרחב תפריט' : 'כווץ תפריט לסרגל סמלים'}
            style={{ marginBottom: 0 }}
          >
            {isSidebarCollapsed ? '›' : '‹'}
          </button>

          <div className="tz-sidebar-bell-wrap">
            <button
              className="tz-icon-button"
              type="button"
              title={attention.count ? `${attention.count} דברים פתוחים` : 'אין כרגע דבר שממתין לך'}
              onClick={() => setAlerts((open) => !open)}
              aria-expanded={alerts}
            >
              <TzIconBell size={18} />
              {attention.count > 0 && <span className="tz-badge-dot">{attention.count}</span>}
            </button>

            {alerts && (
              <>
                <div className="tz-alerts-catch" onClick={() => setAlerts(false)} />
                <div className="tz-alerts" role="dialog" aria-label="מה פתוח">
                  <div className="tz-alerts-head">מה מחכה לך</div>
                  {attention.count === 0 && (
                    <p className="tz-alerts-none">אין כרגע צילום קרוב ואף לקוח לא ממתין לתשובה.</p>
                  )}
                  {attention.soon.map(({ project, when }) => (
                    <button
                      key={`s-${project.id}`}
                      type="button"
                      className="tz-alerts-row"
                      onClick={() => { setAlerts(false); handleOpenProject(project.id); }}
                    >
                      <strong>{project.event || 'צילום'} — {project.client}</strong>
                      <small>צילום ב־{when.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}</small>
                    </button>
                  ))}
                  {attention.waiting.map((project) => (
                    <button
                      key={`w-${project.id}`}
                      type="button"
                      className="tz-alerts-row"
                      onClick={() => { setAlerts(false); handleOpenProject(project.id, 'send-to-client'); }}
                    >
                      <strong>{project.client}</strong>
                      <small>{project.waitingSince ? `ממתין לאישור מאז ${project.waitingSince}` : 'ממתין לאישור הלקוח'}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Logo: FrameOps (clickable to return to today) */}
        <button
          type="button"
          className="tz-logo-wrap"
          onClick={() => setActiveNav('today')}
          title="FrameOps — חזרה לדף היום"
        >
          <img
            src="/frameops-logo.png"
            alt="FrameOps — studio operations for photographers"
            className="tz-logo-full"
          />
          <img
            src="/frameops-mark.png"
            alt="FrameOps"
            className="tz-logo-mark"
          />
        </button>

        {/* Business Navigation items */}
        <nav className="tz-nav-list">
          {BUSINESS_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id || (item.id === 'projects' && activeNav === 'project-detail');
            return (
              <button
                key={item.id}
                type="button"
                className={`tz-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  setActiveNav(item.id);
                }}
              >
                <span className="tz-nav-icon"><Icon size={17} /></span>
                <span>{item.label}</span>
                {item.count !== undefined && item.count > 0 && (
                  <span className="tz-nav-counter">{item.count}</span>
                )}
              </button>
            );
          })}

        </nav>

        {/* Storage Card: Client Gallery Uploads (out of 50 GB) */}
        <div className="tz-storage-card">
          <div className="tz-storage-title">
            <span style={{ fontSize: '13px' }}>☁</span>
            <span>הועלה לבחירת לקוחות</span>
          </div>
          <div className="tz-storage-bar">
            <div className="tz-storage-fill" style={{ width: `${Math.max(storagePercent, usedGb > 0 ? 4 : 0)}%` }} />
          </div>
          <div className="tz-storage-numbers" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>{usedGb} GB</strong> מתוך {MAX_STORAGE_GB} GB</span>
            <span style={{ color: 'var(--tz-text-muted)', fontSize: '11px' }}>{storagePercent}%</span>
          </div>
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

        {/* The studio itself */}
        <button
          className="tz-nav-user-item"
          type="button"
          title="המערכת והתיקיות"
          onClick={() => setActiveNav('settings')}
        >
          <div className="tz-user-avatar-initial">T</div>
          <div className="tz-nav-user-copy">
            <strong>הסטודיו שלי</strong>
            <small>{studio.projects.length} פרויקטים</small>
          </div>
        </button>
      </aside>

      {/* 2. MAIN CONTENT WRAPPER */}
      <div className="tz-main-wrapper">


        {/* Stage Tabs Bar (shown only when in single project cockpit mode) */}
        {activeNav === 'project-detail' && (
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
        <main className={`tz-content-scroll ${isAlbumMode ? 'album-mode' : ''} ${isGrouping ? 'groups-mode' : ''} ${isImporting ? 'import-mode' : ''}`}>
          {renderMainContent()}
        </main>
      </div>

      {/* One job opens from everywhere: the dashboard, the rail, the empty
        * projects screen. The form lives here so none of them has to walk the
        * photographer to a different screen first. */}
      {creating && (
        <NewProject
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            handleOpenProject(created.id);
          }}
        />
      )}
    </div>
  );
}
