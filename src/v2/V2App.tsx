import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
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
import '@fontsource/ibm-plex-sans-hebrew/400.css';
import '@fontsource/ibm-plex-sans-hebrew/500.css';
import '@fontsource/ibm-plex-sans-hebrew/600.css';
import './tz-exact.css';
import './frame.css';
import { TourProvider } from '../tour/TourProvider';
import ProjectFrame from './ProjectFrame';
import {
  QuickSearch, StatusBar, TopBar, readTheme, saveTheme, saveLastOpen, BUSINESS_TABS, TOOL_ITEMS,
} from './Frame';
import type { Theme } from './Frame';

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
  /* פרויקט חדש opens here rather than on the projects screen, so the button on
   * the dashboard opens the form instead of merely walking you to the screen
   * that has the button that opens the form. */
  const [creating, setCreating] = useState(false);
  const [labView, setLabView] = useState<'tools' | 'compare'>('tools');
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [searching, setSearching] = useState(false);
  /* The details panel beside a list. Open by default on a window wide enough
   * to hold it and the list together; closed below that, and it follows the
   * window across that line — never fighting a choice made at the same width. */
  const [inspector, setInspector] = useState(() => window.innerWidth >= 1180);
  const studio = useStudio();

  useEffect(() => {
    let wide = window.innerWidth >= 1180;
    const onResize = () => {
      const now = window.innerWidth >= 1180;
      if (now !== wide) { wide = now; setInspector(now); }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const isEditing = activeNav === 'project-detail' && activeStage === 'gallery-edit';
  const isGrouping = activeNav === 'project-detail' && activeStage === 'batches';
  // סינון wants every pixel for pictures, but scrolls like a page.
  const isWorking = activeNav === 'project-detail' && activeStage === 'work';
  const isAlbumMode = activeNav === 'project-detail' && activeStage === 'album-design';
  // ייבוא is the gallery itself: it owns the whole area and the only scroll.
  const isImporting = activeNav === 'project-detail' && activeStage === 'gallery-upload';

  const selectedProject = studio.projects.find((p) => p.id === selectedProjectId) || studio.projects[0];
  /* ייבוא needs a project to import INTO. Inside a project that is the open
   * one; on the projects list, the one selected there. Nowhere else is there a
   * right answer, so the button says what it needs instead of guessing — it
   * used to drop the photographs into whichever project happened to be first. */
  const importTarget = activeNav === 'project-detail'
    ? selectedProject
    : activeNav === 'projects' && selectedProjectId
    ? studio.projects.find((p) => p.id === selectedProjectId)
    : undefined;

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

  // The actual stages of a project in TEZA
  /* Remember where the photographer is, for היום's "המשך מאיפה שעצרת". */
  useEffect(() => {
    if (activeNav === 'project-detail' && selectedProjectId) saveLastOpen(selectedProjectId, activeStage);
  }, [activeNav, selectedProjectId, activeStage]);

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
          inspector={inspector}
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
          <SettingsV2 onReplayWelcome={() => setActiveNav('today')} />
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
          onNewProject={() => setCreating(true)}
          selectedId={selectedProjectId}
          onSelect={setSelectedProjectId}
          inspector={inspector}
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
          מסך {[...BUSINESS_TABS, ...TOOL_ITEMS].find((i) => i.id === activeNav)?.label || activeNav}
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

  /* Which screen the tour engine is looking at: the rail item, or — inside a
   * project — the stage. Its "?" button and first-visit tours key on this. */
  const tourScreen = activeNav === 'project-detail' ? activeStage : activeNav;

  const isStatus = activeNav === 'project-detail' && activeStage === 'client-status';
  const themed = activeNav === 'projects' || activeNav === 'today' || isWorking || isStatus;

  return (
    <TourProvider screen={tourScreen}>
    <div
      className={`tz-app fo-app ${isEditing ? 'is-editing' : ''} ${isGrouping ? 'is-grouping' : ''}`}
      data-theme={theme}
    >
      <TopBar
        activeNav={activeNav}
        onNav={setActiveNav}
        projectCount={studio.projects.length}
        onNewProject={() => setCreating(true)}
        onImport={importTarget ? () => handleOpenProject(importTarget.id, 'gallery-upload') : undefined}
        importHint={importTarget
          ? `ייבוא תמונות אל ${importTarget.client}`
          : 'בחר פרויקט ברשימת הפרויקטים, או פתח אחד, כדי לייבא אליו תמונות'}
        onSearch={() => setSearching(true)}
        attention={attention}
        onOpenProject={handleOpenProject}
        inspector={activeNav === 'projects' || activeNav === 'today' ? { open: inspector, toggle: () => setInspector((o) => !o) } : null}
        theme={theme}
        onTheme={() => setTheme((t) => {
          const next: Theme = t === 'dark' ? 'light' : 'dark';
          saveTheme(next);
          return next;
        })}
      />

      {/* 2. MAIN CONTENT WRAPPER */}
      <div className="tz-main-wrapper">


        {/* Inside a project: which project, and its stages. */}
        {activeNav === 'project-detail' && selectedProject && (
          <ProjectFrame
            project={selectedProject}
            stage={activeStage}
            onStage={setActiveStage}
            onBack={() => setActiveNav('projects')}
          />
        )}

        {/* Content Area */}
        <main className={`tz-content-scroll fo-content ${themed ? 'is-themed' : ''} ${isAlbumMode ? 'album-mode' : ''} ${isGrouping ? 'groups-mode' : ''} ${isImporting ? 'import-mode' : ''}`}>
          {renderMainContent()}
        </main>
      </div>

      <StatusBar
        status={studio.status}
        fault={studio.fault}
        saveFault={studio.saveFault}
        projects={studio.projects}
      />

      {searching && (
        <QuickSearch
          projects={studio.projects}
          onClose={() => setSearching(false)}
          onOpenProject={(id) => handleOpenProject(id)}
          onNav={setActiveNav}
          onNewProject={() => setCreating(true)}
        />
      )}

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
    </TourProvider>
  );
}
