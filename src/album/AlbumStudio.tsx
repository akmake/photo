import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IcBook, IcCheck, IcChevron, IcDownload, IcEye, IcGallery, IcSparkle,
  IcUndo, IcUpload,
} from '../design/Icons';
import type {
  AlbumPhoto, AlbumPhotoAnalysis, AlbumProject, AlbumSpread, LayoutSlot,
  PhotoFitMode, PhotoFrameSettings,
} from './model';
import { FIRST_PRINT_PROFILE, PRINT_PROFILES } from './model';
import {
  buildAlbumLayoutCandidates, EMPTY_GENERATED_LAYOUT, type GeneratedAlbumLayout,
} from './layoutEngine';
import { assessCrop } from './cropEngine';
import { LAYOUT_TEMPLATES, TEMPLATE_PHOTO_COUNTS } from './layoutTemplates';
import { analyzeAlbumPhoto } from '../api';
import { exportAlbumForPrint, exportAlbumProof } from './exportEngine';
import { buildAutomaticAlbum } from './albumFlow';
import AlbumTimeline from './AlbumTimeline';
import {
  deleteAlbum, duplicateAlbum, listAlbums, loadAlbum, renameAlbum, saveAlbum, storePhotoBlob,
  type AlbumSummary,
} from './albumStorage';
import AlbumPreview from './AlbumPreview';
import ReviewWorkspace from './ReviewWorkspace';
import CoverEditor from './CoverEditor';
import PreflightPanel from './PreflightPanel';
import OrganizeView from './OrganizeView';
import AlbumLibrary from './AlbumLibrary';
import { useProjectFiles } from '../studio/store';
import type { Project as StudioProject } from '../studio/store';
import { framesToPool, enrichPool } from './projectPool';
import { runAlbumPreflight, type PreflightIssue } from './preflightEngine';
// 3,000 lines of album styling, loaded with the album and not before. This file
// is the ONLY way into the album folder from outside it, so importing the sheet
// here covers every album component. The sheet carries no global or element
// selectors — .album-*, .library-*, .organize-*, .review-*, .cover-*,
// .preflight-*, .tl-*, .abm-* — and all of those classes are used only by files
// under src/album, so arriving late changes nothing anywhere else.
import './album.css';

const DEMO_PHOTOS_BASE: AlbumPhoto[] = [
  { id: 'p1', name: 'רגע עם הסוס', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.58, y: 0.45 } },
  { id: 'p2', name: 'פורטרט בחוץ', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.5, y: 0.34 } },
  { id: 'p3', name: 'רגע סתווי', url: '/demo/a.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.48, y: 0.44 } },
  { id: 'p4', name: 'דיוקן נבחר', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.54, y: 0.32 } },
  { id: 'p5', name: 'פריים רחב', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.63, y: 0.45 } },
  { id: 'p6', name: 'פרט משלים', url: '/demo/a.jpg', orientation: 'square', widthPx: 1400, heightPx: 1400, focalPoint: { x: 0.5, y: 0.5 } },
  { id: 'p7', name: 'רגע טבעי', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.58, y: 0.46 } },
  { id: 'p8', name: 'דיוקן עם סוס', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.52, y: 0.34 } },
  { id: 'p9', name: 'מבט מהצד', url: '/demo/a.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.56, y: 0.47 } },
  { id: 'p10', name: 'רגע שקט', url: '/demo/c.jpg', orientation: 'portrait', widthPx: 1067, heightPx: 1600, focalPoint: { x: 0.5, y: 0.36 } },
  { id: 'p11', name: 'פריים לסיום', url: '/demo/b.jpg', orientation: 'landscape', widthPx: 1600, heightPx: 1067, focalPoint: { x: 0.62, y: 0.46 } },
  { id: 'p12', name: 'תמונה משלימה', url: '/demo/a.jpg', orientation: 'square', widthPx: 1400, heightPx: 1400, focalPoint: { x: 0.5, y: 0.5 } },
];

const DEMO_ANALYSIS: Record<string, AlbumPhotoAnalysis> = {
  '/demo/a.jpg': {
    status: 'ready',
    faces: [{ x: 0.50331, y: 0.32614, width: 0.13707, height: 0.16908 }],
    subject: { x: 0.32474, y: 0.34063, width: 0.3177, height: 0.44688 },
    focalPoint: { x: 0.54978, y: 0.44903 },
    sharpnessScore: 0.486,
    qualityScore: 0.5926,
    analyzedBy: 'mediapipe-local-v1',
  },
  '/demo/b.jpg': {
    status: 'ready',
    faces: [{ x: 0.47894, y: 0.30108, width: 0.13497, height: 0.24971 }],
    subject: { x: 0.3, y: 0.08441, width: 0.44531, height: 0.91559 },
    focalPoint: { x: 0.54048, y: 0.455 },
    sharpnessScore: 0.7496,
    qualityScore: 0.8047,
    analyzedBy: 'mediapipe-local-v1',
  },
  '/demo/c.jpg': {
    status: 'ready',
    faces: [{ x: 0.50345, y: 0.32609, width: 0.13718, height: 0.16897 }],
    subject: { x: 0.28605, y: 0.33984, width: 0.35756, height: 0.44688 },
    focalPoint: { x: 0.54524, y: 0.44875 },
    sharpnessScore: 0.8443,
    qualityScore: 0.8238,
    analyzedBy: 'mediapipe-local-v1',
  },
};

const DEMO_PHOTOS: AlbumPhoto[] = DEMO_PHOTOS_BASE.map((photo) => ({
  ...photo,
  widthPx: photo.url.endsWith('/b.jpg') ? 5472 : 3648,
  heightPx: photo.url.endsWith('/b.jpg') ? 3648 : 5472,
  orientation: photo.url.endsWith('/b.jpg') ? 'landscape' : 'portrait',
  focalPoint: DEMO_ANALYSIS[photo.url].focalPoint,
  analysis: DEMO_ANALYSIS[photo.url],
}));

const INITIAL_SPREADS: AlbumSpread[] = [
  { id: 's1', pageStart: 2, layoutId: 'balanced', photoIds: ['p1'], background: '#f4efe7', locked: false, status: 'draft' },
  { id: 's2', pageStart: 4, layoutId: 'balanced', photoIds: ['p2', 'p3'], background: '#f8f6f1', locked: false, status: 'draft' },
  { id: 's3', pageStart: 6, layoutId: 'balanced', photoIds: ['p4', 'p5', 'p6', 'p7', 'p8'], background: '#f5efe7', locked: false, status: 'draft' },
  { id: 's4', pageStart: 8, layoutId: 'balanced', photoIds: [], background: '#e9e2d8', locked: false, status: 'draft' },
  { id: 's5', pageStart: 10, layoutId: 'balanced', photoIds: [], background: '#f8f6f1', locked: false, status: 'draft' },
];

type PhotoTrayFilter = 'available' | 'unused' | 'used' | 'all';
interface PersonalLayout {
  id: string;
  name: string;
  photoCount: number;
  pageAspect: number;
  slots: LayoutSlot[];
}

