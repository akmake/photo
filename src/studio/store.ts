/* The project store.
 *
 * The records live in MongoDB, reached through the local engine (engine/db.py).
 * They used to live in localStorage — one key, one browser profile, no backup,
 * no way to move machines. Clearing site data deleted the studio. The
 * photographs survived because they are files on disk; everything known about
 * them did not.
 *
 * The shape here is deliberate:
 *
 *   memory   what the screens render, updated immediately
 *   Mongo    the truth, written through on every change
 *   disk     the photographs, never copied, never touched
 *
 * Writes are optimistic — the screen must not wait on a round trip to show a
 * change the photographer just made — but a write that FAILS is surfaced, not
 * swallowed. Silence after a failed save is how work disappears.
 */

import { useSyncExternalStore } from 'react';
import { thumbUrl } from '../api';
import { DatabaseDown, dbDelete, dbDeleteWhere, dbFind, dbImport, dbSave } from '../db';

/** The stages a job moves through. `הכנה` is where the deliverables are chosen,
 *  and those choices decide which of the later stages this project even has. */
export const STAGES = [
  { id: 'setup', label: 'הכנה' },
  { id: 'import', label: 'ייבוא' },
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
  event: string;
  /** dd.mm — the shoot date, not the creation date. */
  date: string;
  location?: string;
  price?: number;
  paid?: number;
  /** The job's cover: a REAL frame from its own folders, served by the engine.
   *  Empty until the project has photographs — a stock picture standing in for
   *  a client's shoot is a lie the tile tells every time it is seen. */
  thumb: string;
  /** Crop of the cover, so a wall of tiles is not one repeated composition. */
  pos: string;
  /** Index into the project's own stage list. */
  at: number;
  counts: string;
  state: ProjectState;
  /** Chosen in הכנה. A family session has no album, and a project without one
   *  must not show an album stage it will never use. */
  hasAlbum: boolean;
  hasGallery: boolean;
  /** Counters — the spine of the project header. */
  imported: number;
  kept: number;
  picked: number;
  rendered: number;
  waitingSince?: string;
  createdAt: string;
}

/** The stages this particular project has, after its deliverables are applied. */
export function stagesOf(p: Project) {
  return STAGES.filter((s) => (s.id === 'album' ? p.hasAlbum : true));
}

export type PhotoStatus = 'raw' | 'working' | 'ready';

export const PHOTO_STATUS: { id: PhotoStatus; label: string }[] = [
  { id: 'raw', label: 'חומר גלם' },
  { id: 'working', label: 'בטיפול' },
  { id: 'ready', label: 'מוכן' },
];

export interface ProjectFolder {
  id: string;
  path: string;
  name: string;
  count: number;
}

/** As stored: a folder knows which job it belongs to. */
interface FolderDoc extends ProjectFolder {
  projectId: string;
}

interface StatusDoc {
  /** The absolute path IS the id. */
  id: string;
  status: PhotoStatus;
}

export interface Photo {
  /** The absolute path IS the identity. It is stable, unique, and it is what
   *  every engine call needs anyway — a generated id would only be a second
   *  name for the same thing, and one more thing to keep in sync. */
  id: string;
  path: string;
  name: string;
  folderId: string;
  status: PhotoStatus;
}

/* ------------------------------------------------------------------- state */

export type StoreState = 'loading' | 'ready' | 'down';

let projects: Project[] = [];
let folders: Record<string, ProjectFolder[]> = {};
let statuses: Record<string, PhotoStatus> = {};
let state: StoreState = 'loading';
let failure: string | null = null;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A write that did not reach the database. The screen has to say so — the
 *  change is on screen but not saved, and only the photographer can decide
 *  whether to retry or stop working. */
function writeFailed(error: unknown) {
  failure = error instanceof DatabaseDown
    ? error.message
    : error instanceof Error ? error.message : 'השמירה נכשלה';
  notify();
}

export function useStoreState(): { state: StoreState; failure: string | null } {
  return useSyncExternalStore(
    subscribe,
    () => snapshot(),
    () => snapshot(),
  );
}

/* useSyncExternalStore compares snapshots by identity, so this must return the
 * SAME object until something actually changes — a fresh literal every call is
 * an infinite render loop. */
let cachedSnapshot: { state: StoreState; failure: string | null } = { state, failure };
function snapshot() {
  if (cachedSnapshot.state !== state || cachedSnapshot.failure !== failure) {
    cachedSnapshot = { state, failure };
  }
  return cachedSnapshot;
}

/** True when the records could not be READ. Never means "no projects". */
export function projectsUnreadable(): boolean {
  return state === 'down';
}

/* --------------------------------------------------------------- migration
 *
 * The studio as it was saved in this browser, moved into the database once.
 * NOTHING is deleted here: the old copy stays exactly where it is until the
 * photographer has seen their work in the new home. A migration that removes
 * the only other copy on its first run is one nobody can recover from.
 */

