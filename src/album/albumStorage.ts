/* Albums, in the database.
 *
 * An album is a deliverable of ONE project, so it is stored with that
 * project's id and never listed under another — two weddings sharing a library
 * is how the wrong album reaches the press.
 *
 * What is stored is the DESIGN: spreads, layouts, crops, cover, review
 * versions, and for each frame the album uses, the path to it on disk. Not one
 * photograph is copied in. The tray is rebuilt from the project's folders every
 * time the album opens, so a folder added later simply appears.
 *
 * The one exception is a frame that was uploaded into the browser before
 * albums drew from project folders. Those have no path, only a blob in
 * IndexedDB, and they keep working — deleting somebody's album because the
 * storage model changed is not an option.
 */

import { useSyncExternalStore } from 'react';
import type { AlbumPhoto, AlbumProject } from './model';
import { frameUrl } from './projectPhotos';
import { DatabaseDown, dbDelete, dbFind, dbSave } from '../db';

const DB_NAME = 'teza-album-local';
const DB_VERSION = 1;
const PHOTO_STORE = 'photo-blobs';

/** Albums saved in the browser before they lived in the database. Read once so
 *  they can be moved in; never deleted here. */
const LEGACY_WORKSPACE_KEY = 'teza-album-workspace-v1';
const LEGACY_INDEX_KEY = 'teza-albums-index-v1';
const legacyAlbumKey = (id: string) => `teza-album-${id}-v1`;

interface SavedPhoto extends Omit<AlbumPhoto, 'url'> {
  url?: string;
  storageKey?: string;
}

/** One album, as one document. */
interface AlbumDoc {
  id: string;
  projectId?: string;
  project: AlbumProject;
  photos: SavedPhoto[];
  savedAt: string;
  createdAt: string;
}

/** What the library lists, without paying to parse every album. */
export interface AlbumSummary {
  id: string;
  name: string;
  /** The project this album is a deliverable of. */
  projectId?: string;
  productProfileId: string;
  spreadCount: number;
  photoCount: number;
  placedCount: number;
  updatedAt: string;
  createdAt: string;
}

