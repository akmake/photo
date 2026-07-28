import { useEffect, useState } from 'react';
import { Shell } from './studio/Shell';
import { SECTION_TO_STAGE } from './studio/nav';
import type { SectionId, StageId } from './studio/nav';
import { PROJECT } from './studio/demo';
import ClientStatus from './studio/screens/ClientStatus';
import GalleryEdit from './studio/screens/GalleryEdit';
import Lab from './lab/Lab';
import Compare from './lab/Compare';
import AlbumStudio from './album/AlbumStudio';
import {
  Clients, Home, STAGE_SCREENS, Simple,
} from './studio/screens/Screens';

/* The shell owns two independent positions:
 *   section — where in the business (sidebar)
 *   stage   — where in this project's lifecycle (tabs)
 *
 * Picking a sidebar section that maps to a stage moves BOTH, so "עיבוד גלריה"
 * in the sidebar and the "עיבוד גלריה" tab land on the same screen instead of
 * being two different routes to the same work.
 */
/** `#/section/stage` — so a screen can be linked, reloaded and bookmarked. */
function readHash(): { section: SectionId; stage: StageId } {
  // the `#/` is stripped first, so the section is element 0 — not 1
  const [sec, st] = window.location.hash.replace(/^#\/?/, '').split('/');
  return {
    section: (sec as SectionId) || 'home',
    stage: (st as StageId) || 'client-status',
  };
}

export default function App() {
  const initial = readHash();
  const [section, setSection] = useState<SectionId>(initial.section);
  const [stage, setStage] = useState<StageId>(initial.stage);

  useEffect(() => {
    const onHash = () => {
      const h = readHash();
      setSection(h.section);
      setStage(h.stage);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const want = `#/${section}/${stage}`;
    if (window.location.hash !== want) {
      window.history.replaceState(null, '', want);
    }
  }, [section, stage]);

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

  // A project stage wins over the section when one is selected; the sections
  // that are not part of a project's lifecycle render on their own.
  const standalone: Partial<Record<SectionId, () => JSX.Element>> = {
    home: Home,
    clients: Clients,
    orders: () => <Simple title="הזמנות ומוצרים" sub="הדפסות, אלבומים ומשלוחים" />,
    reports: () => <Simple title="דוחות" sub="הכנסות, עומס עבודה וזמני אספקה" />,
    settings: () => <Simple title="הגדרות" sub="סטודיו, מיתוג, אחסון ומשתמשים" />,
  };

  const Standalone = standalone[section];
  // The lab is not a project stage — it opens on its own, full-bleed, and the
  // stage tabs above it stay where they were.
  const isLab = section === 'lab';
  const isCompare = section === 'compare';
  const isEditor = stage === 'gallery-edit' && !Standalone && !isLab && !isCompare;
  const isAlbum = stage === 'album-design' && !Standalone && !isLab && !isCompare;

  let body: JSX.Element;
  let title = PROJECT.title;

  if (isLab) {
    body = <Lab />;
    title = 'מעבדה';
  } else if (isCompare) {
    body = <Compare />;
    title = 'קריאת עריכה';
  } else if (Standalone) {
    body = <Standalone />;
    title = 'TEZA AI';
  } else if (isEditor) {
    body = <GalleryEdit />;
  } else if (isAlbum) {
    body = <AlbumStudio />;
    title = 'עיצוב אלבום';
  } else if (stage === 'client-status') {
    body = <ClientStatus onStage={goStage} />;
  } else {
    const S = STAGE_SCREENS[stage];
    body = S ? <S /> : <Simple title="בקרוב" sub="" />;
  }

  return (
    <Shell
      section={section}
      onSection={goSection}
      stage={stage}
      onStage={goStage}
      title={title}
      flush={isEditor || isAlbum || isLab || isCompare}
      bare={isAlbum || isLab || isCompare}
    >
      {body}
    </Shell>
  );
}
