/* The project store — and the line down the middle of it.
 *
 * There are two kinds of knowledge in this product, and they do not live in the
 * same place:
 *
 *   THE BUSINESS   clients, money, dates, which jobs are open. It crosses
 *                  projects, belongs to no folder, and lives here in
 *                  localStorage today and MongoDB later.
 *
 *   THE FILES      batches, which frame is in which, statuses, the recipe.
 *                  It is ABOUT a specific set of photographs, so it lives in
 *                  `project.json` INSIDE the project's folder — copy the folder
 *                  to another machine and the work comes with it; uninstall the
 *                  software and nothing is lost.
 *
 * The disk half used to live in localStorage too, which meant the files were on
 * D:\ and everything anyone knew about them was in a browser profile. Clearing
 * the browser threw away the batches, the grades and the statuses of every
 * job on the machine while leaving every photograph untouched.
 *
 * Reads are synchronous against an in-memory mirror; writes update the mirror,
 * notify, and persist on a short debounce. A screen must never wait on a disk
 * round trip to render a list it already has.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  applyToFrame, galleryPublishVersion, galleryState, initProject, projectFrames, projectState, workspaceRoot,
} from '../api';
import { createEditSync } from './editSync';
import type { SyncStatus } from './editSync';
import type { Frame, GalleryLink, ProjectMemory, StoryMoment } from '../api';
import { dbDelete, dbFind, dbImport, dbSaveMany } from '../db';
import * as G from './groups';
import type { GroupKind, GroupSlice } from './groups';
import { withClientChoice } from './clientChoice';
import type { ClientChoicePlan } from './clientChoice';
import type { LearnedColorModel, ProjectRecipe, Batch, ToolInstance } from '../types';

/** The stages a job moves through. Every project carries all of them — a shoot
 *  that was not sold with an album can still become one, so the album tool is
 *  reachable from every project. `הכנה` is where the deliverables are chosen;
 *  those choices drive the checklist, not which stages exist. */
export const STAGES = [
  { id: 'setup', label: 'הכנה' },
  { id: 'import', label: 'ייבוא' },
  { id: 'batches', label: 'רצפים' },
  { id: 'select', label: 'בחירה' },
  { id: 'edit', label: 'עריכה' },
  { id: 'album', label: 'אלבום' },
  { id: 'deliver', label: 'מסירה' },
] as const;

export type StageKey = (typeof STAGES)[number]['id'];

export type ProjectState = 'shoot' | 'work' | 'waiting' | 'done';

export const STATE_LABEL: Record<ProjectState, string> = {
  shoot: 'לפני צילום',
  work: 'בעבודה',
  waiting: 'ממתין ללקוח',
  done: 'הושלם',
};

export interface Project {
  id: string;
  client: string;
  /** How to reach them. A photographer chases a client by phone, not by
   *  project id, and the number lived nowhere until now — so every follow-up
   *  meant leaving this program to look it up. Optional on purpose: a job can
   *  be opened from a name alone. */
  phone?: string;
  email?: string;
  event: string;
  /** dd.mm — the shoot date, not the creation date. */
  date: string;
  location?: string;
  price?: number;
  /** What has actually come in. `price - paid` is the open balance the
   *  business is run on, so a deposit taken at booking belongs here from the
   *  moment the job is opened. */
  paid?: number;
  thumb: string;
  /** THE COVER: the path of one of this project's own frames.
   *
   *  It is written the first time the folder is read (`rememberCover`) and it
   *  is a path on disk, not a URL — the engine's address is where thumbnails
   *  come from and that is not a fact worth freezing into a saved record.
   *
   *  Absent means the shoot has not been imported yet, and the card says so
   *  with an empty tile. It used to mean something else entirely: the card
   *  reached for a stock photograph of strangers from the internet, on every
   *  launch, for every project — because `thumb` is written empty at creation
   *  and nothing has ever filled it, so the "does it have its own picture"
   *  test was never once true. */
  cover?: string;
  /** Crop of the cover, so a wall of tiles is not one repeated composition. */
  pos: string;
  /** Index into the project's own stage list. */
  at: number;
  counts: string;
  state: ProjectState;
  /** Chosen in הכנה — whether an album was sold as a deliverable. Drives the
   *  setup checklist. It no longer hides the album stage: the tool is available
   *  in every project, sold or not. */
  hasAlbum: boolean;
  hasGallery: boolean;
  albumPlan?: {
    closedWidthCm: number;
    closedHeightCm: number;
    styleName: string;
    coverStyle: 'photo' | 'linen' | 'minimal';
  };
  /** Counters — the spine of the project header. */
  imported: number;
  kept: number;
  picked: number;
  rendered: number;
  waitingSince?: string;
  createdAt: string;
  /** The project's folder on disk: `<root>/<name>/`. Absent until the first
   *  import creates it — a project can exist before its shoot has happened. */
  home?: string;
}

/** The stages this project shows. Every project gets all of them — the album
 *  tool must be reachable from every project, whether or not one was sold. */
export function stagesOf(_p: Project) {
  return STAGES;
}

/* THE BUSINESS LIVES IN THE DATABASE, NOT IN THE BROWSER.
 *
 * It lived in localStorage until now, and the bill came due the first time this
 * app was opened on a second port. localStorage is keyed by ORIGIN — scheme,
 * host AND port — so http://localhost:5173 and http://localhost:5188 are two
 * unrelated stores inside the same browser. Opening the app at a different
 * address did not show a different view of the studio, it showed a DIFFERENT
 * STUDIO: an old project appeared and every current one was gone. Nothing had
 * actually been lost and everything looked lost, which is the worst shape a
 * data bug can take.
 *
 * The engine answers on a fixed 127.0.0.1:8756 and holds the only connection to
 * MongoDB. Reading the business from there makes the client's port what it
 * should always have been: irrelevant.
 *
 * Reads stay SYNCHRONOUS against the mirror below — a screen must never wait on
 * a round trip to render a list it already has. What changed is where the
 * mirror is filled from, and that failing to fill it is now a state the screens
 * can see. `status` is not decoration: empty and unreadable are different
 * claims, and a studio that says "no projects" when it merely could not read is
 * telling a photographer their work is gone (CLAUDE.md §3).
 *
 * There is still no seed data. A project exists because the photographer
 * created it, and every counter it carries is real.
 */

/** Where the studio used to live, per origin. Read ONCE to migrate out of it,
 *  and never written again. Deliberately NOT deleted: engine/db.py::import_once
 *  leaves the browser copy standing as a safety net, and so does this — a
 *  migration that removes the only other copy on its first run is one nobody
 *  can recover from. */
const LEGACY_KEY = 'teza.projects.v2';