/* ------------------------------------------------------- the photo blobs
 *
 * Only for frames uploaded into the browser. Project photos are paths, and
 * their pixels come from the engine.
 */

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE)) {
        request.result.createObjectStore(PHOTO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storePhotoBlob(key: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readwrite');
    transaction.objectStore(PHOTO_STORE).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readPhotoBlob(key: string): Promise<Blob | null> {
  const database = await openDatabase();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const request = database.transaction(PHOTO_STORE).objectStore(PHOTO_STORE).get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return result;
}

/* --------------------------------------------------------------- the store */

let summaries: AlbumSummary[] = [];
let state: 'loading' | 'ready' | 'down' = 'loading';
let failure: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function writeFailed(error: unknown) {
  failure = error instanceof DatabaseDown
    ? error.message
    : error instanceof Error ? error.message : 'שמירת האלבום נכשלה';
  notify();
}

function summarize(doc: AlbumDoc): AlbumSummary {
  const placed = new Set(doc.project.spreads.flatMap((spread) => spread.photoIds));
  return {
    id: doc.project.id,
    name: doc.project.name,
    projectId: doc.project.projectId,
    productProfileId: doc.project.productProfileId,
    spreadCount: doc.project.spreads.length,
    photoCount: doc.photos.length,
    placedCount: placed.size,
    updatedAt: doc.savedAt,
    createdAt: doc.createdAt,
  };
}

/* Albums the browser still holds from before the database. Moved in on first
 * load, and left in place afterwards as a safety net. */
function legacyAlbums(): AlbumDoc[] {
  const docs: AlbumDoc[] = [];
  const seen = new Set<string>();

  const take = (raw: string | null, fallbackId?: string) => {
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { project: AlbumProject; photos: SavedPhoto[]; savedAt: string };
      if (!saved?.project || !Array.isArray(saved.photos)) return;
      const id = saved.project.id || fallbackId;
      if (!id || seen.has(id)) return;
      seen.add(id);
      docs.push({
        id,
        projectId: saved.project.projectId,
        project: { ...saved.project, id },
        photos: saved.photos,
        savedAt: saved.savedAt ?? new Date().toISOString(),
        createdAt: saved.savedAt ?? new Date().toISOString(),
      });
    } catch {
      // a corrupt legacy blob must not block the library from opening
    }
  };

  take(localStorage.getItem(LEGACY_WORKSPACE_KEY), `album-${Date.now()}`);
  try {
    const index = JSON.parse(localStorage.getItem(LEGACY_INDEX_KEY) ?? '[]') as AlbumSummary[];
    if (Array.isArray(index)) {
      index.forEach((entry) => take(localStorage.getItem(legacyAlbumKey(entry.id))));
    }
  } catch {
    // no index, or an unreadable one — the workspace above may still be there
  }
  return docs;
}

async function hydrate() {
  try {
    const legacy = legacyAlbums();
    if (legacy.length) {
      // never overwrites: an id already in the database is left alone
      const existing = new Set((await dbFind<AlbumDoc>('albums')).map((doc) => doc.id));
      await Promise.all(
        legacy
          .filter((doc) => !existing.has(doc.id))
          .map((doc) => dbSave('albums', doc).catch(() => undefined)),
      );
    }
    const docs = await dbFind<AlbumDoc>('albums');
    summaries = docs.map(summarize).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    state = 'ready';
    failure = null;
  } catch (error) {
    // unreachable is not empty — the library must say which one it is
    state = 'down';
    failure = error instanceof Error ? error.message : 'לא ניתן לקרוא את האלבומים';
  }
  notify();
}

let started = false;
if (typeof window !== 'undefined' && !started) {
  started = true;
  void hydrate();
}

/** The albums of one project, newest first.
 *
 * With no project id it returns everything — the only caller that wants that is
 * one looking for albums made before albums belonged to projects. */
export function listAlbums(projectId?: string): AlbumSummary[] {
  return projectId ? summaries.filter((entry) => entry.projectId === projectId) : summaries;
}

/** Albums with no project — the pre-integration ones, kept reachable. */
export function listUnassignedAlbums(): AlbumSummary[] {
  return summaries.filter((entry) => !entry.projectId);
}

/** Re-render whichever screen is showing albums when they change. */
export function useAlbums(projectId?: string): AlbumSummary[] {
  const all = useSyncExternalStore(subscribe, () => summaries, () => EMPTY_SUMMARIES);
  return projectId ? all.filter((entry) => entry.projectId === projectId) : all;
}

const EMPTY_SUMMARIES: AlbumSummary[] = [];

export function albumStoreState(): { state: typeof state; failure: string | null } {
  return { state, failure };
}

export function saveAlbum(project: AlbumProject, photos: AlbumPhoto[]): void {
  const existing = summaries.find((entry) => entry.id === project.id);
  const now = new Date().toISOString();
  const doc: AlbumDoc = {
    id: project.id,
    projectId: project.projectId,
    project,
    photos: photos.map((photo) => ({
      ...photo,
      /* A url is only worth keeping when it is the only way back to the
       * pixels. A project photo is rebuilt from its path and an uploaded one
       * from its blob; a stored blob: URL would just be a dead handle from a
       * session that has ended. */
      url: photo.path || photo.storageKey ? undefined : photo.url,
    })),
    savedAt: now,
    createdAt: existing?.createdAt ?? now,
  };

  summaries = [
    summarize(doc),
    ...summaries.filter((entry) => entry.id !== project.id),
  ];
  notify();
  dbSave('albums', doc).catch(writeFailed);
}

export async function loadAlbum(id: string): Promise<{
  project: AlbumProject;
  photos: AlbumPhoto[];
} | null> {
  const [doc] = await dbFind<AlbumDoc>('albums', { _id: id });
  if (!doc) return null;

  const photos = await Promise.all(doc.photos.map(async (photo) => {
    /* A project photo is a pointer to a file on disk. The engine serves it,
     * so re-opening an album a month later costs nothing and picks up the
     * file as it is now — including a re-export of the same frame. */
    if (photo.path) return { ...photo, url: frameUrl(photo.path) } as AlbumPhoto;
    if (!photo.storageKey) return { ...photo, url: photo.url ?? '' } as AlbumPhoto;
    const blob = await readPhotoBlob(photo.storageKey);
    return {
      ...photo,
      url: blob ? URL.createObjectURL(blob) : '',
      analysis: blob ? photo.analysis : {
        status: 'failed',
        faces: [],
        focalPoint: { x: 0.5, y: 0.5 },
        sharpnessScore: 0,
        qualityScore: 0,
        analyzedBy: 'missing-local-file',
      },
    } as AlbumPhoto;
  }));
  return { project: doc.project, photos };
}

export async function deleteAlbum(id: string): Promise<void> {
  summaries = summaries.filter((entry) => entry.id !== id);
  notify();
  await dbDelete('albums', id).catch(writeFailed);
}

export async function duplicateAlbum(id: string, name: string): Promise<string | null> {
  const [doc] = await dbFind<AlbumDoc>('albums', { _id: id });
  if (!doc) return null;
  const newId = `album-${Date.now()}`;
  /* The copy points at the SAME frames on purpose — duplicating an album to
   * try a different edit must not double anything on disk. */
  const now = new Date().toISOString();
  const copy: AlbumDoc = {
    ...doc,
    id: newId,
    project: { ...doc.project, id: newId, name },
    savedAt: now,
    createdAt: now,
  };
  summaries = [summarize(copy), ...summaries];
  notify();
  await dbSave('albums', copy).catch(writeFailed);
  return newId;
}

export async function renameAlbum(id: string, name: string): Promise<void> {
  const [doc] = await dbFind<AlbumDoc>('albums', { _id: id });
  if (!doc) return;
  const next: AlbumDoc = { ...doc, project: { ...doc.project, name } };
  summaries = summaries.map((entry) => (entry.id === id ? { ...entry, name } : entry));
  notify();
  await dbSave('albums', next).catch(writeFailed);
}

/** Attach an existing album to a project. */
export async function assignAlbumToProject(id: string, projectId: string): Promise<void> {
  const [doc] = await dbFind<AlbumDoc>('albums', { _id: id });
  if (!doc) return;
  const next: AlbumDoc = { ...doc, projectId, project: { ...doc.project, projectId } };
  summaries = summaries.map((entry) => (entry.id === id ? { ...entry, projectId } : entry));
  notify();
  await dbSave('albums', next).catch(writeFailed);
}