const DEFAULT_FRAME_SETTINGS: PhotoFrameSettings = {
  fit: 'smart',
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

const INITIAL_PROJECT: AlbumProject = {
  id: 'album-mali',
  name: 'מלי כץ — בת מצווה',
  productProfileId: FIRST_PRINT_PROFILE.id,
  styleName: 'Fine Art',
  spreads: INITIAL_SPREADS,
  activeSpreadId: 's3',
};

function orientationFor(width: number, height: number): AlbumPhoto['orientation'] {
  const ratio = width / height;
  if (ratio > 1.12) return 'landscape';
  if (ratio < 0.88) return 'portrait';
  return 'square';
}

export default function AlbumStudio({ job, onBack }: {
  /** The project this album belongs to. Its frames ARE the album's photo pool,
   *  served from disk by the engine — nothing is imported or copied. Optional so
   *  the legacy standalone route (#/albums) still renders on its own photos. */
  job?: StudioProject;
  onBack?: () => void;
} = {}) {
  const [project, setProject] = useState(INITIAL_PROJECT);
  // In project mode the pool is the project's frames (seeded by the effect
  // below), so there is nothing to demo. The demo set survives only for the
  // standalone route, which has no project to draw from.
  const [photos, setPhotos] = useState<AlbumPhoto[]>(job ? [] : DEMO_PHOTOS);
  const [historyPast, setHistoryPast] = useState<AlbumProject[]>([]);
  const [historyFuture, setHistoryFuture] = useState<AlbumProject[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [albumSelectedIds, setAlbumSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  /* Double-click a frame to reposition the PHOTO inside it (pan + zoom); until
   * then a drag anywhere on the frame moves the frame itself. One frame at a
   * time is in this mode. */
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [photoFilter, setPhotoFilter] = useState<PhotoTrayFilter>('available');
  const [showGuides, setShowGuides] = useState(true);
  const [panelTab, setPanelTab] = useState<'layouts' | 'design'>('layouts');
  const [templateCount, setTemplateCount] = useState<number | null>(null);
  const [notice, setNotice] = useState('הטיוטה נשמרה מקומית');
  const [photoLimit, setPhotoLimit] = useState(60);
  const [isExporting, setIsExporting] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  /* `organize` is the album; `design` is one spread. The module opens on the
   * album, because that is the question a photographer actually asks first. */
  const [mode, setMode] = useState<'timeline' | 'organize' | 'design'>('organize');
  /* Null means the library is showing. An album is a saved thing you come back
   * to, so nothing is open until the photographer picks one. */
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AlbumSummary[]>(() => listAlbums());
  const [showPreview, setShowPreview] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showCover, setShowCover] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const [printProfiles, setPrintProfiles] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('album-print-profiles') ?? '[]');
      if (!Array.isArray(saved) || !saved.length) return PRINT_PROFILES;
      return PRINT_PROFILES.map((base) => ({
        ...base,
        ...(saved.find((item) => item.id === base.id) ?? {}),
      }));
    } catch {
      return PRINT_PROFILES;
    }
  });
  const [personalLayouts, setPersonalLayouts] = useState<PersonalLayout[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('album-personal-layouts') ?? '[]');
    } catch {
      return [];
    }
  });
  const fileInput = useRef<HTMLInputElement>(null);
  // The project's frames, loaded from disk on demand. Empty id (standalone
  // route) is a no-op in the store, so this stays an unconditional hook.
  const jobFiles = useProjectFiles(job?.id ?? '');
  // Frames whose analysis has already been dispatched this session, so opening
  // a second album in the same project does not re-analyse the same files.
  const enrichingRef = useRef<Set<string>>(new Set());
  /* Liveness is per-COMPONENT, not per-effect. Analysis is dispatched from an
   * effect that re-runs whenever the frame list changes identity; tying the
   * "still mounted?" flag to that effect's cleanup meant the first dispatch's
   * results were thrown away the moment the frames notified again, and every
   * photo stayed `pending`. This ref is only ever cleared on real unmount. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const panSession = useRef<{
    slotIndex: number;
    startX: number;
    startY: number;
    positionX: number;
    positionY: number;
    before: AlbumProject;
    moved: boolean;
  } | null>(null);
  /* Direct-manipulation of the FRAME itself — move and resize on the canvas,
   * the way Canva and InDesign do it, so a layout is built by dragging boxes
   * instead of typing four numbers into sliders. */
  const frameGesture = useRef<{
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    index: number;
    startX: number;
    startY: number;
    slot: LayoutSlot;
    baseSlots: LayoutSlot[];
    rect: DOMRect;
    before: AlbumProject;
    moved: boolean;
  } | null>(null);
  const suppressFrameClick = useRef(false);

  useEffect(() => {
    if (!activeAlbumId) return undefined;
    let alive = true;
    setIsHydrated(false);
    loadAlbum(activeAlbumId)
      .then((saved) => {
        if (!alive || !saved) return;
        setProject(saved.project);
        setPhotos(saved.photos);
        setNotice(`${saved.project.name} נפתח`);
      })
      .catch(() => setNotice('לא ניתן היה לפתוח את האלבום'))
      .finally(() => {
        if (alive) setIsHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, [activeAlbumId]);

  useEffect(() => {
    // autosave belongs to the OPEN album; with none open there is nothing to write
    if (!isHydrated || !activeAlbumId) return undefined;
    const timer = window.setTimeout(() => {
      saveAlbum(project, photos);
      setAlbums(listAlbums());
      setNotice('כל השינויים נשמרו אוטומטית');
    }, 600);
    return () => window.clearTimeout(timer);
  }, [activeAlbumId, isHydrated, photos, project]);

  /* THE POOL IS THE PROJECT.
   *
   * With an album open under a project, the available photos ARE the project's
   * frames — re-derived here rather than trusted from the saved copy, because
   * the disk is the authority on what still exists. Placement survives a
   * re-derivation because a photo's id is its frame's own file name, which is
   * also what the spreads reference. Analysis already resolved this session is
   * kept so a re-open does not blank the dimensions back to pending.
   *
   * Enrichment (real size, faces, focal point) runs a few frames at a time and
   * only once per frame per session. It is gated on an album being open, so
   * merely browsing the library analyses nothing. */
  useEffect(() => {
    if (!job || !activeAlbumId) return undefined;
    const frames = jobFiles.frames;
    setPhotos((prev) => {
      const prior = new Map(prev.map((photo) => [photo.id, photo]));
      return framesToPool(frames).map((fresh) => {
        const old = prior.get(fresh.id);
        // keep a resolved analysis; take the fresh url in case `shown` changed
        return old && old.analysis?.status === 'ready'
          ? { ...fresh, orientation: old.orientation, widthPx: old.widthPx, heightPx: old.heightPx, focalPoint: old.focalPoint, analysis: old.analysis }
          : fresh;
      });
    });

    // Skip anything already analysed — a saved album reloads with its analysis
    // intact, so re-opening it must not put the engine through 23 scans again.
    const readyIds = new Set(
      photos.filter((photo) => photo.analysis?.status === 'ready').map((photo) => photo.id),
    );
    const toEnrich = framesToPool(frames).filter(
      (photo) => !readyIds.has(photo.id) && !enrichingRef.current.has(photo.id),
    );
    toEnrich.forEach((photo) => enrichingRef.current.add(photo.id));
    if (toEnrich.length) {
      void enrichPool(toEnrich, (enriched) => {
        if (!mountedRef.current) return;
        setPhotos((prev) => prev.map((photo) => (photo.id === enriched.id ? { ...photo, ...enriched } : photo)));
      });
    }
    return undefined;
  }, [job?.id, activeAlbumId, jobFiles.frames]);

  /* The core loop is the keyboard: vertical cycles this spread's candidate
   * layouts, horizontal walks the album. The album reads right-to-left, so
   * LEFT advances — matching the direction the pages actually turn. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // never steal a keystroke that belongs to a field (alb.md §14.5).
      // The target is not always an Element — guard the method, not just null.
      const target = event.target;
      if (target instanceof Element
        && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (showPreview || showReview || showCover || showPreflight) return;

      switch (event.key) {
        // cycling a layout you cannot see would change the album blindly
        case 'ArrowUp':   if (mode === 'design') { event.preventDefault(); cycleLayout(-1); } break;
        case 'ArrowDown': if (mode === 'design') { event.preventDefault(); cycleLayout(1); } break;
        case 'ArrowLeft': event.preventDefault(); setActiveSpread(spreadIndex + 1); break;
        case 'ArrowRight':event.preventDefault(); setActiveSpread(spreadIndex - 1); break;
        case 'Escape':    setCropIndex(null); setSelectedSlotIndex(null); setSelectedPhotoId(null); break;
        default: break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const spreadIndex = project.spreads.findIndex((spread) => spread.id === project.activeSpreadId);
  const spread = project.spreads[spreadIndex] ?? project.spreads[0];
  const profile = printProfiles.find((item) => item.id === project.productProfileId)
    ?? FIRST_PRINT_PROFILE;
  const layoutCandidates = useMemo(
    () => buildAlbumLayoutCandidates(
      spread.photoIds,
      photos,
      profile.closedWidthMm / profile.closedHeightMm,
    ),
    [photos, profile.closedHeightMm, profile.closedWidthMm, spread.photoIds],
  );
  const generatedLayout = layoutCandidates.find((candidate) => candidate.id === spread.layoutId)
    ?? layoutCandidates[0]
    ?? EMPTY_GENERATED_LAYOUT;
  const layout = spread.customSlots?.length === spread.photoIds.length ? {
    ...generatedLayout,
    id: spread.layoutId,
    name: 'פריסה אישית',
    slots: spread.customSlots,
    photoIds: spread.photoIds,
    explanation: 'פריסה אישית שנערכה ידנית',
  } : generatedLayout;
  const usedIds = useMemo(() => new Set(project.spreads.flatMap((item) => item.photoIds)), [project.spreads]);
  const currentSpreadIds = useMemo(() => new Set(spread.photoIds), [spread.photoIds]);
  const previouslyUsedIds = useMemo(
    () => new Set(project.spreads.slice(0, Math.max(0, spreadIndex)).flatMap((item) => item.photoIds)),
    [project.spreads, spreadIndex],
  );
  const filteredPhotos = useMemo(() => photos.filter((photo) => {
    if (photoFilter === 'available') return !previouslyUsedIds.has(photo.id);
    if (photoFilter === 'unused') return !usedIds.has(photo.id);
    if (photoFilter === 'used') return usedIds.has(photo.id);
    return true;
  }), [photoFilter, photos, previouslyUsedIds, usedIds]);
  const visiblePhotos = filteredPhotos.slice(0, photoLimit);
  const selectedSlot = selectedSlotIndex === null ? null : layout.slots[selectedSlotIndex];
  const selectedFramePhoto = selectedSlotIndex === null
    ? null
    : photos.find((photo) => photo.id === layout.photoIds[selectedSlotIndex]) ?? null;
  const selectedFrameSettings = selectedSlot
    ? spread.frameSettings?.[selectedSlot.id] ?? {
      ...DEFAULT_FRAME_SETTINGS,
      positionX: (selectedFramePhoto?.focalPoint?.x ?? 0.5) * 100,
      positionY: (selectedFramePhoto?.focalPoint?.y ?? 0.5) * 100,
    }
    : null;
  const selectedCrop = selectedSlot && selectedFramePhoto && selectedFrameSettings
    ? assessCrop(
      selectedFramePhoto,
      selectedSlot,
      selectedFrameSettings,
      profile.spreadWidthMm / profile.spreadHeightMm,
    )
    : null;
  /* When the crop window already spans the whole photo on an axis, there is
   * nothing to slide along it — the frame matches the photo there. Say so and
   * lock that one slider, instead of letting it snap back unexplained. */
  const canPanX = selectedCrop?.fit === 'cover' && selectedCrop.crop.width < 0.999;
  const canPanY = selectedCrop?.fit === 'cover' && selectedCrop.crop.height < 0.999;
  const preflightIssues = useMemo(
    () => runAlbumPreflight(project, photos, profile),
    [photos, profile, project],
  );
  const preflight = useMemo(() => ({
    blockers: preflightIssues.filter((issue) => issue.severity === 'blocker').length,
    warnings: preflightIssues.filter((issue) => issue.severity === 'warning').length,
    lowResolution: preflightIssues.filter((issue) => issue.code === 'LOW_PPI').length,
    riskyCrop: preflightIssues.filter((issue) => issue.code === 'UNSAFE_CROP').length,
    waitingAnalysis: preflightIssues.filter((issue) => issue.code === 'ANALYSIS_PENDING').length,
    overlaps: preflightIssues.filter((issue) => issue.code === 'FRAME_OVERLAP').length,
    profileIssues: preflightIssues.filter((issue) => issue.target === 'profile').length,
    approvalIssues: preflightIssues.filter((issue) => issue.target === 'review').length,
    total: preflightIssues.filter((issue) => issue.severity === 'blocker').length,
  }), [preflightIssues]);

  function commitProject(next: AlbumProject | ((current: AlbumProject) => AlbumProject)) {
    const resolved = typeof next === 'function' ? next(project) : next;
    setHistoryPast((items) => [...items.slice(-49), project]);
    setHistoryFuture([]);
    setProject(resolved);
  }

  function undoProject() {
    const previous = historyPast[historyPast.length - 1];
    if (!previous) return;
    setHistoryPast((items) => items.slice(0, -1));
    setHistoryFuture((items) => [project, ...items].slice(0, 50));
    setProject(previous);
    setSelectedSlotIndex(null);
    setNotice('השינוי האחרון בוטל');
  }

  function redoProject() {
    const next = historyFuture[0];
    if (!next) return;
    setHistoryFuture((items) => items.slice(1));
    setHistoryPast((items) => [...items.slice(-49), project]);
    setProject(next);
    setSelectedSlotIndex(null);
    setNotice('השינוי הוחזר');
  }

  function updateSpread(patch: Partial<AlbumSpread>) {
    commitProject((current) => ({
      ...current,
      spreads: current.spreads.map((item) => item.id === spread.id ? { ...item, ...patch } : item),
    }));
    setNotice('השינויים נשמרו');
  }

  function updatePrintProfile(patch: Partial<typeof profile>) {
    const invalidatesCover = patch.closedWidthMm !== undefined
      || patch.closedHeightMm !== undefined
      || patch.spreadWidthMm !== undefined
      || patch.spreadHeightMm !== undefined;
    const next = printProfiles.map((item) => (
      item.id === profile.id ? {
        ...item,
        ...patch,
        coverSpec: patch.coverSpec ?? (
          invalidatesCover ? { ...item.coverSpec, verified: false } : item.coverSpec
        ),
      } : item
    ));
    setPrintProfiles(next);
    localStorage.setItem('album-print-profiles', JSON.stringify(next));
    setNotice('פרופיל הדפוס נשמר במחשב');
  }

  function setActiveSpread(index: number) {
    const next = project.spreads[index];
    if (!next) return;
    setProject((current) => ({ ...current, activeSpreadId: next.id }));
    setSelectedPhotoId(null);
    setSelectedSlotIndex(null);
    setPhotoFilter('available');
    setPhotoLimit(60);
  }

  function addSpread() {
    const next: AlbumSpread = {
      id: `spread-${Date.now()}`,
      pageStart: project.spreads.length * 2 + 2,
      layoutId: 'balanced',
      photoIds: [],
      background: '#f8f6f1',
      locked: false,
      status: 'draft',
      frameSettings: {},
    };
    commitProject((current) => ({
      ...current,
      spreads: [...current.spreads, next],
      activeSpreadId: next.id,
    }));
    setSelectedSlotIndex(null);
    setPhotoFilter('available');
    setNotice('נוספה כפולה חדשה');
  }

  function removeSpread() {
    if (project.spreads.length <= 1) {
      setNotice('האלבום חייב להכיל לפחות כפולה אחת');
      return;
    }
    const remaining = project.spreads
      .filter((item) => item.id !== spread.id)
      .map((item, index) => ({ ...item, pageStart: 2 + index * 2 }));
    const nextActive = remaining[Math.min(spreadIndex, remaining.length - 1)];
    commitProject((current) => ({
      ...current,
      spreads: remaining,
      activeSpreadId: nextActive.id,
    }));
    setSelectedSlotIndex(null);
    setNotice('הכפולה נמחקה; התמונות נשארו במאגר');
  }

  function createAlbum(name: string, productProfileId: string) {
    const id = `album-${Date.now()}`;
    const fresh: AlbumProject = {
      id,
      name,
      productProfileId,
      styleName: 'Fine Art',
      /* One empty spread, so the album opens on a page rather than on nothing.
       * Photos are chosen next, from the tray. */
      spreads: [{
        id: 's1', pageStart: 2, layoutId: 'balanced', photoIds: [],
        background: '#f8f6f1', locked: false, status: 'draft',
      }],
      activeSpreadId: 's1',
    };
    saveAlbum(fresh, []);
    setAlbums(listAlbums());
    setProject(fresh);
    setPhotos([]);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSelectedSlotIndex(null);
    setSelectedPhotoId(null);
    setAlbumSelectedIds(new Set());
    setSelectionMode(false);
    // Straight to the timeline — add photos, and they pace themselves into
    // spreads. No empty spread staring back.
    setMode('timeline');
    setActiveAlbumId(id);
    setNotice('הוסף את התמונות שייכנסו לאלבום');
  }

  function closeAlbum() {
    // flush before leaving; the autosave debounce may not have fired yet
    if (activeAlbumId && isHydrated) saveAlbum(project, photos);
    setAlbums(listAlbums());
    setActiveAlbumId(null);
    setSelectedSlotIndex(null);
    setSelectedPhotoId(null);
    setMode('organize');
  }

  /** Reorder by dropping one spread onto another's slot, from the organise grid. */
  function reorderSpread(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const reordered = [...project.spreads];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    commitProject((current) => ({
      ...current,
      // page numbers are a function of position, never stored independently
      spreads: reordered.map((item, index) => ({ ...item, pageStart: 2 + index * 2 })),
    }));
    setNotice('סדר הכפולות עודכן');
  }

  function moveSpread(direction: -1 | 1) {
    const target = spreadIndex + direction;
    if (target < 0 || target >= project.spreads.length) return;
    const reordered = [...project.spreads];
    [reordered[spreadIndex], reordered[target]] = [reordered[target], reordered[spreadIndex]];
    commitProject((current) => ({
      ...current,
      spreads: reordered.map((item, index) => ({ ...item, pageStart: 2 + index * 2 })),
    }));
    setNotice(direction < 0 ? 'הכפולה הוזזה אחורה' : 'הכפולה הוזזה קדימה');
  }

  function toggleAlbumPhoto(photoId: string) {
    setAlbumSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function selectAllFilteredPhotos() {
    setAlbumSelectedIds((current) => {
      const next = new Set(current);
      filteredPhotos.forEach((photo) => next.add(photo.id));
      return next;
    });
    setNotice(`${filteredPhotos.length} תמונות נוספו לבחירת האלבום`);
  }

  function buildFullAlbum() {
    const orderedIds = photos
      .filter((photo) => albumSelectedIds.has(photo.id))
      .map((photo) => photo.id);
    if (!orderedIds.length) {
      setSelectionMode(true);
      setNotice('בחרי תחילה את התמונות שייכנסו לאלבום');
      return;
    }
    const spreads = buildAutomaticAlbum(
      orderedIds,
      photos,
      profile.closedWidthMm / profile.closedHeightMm,
    );
    commitProject((current) => ({
      ...current,
      spreads,
      activeSpreadId: spreads[0].id,
    }));
    setSelectionMode(false);
    setSelectedPhotoId(null);
    setSelectedSlotIndex(null);
    setPhotoFilter('available');
    setNotice(
      `נבנתה טיוטה של ${spreads.length} כפולות מתוך ${orderedIds.length} תמונות · ניתן לבטל`,
    );
  }

  function createReviewVersion() {
    const versions = project.reviewVersions ?? [];
    const version = {
      id: `review-${Date.now()}`,
      number: Math.max(0, ...versions.map((item) => item.number)) + 1,
      createdAt: new Date().toISOString(),
      status: 'sent' as const,
      spreads: JSON.parse(JSON.stringify(project.spreads)) as AlbumSpread[],
      cover: project.cover ? JSON.parse(JSON.stringify(project.cover)) : undefined,
      comments: [],
    };
    commitProject({
      ...project,
      reviewVersions: [...versions, version],
      activeReviewVersionId: version.id,
    });
    setShowReview(true);
    setNotice(`נוצרה גרסת הגהה ${version.number}`);
  }

  function openReviewWorkspace() {
    const versions = project.reviewVersions ?? [];
    if (!versions.length) {
      createReviewVersion();
      return;
    }
    const activeId = project.activeReviewVersionId ?? versions[versions.length - 1].id;
    if (activeId !== project.activeReviewVersionId) {
      setProject({ ...project, activeReviewVersionId: activeId });
    }
    setShowReview(true);
  }

  function navigateFromPreflight(issue: PreflightIssue) {
    setShowPreflight(false);
    if (issue.target === 'spread' && issue.spreadId) {
      setProject((current) => ({ ...current, activeSpreadId: issue.spreadId! }));
      setSelectedSlotIndex(null);
      setNotice(issue.title);
      return;
    }
    if (issue.target === 'cover') {
      setShowCover(true);
      return;
    }
    if (issue.target === 'profile') {
      setShowProfileEditor(true);
      setNotice(issue.detail);
      return;
    }
    if (issue.target === 'review') openReviewWorkspace();
  }

  /* Applying a template is layout-FIRST: the frames come from the template, and
   * the photos already on the spread fall into them in order. Extra frames stay
   * empty and wait to be filled, instead of the layout being dictated by how
   * many photos happen to be placed. */
  function applyTemplate(templateSlots: LayoutSlot[], id: string, name: string) {
    const existing = spread.photoIds.filter(Boolean);
    const photoIds = Array.from({ length: templateSlots.length }, (_, i) => existing[i] ?? '');
    updateSpread({
      layoutId: id,
      customSlots: templateSlots,
      photoIds,
      frameSettings: {},
    });
    setSelectedSlotIndex(null);
    const spare = existing.length - templateSlots.length;
    setNotice(spare > 0
      ? `הוחלה „${name}” · ${spare} תמונות חזרו למגש`
      : `הוחלה „${name}”`);
  }

  function addFrame() {
    // Base BOTH lists on the layout currently on screen so `customSlots.length`
    // and `photoIds.length` always match — otherwise the spread silently falls
    // back to a generated layout and the new frame vanishes. That mismatch was
    // why adding a second and third frame "did nothing".
    const slots = layout.slots.map((s) => ({ ...s }));
    const ids = [...layout.photoIds];
    const next: LayoutSlot = {
      id: `frame-${Date.now()}`,
      // dropped near the middle, offset so a second one does not hide the first
      x: 0.36 + (slots.length % 4) * 0.05,
      y: 0.28 + (slots.length % 4) * 0.05,
      width: 0.3,
      height: 0.34,
      role: 'support',
      preferred: [],
    };
    updateSpread({
      layoutId: `custom-${Date.now()}`,
      customSlots: [...slots, next],
      photoIds: [...ids, ''],
    });
    setSelectedSlotIndex(slots.length);
    setCropIndex(null);
    setNotice('מסגרת נוספה — גרור אותה, שנה גודל בפינות, או שים אותה על מסגרת אחרת');
  }

  function removeFrame(index: number) {
    if (layout.slots.length <= 1) return;
    const allSlots = layout.slots.filter((_, i) => i !== index);
    updateSpread({
      layoutId: `custom-${Date.now()}`,
      customSlots: allSlots,
      photoIds: layout.photoIds.filter((_, i) => i !== index),
    });
    setSelectedSlotIndex(null);
    setCropIndex(null);
    setNotice('המסגרת הוסרה');
  }

  /* Stacking order IS render order — a later frame paints over an earlier one.
   * Bringing a frame to the front (or back) is how "a photo on a photo" gets the
   * layering the photographer means, instead of whichever one happened to be
   * added last winning. Slot, its photo and its settings move together. */
  function reorderFrame(to: 'front' | 'back') {
    if (selectedSlotIndex === null) return;
    const slots = layout.slots.map((s) => ({ ...s }));
    const ids = [...layout.photoIds];
    const [slot] = slots.splice(selectedSlotIndex, 1);
    const [id] = ids.splice(selectedSlotIndex, 1);
    if (to === 'front') { slots.push(slot); ids.push(id); } else { slots.unshift(slot); ids.unshift(id); }
    updateSpread({ customSlots: slots, photoIds: ids });
    const nextIndex = to === 'front' ? slots.length - 1 : 0;
    setSelectedSlotIndex(nextIndex);
    setNotice(to === 'front' ? 'המסגרת הובאה לחזית' : 'המסגרת נשלחה לאחור');
  }

  function chooseLayout(nextLayout: GeneratedAlbumLayout) {
    updateSpread({
      layoutId: nextLayout.id,
      photoIds: nextLayout.photoIds,
      frameSettings: {},
      customSlots: undefined,
    });
    setSelectedSlotIndex(null);
    setNotice(`הוחלה הפריסה „${nextLayout.name}”`);
  }

  function updateSelectedSlot(patch: Partial<LayoutSlot>) {
    if (selectedSlotIndex === null) return;
    const next = layout.slots.map((slot, index) => (
      index === selectedSlotIndex ? { ...slot, ...patch } : slot
    ));
    updateSpread({ customSlots: next });
    setNotice('המסגרת נערכה · הפריסה כעת אישית');
  }

  function savePersonalLayout() {
    if (!layout.slots.length) return;
    const next: PersonalLayout = {
      id: `personal-${Date.now()}`,
      name: `תבנית אישית ${personalLayouts.length + 1}`,
      photoCount: layout.photoCount,
      pageAspect: profile.closedWidthMm / profile.closedHeightMm,
      slots: layout.slots,
    };
    const all = [...personalLayouts, next];
    setPersonalLayouts(all);
    localStorage.setItem('album-personal-layouts', JSON.stringify(all));
    updateSpread({ layoutId: next.id, customSlots: next.slots });
    setNotice(`נשמרה ${next.name}`);
  }

  function applyPersonalLayout(item: PersonalLayout) {
    updateSpread({ layoutId: item.id, customSlots: item.slots, frameSettings: {} });
    setSelectedSlotIndex(null);
    setNotice(`הוחלה ${item.name}`);
  }

  function assignPhotoById(slotIndex: number, photoId: string) {
    const nextIds = [...layout.photoIds];
    const existingIndex = nextIds.indexOf(photoId);
    if (existingIndex >= 0) {
      [nextIds[existingIndex], nextIds[slotIndex]] = [nextIds[slotIndex], nextIds[existingIndex]];
    } else {
      nextIds[slotIndex] = photoId;
    }
    updateSpread({ photoIds: nextIds });
    setSelectedPhotoId(null);
    setSelectedSlotIndex(slotIndex);
    setNotice('התמונה שובצה במסגרת');
  }

  function assignPhoto(slotIndex: number) {
    if (suppressFrameClick.current) return;
    if (!selectedPhotoId) {
      setSelectedSlotIndex(slotIndex);
      setCropIndex(null);
      setNotice('גרור להזיז · פינות לשינוי גודל · לחיצה כפולה למקם את התמונה');
      return;
    }
    assignPhotoById(slotIndex, selectedPhotoId);
  }

  function beginPhotoDrag(event: React.DragEvent, photoId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-teza-photo', photoId);
    event.dataTransfer.setData('text/plain', photoId);
  }

  function dropPhotoOnFrame(event: React.DragEvent, slotIndex: number) {
    event.preventDefault();
    const photoId = event.dataTransfer.getData('application/x-teza-photo')
      || event.dataTransfer.getData('text/plain');
    if (!photos.some((photo) => photo.id === photoId)) return;
    assignPhotoById(slotIndex, photoId);
  }

  function beginPan(
    event: React.PointerEvent<HTMLButtonElement>,
    slotIndex: number,
    settings: PhotoFrameSettings,
  ) {
    /* Dragging inside the SELECTED frame moves the photo; dragging any other
     * frame still hands the photo to a different slot. Selection is what tells
     * the two apart — the same rule InDesign uses for its content grabber —
     * so there is no mode to switch on first. */
    if (selectedSlotIndex !== slotIndex || settings.fit === 'contain') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panSession.current = {
      slotIndex,
      startX: event.clientX,
      startY: event.clientY,
      positionX: settings.positionX,
      positionY: settings.positionY,
      before: project,
      moved: false,
    };
  }

  function movePan(event: React.PointerEvent<HTMLButtonElement>, slotId: string) {
    const session = panSession.current;
    if (!session) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const positionX = Math.max(
      0,
      Math.min(100, session.positionX - (event.clientX - session.startX) / bounds.width * 100),
    );
    const positionY = Math.max(
      0,
      Math.min(100, session.positionY - (event.clientY - session.startY) / bounds.height * 100),
    );
    session.moved = true;
    setProject((current) => ({
      ...current,
      spreads: current.spreads.map((item) => item.id === spread.id ? {
        ...item,
        frameSettings: {
          ...item.frameSettings,
          [slotId]: {
            ...(item.frameSettings?.[slotId] ?? DEFAULT_FRAME_SETTINGS),
            fit: 'cover',
            positionX,
            positionY,
          },
        },
      } : item),
    }));
  }

  function endPan() {
    const session = panSession.current;
    if (session?.moved) {
      suppressFrameClick.current = true;
      window.setTimeout(() => {
        suppressFrameClick.current = false;
      }, 0);
      setHistoryPast((items) => [...items.slice(-49), session.before]);
      setHistoryFuture([]);
      setNotice('מיקום התמונה עודכן');
    }
    panSession.current = null;
  }

  /* ---- move + resize the frame on the canvas (no sliders) ---- */
  function beginFrameGesture(
    event: React.PointerEvent<Element>,
    slotIndex: number,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se',
  ) {
    event.preventDefault();
    event.stopPropagation();
    const sheet = (event.currentTarget.closest('.album-spread') as HTMLElement | null);
    if (!sheet) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already released */ }
    frameGesture.current = {
      mode,
      index: slotIndex,
      startX: event.clientX,
      startY: event.clientY,
      slot: { ...layout.slots[slotIndex] },
      baseSlots: layout.slots.map((s) => ({ ...s })),
      rect: sheet.getBoundingClientRect(),
      before: project,
      moved: false,
    };
  }

  function moveFrameGesture(event: React.PointerEvent<Element>) {
    const g = frameGesture.current;
    if (!g) return;
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    const MIN = 0.06;
    const dx = (event.clientX - g.startX) / g.rect.width;
    const dy = (event.clientY - g.startY) / g.rect.height;
    let { x, y, width, height } = g.slot;
    if (g.mode === 'move') {
      x = clamp(g.slot.x + dx, 0, 1 - g.slot.width);
      y = clamp(g.slot.y + dy, 0, 1 - g.slot.height);
    } else {
      const east = g.mode === 'ne' || g.mode === 'se';
      const south = g.mode === 'se' || g.mode === 'sw';
      if (east) {
        width = clamp(g.slot.width + dx, MIN, 1 - g.slot.x);
      } else {
        const nx = clamp(g.slot.x + dx, 0, g.slot.x + g.slot.width - MIN);
        width = g.slot.x + g.slot.width - nx;
        x = nx;
      }
      if (south) {
        height = clamp(g.slot.height + dy, MIN, 1 - g.slot.y);
      } else {
        const ny = clamp(g.slot.y + dy, 0, g.slot.y + g.slot.height - MIN);
        height = g.slot.y + g.slot.height - ny;
        y = ny;
      }
    }
    g.moved = true;
    const nextSlots = g.baseSlots.map((s, i) => (i === g.index ? { ...s, x, y, width, height } : s));
    setProject((current) => ({
      ...current,
      spreads: current.spreads.map((item) => (
        item.id === spread.id ? { ...item, customSlots: nextSlots } : item
      )),
    }));
  }

  function endFrameGesture() {
    const g = frameGesture.current;
    if (g?.moved) {
      suppressFrameClick.current = true;
      window.setTimeout(() => { suppressFrameClick.current = false; }, 0);
      setHistoryPast((items) => [...items.slice(-49), g.before]);
      setHistoryFuture([]);
      setNotice(g.mode === 'move' ? 'המסגרת הוזזה' : 'גודל המסגרת עודכן');
    }
    frameGesture.current = null;
  }

  /** Wheel over the selected frame zooms its photo, the way every canvas tool does. */
  function zoomSelectedFrame(event: React.WheelEvent<HTMLButtonElement>, slotIndex: number) {
    if (selectedSlotIndex !== slotIndex || !selectedFrameSettings) return;
    if (selectedFrameSettings.fit === 'contain') return;
    event.preventDefault();
    const step = event.deltaY > 0 ? -6 : 6;
    const zoom = Math.max(100, Math.min(250, (selectedFrameSettings.zoom ?? 100) + step));
    if (zoom === (selectedFrameSettings.zoom ?? 100)) return;
    // zooming is a manual decision, so it takes the frame off `smart` too
    setFramePosition({ zoom });
  }

  /** Move to another candidate layout for this spread. Wraps at both ends. */
  function cycleLayout(direction: 1 | -1) {
    if (layoutCandidates.length < 2) return;
    const current = layoutCandidates.findIndex((item) => item.id === spread.layoutId);
    const at = current === -1 ? 0 : current;
    const next = layoutCandidates[(at + direction + layoutCandidates.length) % layoutCandidates.length];
    /* Clearing customSlots is deliberate: leaving them set makes the spread
     * resolve as "פריסה אישית", so every candidate you cycled to would claim
     * to be a hand-made layout. `updateSpread` records the undo step itself. */
    updateSpread({ layoutId: next.id, customSlots: undefined, frameSettings: {} });
    setSelectedSlotIndex(null);
    setNotice(`${next.name} · ${next.explanation}`);
  }

  function toggleSelectedPhotoInSpread() {
    if (!selectedPhotoId) return;

    if (selectedSlotIndex !== null) {
      assignPhoto(selectedSlotIndex);
      return;
    }

    const currentIds = [...layout.photoIds];
    if (currentIds.includes(selectedPhotoId)) {
      updateSpread({
        photoIds: currentIds.filter((id) => id !== selectedPhotoId),
        layoutId: 'balanced',
        frameSettings: {},
        customSlots: undefined,
      });
      setNotice('התמונה הוחזרה למאגר');
    } else {
      updateSpread({
        photoIds: [...currentIds, selectedPhotoId],
        layoutId: 'balanced',
        frameSettings: {},
        customSlots: undefined,
      });
      setNotice('התמונה נוספה והכפולה אורגנה מחדש');
    }
    setSelectedPhotoId(null);
    setSelectedSlotIndex(null);
  }

  function updateFrameSettings(patch: Partial<PhotoFrameSettings>) {
    if (!selectedSlot || !selectedFrameSettings) return;
    updateSpread({
      frameSettings: {
        ...spread.frameSettings,
        [selectedSlot.id]: { ...selectedFrameSettings, ...patch },
      },
    });
  }

  /* Position reads as "locked" in `smart` mode only because smart is the one
   * choosing it. The moment she moves it herself she has taken that decision
   * back, so hand her the crop smart had reached and switch to manual — rather
   * than greying the control out and leaving her with no way to fix the frame. */
  function setFramePosition(patch: Partial<PhotoFrameSettings>) {
    if (!selectedFrameSettings) return;
    if (selectedFrameSettings.fit === 'smart') {
      updateFrameSettings({
        fit: 'cover',
        positionX: selectedCrop?.positionX ?? selectedFrameSettings.positionX,
        positionY: selectedCrop?.positionY ?? selectedFrameSettings.positionY,
        ...patch,
      });
      return;
    }
    updateFrameSettings(patch);
  }

  function setFitMode(fit: PhotoFitMode) {
    updateFrameSettings({ fit });
    setNotice(
      fit === 'smart'
        ? 'מילוי חכם שומר על הפנים והדמות'
        : fit === 'contain'
          ? 'התמונה מוצגת במלואה — אין מה להזיז'
          : 'מילוי מסגרת — גררי במסגרת כדי למקם',
    );
  }

  function removeSelectedFramePhoto() {
    if (selectedSlotIndex === null) return;
    updateSpread({
      photoIds: layout.photoIds.filter((_, index) => index !== selectedSlotIndex),
      layoutId: 'balanced',
      frameSettings: {},
      customSlots: undefined,
    });
    setSelectedSlotIndex(null);
    setNotice('התמונה הוחזרה למאגר והכפולה אורגנה מחדש');
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const imported: AlbumPhoto[] = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .map((file, index) => {
        const url = URL.createObjectURL(file);
        const id = `import-${Date.now()}-${index}`;
        void storePhotoBlob(id, file).catch(() => {
          setNotice(`לא ניתן היה לשמור את ${file.name} לשחזור`);
        });
        return {
          id,
          name: file.name,
          url,
          storageKey: id,
          orientation: 'landscape',
          widthPx: 0,
          heightPx: 0,
          analysis: {
            status: 'pending',
            faces: [],
            focalPoint: { x: 0.5, y: 0.5 },
            sharpnessScore: 0,
            qualityScore: 0,
            analyzedBy: 'pending',
          },
        };
      });
    imported.forEach((photo) => {
      const img = new Image();
      img.onload = () => {
        setPhotos((current) => current.map((item) => item.id === photo.id
          ? { ...item, widthPx: img.width, heightPx: img.height, orientation: orientationFor(img.width, img.height) }
          : item));
        analyzeAlbumPhoto(photo.url)
          .then((result) => {
            setPhotos((current) => current.map((item) => item.id === photo.id ? {
              ...item,
              widthPx: result.widthPx,
              heightPx: result.heightPx,
              orientation: orientationFor(result.widthPx, result.heightPx),
              focalPoint: result.focalPoint,
              analysis: { ...result, status: 'ready' },
            } : item));
          })
          .catch(() => {
            setPhotos((current) => current.map((item) => item.id === photo.id ? {
              ...item,
              analysis: {
                ...item.analysis!,
                status: 'failed',
                analyzedBy: 'engine-unavailable',
              },
            } : item));
          });
      };
      img.src = photo.url;
    });
    setPhotos((current) => [...current, ...imported]);
    setNotice(`נוספו ${imported.length} תמונות · הניתוח המקומי התחיל`);
  }

  function createExportItems() {
    return project.spreads.map((item) => {
      const candidates = buildAlbumLayoutCandidates(
        item.photoIds,
        photos,
        profile.closedWidthMm / profile.closedHeightMm,
      );
      const generated = candidates.find((candidate) => candidate.id === item.layoutId)
        ?? candidates[0]
        ?? EMPTY_GENERATED_LAYOUT;
      return {
        spread: item,
        layout: item.customSlots?.length === item.photoIds.length ? {
          ...generated,
          id: item.layoutId,
          slots: item.customSlots,
          photoIds: item.photoIds,
        } : generated,
      };
    });
  }

  async function handleExportProof() {
    if (isExporting) return;
    setIsExporting(true);
    setNotice('מכין את קבצי ההגהה…');
    try {
      const result = await exportAlbumProof(
        project,
        createExportItems(),
        photos,
        profile,
        (current, total) => setNotice(`מרנדר כפולה ${current} מתוך ${total}…`),
      );
      setNotice(
        `חבילת ההגהה מוכנה · ${result.files} קבצים · ${result.pixelSize.width}×${result.pixelSize.height}px`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('ייצוא ההגהה בוטל');
      } else {
        setNotice(error instanceof Error ? error.message : 'ייצוא ההגהה נכשל');
      }
    } finally {
      setIsExporting(false);
    }
  }

  async function handlePrintExport() {
    if (isExporting || preflight.total > 0) return;
    setIsExporting(true);
    setNotice('מכין חבילת דפוס…');
    try {
      const result = await exportAlbumForPrint(
        project,
        createExportItems(),
        photos,
        profile,
        (current, total) => setNotice(`מייצא לדפוס כפולה ${current} מתוך ${total}…`),
      );
      setNotice(
        `חבילת הדפוס מוכנה · ${result.files} קבצים · ${result.pixelSize.width}×${result.pixelSize.height}px`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice('ייצוא הדפוס בוטל');
      } else {
        setNotice(error instanceof Error ? error.message : 'ייצוא הדפוס נכשל');
      }
    } finally {
      setIsExporting(false);
    }
  }

  /* No album open means the library IS the screen — every overlay below this
   * point assumes a loaded project, so this has to come first. */
  if (!activeAlbumId) {
    return (
      <AlbumLibrary
        albums={albums}
        profiles={printProfiles}
        onBack={onBack}
        onOpen={(id) => { setHistoryPast([]); setHistoryFuture([]); setActiveAlbumId(id); }}
        onCreate={createAlbum}
        onRename={(id, name) => {
          renameAlbum(id, name);
          setAlbums(listAlbums());
        }}
        onDuplicate={(id) => {
          const source = albums.find((item) => item.id === id);
          if (duplicateAlbum(id, `${source?.name ?? 'אלבום'} — עותק`)) setAlbums(listAlbums());
        }}
        onDelete={(id) => {
          deleteAlbum(id).then(() => setAlbums(listAlbums()));
        }}
      />
    );
  }

  if (showPreview) {
    return (
      <AlbumPreview
        project={project}
        photos={photos}
        profile={profile}
        onClose={() => setShowPreview(false)}
      />
    );
  }

  if (showReview) {
    return (
      <ReviewWorkspace
        project={project}
        photos={photos}
        profile={profile}
        onUpdate={(next) => commitProject(next)}
        onNewVersion={createReviewVersion}
        onClose={() => setShowReview(false)}
      />
    );
  }

  if (showCover) {
    return (
      <CoverEditor
        project={project}
        photos={photos}
        profile={profile}
        onUpdateProject={(next) => commitProject(next)}
        onUpdateProfile={(next) => updatePrintProfile(next)}
        onClose={() => setShowCover(false)}
      />
    );
  }

  if (showPreflight) {
    return (
      <PreflightPanel
        issues={preflightIssues}
        onNavigate={navigateFromPreflight}
        onClose={() => setShowPreflight(false)}
      />
    );
  }

  // The timeline is the front door: full-bleed, its own header, none of the
  // export/proof chrome that only matters once there is an album to export.
  if (mode === 'timeline') {
    return (
      <div className="album-timeline-shell" data-surface="studio">
        <AlbumTimeline
          photos={photos}
          profile={profile}
          initialOrder={project.spreads.flatMap((spread) => spread.photoIds)}
          onAddPhotos={() => fileInput.current?.click()}
          onCancel={closeAlbum}
          onBuild={(spreads) => {
            commitProject((current) => ({
              ...current,
              spreads,
              activeSpreadId: spreads[0]?.id ?? current.activeSpreadId,
            }));
            setSelectionMode(false);
            setSelectedPhotoId(null);
            setSelectedSlotIndex(null);
            setMode('organize');
            setNotice(`נבנתה טיוטה של ${spreads.length} כפולות · אפשר לכוונן ולבטל`);
          }}
          onDesignSpread={(spreads, index) => {
            const target = spreads[index] ?? spreads[0];
            commitProject((current) => ({
              ...current,
              spreads,
              activeSpreadId: target?.id ?? current.activeSpreadId,
            }));
            setSelectionMode(false);
            setSelectedPhotoId(null);
            setSelectedSlotIndex(null);
            setMode('design');
            setNotice(`נבנתה טיוטה של ${spreads.length} כפולות · פותח את כפולה ${index + 1}`);
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>
    );
  }

  return (
    <div className="album-studio" data-surface="studio">
      <header className="album-actionbar">
        <div className="album-save-state">
          <button className="album-back-to-library" onClick={closeAlbum} title="כל האלבומים">
            <IcChevron size={15} style={{ transform: 'rotate(180deg)' }} />
            <span>האלבומים</span>
          </button>
          <div className="album-mode-switch" role="group" aria-label="מצב עבודה">
            {/* Pure entry point — when the timeline is active the studio takes
                the full-bleed timeline branch above, so this is never "on" here. */}
            <button
              onClick={() => setMode('timeline')}
              title="ציר הזמן — חלוקת התמונות לכפולות"
            >
              <IcSparkle size={15} />ציר הזמן
            </button>
            <button
              className={mode === 'organize' ? 'on' : ''}
              onClick={() => setMode('organize')}
            >
              <IcBook size={15} />האלבום
            </button>
            <button
              className={mode === 'design' ? 'on' : ''}
              onClick={() => setMode('design')}
            >
              <IcGallery size={15} />עריכת כפולה
            </button>
          </div>
          <span className="album-saved-dot"><IcCheck size={12} /></span>
          <span>{notice}</span>
        </div>
        <div className="album-actionbar-main">
          <button className="album-action secondary" onClick={() => setShowPreview(true)}>
            <IcEye size={17} />תצוגה מקדימה
          </button>
          <button
            className="album-action secondary"
            onClick={handleExportProof}
            disabled={isExporting}
          >
            <IcDownload size={17} />{isExporting ? 'מייצא הגהה…' : 'ייצוא הגהה'}
          </button>
          <button
            className="album-action print"
            onClick={handlePrintExport}
            disabled={isExporting || preflight.total > 0}
            title={preflight.total > 0 ? 'יש להשלים את בדיקת הדפוס' : 'ייצוא קבצים מוכנים לדפוס'}
          >
            <IcDownload size={17} />ייצוא לדפוס
          </button>
          <button className="album-action secondary" onClick={openReviewWorkspace}>
            שיתוף ואישור
            {(project.reviewVersions?.some((item) => item.status === 'changes-requested')) && (
              <span className="review-alert-dot" />
            )}
          </button>
          <button className="album-action secondary" onClick={() => setShowCover(true)}>
            כריכה ושדרה
          </button>
          <button className="album-action primary" onClick={buildFullAlbum}>
            <IcSparkle size={17} />
            {albumSelectedIds.size
              ? `עיצוב אלבום מ־${albumSelectedIds.size} תמונות`
              : 'בחירת תמונות ועיצוב אלבום'}
          </button>
        </div>
        <div className="album-history">
          <button aria-label="ביטול" onClick={undoProject} disabled={!historyPast.length}><IcUndo size={19} /></button>
          <button aria-label="ביצוע חוזר" onClick={redoProject} disabled={!historyFuture.length}><IcUndo size={19} style={{ transform: 'scaleX(-1)' }} /></button>
        </div>
      </header>

      <div className={`album-workspace ${mode}`}>
        {mode === 'organize' && (
        <aside className="album-settings-panel">
          <div className="album-panel-title">
            <IcBook size={18} />
            <span>הגדרות אלבום</span>
          </div>

          <label className="album-field-label">סוג אלבום</label>
          <select className="album-select" value="layflat" disabled>
            <option value="layflat">בת מצווה — Layflat</option>
          </select>

          <div className="album-field-label">גודל סגור</div>
          <div className="album-size-options">
            {printProfiles.map((item) => (
              <button
                key={item.id}
                className={item.id === profile.id ? 'on' : ''}
                onClick={() => {
                  commitProject((current) => ({
                    ...current,
                    productProfileId: item.id,
                    spreads: current.spreads.map((candidate) => ({
                      ...candidate,
                      layoutId: 'balanced',
                      customSlots: undefined,
                      frameSettings: {},
                    })),
                  }));
                  setSelectedSlotIndex(null);
                  setNotice(`האלבום הותאם לפורמט ${item.name}`);
                }}
              >
                {item.closedWidthMm / 10}×{item.closedHeightMm / 10} ס״מ
                <small>{item.closedWidthMm === item.closedHeightMm ? 'מרובע' : item.closedWidthMm > item.closedHeightMm ? 'רוחב' : 'אורך'}</small>
              </button>
            ))}
          </div>

          <label className="album-field-label">סגנון</label>
          <select className="album-select" value={project.styleName} onChange={(event) => commitProject({ ...project, styleName: event.target.value })}>
            <option>Fine Art</option>
            <option>נקי ומודרני</option>
            <option>קלאסי</option>
          </select>

          <div className="album-field-label">רקע הכפולה</div>
          <div className="album-palette">
            {['#f8f6f1', '#f4efe7', '#e9e2d8', '#c9bfb2', '#222326'].map((color) => (
              <button
                key={color}
                className={spread.background === color ? 'on' : ''}
                style={{ background: color }}
                onClick={() => updateSpread({ background: color })}
                aria-label={`רקע ${color}`}
              />
            ))}
          </div>

          <div className="album-panel-divider" />
          <div className="album-field-label">תצוגת ייצור</div>
          <label className="album-check">
            <input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} />
            <span>גלישה, חיתוך ואזור בטוח</span>
          </label>
          <label className="album-check">
            <input type="checkbox" checked readOnly />
            <span>סימון מרכז הכפולה</span>
          </label>

          <div className="album-profile-note">
            <strong>{profile.name}</strong>
            <span>{profile.labName}</span>
            <span>{profile.targetPpi} PPI · {profile.outputFormat.toUpperCase()}</span>
            <span className={profile.verified ? 'profile-verified' : 'profile-draft'}>
              {profile.verified ? `מאומת · ${profile.profileVersion}` : 'טיוטה · יצוא דפוס חסום'}
            </span>
            <button onClick={() => setShowProfileEditor((value) => !value)}>
              {showProfileEditor ? 'סגירת הגדרות' : 'הגדרת בית דפוס'}
            </button>
          </div>
          {showProfileEditor && (
            <div className="album-profile-editor">
              <label>
                <span>שם בית הדפוס</span>
                <input
                  value={profile.labName}
                  onChange={(event) => updatePrintProfile({
                    labName: event.target.value,
                    verified: false,
                  })}
                />
              </label>
              <label>
                <span>גרסת המפרט</span>
                <input
                  value={profile.profileVersion}
                  onChange={(event) => updatePrintProfile({
                    profileVersion: event.target.value,
                    verified: false,
                  })}
                />
              </label>
              <div className="profile-grid">
                <label>
                  <span>רוחב כפולה במ״מ</span>
                  <input
                    type="number"
                    min="100"
                    max="2000"
                    value={profile.spreadWidthMm}
                    onChange={(event) => updatePrintProfile({
                      spreadWidthMm: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
                <label>
                  <span>גובה כפולה במ״מ</span>
                  <input
                    type="number"
                    min="100"
                    max="1000"
                    value={profile.spreadHeightMm}
                    onChange={(event) => updatePrintProfile({
                      spreadHeightMm: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
                <label>
                  <span>גלישה במ״מ</span>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={profile.bleedMm}
                    onChange={(event) => updatePrintProfile({
                      bleedMm: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
                <label>
                  <span>PPI</span>
                  <input
                    type="number"
                    min="150"
                    max="600"
                    value={profile.targetPpi}
                    onChange={(event) => updatePrintProfile({
                      targetPpi: Number(event.target.value),
                      verified: false,
                    })}
                  />
                </label>
              </div>
              <label>
                <span>פרופיל צבע</span>
                <select
                  value={profile.colorProfile}
                  onChange={(event) => updatePrintProfile({
                    colorProfile: event.target.value,
                    verified: false,
                  })}
                >
                  <option>ייקבע מול בית הדפוס</option>
                  <option>sRGB</option>
                  <option>Adobe RGB</option>
                  <option>ICC מותאם</option>
                </select>
              </label>
              <label>
                <span>תבנית שמות</span>
                <input
                  value={profile.namingPattern}
                  onChange={(event) => updatePrintProfile({
                    namingPattern: event.target.value,
                    verified: false,
                  })}
                />
              </label>
              <label className="profile-verify-check">
                <input
                  type="checkbox"
                  checked={profile.verified}
                  disabled={
                    !profile.labName.trim()
                    || !profile.profileVersion.trim()
                    || profile.colorProfile !== 'sRGB'
                    || !profile.namingPattern.includes('{index}')
                  }
                  onChange={(event) => updatePrintProfile({ verified: event.target.checked })}
                />
                <span>בדקתי את הנתונים מול מפרט כתוב של בית הדפוס</span>
              </label>
              {profile.colorProfile !== 'sRGB' && (
                <div className="profile-blocker">
                  יצוא דפוס פעיל כרגע רק ל־sRGB. פרופיל אחר דורש קובץ ICC.
                </div>
              )}
            </div>
          )}
        </aside>
        )}

        {mode === 'organize' ? (
          <OrganizeView
            project={project}
            photos={photos}
            profile={profile}
            issues={preflightIssues}
            onOpenSpread={(id) => {
              const index = project.spreads.findIndex((item) => item.id === id);
              if (index >= 0) setActiveSpread(index);
              setMode('design');
            }}
            onReorder={reorderSpread}
            onAddSpread={addSpread}
            onAddPhotos={() => { setMode('design'); fileInput.current?.click(); }}
          />
        ) : (
          <>
        <main className="album-center">
          <div className="album-canvas-toolbar">
            <div className="album-page-nav">
              <button onClick={() => setActiveSpread(spreadIndex - 1)} disabled={spreadIndex === 0} aria-label="כפולה קודמת"><IcChevron size={16} /></button>
              <strong>עמודים {spread.pageStart}–{spread.pageStart + 1}</strong>
              <span>מתוך {project.spreads.length * 2 + 1}</span>
              <button onClick={() => setActiveSpread(spreadIndex + 1)} disabled={spreadIndex === project.spreads.length - 1} aria-label="כפולה הבאה"><IcChevron size={16} style={{ transform: 'rotate(180deg)' }} /></button>
              <button onClick={addSpread}>+ כפולה</button>
              <button onClick={() => moveSpread(-1)} disabled={spreadIndex === 0}>הזזה אחורה</button>
              <button onClick={() => moveSpread(1)} disabled={spreadIndex === project.spreads.length - 1}>הזזה קדימה</button>
              <button className="remove-spread" onClick={removeSpread}>מחיקה</button>
            </div>
            <div className="album-canvas-tools">
              <button onClick={addFrame} title="הוסף מסגרת חדשה — אפשר להניח אחת על השנייה"><IcGallery size={16} />+ מסגרת</button>
              <button onClick={() => fileInput.current?.click()}><IcUpload size={16} />החלף תמונות</button>
              <button><IcGallery size={16} />{layout.photoCount} מסגרות</button>
              <button
                aria-label="בדיקה לפני ייצוא"
                title="בדיקה לפני ייצוא"
                className={preflight.total ? 'has-issues' : ''}
                onClick={() => setShowPreflight(true)}
              >
                <IcDownload size={16} />בדיקת דפוס ({preflight.blockers}/{preflight.warnings})
              </button>
            </div>
          </div>

          <div className="album-canvas-area">
            <div
              className={`album-spread ${showGuides ? 'show-guides' : ''}`}
              style={{
                background: spread.background,
                aspectRatio: `${profile.spreadWidthMm} / ${profile.spreadHeightMm}`,
                '--spread-aspect': profile.spreadWidthMm / profile.spreadHeightMm,
              } as React.CSSProperties}
            >
              <div className="album-page album-page-left" />
              <div className="album-page album-page-right" />
              <div className="album-gutter" />
              {showGuides && <><div className="album-bleed-guide" /><div className="album-safe-guide" /></>}

              {layout.slots.map((slot, slotIndex) => {
                const photoId = layout.photoIds[slotIndex];
                const photo = photos.find((item) => item.id === photoId);
                const frameSettings = spread.frameSettings?.[slot.id] ?? {
                  ...DEFAULT_FRAME_SETTINGS,
                  positionX: (photo?.focalPoint?.x ?? 0.5) * 100,
                  positionY: (photo?.focalPoint?.y ?? 0.5) * 100,
                };
                const crop = photo
                  ? assessCrop(
                    photo,
                    slot,
                    frameSettings,
                    profile.spreadWidthMm / profile.spreadHeightMm,
                  )
                  : null;
                return (
                  <button
                    key={slot.id}
                    className={`album-frame ${slot.role === 'hero' ? 'hero' : ''} ${selectedPhotoId ? 'assignable' : ''} ${selectedSlotIndex === slotIndex ? 'selected' : ''} ${cropIndex === slotIndex ? 'cropping' : ''} ${crop?.letterboxed ? 'letterboxed' : ''}`}
                    style={{
                      left: `${slot.x * 100}%`,
                      top: `${slot.y * 100}%`,
                      width: `${slot.width * 100}%`,
                      height: `${slot.height * 100}%`,
                      /* Showing the whole photo is a choice, so what is left over
                       * has to read as the page it sits on — not as a white bar
                       * that looks like the frame failed to fill. */
                      ...(crop?.letterboxed ? { background: spread.background } : null),
                    }}
                    onClick={() => assignPhoto(slotIndex)}
                    onDoubleClick={() => {
                      if (!photo) return;
                      setSelectedSlotIndex(slotIndex);
                      setCropIndex(slotIndex);
                      setNotice('גרור למקם את התמונה · גלגלת לזום · לחיצה מחוץ למסגרת לסיום');
                    }}
                    draggable={Boolean(photo) && selectedSlotIndex !== slotIndex}
                    onDragStart={(event) => {
                      if (photo) beginPhotoDrag(event, photo.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(event) => dropPhotoOnFrame(event, slotIndex)}
                    onWheel={(event) => {
                      if (cropIndex === slotIndex) zoomSelectedFrame(event, slotIndex);
                    }}
                    onPointerDown={(event) => {
                      if (cropIndex === slotIndex && photo) beginPan(event, slotIndex, frameSettings);
                      else if (selectedSlotIndex === slotIndex) beginFrameGesture(event, slotIndex, 'move');
                    }}
                    onPointerMove={(event) => {
                      if (cropIndex === slotIndex) movePan(event, slot.id);
                      else moveFrameGesture(event);
                    }}
                    onPointerUp={() => { if (cropIndex === slotIndex) endPan(); else endFrameGesture(); }}
                    onPointerCancel={() => { if (cropIndex === slotIndex) endPan(); else endFrameGesture(); }}
                    aria-label={photo ? `מסגרת עם ${photo.name}` : 'מסגרת ריקה'}
                  >
                    {photo ? (
                      <img
                        src={photo.url}
                        alt={photo.name}
                        style={{
                          objectFit: crop?.fit,
                          objectPosition: `${crop?.positionX ?? 50}% ${crop?.positionY ?? 50}%`,
                          transform: `scale(${crop?.fit === 'contain' ? 1 : (frameSettings.zoom ?? 100) / 100})`,
                          transformOrigin: `${crop?.positionX ?? 50}% ${crop?.positionY ?? 50}%`,
                        }}
                      />
                    ) : (
                      <span className="album-empty-frame"><IcGallery size={22} />בחרי תמונה</span>
                    )}
                    {selectedSlotIndex === slotIndex && cropIndex !== slotIndex && (
                      <>
                        <span className="album-frame-bar" onPointerDown={(e) => e.stopPropagation()}>
                          <span
                            role="button"
                            tabIndex={0}
                            className="album-frame-z"
                            title="שלח לאחור"
                            onClick={(e) => { e.stopPropagation(); reorderFrame('back'); }}
                          >לאחור</span>
                          <span
                            role="button"
                            tabIndex={0}
                            className="album-frame-z"
                            title="הבא לחזית"
                            onClick={(e) => { e.stopPropagation(); reorderFrame('front'); }}
                          >לחזית</span>
                        </span>
                        {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                          <span
                            key={h}
                            className={`album-frame-handle ${h}`}
                            onPointerDown={(e) => beginFrameGesture(e, slotIndex, h)}
                            onPointerMove={moveFrameGesture}
                            onPointerUp={endFrameGesture}
                            onPointerCancel={endFrameGesture}
                          />
                        ))}
                      </>
                    )}
                  </button>
                );
              })}

              <div className="album-page-number left">{spread.pageStart}</div>
              <div className="album-page-number right">{spread.pageStart + 1}</div>
            </div>
            <div className="album-guide-legend">
              {showGuides ? 'כתום: גלישה · אפור: אזור בטוח · המרכז מסמן את הקיפול' : 'תצוגה נקייה'}
            </div>
          </div>

          <section className="album-photo-tray">
            <div className="album-photo-tray-head">
              <div className="album-photo-summary">
                <strong>מאגר התמונות</strong>
                <span>{filteredPhotos.length} מוצגות · {photos.length - usedIds.size} טרם שובצו</span>
              </div>
              <div className="album-photo-filters" role="group" aria-label="סינון תמונות">
                {([
                  ['available', 'זמינות לכפולה'],
                  ['unused', 'טרם שובצו'],
                  ['used', 'בשימוש'],
                  ['all', 'הכול'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={photoFilter === value ? 'on' : ''}
                    onClick={() => {
                      setPhotoFilter(value);
                      setPhotoLimit(60);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="album-selection-tools">
                <button
                  className={selectionMode ? 'on' : ''}
                  onClick={() => {
                    setSelectionMode((value) => !value);
                    setSelectedPhotoId(null);
                  }}
                >
                  {selectionMode ? `בחירה מרובה · ${albumSelectedIds.size}` : 'בחירת תמונות לאלבום'}
                </button>
                {selectionMode && (
                  <>
                    <button onClick={selectAllFilteredPhotos}>בחירת המוצגות</button>
                    <button onClick={() => setAlbumSelectedIds(new Set())}>ניקוי</button>
                    <button className="build" disabled={!albumSelectedIds.size} onClick={buildFullAlbum}>
                      בניית אלבום
                    </button>
                  </>
                )}
              </div>
              <button
                className="album-photo-commit"
                disabled={!selectedPhotoId}
                onClick={toggleSelectedPhotoInSpread}
              >
                {selectedSlotIndex !== null
                  ? 'החלפה במסגרת'
                  : selectedPhotoId && currentSpreadIds.has(selectedPhotoId)
                    ? 'הסרה מהכפולה'
                    : 'הוספה לכפולה'}
              </button>
              <button className="album-import" onClick={() => fileInput.current?.click()}><IcUpload size={16} />הוספת תמונות</button>
              <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => handleFiles(event.target.files)} />
            </div>
            <div className="album-photos">
              {visiblePhotos.map((photo) => (
                <button
                  key={photo.id}
                  className={`album-photo-thumb ${selectedPhotoId === photo.id ? 'selected' : ''} ${albumSelectedIds.has(photo.id) ? 'album-selected' : ''}`}
                  onClick={() => {
                    if (selectionMode) toggleAlbumPhoto(photo.id);
                    else setSelectedPhotoId(selectedPhotoId === photo.id ? null : photo.id);
                  }}
                  aria-label={`בחרי ${photo.name}`}
                  draggable={!selectionMode}
                  onDragStart={(event) => beginPhotoDrag(event, photo.id)}
                >
                  <img src={photo.url} alt="" loading="lazy" decoding="async" />
                  {albumSelectedIds.has(photo.id) && (
                    <span className="album-selection-order">
                      <IcCheck size={11} />
                    </span>
                  )}
                  <span className={`album-analysis-state ${photo.analysis?.status ?? 'pending'}`}>
                    {photo.analysis?.status === 'ready' ? 'נותחה' : photo.analysis?.status === 'failed' ? 'ללא ניתוח' : 'מנתח'}
                  </span>
                  {usedIds.has(photo.id) && (
                    <span
                      className={`album-used ${currentSpreadIds.has(photo.id) ? 'current' : ''}`}
                      title={currentSpreadIds.has(photo.id) ? 'נמצאת בכפולה הנוכחית' : 'כבר שובצה באלבום — עדיין אפשר להשתמש בה שוב'}
                    >
                      <IcCheck size={11} />
                    </span>
                  )}
                  <span className="album-photo-name">{photo.name}</span>
                </button>
              ))}
              {visiblePhotos.length < filteredPhotos.length && (
                <button
                  className="album-load-more"
                  onClick={() => setPhotoLimit((value) => value + 60)}
                >
                  עוד {Math.min(60, filteredPhotos.length - visiblePhotos.length)} תמונות
                </button>
              )}
              {filteredPhotos.length === 0 && (
                <div className="album-photo-empty">
                  אין תמונות במסנן הזה. אפשר לעבור ל״הכול״ או להוסיף תמונות חדשות.
                </div>
              )}
            </div>
          </section>
        </main>

        <aside className="album-layout-panel">
        {selectedSlot && selectedFrameSettings ? (
          <div className="album-inspector" role="group" aria-label="התאמת התמונה במסגרת">
            <div className="album-inspector-head">
              <strong>התאמת תמונה</strong>
              <button onClick={() => setSelectedSlotIndex(null)}>סיום</button>
            </div>
        <strong>התאמת תמונה</strong>
        <div className="album-fit-options">
        <button
        className={selectedFrameSettings.fit === 'smart' ? 'on' : ''}
        onClick={() => setFitMode('smart')}
        >
        חכם
        </button>
        <button
        className={selectedFrameSettings.fit === 'contain' ? 'on' : ''}
        onClick={() => setFitMode('contain')}
        >
        הצג הכול
        </button>
        <button
        className={selectedFrameSettings.fit === 'cover' ? 'on' : ''}
        onClick={() => setFitMode('cover')}
        >
        מלא מסגרת
        </button>
        </div>
        <span className={`album-crop-state ${selectedCrop?.safe ? 'safe' : 'warning'}`}>
        {selectedCrop?.warnings[0]
        ?? (selectedCrop?.letterboxed
        ? 'התמונה מוצגת במלואה — נשארים שוליים בצבע הכפולה'
        : `חיתוך בטוח · ${selectedCrop?.retainedPercent ?? 100}% נשמר`)}
        </span>
        <span className="album-control-hint">גררי במסגרת · גלגלת לזום</span>
        <label>
        <span>זום</span>
        <input
        type="range"
        min="100"
        max="250"
        value={selectedFrameSettings.zoom ?? 100}
        disabled={selectedFrameSettings.fit === 'contain'}
        onChange={(event) => updateFrameSettings({ zoom: Number(event.target.value) })}
        />
        </label>
        <label>
        <span>רוחב מסגרת</span>
        <input
        type="range"
        min="8"
        max={Math.max(8, ((selectedSlot.x < 0.5 ? 0.49 : 0.99) - selectedSlot.x) * 100)}
        value={selectedSlot.width * 100}
        onChange={(event) => updateSelectedSlot({ width: Number(event.target.value) / 100 })}
        />
        </label>
        <label>
        <span>גובה מסגרת</span>
        <input
        type="range"
        min="8"
        max={Math.max(8, (0.95 - selectedSlot.y) * 100)}
        value={selectedSlot.height * 100}
        onChange={(event) => updateSelectedSlot({ height: Number(event.target.value) / 100 })}
        />
        </label>
        <label>
        <span>מיקום מסגרת</span>
        <input
        type="range"
        min={selectedSlot.x < 0.5 ? 1 : 51}
        max={Math.max(
        selectedSlot.x < 0.5 ? 1 : 51,
        ((selectedSlot.x < 0.5 ? 0.49 : 0.99) - selectedSlot.width) * 100,
        )}
        value={selectedSlot.x * 100}
        onChange={(event) => updateSelectedSlot({ x: Number(event.target.value) / 100 })}
        />
        </label>
        <label>
        <span>גובה בעמוד</span>
        <input
        type="range"
        min="1"
        max={Math.max(1, (0.95 - selectedSlot.height) * 100)}
        value={selectedSlot.y * 100}
        onChange={(event) => updateSelectedSlot({ y: Number(event.target.value) / 100 })}
        />
        </label>
        <label title={canPanX ? undefined : 'התמונה כבר תואמת את רוחב המסגרת — הגדילי את הזום כדי לקבל מרווח הזזה'}>
        <span>מיקום אופקי</span>
        <input
        type="range"
        min="0"
        max="100"
        value={Math.round(selectedCrop?.positionX ?? selectedFrameSettings.positionX)}
        disabled={!canPanX}
        onChange={(event) => setFramePosition({ positionX: Number(event.target.value) })}
        />
        </label>
        <label title={canPanY ? undefined : 'התמונה כבר תואמת את גובה המסגרת — הגדילי את הזום כדי לקבל מרווח הזזה'}>
        <span>מיקום אנכי</span>
        <input
        type="range"
        min="0"
        max="100"
        value={Math.round(selectedCrop?.positionY ?? selectedFrameSettings.positionY)}
        disabled={!canPanY}
        onChange={(event) => setFramePosition({ positionY: Number(event.target.value) })}
        />
        </label>
        {/* Two different removals, and confusing them loses work: one empties
            the frame, the other deletes the frame itself. */}
        <div className="album-inspector-removals">
          <button className="album-control-remove" onClick={removeSelectedFramePhoto}>הסרת התמונה</button>
          <button
            className="album-control-remove danger"
            disabled={layout.slots.length <= 1}
            onClick={() => selectedSlotIndex !== null && removeFrame(selectedSlotIndex)}
          >
            מחיקת המסגרת
          </button>
        </div>
          </div>
        ) : (
          <>
          <div className="album-panel-tabs">
            <button className={panelTab === 'layouts' ? 'on' : ''} onClick={() => setPanelTab('layouts')}>פריסות</button>
            <button className={panelTab === 'design' ? 'on' : ''} onClick={() => setPanelTab('design')}>עיצובים</button>
          </div>

          {panelTab === 'layouts' ? (
            <>
              <div className="album-layout-title">
                <strong>תבניות פריסה</strong>
                <span>בחרי תבנית ואז מלאי אותה — או צרי משלך</span>
              </div>

              <div className="template-counts" role="group" aria-label="סינון לפי מספר מסגרות">
                <button
                  className={templateCount === null ? 'on' : ''}
                  onClick={() => setTemplateCount(null)}
                >הכול</button>
                {TEMPLATE_PHOTO_COUNTS.map((count) => (
                  <button
                    key={count}
                    className={templateCount === count ? 'on' : ''}
                    onClick={() => setTemplateCount(count)}
                  >{count}</button>
                ))}
              </div>

              <div className="album-layout-list">
                {LAYOUT_TEMPLATES
                  .filter((item) => templateCount === null || item.photoCount === templateCount)
                  .map((item) => (
                    <button
                      key={item.id}
                      className={`album-layout-card ${item.id === spread.layoutId ? 'on' : ''}`}
                      onClick={() => applyTemplate(item.slots, item.id, item.name)}
                      title={item.name}
                    >
                      <span className="album-layout-preview">
                        {item.slots.map((frame) => (
                          <i key={frame.id} style={{
                            left: `${frame.x * 100}%`,
                            top: `${frame.y * 100}%`,
                            width: `${frame.width * 100}%`,
                            height: `${frame.height * 100}%`,
                          }} />
                        ))}
                        <em />
                      </span>
                      <span className="album-layout-meta">
                        <b>{item.name}</b>
                        <small>{item.photoCount} מסגרות</small>
                      </span>
                    </button>
                  ))}

                {personalLayouts.length > 0 && (
                  <div className="album-layout-section">התבניות שלי</div>
                )}
                {personalLayouts.map((item) => (
                  <button
                    key={item.id}
                    className={`album-layout-card ${item.id === spread.layoutId ? 'on' : ''}`}
                    onClick={() => applyTemplate(item.slots, item.id, item.name)}
                  >
                    <span className="album-layout-preview">
                      {item.slots.map((frame) => (
                        <i key={frame.id} style={{
                          left: `${frame.x * 100}%`,
                          top: `${frame.y * 100}%`,
                          width: `${frame.width * 100}%`,
                          height: `${frame.height * 100}%`,
                        }} />
                      ))}
                      <em />
                    </span>
                    <span className="album-layout-meta">
                      <b>{item.name}</b>
                      <small>{item.photoCount} מסגרות · נשמרה על ידך</small>
                    </span>
                  </button>
                ))}

                {layoutCandidates.length > 0 && (
                  <div className="album-layout-section">מותאם לתמונות שבכפולה</div>
                )}
              </div>
              <div className="album-layout-list secondary">
                {layoutCandidates.map((item) => (
                  <button
                    key={item.id}
                    className={`album-layout-card ${item.id === layout.id ? 'on' : ''}`}
                    onClick={() => chooseLayout(item)}
                    title={item.explanation}
                  >
                    <span className="album-layout-preview">
                      {item.slots.map((slot) => (
                        <i key={slot.id} style={{
                          left: `${slot.x * 100}%`,
                          top: `${slot.y * 100}%`,
                          width: `${slot.width * 100}%`,
                          height: `${slot.height * 100}%`,
                        }} />
                      ))}
                      <em />
                    </span>
                    <span className="album-layout-meta">
                      <b>{item.name}</b>
                      <small>{item.photoCount} תמונות · ציון התאמה {item.score}</small>
                      <small className={item.warnings.length ? 'layout-warning' : 'layout-safe'}>
                        {item.warnings[0] ?? 'ללא חיתוך מסוכן'}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="album-frame-tools">
                <strong>בניית פריסה</strong>
                <div>
                  <button onClick={addFrame}>+ הוספת מסגרת</button>
                </div>
                <small>בחרי מסגרת בקנבס כדי להזיז אותה, לשנות את גודלה או למחוק אותה</small>
              </div>
              <button
                className="album-save-layout"
                disabled={!layout.slots.length}
                onClick={savePersonalLayout}
              >
                שמירת הפריסה כתבנית אישית
              </button>
            </>
          ) : (
            <div className="album-design-options">
              <button className="on"><span className="design-swatch fine-art" /><b>Fine Art</b><small>רך, אוורירי וחם</small></button>
              <button><span className="design-swatch clean" /><b>נקי ומודרני</b><small>לבן, מדויק ושקט</small></button>
              <button><span className="design-swatch classic" /><b>קלאסי</b><small>מסגרות וקצב סימטרי</small></button>
            </div>
          )}

          <div className="album-tip">
            <IcSparkle size={16} />
            <span><strong>טיפ:</strong> ↑↓ מחליפות פריסה · ←→ מדפדפות בין כפולות.</span>
          </div>
          </>
        )}
        </aside>
          </>
        )}
      </div>
    </div>
  );
}