/** That this origin's browser copy has already been dealt with.
 *
 *  THIS FLAG IS WHY DELETING A PROJECT NOW STICKS. The migration below used to
 *  run on EVERY read: it compared the browser copy against the database and
 *  imported anything the database was missing. A deleted project is, by
 *  definition, a project the database is missing — so the next reload handed it
 *  straight back, and the photographer watched a job he had deleted return with
 *  no explanation and no way to get rid of it.
 *
 *  A migration is a ONE-TIME move, not a continuous sync, and this records that
 *  it happened. The browser copy itself is still never written and never
 *  deleted: it stays exactly where it is as the safety net it was meant to be.
 */
const MIGRATED_KEY = 'teza.projects.v2.migrated';

function migrationDone(): boolean {
  try {
    return localStorage.getItem(MIGRATED_KEY) === '1';
  } catch {
    // No storage at all means nothing to migrate FROM, so nothing to do.
    return true;
  }
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    /* A studio that cannot write this flag still works; it merely re-checks. */
  }
}

export type StudioStatus = 'loading' | 'ready' | 'down';

let projects: Project[] = [];
let status: StudioStatus = 'loading';
/** Why the studio could not be read. Shown; never collapsed into emptiness. */
let fault: string | null = null;
/** A write that did not reach the database. Surfaced rather than swallowed — a
 *  save that fails in silence is how the mirror and the truth part company
 *  without anyone finding out until it matters. */
let saveFault: string | null = null;

const listeners = new Set<() => void>();

export interface StudioSnapshot {
  projects: Project[];
  status: StudioStatus;
  fault: string | null;
  saveFault: string | null;
}

let snapshot: StudioSnapshot = { projects, status, fault, saveFault };

function notify() {
  // useSyncExternalStore compares snapshots by identity, so a fresh object on
  // every notify would re-render every subscriber whenever the DISK half moves.
  // Rebuild only when something inside it actually changed.
  if (
    snapshot.projects !== projects
    || snapshot.status !== status
    || snapshot.fault !== fault
    || snapshot.saveFault !== saveFault
  ) {
    snapshot = { projects, status, fault, saveFault };
  }
  listeners.forEach((fn) => fn());
}

function legacyProjects(): Project[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Project[];
    if (!Array.isArray(parsed)) return [];
    // A record with no id cannot be addressed later, so it cannot be migrated.
    return parsed.filter((p) => p && typeof p.id === 'string' && p.id.length > 0);
  } catch {
    return [];
  }
}

/** Fill the mirror from the database, moving this origin's browser copy in the
 *  FIRST time it is read and never again.
 *
 *  Two conditions, and both matter:
 *
 *  ONCE — see MIGRATED_KEY. A migration that repeats is a sync, and a sync
 *  against a copy nothing ever writes to resurrects everything deleted since.
 *
 *  ONLY INTO AN EMPTY DATABASE. A database that already holds projects has
 *  already been lived in: whatever the browser copy still carries that is not
 *  there was either migrated once and deleted since, or was never wanted. The
 *  browser copy is the older one by definition, and replaying it over a studio
 *  in use is how deleted work comes back. A genuinely fresh installation reads
 *  an empty database, and that is the one case the move is for.
 *
 *  Nothing is deleted from the browser either way — the old copy stays as the
 *  safety net, and `teza.projects.v2` can always be read back by hand. */
async function refresh(): Promise<void> {
  try {
    let docs = await dbFind<Project>('projects');
    if (!migrationDone()) {
      const stranded = docs.length ? [] : legacyProjects();
      if (stranded.length) {
        await dbImport({ projects: stranded });
        docs = await dbFind<Project>('projects');
      }
      markMigrated();
    }
    projects = docs;
    status = 'ready';
    fault = null;
  } catch (e) {
    // The mirror is left exactly as it was. Reporting "no projects" here is the
    // one thing this branch exists to prevent.
    status = 'down';
    fault = (e as Error).message;
  }
  notify();
}

let booted = false;

/** Start the first read. Idempotent, so every screen can ask without
 *  coordinating. */
export function boot(): void {
  if (booted) return;
  booted = true;
  void refresh();
}

/** Deliberate re-read, after the engine has been started or a failure fixed. */
export function reload(): void {
  booted = true;
  status = 'loading';
  fault = null;
  notify();
  void refresh();
}

async function persist(changed: Project[]): Promise<void> {
  if (!changed.length) return;
  try {
    await dbSaveMany('projects', changed);
    if (saveFault !== null) {
      saveFault = null;
      notify();
    }
  } catch (e) {
    saveFault = (e as Error).message;
    notify();
  }
}

/** Mirror first, database right behind it. The screen updates on this tick; the
 *  write is on its way before the next render finishes. */