const OLD_PROJECTS = 'teza.projects.v1';
const OLD_FOLDERS = 'teza.folders.v1';
const OLD_STATUS = 'teza.photo-status.v1';

function readOld<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

/** What this browser still holds, in the shape the database stores. */
function browserRecords() {
  const oldProjects = readOld<Project[]>(OLD_PROJECTS, []);
  const oldFolders = readOld<Record<string, ProjectFolder[]>>(OLD_FOLDERS, {});
  const oldStatus = readOld<Record<string, PhotoStatus>>(OLD_STATUS, {});

  const folderDocs: FolderDoc[] = Object.entries(oldFolders)
    .flatMap(([projectId, list]) => (Array.isArray(list) ? list : [])
      .map((folder) => ({ ...folder, projectId })));
  const statusDocs: StatusDoc[] = Object.entries(oldStatus)
    .map(([path, status]) => ({ id: path, status }));

  return {
    projects: Array.isArray(oldProjects) ? oldProjects : [],
    folders: folderDocs,
    photoStatus: statusDocs,
  };
}

/** Whether this browser is still holding records that never reached the
 *  database — the UI offers to move them rather than doing it silently. */
export function browserRecordCount(): number {
  const old = browserRecords();
  return old.projects.length + old.folders.length + old.photoStatus.length;
}

/* ------------------------------------------------------------------ loading */

async function hydrate() {
  try {
    /* Anything this browser still holds goes in FIRST, and only where the
     * database has nothing — import_once never overwrites. Then the read below
     * returns the union, so a photographer who has been working in localStorage
     * finds their studio intact on the first launch after the change. */
    const old = browserRecords();
    if (old.projects.length || old.folders.length || old.photoStatus.length) {
      await dbImport(old).catch(() => undefined);
    }

    const [projectDocs, folderDocs, statusDocs] = await Promise.all([
      dbFind<Project>('projects'),
      dbFind<FolderDoc>('folders'),
      dbFind<StatusDoc>('photoStatus'),
    ]);

    projects = projectDocs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    folders = {};
    folderDocs.forEach(({ projectId, ...folder }) => {
      folders[projectId] = [...(folders[projectId] ?? []), folder];
    });
    statuses = {};
    statusDocs.forEach((doc) => {
      statuses[doc.id] = doc.status;
    });

    state = 'ready';
    failure = null;
  } catch (error) {
    /* An unreachable database is NOT an empty studio. Everything stays empty
     * in memory, but the state says why, and every screen that lists records
     * must show that reason instead of "nothing here". */
    state = 'down';
    failure = error instanceof Error ? error.message : 'לא ניתן לקרוא את הנתונים';
  }
  notify();
}

let started = false;

/** Load the studio. Safe to call repeatedly; only the first call reads. */
export function openStore(): void {
  if (started) return;
  started = true;
  void hydrate();
}

/** Try again after a failure — the engine may simply not have been running. */
export function retryStore(): void {
  state = 'loading';
  failure = null;
  notify();
  void hydrate();
}

openStore();

/* ----------------------------------------------------------------- projects */

const EMPTY_PROJECTS: Project[] = [];

export function useProjects(): Project[] {
  return useSyncExternalStore(subscribe, () => projects, () => EMPTY_PROJECTS);
}

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export interface NewProjectInput {
  client: string;
  event: string;
  date: string;
  location?: string;
  price?: number;
  hasGallery: boolean;
  hasAlbum: boolean;
}

const CROPS = ['50% 40%', '40% 30%', '55% 45%', '35% 55%', '60% 35%'];

/** Creates the project and returns it, so the caller can walk straight into it.
 *  A new job starts in הכנה with every counter at zero — there is nothing to
 *  invent, and inventing it is how a screen starts lying. */
