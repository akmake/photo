import { Suspense, lazy, useEffect, useState } from 'react';
import { Shell } from './studio/Shell';
import { SECTION_TO_STAGE } from './studio/nav';
import type { SectionId, StageId } from './studio/nav';
import Today from './studio/screens/Today';
import Projects from './studio/screens/Projects';
import ProjectScreen from './studio/screens/Project';
import Clients from './studio/screens/Clients';
import { getProject } from './studio/store';
import { STAGE_SCREENS, Simple } from './studio/screens/Screens';

/* The business screens above are eager: one of them is always what the app opens
 * on, so deferring them would only add a flash.
 *
 * Everything below is a WORKSPACE — entered by a deliberate act, never the first
 * thing on screen — so it is fetched when it is actually opened. Statically
 * imported, this set dragged roughly fourteen thousand lines into the first
 * paint: AlbumStudio alone is the sole door into the album folder (18 files,
 * ~8,400 lines), Lab is another 1,500, and Editor pulls imageEngine's 1,300.
 * None of it is needed to render היום, and in dev every one of those modules is
 * a separate request the browser waits on before the app appears. */
const GalleryEdit = lazy(() => import('./studio/screens/GalleryEdit'));
const Lab = lazy(() => import('./lab/Lab'));
const Compare = lazy(() => import('./lab/Compare'));
const AlbumStudio = lazy(() => import('./album/AlbumStudio'));
const ColorMatch = lazy(() => import('./studio/screens/ColorMatch'));
const SetWorkbench = lazy(() => import('./studio/screens/SetWorkbench'));

/* The rail carries ONE axis — the business. A project's stages live inside the
 * project, because they are only ever true of one project at a time.
 *
 * The `stage` position below is what remains of the old second axis: the
 * pre-direction screens (editor, album, lab) still hang off it, and they keep
 * their tab row until the project screen absorbs them. The business screens
 * never show it. Build order is deliberate — tools last.
 */
/* Routes that were replaced. A tab left open on one of them would keep serving
 * the screen it replaced — which is exactly how a rewrite gets reported as
 * "nothing changed". A retired route resolves to its successor instead of
 * quietly still working. */
const RETIRED: Partial<Record<string, SectionId>> = {
  home: 'today',
  galleries: 'projects',
  culling: 'projects',
  orders: 'today',
  reports: 'today',
};

const LIVE_SECTIONS = new Set<string>([
  'today', 'projects', 'project', 'clients', 'calendar', 'settings',
  // pre-direction workspaces, still reachable until the project screen absorbs them
  'editing', 'albums', 'lab', 'compare',
]);

/** `#/section/stage`, plus `#/project/<id>` for one job — so any screen can be
 *  linked, reloaded and bookmarked. */