function commit(next: Project[], changed: Project[]) {
  projects = next;
  notify();
  void persist(changed);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useProjects(): Project[] {
  useEffect(boot, []);
  return useSyncExternalStore(subscribe, () => projects, () => projects);
}

/** The list AND whether it can be believed. Any screen that renders an empty
 *  state must use this rather than `useProjects`, or it will eventually print
 *  "nothing here" over a database it merely failed to reach. */
export function useStudio(): StudioSnapshot {
  useEffect(boot, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export function studioStatus(): StudioStatus {
  return status;
}

export function updateProject(id: string, patch: Partial<Project>) {
  const next = projects.map((p) => (p.id === id ? { ...p, ...patch } : p));
  commit(next, next.filter((p) => p.id === id));
}

/** Removes a project from the studio. THE PHOTOGRAPHS ARE NOT TOUCHED.
 *
 *  This is the whole reason the function reads the way it does. A project here
 *  is a record ABOUT a shoot — client, dates, batches, recipes, statuses. The
 *  photographs live in the photographer's own folder, where he put them, and
 *  this product's first promise is that they stay there. Deleting a job must
 *  never become deleting a wedding.
 *
 *  The database row goes first. The mirror is updated only once the delete has
 *  actually landed: removing it from the screen and failing to remove it from
 *  the database is the silent divergence this file exists to prevent — the
 *  project would be back on the next reload, and the photographer would be
 *  told nothing.
 */
export async function removeProject(id: string): Promise<void> {
  if (status !== 'ready') {
    throw new Error(
      status === 'loading'
        ? 'עוד קוראים את הפרויקטים מהמסד — רגע.'
        : `אין חיבור למסד, אז המחיקה לא הייתה נשמרת. ${fault ?? ''}`.trim(),
    );
  }
  await dbDelete('projects', id);

  projects = projects.filter((p) => p.id !== id);
  /* The per-project caches, so a new project that happens to reuse an id
   * cannot inherit a dead one's frames or recipe. */
  delete states[id];
  delete framesByProject[id];
  notify();
}

export interface NewProjectInput {
  client: string;
  phone?: string;
  email?: string;
  event: string;
  date: string;
  location?: string;
  price?: number;
  paid?: number;
  hasGallery: boolean;
  hasAlbum: boolean;
  albumPlan?: Project['albumPlan'];
}

/** Creates the project and returns it, so the caller can walk straight into it.
 *  A new job starts in הכנה with every counter at zero and no cover frame — there
 *  is nothing to invent, and inventing it is how a screen starts lying. A cover
 *  appears once the shoot's files are imported. */
export function createProject(input: NewProjectInput): Project {
  /* Refuse rather than pretend. With the database unreachable this could only
   * add a row to the mirror, which looks exactly like success and is gone on
   * the next reload — the same silent divergence this whole file was rewritten
   * to end. The screens disable the button too; this is the invariant behind
   * them, so no future caller can reintroduce it. */
  if (status !== 'ready') {
    throw new Error(
      status === 'loading'
        ? 'עוד קוראים את הפרויקטים מהמסד — רגע.'
        : `אין חיבור למסד, אז הפרויקט לא היה נשמר. ${fault ?? ''}`.trim(),
    );
  }
  const project: Project = {
    id: `p${Date.now().toString(36)}`,
    client: input.client.trim(),
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    event: input.event.trim() || 'צילום',
    date: input.date,
    location: input.location?.trim() || undefined,
    price: input.price,
    paid: input.paid ?? 0,
    thumb: '',
    pos: '50% 50%',
    at: 0,
    counts: 'טרם יובא',
    state: 'shoot',
    hasAlbum: input.hasAlbum,
    hasGallery: input.hasGallery,
    albumPlan: input.hasAlbum ? input.albumPlan : undefined,
    imported: 0,
    kept: 0,
    picked: 0,
    rendered: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  commit([project, ...projects], [project]);
  return project;
}

/** The folder name a project claims on disk. Client and event, because that is
 *  how a photographer looks for a job in Explorer six months later — not by an
 *  id that means nothing outside this program. */
export function folderNameOf(p: Project): string {
  return [p.client, p.event, p.date].filter(Boolean).join(' — ');
}

/** Every distinct client already on file — a returning client is the most
 *  valuable thing in the business, and typing their name again is how the
 *  history gets split in two. */
export function knownClients(): string[] {
  return [...new Set(projects.map((p) => p.client))].sort((a, b) => a.localeCompare(b, 'he'));
}

/** The phone and mail already on file for a name, newest project first.
 *
 *  Typing a returning client's number again is how one client's history quietly
 *  becomes two — and how the number in one job stays right while the number in
 *  the other goes stale. Returns nothing rather than a guess when the name is
 *  new. */
export function clientContact(name: string): { phone?: string; email?: string } {
  const key = name.trim();
  if (!key) return {};
  const theirs = projects
    .filter((p) => p.client.trim() === key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    phone: theirs.find((p) => p.phone)?.phone,
    email: theirs.find((p) => p.email)?.email,
  };
}

/** One client, rolled up from every project that carries their name. This is
 *  DERIVED, never stored: the client screen used to run on a separate demo
 *  array, which is how the same client could read one way in לקוחות and another
 *  in פרויקטים. There is one source of truth — the projects — and a client is
 *  what you get when you group them. */
export interface ClientSummary {
  name: string;
  /** Whatever was filled in on any of their jobs, newest first. Absent means
   *  it was never entered — the screen says so instead of showing a blank that
   *  reads like a number nobody answers. */
  phone?: string;
  email?: string;
  count: number;
  /** Non-done projects — the ones still needing the photographer. */
  active: number;
  /** Total agreed across all their projects — how much this client is worth. */
  scope: number;
  paid: number;
  /** What they still owe. The number the business is actually run on. */
  open: number;
  lastEvent: string;
  lastDate: string;
  /** Most recent project, so the row opens somewhere real instead of nowhere. */
  latestId: string;
}

export function clientSummaries(list: Project[] = projects): ClientSummary[] {
  const byName = new Map<string, Project[]>();
  for (const p of list) {
    const arr = byName.get(p.client);
    if (arr) arr.push(p);
    else byName.set(p.client, [p]);
  }

  const out: ClientSummary[] = [];
  for (const [name, ps] of byName) {
    const recent = [...ps].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const scope = ps.reduce((n, p) => n + (p.price ?? 0), 0);
    const paid = ps.reduce((n, p) => n + (p.paid ?? 0), 0);
    out.push({
      name,
      phone: recent.find((p) => p.phone)?.phone,
      email: recent.find((p) => p.email)?.email,
      count: ps.length,
      active: ps.filter((p) => p.state !== 'done').length,
      scope,
      paid,
      open: scope - paid,
      lastEvent: recent[0].event,
      lastDate: recent[0].date,
      latestId: recent[0].id,
    });
  }

  // Money first: who owes the most, then who is worth the most. Operating the
  // business means the client with an open balance is the one you want on top.
  return out.sort((a, b) => b.open - a.open || b.scope - a.scope);
}

export function useClientSummaries(): ClientSummary[] {
  const list = useProjects();
  return useMemo(() => clientSummaries(list), [list]);
}

/* ============================================================ the disk half
 *
 * From here down, everything is ABOUT a folder of photographs and therefore
 * lives in that folder. The mirror below is a cache of `project.json`, not a
 * second copy of the truth: the disk wins on load, and every mutation is on its
 * way back to the disk before the next render finishes.
 */

export type PhotoStatus = 'raw' | 'working' | 'ready';

export const PHOTO_STATUS: { id: PhotoStatus; label: string }[] = [
  { id: 'raw', label: 'חומר גלם' },
  { id: 'working', label: 'בטיפול' },
  { id: 'ready', label: 'מוכן' },
];

export type { Frame };

/** A frame's key in project.json. The absolute path is what every engine call
 *  needs, but it is NOT identity: the folder is built to travel, and a drive
 *  letter that changes must not orphan a batch. */
export function frameKey(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).pop() ?? pathOrName;
}

const EMPTY_STATE: ProjectMemory = {
  version: 1,
  batches: [],
  assign: {},
  statuses: {},
  recipe: { version: 1, base: [], perBatch: {}, perFrame: {} },
  gallery: null,
  moments: [],
  momentAssign: {},
  rejectedBoundaries: [],
  cull: {},
};

const states: Record<string, ProjectMemory> = {};
const framesByProject: Record<string, Frame[]> = {};
const loading = new Set<string>();
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** Where the projects live. One answer for the installation, cached here so a
 *  screen can ask without a round trip after the first time. */
let root: string | null = null;
let rootAsked = false;

export async function getWorkspaceRoot(): Promise<string | null> {
  if (!rootAsked) {
    root = await workspaceRoot().catch(() => null);
    rootAsked = true;
  }
  return root;
}

export async function setWorkspaceRoot(folder: string): Promise<string | null> {
  root = await workspaceRoot(folder);
  rootAsked = true;
  notify();
  return root;
}

export function knownRoot(): string | null {
  return root;
}

function stateOf(projectId: string): ProjectMemory {
  return states[projectId] ?? EMPTY_STATE;
}

/** Persist on a debounce. Marking forty photographs into a batch is forty
 *  mutations in a second; forty writes of the same file is how a save ends up
 *  racing itself. */
function save(projectId: string) {
  const project = getProject(projectId);
  if (!project?.home) return;
  clearTimeout(saveTimers[projectId]);
  saveTimers[projectId] = setTimeout(() => { void flush(projectId); }, 400);
}

/** Why the last write of project.json did not land, per project. It used to be
 *  swallowed — "the next mutation retries" — which meant a screen full of
 *  batches that existed nowhere but this tab, with nothing on it saying so. */
const diskFaults: Record<string, string | null> = {};

async function flush(projectId: string): Promise<void> {
  const home = getProject(projectId)?.home;
  if (!home || !states[projectId]) return;
  try {
    await projectState(home, states[projectId]);
    if (diskFaults[projectId]) {
      diskFaults[projectId] = null;
      notify();
    }
  } catch (e) {
    diskFaults[projectId] = (e as Error).message || 'הכתיבה לדיסק נכשלה';
    notify();
  }
}

/** Non-null while what is on screen has NOT reached project.json. */
export function useDiskFault(projectId: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => diskFaults[projectId] ?? null,
    () => diskFaults[projectId] ?? null,
  );
}

export function retrySave(projectId: string): void {
  clearTimeout(saveTimers[projectId]);
  void flush(projectId);
}

function write(projectId: string, next: ProjectMemory) {
  states[projectId] = next;
  notify();
  save(projectId);
}

/** Open a project's folder: create it if needed, read its memory, list its
 *  frames. Safe to call repeatedly — the guard makes a re-render cheap. */
export async function openProject(projectId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project || loading.has(projectId)) return;
  loading.add(projectId);
  try {
    let home = project.home;
    if (!home) {
      if (!(await getWorkspaceRoot())) return; // no root chosen yet — the UI asks
      home = (await initProject(folderNameOf(project))).home;
      updateProject(projectId, { home });
    }
    states[projectId] = G.normalize(await projectState(home));
    const { frames } = await projectFrames(home);
    framesByProject[projectId] = frames;
    rememberCover(projectId, frames);
    notify();
  } finally {
    loading.delete(projectId);
  }
}

/** Re-read the folder. The disk is the authority on what EXISTS, so anything
 *  that changes it — an import, an apply — ends here rather than patching a
 *  list in memory and hoping the two agree. */
export async function reloadFrames(projectId: string): Promise<void> {
  const home = getProject(projectId)?.home;
  if (!home) return;
  const { frames } = await projectFrames(home);
  framesByProject[projectId] = frames;
  updateProject(projectId, { imported: frames.length });
  rememberCover(projectId, frames);
  notify();
}

/** Give a cover to projects that were imported before covers existed.
 *
 *  A card reads `cover` off the saved project record, and until now nothing
 *  ever wrote one — so every project already on this machine has a folder full
 *  of photographs and no cover naming any of them. This walks those projects
 *  once, in the background, and asks the disk.
 *
 *  Only projects with a `home`: a project that has never been opened has no
 *  folder yet, and CREATING one to decorate a card would be a real change to
 *  the disk made for a picture. One at a time, because the engine has a single
 *  worker and a list screen is not worth queueing ahead of the photograph
 *  someone is actually waiting for. */
export async function fillMissingCovers(): Promise<void> {
  // A snapshot: every cover written replaces the live array, and a loop over
  // an array being rebuilt under it is how a project gets skipped.
  for (const p of [...projects]) {
    if (p.cover || !p.home) continue;
    try {
      const { frames } = await projectFrames(p.home);
      if (frames.length) rememberCover(p.id, frames);
    } catch {
      // A folder that cannot be read is not an error worth a dialogue here:
      // the card shows its empty tile, which is the truth about what we know.
    }
  }
}

/** Keep the project's cover pointing at a frame that still exists.
 *
 *  Called wherever the folder is read, because the disk is the authority on
 *  what a project HAS — a cover chosen once and never checked would go on
 *  naming a file the photographer deleted. It only ever writes when the answer
 *  changed, so a re-read of an unchanged folder costs nothing and never
 *  reshuffles a cover he has grown used to. */
function rememberCover(projectId: string, frames: Frame[]) {
  const project = getProject(projectId);
  if (!project) return;
  const has = (p?: string) => Boolean(p) && frames.some((f) => f.path === p);
  const cover = has(project.cover) ? project.cover : frames[0]?.path;
  if (cover !== project.cover) updateProject(projectId, { cover });
}

const NO_FRAMES: Frame[] = [];

export function framesOf(projectId: string): Frame[] {
  return framesByProject[projectId] ?? NO_FRAMES;
}

/** The set, loaded on first use. `ready` is false only while the very first
 *  read is in flight — long enough to say "reading the folder", never long
 *  enough to justify a skeleton. */
export function useProjectFiles(projectId: string): { frames: Frame[]; ready: boolean } {
  const frames = useSyncExternalStore(
    subscribe,
    () => framesByProject[projectId] ?? NO_FRAMES,
    () => framesByProject[projectId] ?? NO_FRAMES,
  );
  const [ready, setReady] = useState(() => projectId in framesByProject);
  useEffect(() => {
    let alive = true;
    setReady(projectId in framesByProject);
    openProject(projectId).finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);
  return { frames, ready };
}

/* -------------------------------------------------------------- batches */

export type { Batch };

export function batchesOf(projectId: string): Batch[] {
  return [...stateOf(projectId).batches].sort((a, b) => a.order - b.order);
}

export function useBatches(projectId: string): Batch[] {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return useMemo(
    () => [...state.batches].sort((a, b) => a.order - b.order),
    [state],
  );
}

/** Create a batch and put frames in it in ONE move.
 *
 *  This is the whole interaction: mark a run of photographs, name it, and it
 *  leaves the pool. Splitting it into "make a batch" and then "put things
 *  in it" would be two screens for one thought. */
export function addBatch(projectId: string, name: string, frames: string[] = []): Batch {
  const current = stateOf(projectId);
  const batch: Batch = {
    id: `s${Date.now().toString(36)}`,
    name: name.trim() || 'ללא שם',
    order: current.batches.length,
  };
  const assign = { ...current.assign };
  for (const f of frames) assign[frameKey(f)] = batch.id;
  write(projectId, { ...current, batches: [...current.batches, batch], assign });
  return batch;
}

/* ── the client gallery's thread back into the project ─────────────────────
 *
 * The link is kept in project.json beside the batches on purpose: the client's
 * choice and the note saying it was already imported have to be written in the
 * same move, or a crash between them either imports twice or never imports at
 * all. The choice is deliberately NOT a batch. It is a filter laid over the
 * shoot's original batches, which remain the useful units for editing.
 */

export function galleryOf(projectId: string): GalleryLink | null {
  return stateOf(projectId).gallery ?? null;
}

export function useGalleryOf(projectId: string): GalleryLink | null {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return state.gallery ?? null;
}

export function setGalleryLink(projectId: string, link: GalleryLink | null) {
  write(projectId, { ...stateOf(projectId), gallery: link });
}

/** Save the client's locked choice — in ONE write with the note that says it
 *  happened — without changing any original batch assignment.
 *
 *  Returns the frames the client chose that are not in this folder. The caller
 *  must show them: fewer photographs than the couple picked, with nothing said,
 *  is the one outcome that would make the photographer distrust the whole
 *  mechanism. */
export function importClientChoice(
  projectId: string,
  link: GalleryLink,
  plan: ClientChoicePlan,
): { count: number; missing: string[] } {
  const current = stateOf(projectId);
  write(projectId, withClientChoice(current, link, plan));
  return { count: plan.matched.length, missing: plan.missing };
}

export function renameBatch(projectId: string, id: string, name: string) {
  const current = stateOf(projectId);
  write(projectId, {
    ...current,
    batches: current.batches.map((s) => (s.id === id ? { ...s, name } : s)),
  });
}

/** Choose which frame is the batch's face, by frame NAME. The UI falls back to
 *  the first frame when this is empty or points at a frame that has since left
 *  the batch, so there is nothing to clean up when a frame goes. */
export function setBatchCover(projectId: string, id: string, frame: string) {
  const current = stateOf(projectId);
  write(projectId, {
    ...current,
    batches: current.batches.map((s) => (s.id === id ? { ...s, cover: frame } : s)),
  });
}

/** Remove a batch. Its frames go back to the pool rather than anywhere
 *  else, and its grade goes with it — a look that belonged to a light that no
 *  longer has a name is a step nobody can find to switch off. */
export function removeBatch(projectId: string, id: string) {
  const current = stateOf(projectId);
  const assign: Record<string, string> = {};
  for (const [name, sid] of Object.entries(current.assign)) {
    if (sid !== id) assign[name] = sid;
  }
  const { [id]: _dropped, ...perBatch } = current.recipe.perBatch;
  write(projectId, {
    ...current,
    batches: current.batches.filter((s) => s.id !== id),
    assign,
    recipe: { ...current.recipe, perBatch },
  });
}

/** Put frames in a batch, or back in the pool with `null`. */
export function assignFrames(projectId: string, frames: string[], batchId: string | null) {
  const current = stateOf(projectId);
  const assign = { ...current.assign };
  for (const f of frames) {
    const key = frameKey(f);
    if (batchId) assign[key] = batchId;
    else delete assign[key];
  }
  write(projectId, { ...current, assign });
}

export function batchOfFrame(projectId: string, frame: string): string | undefined {
  return stateOf(projectId).assign[frameKey(frame)];
}

/** The frames still waiting to be told what they are.
 *
 *  This is what the marking screen shows, and it is the reason the screen
 *  works: it shrinks. "Finished" is a pool with nothing in it, which needs no
 *  counter to read — and no photograph can end up in two batches, because
 *  a frame that has been named has left. */
export function unassignedFrames(projectId: string): Frame[] {
  const { assign } = stateOf(projectId);
  return framesOf(projectId).filter((f) => !assign[f.name]);
}

export function framesInBatch(projectId: string, batchId: string): Frame[] {
  const { assign } = stateOf(projectId);
  return framesOf(projectId).filter((f) => assign[f.name] === batchId);
}

/* ============================================================ groups: one door
 *
 * Every change the group workspace makes — to edit groups or to story moments —
 * goes through applyGroups, which is what makes each of them ONE undo entry and
 * ONE write however many frames it touches. The rules themselves live in
 * groups.ts as pure functions; this is only the history and the persistence.
 */

interface HistoryEntry {
  label: string;
  before: GroupSlice;
  after: GroupSlice;
}

const HISTORY_LIMIT = 100;
const histories: Record<string, { past: HistoryEntry[]; future: HistoryEntry[] }> = {};

export interface GroupHistory {
  /** label of what Undo would undo, or null */
  undo: string | null;
  redo: string | null;
}

const NO_HISTORY: GroupHistory = { undo: null, redo: null };
const historySnaps: Record<string, GroupHistory> = {};

function historyOf(projectId: string) {
  return (histories[projectId] ??= { past: [], future: [] });
}

function publishHistory(projectId: string) {
  const h = historyOf(projectId);
  const undo = h.past[h.past.length - 1]?.label ?? null;
  const redo = h.future[h.future.length - 1]?.label ?? null;
  const prev = historySnaps[projectId];
  if (!prev || prev.undo !== undo || prev.redo !== redo) historySnaps[projectId] = { undo, redo };
}

export function useGroupHistory(projectId: string): GroupHistory {
  return useSyncExternalStore(
    subscribe,
    () => historySnaps[projectId] ?? NO_HISTORY,
    () => historySnaps[projectId] ?? NO_HISTORY,
  );
}

/** The project's memory with moments guaranteed present. */
export function groupStateOf(projectId: string): ProjectMemory {
  return G.normalize(stateOf(projectId));
}

export function useGroupState(projectId: string): ProjectMemory {
  const state = useSyncExternalStore(subscribe, () => stateOf(projectId), () => stateOf(projectId));
  return useMemo(() => G.normalize(state), [state]);
}

/** Apply one operation as one undoable step. Returns false when it changed
 *  nothing, so the caller does not announce a move that did not happen. */
export function applyGroups(
  projectId: string,
  label: string,
  op: (state: ProjectMemory) => ProjectMemory,
): boolean {
  const current = groupStateOf(projectId);
  const next = op(current);
  if (next === current) return false;
  const h = historyOf(projectId);
  // Something outside this history (a client import, the old screen) changed
  // the groups since the last step: undoing across that would be a lie.
  const top = h.past[h.past.length - 1];
  if (top && !G.sliceIsCurrent(current, top.after)) h.past = [];
  h.past.push({ label, before: G.sliceOf(current), after: G.sliceOf(next) });
  if (h.past.length > HISTORY_LIMIT) h.past.shift();
  h.future = [];
  publishHistory(projectId);
  write(projectId, next);
  return true;
}

function travel(projectId: string, direction: 'undo' | 'redo'): string | null {
  const h = historyOf(projectId);
  const stack = direction === 'undo' ? h.past : h.future;
  const entry = stack[stack.length - 1];
  if (!entry) return null;
  const current = groupStateOf(projectId);
  const from = direction === 'undo' ? entry.after : entry.before;
  const to = direction === 'undo' ? entry.before : entry.after;
  if (!G.sliceIsCurrent(current, from)) {
    h.past = [];
    h.future = [];
    publishHistory(projectId);
    notify();
    return null;
  }
  stack.pop();
  (direction === 'undo' ? h.future : h.past).push(entry);
  publishHistory(projectId);
  write(projectId, G.restoreSlice(current, from, to));
  return entry.label;
}

export const undoGroups = (projectId: string) => travel(projectId, 'undo');
export const redoGroups = (projectId: string) => travel(projectId, 'redo');

let mint = 0;
/** Ids are minted here, never inside an operation, so the pure rules stay pure. */
export function newGroupId(kind: GroupKind): string {
  mint += 1;
  return `${kind === 'edit' ? 's' : 'm'}${Date.now().toString(36)}${mint.toString(36)}`;
}

/* ── story moments: the named API (the album reads these) ── */

export function momentsOf(projectId: string): StoryMoment[] {
  return G.groupsOf(groupStateOf(projectId), 'story') as StoryMoment[];
}

export function useMoments(projectId: string): StoryMoment[] {
  const state = useGroupState(projectId);
  return useMemo(() => G.groupsOf(state, 'story') as StoryMoment[], [state]);
}

export function framesInMoment(projectId: string, momentId: string): Frame[] {
  return G.membersOf(framesOf(projectId), groupStateOf(projectId).momentAssign!, momentId);
}

export function unassignedMomentFrames(projectId: string): Frame[] {
  return G.membersOf(framesOf(projectId), groupStateOf(projectId).momentAssign!, null);
}

export function addMoment(projectId: string, name: string, frames: string[] = []): string {
  const id = newGroupId('story');
  applyGroups(projectId, 'יצירת רצף', (s) => {
    const at = G.insertIndex(G.groupsOf(s, 'story'), s.momentAssign!, framesOf(projectId), frames, null);
    const created = new Date().toISOString();
    return G.createGroup(s, 'story', { id, name: name.trim() || 'רצף ללא שם', createdAt: created }, frames, at);
  });
  return id;
}

export function assignFramesToMoment(projectId: string, frames: string[], momentId: string | null) {
  applyGroups(projectId, momentId ? 'העברה לרצף' : 'הוצאה מהרצף',
    (s) => G.moveFrames(s, 'story', frames.map(frameKey), momentId));
}

export function renameMoment(projectId: string, id: string, name: string) {
  applyGroups(projectId, 'שינוי שם', (s) => G.renameGroup(s, 'story', id, name, 'רצף ללא שם'));
}

export function removeMoment(projectId: string, id: string) {
  applyGroups(projectId, 'מחיקת רצף', (s) => G.deleteGroup(s, 'story', id));
}

export function reorderMoments(projectId: string, orderedIds: string[]) {
  applyGroups(projectId, 'שינוי סדר', (s) => G.reorderGroups(s, 'story', orderedIds));
}

export function setMomentCover(projectId: string, id: string, frame: string) {
  applyGroups(projectId, 'תמונת שער', (s) => G.setCover(s, 'story', id, frameKey(frame)));
}

/** Edit groups had an `order` and no way to change it (spec §222). */
export function reorderBatches(projectId: string, orderedIds: string[]) {
  applyGroups(projectId, 'שינוי סדר', (s) => G.reorderGroups(s, 'edit', orderedIds));
}

/* ---------------------------------------------------------------- statuses */

export function statusOf(projectId: string, frame: string): PhotoStatus {
  return (stateOf(projectId).statuses[frameKey(frame)] as PhotoStatus) ?? 'raw';
}

export function setPhotoStatus(projectId: string, frame: string, status: PhotoStatus) {
  const current = stateOf(projectId);
  const statuses = { ...current.statuses };
  if (status === 'raw') delete statuses[frameKey(frame)];
  else statuses[frameKey(frame)] = status;
  write(projectId, { ...current, statuses });
  // The business record's "edited" counter is the number of frames the
  // photographer marked finished — read by the status screen and Today. It was
  // never written by anything, so the editing step could never complete.
  const done = Object.values(statuses).filter((v) => v === 'ready').length;
  if (getProject(projectId)?.rendered !== done) updateProject(projectId, { rendered: done });
}

/* ------------------------------------------------------- the work stage */

/** keep · maybe (the photographer is not sure yet — still goes on) · reject */
export type CullDecision = 'keep' | 'maybe' | 'reject';

/** The photographer's own decisions — never the engine's suggestions. */
export function cullOf(projectId: string): Record<string, CullDecision> {
  return stateOf(projectId).cull ?? {};
}

export function useCull(projectId: string): Record<string, CullDecision> {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return state.cull ?? {};
}

/** Decide several frames in ONE write (accepting forty suggestions is one
 *  thought). `null` returns them to undecided. */
export function setCull(projectId: string, frames: string[], decision: CullDecision | null) {
  const current = stateOf(projectId);
  const cull = { ...(current.cull ?? {}) };
  for (const f of frames) {
    const key = frameKey(f);
    if (decision) cull[key] = decision;
    else delete cull[key];
  }
  write(projectId, { ...current, cull });
}

/** What goes on to the client: every frame the photographer did not take out.
 *  Undecided frames go — a suggestion is not a decision. */
export function notRejected<T extends { name: string }>(projectId: string, frames: T[]): T[] {
  const cull = cullOf(projectId);
  return frames.filter((f) => cull[frameKey(f.name)] !== 'reject');
}

export function useStatuses(projectId: string): Record<string, string> {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return state.statuses;
}

/* ================================================================ the recipe
 *
 * WHAT THE SET LOOKS LIKE NOW — three layers deep, and the depth is the point.
 *
 * `base` is the project: tools driven by CONTENT — cleanup, skin, noise,
 * sharpening. The same face wants the same treatment wherever it was standing.
 *
 * `perBatch` is the light: the learned colour, white balance, exposure,
 * grading. One grade over a whole wedding is a lie, and this is where that stops
 * being one.
 *
 * `perFrame` is the exception — the single photograph that breaks the rule.
 *
 * Nothing here writes a file. Switching a step off is instant and costs nothing,
 * because the only thing that ever gets written is `תמונות`, and that happens
 * when the photographer applies — from the RAW, through the whole stack, never
 * on top of the previous output.
 */

const EMPTY_RECIPE: ProjectRecipe = { version: 1, base: [], perBatch: {}, perFrame: {} };

export function recipeOf(projectId: string): ProjectRecipe {
  return (stateOf(projectId).recipe as ProjectRecipe) ?? EMPTY_RECIPE;
}

export function useRecipe(projectId: string): ProjectRecipe {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(projectId),
    () => stateOf(projectId),
  );
  return (state.recipe as ProjectRecipe) ?? EMPTY_RECIPE;
}

/** Strip what cannot mean anything on another frame.
 *
 *  A brush stroke and a set of marked outlines belong to one face in one photo;
 *  carrying them into a step that runs on a whole batch would apply one
 *  frame's geometry to every other frame. The rule is stated in types.ts — this
 *  is where it is enforced, at the one door into the shared layers. */
function shareable(step: ToolInstance): ToolInstance {
  const { selection: _drop, strokes: _painted_by_hand, objectSelection: _object_selection, mask, ...rest } = step;
  if (step.toolId === 'object-remove') return { ...rest, enabled: false };
  if (!mask) return rest;
  // The mask itself travels — "the 3D on the clothes" is a sentence about
  // every photograph in the set. What he drew BY HAND inside it does not, in
  // either of the two shapes it comes in: `paint` is an alpha of one frame's
  // pixels, `strokes` is a path across one frame's faces.
  const { paint: _painted, strokes: _by_hand, ...maskRest } = mask;
  return { ...rest, mask: maskRest };
}

function upsert(list: ToolInstance[], step: ToolInstance): ToolInstance[] {
  return list.some((t) => t.toolId === step.toolId)
    ? list.map((t) => (t.toolId === step.toolId ? step : t))
    : [...list, step];
}

/** Put a step on a layer. One entry per tool per layer: applying a look twice
 *  REPLACES it rather than stacking two grades — a set has one look, and "keep
 *  both" is a variations feature, not a side effect.
 *
 *  `batchId` chooses the layer. Passing one is what makes the dance floor
 *  and the garden two different grades instead of an argument. */
export function setStep(projectId: string, step: ToolInstance, batchId?: string | null) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const clean = shareable(step);
  const next: ProjectRecipe = batchId
    ? {
      ...recipe,
      perBatch: {
        ...recipe.perBatch,
        [batchId]: upsert(recipe.perBatch[batchId] ?? [], clean),
      },
    }
    : { ...recipe, base: upsert(recipe.base, clean) };
  write(projectId, { ...current, recipe: next });
}