export function createProject(input: NewProjectInput): Project {
  const n = projects.length + 1;
  const project: Project = {
    id: `p${Date.now().toString(36)}`,
    client: input.client.trim(),
    event: input.event.trim() || 'צילום',
    date: input.date,
    location: input.location?.trim() || undefined,
    price: input.price,
    paid: 0,
    // no photographs yet, so no cover. It arrives with the first folder.
    thumb: '',
    pos: CROPS[n % CROPS.length],
    at: 0,
    counts: 'טרם יובא',
    state: 'shoot',
    hasAlbum: input.hasAlbum,
    hasGallery: input.hasGallery,
    imported: 0,
    kept: 0,
    picked: 0,
    rendered: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  projects = [project, ...projects];
  notify();
  dbSave('projects', project).catch(writeFailed);
  return project;
}

/** Change one job. The screen updates now; the database catches up. */
export function updateProject(id: string, patch: Partial<Project>): void {
  const current = projects.find((p) => p.id === id);
  if (!current) return;
  const next = { ...current, ...patch, id: current.id };
  projects = projects.map((p) => (p.id === id ? next : p));
  notify();
  dbSave('projects', next).catch(writeFailed);
}

/** Remove a job and everything that belongs only to it. */
export function deleteProject(id: string): void {
  projects = projects.filter((p) => p.id !== id);
  const { [id]: _dropped, ...rest } = folders;
  folders = rest;
  notify();
  dbDelete('projects', id).catch(writeFailed);
  dbDeleteWhere('folders', { projectId: id }).catch(writeFailed);
}

/** The cover to draw for a job, or null when it has no photographs yet.
 *
 * The stored value is a PATH on disk — the browser cannot read it, so the
 * engine serves the pixels, exactly as it does everywhere else in the product. */
export function coverUrl(project: Project, width = 480): string | null {
  if (!project.thumb) return null;
  return project.thumb.startsWith('/') ? project.thumb : thumbUrl(project.thumb, width);
}

/** Give a project its cover, once, from a frame it actually contains.
 *
 * Never overwrites an existing cover: the photographer may pick a better one
 * later, and a re-read of the folder must not silently undo that choice. */
export function setCoverIfMissing(projectId: string, framePath: string) {
  const project = projects.find((p) => p.id === projectId);
  if (!project || project.thumb || !framePath) return;
  updateProject(projectId, { thumb: framePath });
}

/** Every distinct client already on file — a returning client is the most
 *  valuable thing in the business, and typing their name again is how the
 *  history gets split in two. */
export function knownClients(): string[] {
  return [...new Set(projects.map((p) => p.client))].sort((a, b) => a.localeCompare(b, 'he'));
}

/* ============================================================ folders & photos
 *
 * A project points at FOLDERS on disk — often more than one (ceremony, party,
 * second shooter). The photographs themselves are never copied anywhere: the
 * folder list and each frame's status are the only things stored, and the disk
 * stays the source of truth for what actually exists.
 *
 * Status defaults to "חומר גלם". That is not a placeholder for "unprocessed" —
 * most frames in a shoot never need an individual decision, and forcing the
 * photographer to clear a to-do on 1,800 files would be the tool inventing
 * work. Marking בטיפול / מוכן is opt-in, per frame.
 */

const EMPTY_FOLDERS: ProjectFolder[] = [];

export function foldersOf(projectId: string): ProjectFolder[] {
  return folders[projectId] ?? EMPTY_FOLDERS;
}

export function useFolders(projectId: string): ProjectFolder[] {
  return useSyncExternalStore(
    subscribe,
    () => folders[projectId] ?? EMPTY_FOLDERS,
    () => EMPTY_FOLDERS,
  );
}

export function addFolder(projectId: string, path: string, count: number): ProjectFolder {
  /* Both separators, on both ends of the job. These paths are Windows paths:
   * splitting on `/` alone left the folder's "name" as the entire path. */
  const clean = path.trim().replace(/[/\\]+$/, '');
  const name = clean.split(/[/\\]/).filter(Boolean).pop() ?? clean;
  const existing = (folders[projectId] ?? []).find((f) => f.path === clean);
  const folder: ProjectFolder = existing
    ? { ...existing, count }
    : { id: `f${Date.now().toString(36)}`, path: clean, name, count };
  folders = {
    ...folders,
    [projectId]: existing
      ? (folders[projectId] ?? []).map((f) => (f.path === clean ? folder : f))
      : [...(folders[projectId] ?? []), folder],
  };
  notify();
  dbSave<FolderDoc>('folders', { ...folder, projectId }).catch(writeFailed);
  return folder;
}

export function removeFolder(projectId: string, folderId: string) {
  folders = {
    ...folders,
    [projectId]: (folders[projectId] ?? []).filter((f) => f.id !== folderId),
  };
  notify();
  dbDelete('folders', folderId).catch(writeFailed);
}

export function statusOf(path: string): PhotoStatus {
  return statuses[path] ?? 'raw';
}

export function setPhotoStatus(path: string, status: PhotoStatus) {
  if (status === 'raw') {
    // the default is not stored — 1,800 rows saying "untouched" is not a record
    const { [path]: _drop, ...rest } = statuses;
    statuses = rest;
    notify();
    dbDelete('photoStatus', path).catch(writeFailed);
    return;
  }
  statuses = { ...statuses, [path]: status };
  notify();
  dbSave<StatusDoc>('photoStatus', { id: path, status }).catch(writeFailed);
}

const EMPTY_STATUSES: Record<string, PhotoStatus> = {};

export function useStatuses(): Record<string, PhotoStatus> {
  return useSyncExternalStore(subscribe, () => statuses, () => EMPTY_STATUSES);
}