function readHash(): { section: SectionId; stage: StageId; id: string; sub: string } {
  // the `#/` is stripped first, so the section is element 0 — not 1
  const [sec, a, b] = window.location.hash.replace(/^#\/?/, '').split('/');
  const section = RETIRED[sec] ?? (LIVE_SECTIONS.has(sec) ? (sec as SectionId) : 'today');
  if (section === 'project') {
    return { section, stage: 'client-status', id: a ?? '', sub: b ?? '' };
  }
  return { section, stage: (a as StageId) || 'client-status', id: '', sub: '' };
}

/** The top bar states where you are, not what the product is called. */
const SECTION_TITLE: Partial<Record<SectionId, string>> = {
  today: 'היום',
  projects: 'פרויקטים',
  clients: 'לקוחות',
  calendar: 'יומן',
  settings: 'הגדרות',
};

export default function App() {
  const initial = readHash();
  const [section, setSection] = useState<SectionId>(initial.section);
  const [stage, setStage] = useState<StageId>(initial.stage);
  const [projectId, setProjectId] = useState<string>(initial.id);
  const [colorMatch, setColorMatch] = useState(initial.sub === 'color');
  // The set's workbench — one tool at a time, on top of the recipe so far.
  const [workbench, setWorkbench] = useState(initial.sub === 'edit');
  /* Which batch a tool was opened FOR. Carried here rather than looked up
   * inside the tool, because the tool is opened from the stage that made the
   * choice — and a tool that guesses its own layer is a tool that writes the
   * dance floor's colour onto the garden. */
  const [batch, setBatch] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setSection(h.section);
      setStage(h.stage);
      setProjectId(h.id);
      setColorMatch(h.sub === 'color');
      setWorkbench(h.sub === 'edit');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const sub = colorMatch ? '/color' : workbench ? '/edit' : '';
    const want = section === 'project'
      ? `#/project/${projectId}${sub}`
      : `#/${section}/${stage}`;
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', want);
    }
  }, [section, stage, projectId, colorMatch, workbench]);

  function openProject(id: string) {
    setProjectId(id);
    setSection('project');
  }

  function goSection(s: SectionId) {
    setSection(s);
    const mapped = SECTION_TO_STAGE[s];
    if (mapped) setStage(mapped);
  }

  function goStage(s: StageId) {
    setStage(s);
    // keep the sidebar honest about where we actually are
    const back = (Object.entries(SECTION_TO_STAGE) as [SectionId, StageId][])
      .find(([, st]) => st === s)?.[0];
    setSection(back ?? 'projects');
  }

  // The business sections render on their own — no stage, no tabs.
  const standalone: Partial<Record<SectionId, () => JSX.Element>> = {
    today: () => <Today onSection={goSection} onOpen={openProject} />,
    projects: () => <Projects onOpen={openProject} />,
    clients: () => <Clients onOpen={openProject} />,
    calendar: () => <Simple title="יומן" sub="צילומים קרובים ודדליינים" />,
    settings: () => <Simple title="הגדרות" sub="חשבון, מנוי, אחסון ותבניות" />,
  };

  const openedProject = section === 'project' ? getProject(projectId) : undefined;
  const Standalone = openedProject ? undefined : standalone[section];
  // The lab is not a project stage — it opens on its own, full-bleed, and the
  // stage tabs above it stay where they were.
  const isLab = section === 'lab';
  const isCompare = section === 'compare';
  const isEditor = stage === 'gallery-edit' && !Standalone && !isLab && !isCompare;
  const isAlbum = stage === 'album-design' && !Standalone && !isLab && !isCompare;

  let body: JSX.Element;
  let title = 'TEZA';

  if (openedProject && colorMatch) {
    body = (
      <ColorMatch
        project={openedProject}
        batchId={batch}
        onBack={() => setColorMatch(false)}
      />
    );
    title = `התאמת צבעים · ${openedProject.client}`;
  } else if (openedProject && workbench) {
    body = (
      <SetWorkbench
        project={openedProject}
        batchId={batch}
        onBack={() => setWorkbench(false)}
      />
    );
    title = `עריכה · ${openedProject.client}`;
  } else if (openedProject) {
    body = (
      <ProjectScreen
        project={openedProject}
        initialStage={(initial.sub || undefined) as never}
        onBack={() => goSection('projects')}
        onOpenTool={(what, batchId = null) => {
          setBatch(batchId);
          if (what === 'color') {
            setColorMatch(true);
            return;
          }
          if (what === 'edit') {
            // The set's own workbench, not the disconnected gallery editor.
            setWorkbench(true);
            return;
          }
          setStage('album-design');
          setSection('albums');
        }}
      />
    );
    title = openedProject.client;
  } else if (isLab) {
    body = <Lab />;
    title = 'מעבדה';
  } else if (isCompare) {
    body = <Compare />;
    title = 'קריאת עריכה';
  } else if (Standalone) {
    body = <Standalone />;
    title = SECTION_TITLE[section] ?? 'TEZA';
  } else if (isEditor) {
    body = <GalleryEdit />;
    title = 'עריכת גלריה';
  } else if (isAlbum) {
    body = <AlbumStudio />;
    title = 'עיצוב אלבום';
  } else {
    const S = STAGE_SCREENS[stage];
    body = S ? <S /> : <Simple title="בקרוב" sub="" />;
  }

  return (
    <Shell
      // A project is a place INSIDE projects — the rail stays lit on the list.
      section={section === 'project' ? 'projects' : section}
      onSection={goSection}
      stage={stage}
      onStage={goStage}
      title={title}
      flush={isEditor || isAlbum || isLab || isCompare || Boolean(openedProject && workbench)}
      // Editing a photograph owns the whole window: the business rail comes off
      // and the strip it used becomes the set being edited.
      rail={!(openedProject && workbench)}
      bare={isAlbum || isLab || isCompare}
      // Only the pre-direction project routes still carry the tab row.
      stages={!Standalone && !openedProject}
    >
      {/* The wait only becomes visible after a beat (see .screen-wait) — a
        * workspace that arrives in 40ms should not flash a loading line. */}
      <Suspense fallback={<div className="screen-wait">טוען…</div>}>
        {body}
      </Suspense>
    </Shell>
  );
}