export function removeStep(projectId: string, toolId: string, batchId?: string | null) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const next: ProjectRecipe = batchId
    ? {
      ...recipe,
      perBatch: {
        ...recipe.perBatch,
        [batchId]: (recipe.perBatch[batchId] ?? []).filter((t) => t.toolId !== toolId),
      },
    }
    : { ...recipe, base: recipe.base.filter((t) => t.toolId !== toolId) };
  write(projectId, { ...current, recipe: next });
}

export function toggleStep(
  projectId: string,
  toolId: string,
  enabled: boolean,
  batchId?: string | null,
) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const flip = (list: ToolInstance[]) =>
    list.map((t) => (t.toolId === toolId ? { ...t, enabled } : t));
  const next: ProjectRecipe = batchId
    ? {
      ...recipe,
      perBatch: {
        ...recipe.perBatch,
        [batchId]: flip(recipe.perBatch[batchId] ?? []),
      },
    }
    : { ...recipe, base: flip(recipe.base) };
  write(projectId, { ...current, recipe: next });
}

/* ---- the frame layer ----
 *
 * One photograph, on its own. This is where the tool-by-tool workbench writes:
 * retouching is judged frame by frame, and a skin setting that flatters one
 * face is not a setting, it is a guess about every other face in the batch.
 *
 * Unlike the shared layers, THIS one may carry a brush stroke and a set of
 * marked spots — they belong to one face in one photograph, which is exactly
 * what this layer is. `shareable()` is deliberately not applied here. */

export function setFrameStep(projectId: string, frame: string, step: ToolInstance) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const key = frameKey(frame);
  const before = renderedAs(projectId, frame);
  write(projectId, {
    ...current,
    recipe: {
      ...recipe,
      perFrame: { ...recipe.perFrame, [key]: upsert(recipe.perFrame[key] ?? [], step) },
    },
  });
  afterFrameEdit(projectId, frame, before);
}

/** Copy one or more shareable steps to a precise list of photographs in a
 * single project write. This is what lets "apply to the client's choice" stay
 * honest: hidden, unselected photographs in the same batch are untouched. */
export function setFrameSteps(projectId: string, frames: string[], steps: ToolInstance[]) {
  if (!frames.length || !steps.length) return;
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const perFrame = { ...recipe.perFrame };
  const clean = steps.map(shareable);
  const before = new Map(frames.map((frame) => [frame, renderedAs(projectId, frame)]));
  for (const frame of frames) {
    const key = frameKey(frame);
    let next = perFrame[key] ?? [];
    for (const step of clean) next = upsert(next, step);
    perFrame[key] = next;
  }
  write(projectId, { ...current, recipe: { ...recipe, perFrame } });
  for (const frame of frames) afterFrameEdit(projectId, frame, before.get(frame) ?? '');
}

export function removeFrameStep(projectId: string, frame: string, toolId: string) {
  const current = stateOf(projectId);
  const recipe = current.recipe as ProjectRecipe;
  const key = frameKey(frame);
  const before = renderedAs(projectId, frame);
  const left = (recipe.perFrame[key] ?? []).filter((t) => t.toolId !== toolId);
  const perFrame = { ...recipe.perFrame };
  // An empty exception list is not an exception. Leaving `{}` behind would make
  // "how many frames differ from the set" count frames that no longer do.
  if (left.length) perFrame[key] = left;
  else delete perFrame[key];
  write(projectId, { ...current, recipe: { ...recipe, perFrame } });
  afterFrameEdit(projectId, frame, before);
}

/** What this ONE frame carries of its own, ignoring what it inherits. */
export function frameSteps(projectId: string, frame: string): ToolInstance[] {
  return recipeOf(projectId).perFrame[frameKey(frame)] ?? [];
}

function merge(wide: ToolInstance[], narrow: ToolInstance[]): ToolInstance[] {
  if (!narrow.length) return wide;
  const byId = new Map(narrow.map((t) => [t.toolId, t]));
  const merged = wide.map((t) => byId.get(t.toolId) ?? t);
  const extra = narrow.filter((t) => !wide.some((b) => b.toolId === t.toolId));
  return [...merged, ...extra];
}

/** What one frame actually renders through: base, then its batch, then its
 *  own exception. Each layer overrides by toolId, so an exception on three
 *  photographs never has to restate the twelve steps they share with the rest
 *  of the set. The engine sorts by pipeline order anyway, so this order is for
 *  reading, not for correctness. */
export function effectiveRecipe(projectId: string, frame?: string): ToolInstance[] {
  const recipe = recipeOf(projectId);
  let out = recipe.base;
  if (frame) {
    const batch = batchOfFrame(projectId, frame);
    if (batch) out = merge(out, recipe.perBatch[batch] ?? []);
    out = merge(out, recipe.perFrame[frameKey(frame)] ?? []);
  }
  return out;
}

/** What a whole batch renders through — base plus its own light. The set
 *  view keys its previews on this, and `apply` writes files from it. */
export function batchRecipe(projectId: string, batchId?: string | null): ToolInstance[] {
  const recipe = recipeOf(projectId);
  if (!batchId) return recipe.base;
  return merge(recipe.base, recipe.perBatch[batchId] ?? []);
}

/** Steps that will actually run — what the engine keys a preview on. An
 *  all-disabled recipe is the raw frame, and must produce the raw frame's key. */
export function activeSteps(projectId: string, frame?: string): ToolInstance[] {
  return effectiveRecipe(projectId, frame).filter((t) => t.enabled);
}

/* ---- the frame's file follows the frame's recipe ----
 *
 * The recipe is the truth, and the edit screen rightly writes no file. But the
 * album lays out and PRINTS `frame.shown` — the file in `תמונות` — so a photo
 * edited on its own used to reach the album unedited. When a frame's own
 * recipe really changes, its file is re-rendered from the raw through the full
 * layered recipe. See editSync.ts and docs/EDIT-TO-ALBUM.md.
 *
 * Only the FRAME layer triggers this. A change to a batch's look reaches its
 * files through "apply to set", explicitly: re-rendering every photograph in a
 * batch on each move of its look would hold the processor for tens of minutes
 * at a time. */

/** Where a project's rendered files live. One place, so the folder name cannot
 *  drift between the screens that write there. Matches workspace.EDITED_DIR. */
export function editedDirOf(home: string): string {
  return `${home}\\תמונות`;
}

function rawPathOf(projectId: string, frame: string): string | undefined {
  const name = frameKey(frame);
  return (framesByProject[projectId] ?? []).find((f) => f.name === name)?.path;
}

const frameSync = createEditSync({
  async render(projectId, frame) {
    const home = getProject(projectId)?.home;
    if (!home) throw new Error('לפרויקט אין עדיין תיקייה על הדיסק');
    const raw = rawPathOf(projectId, frame);
    if (!raw) throw new Error(`התמונה ${frameKey(frame)} לא נמצאה בתיקיית הפרויקט`);
    // Read NOW, not when scheduled: the latest recipe is the one that renders.
    await applyToFrame(raw, editedDirOf(home), activeSteps(projectId, raw));
  },
  reload: reloadFrames,
  onError(projectId, frame, error) {
    // Reported, never swallowed: a silent failure here is the original bug.
    console.error(`[עדכון קובץ ערוך] ${projectId} ${frame}:`, error);
  },
});

/** סיימתי — the photograph is finished, so its finished file goes where it is
 *  looked at:
 *   1. rendered from the raw through its WHOLE recipe (base, batch and its own
 *      layer) into תמונות — the album lays out `frame.shown`, and a batch look
 *      never re-renders a file by itself (see frameSync above);
 *   2. if the client's gallery holds this frame, published there as the next
 *      version with the client's choice kept, so the client sees the photos
 *      they chose being edited.
 *  Each outcome is reported on its own; a gallery that cannot be reached does
 *  not undo the file, and neither failure is ever silent. */
export interface FinishOutcome {
  file: string | null;
  fileError?: string;
  gallery: 'sent' | 'not-in-gallery' | 'no-gallery' | 'failed';
  galleryError?: string;
}

export async function publishFinished(projectId: string, frame: string): Promise<FinishOutcome> {
  const home = getProject(projectId)?.home;
  const raw = rawPathOf(projectId, frame);
  if (!home || !raw) {
    return { file: null, fileError: !home ? 'לפרויקט אין תיקייה על הדיסק' : 'התמונה לא נמצאה בתיקייה', gallery: 'failed' };
  }
  let file: string | null = null;
  try {
    file = (await applyToFrame(raw, editedDirOf(home), activeSteps(projectId, raw))).file;
    await reloadFrames(projectId);
  } catch (e) {
    return { file: null, fileError: e instanceof Error ? e.message : 'השמירה נכשלה', gallery: 'failed' };
  }
  const link = galleryOf(projectId);
  if (!link) return { file, gallery: 'no-gallery' };
  try {
    const state = await galleryState(link.galleryId);
    const item = state.selection.find((s) => s.frameId === frameKey(frame));
    if (!item) return { file, gallery: 'not-in-gallery' };
    await galleryPublishVersion(link.galleryId, item.itemId, file, true);
    return { file, gallery: 'sent' };
  } catch (e) {
    return { file, gallery: 'failed', galleryError: e instanceof Error ? e.message : 'הגלריה לא ענתה' };
  }
}

/** What is happening to a frame's file right now: undefined when it is up to
 *  date, else waiting / rendering / error (with the engine's message). */
export function frameSyncStatus(projectId: string, frame: string): SyncStatus | undefined {
  return frameSync.statusOf(projectId, frameKey(frame));
}

export function subscribeFrameSync(fn: () => void): () => void {
  return frameSync.subscribe(fn);
}

/** Resolves once every pending frame file has been written and re-read. */
export function frameSyncIdle(): Promise<void> {
  return frameSync.whenIdle();
}

/** The recipe a frame renders through, as a comparable value. Used to tell a
 *  real edit from a save that changed nothing — the edit screen saves on every
 *  action, and merely opening a photograph must not render it. */
function renderedAs(projectId: string, frame: string): string {
  return JSON.stringify(activeSteps(projectId, frame));
}

function afterFrameEdit(projectId: string, frame: string, before: string) {
  if (renderedAs(projectId, frame) !== before) {
    frameSync.schedule(projectId, frameKey(frame));
  }
}

/** The learned colour look on a batch — or on the project when no batch
 *  is given. */
export function colorStep(
  projectId: string,
  batchId?: string | null,
): LearnedColorModel | undefined {
  return batchRecipe(projectId, batchId).find((t) => t.toolId === 'pixel-color')?.model;
}
