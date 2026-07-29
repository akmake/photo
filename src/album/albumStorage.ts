import type { AlbumPhoto, AlbumProject } from './model';

const DB_NAME = 'teza-album-local';
const DB_VERSION = 1;
const PHOTO_STORE = 'photo-blobs';

/** The pre-library format: a single album, with no way back to an earlier one. */
const LEGACY_WORKSPACE_KEY = 'teza-album-workspace-v1';
const INDEX_KEY = 'teza-albums-index-v1';
const albumKey = (id: string) => `teza-album-${id}-v1`;

interface SavedPhoto extends Omit<AlbumPhoto, 'url'> {
  url?: string;
  storageKey?: string;
}

interface SavedAlbum {
  project: AlbumProject;
  photos: SavedPhoto[];
  savedAt: string;
}

/** What the library lists, without paying to parse every album. */
export interface AlbumSummary {
  id: string;
  name: string;
  productProfileId: string;
  spreadCount: number;
  photoCount: number;
  placedCount: number;
  updatedAt: string;
  createdAt: string;
}

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

async function deletePhotoBlobs(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, 'readwrite');
    const store = transaction.objectStore(PHOTO_STORE);
    keys.forEach((key) => store.delete(key));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

function readIndex(): AlbumSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed as AlbumSummary[] : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: AlbumSummary[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

function readAlbum(id: string): SavedAlbum | null {
  try {
    const raw = localStorage.getItem(albumKey(id));
    const parsed = raw ? JSON.parse(raw) as SavedAlbum : null;
    if (!parsed?.project || !Array.isArray(parsed.photos)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storageKeysOf(saved: SavedAlbum): string[] {
  return saved.photos.map((photo) => photo.storageKey).filter((key): key is string => !!key);
}

/* One album saved before the library existed. Move it in rather than leaving it
 * stranded — it is the photographer's real work, and it is the only copy. */
function migrateLegacyWorkspace(): void {
  const raw = localStorage.getItem(LEGACY_WORKSPACE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as SavedAlbum;
    if (!saved?.project || !Array.isArray(saved.photos)) {
      localStorage.removeItem(LEGACY_WORKSPACE_KEY);
      return;
    }
    const id = saved.project.id || `album-${Date.now()}`;
    if (!readAlbum(id)) {
      localStorage.setItem(albumKey(id), JSON.stringify(saved));
      const entries = readIndex();
      if (!entries.some((entry) => entry.id === id)) {
        writeIndex([summarize({ ...saved, project: { ...saved.project, id } }), ...entries]);
      }
    }
    localStorage.removeItem(LEGACY_WORKSPACE_KEY);
  } catch {
    // a corrupt legacy blob must not block the library from opening
    localStorage.removeItem(LEGACY_WORKSPACE_KEY);
  }
}

function summarize(saved: SavedAlbum, createdAt?: string): AlbumSummary {
  const placed = new Set(saved.project.spreads.flatMap((spread) => spread.photoIds));
  return {
    id: saved.project.id,
    name: saved.project.name,
    productProfileId: saved.project.productProfileId,
    spreadCount: saved.project.spreads.length,
    photoCount: saved.photos.length,
    placedCount: placed.size,
    updatedAt: saved.savedAt,
    createdAt: createdAt ?? saved.savedAt,
  };
}

export function listAlbums(): AlbumSummary[] {
  migrateLegacyWorkspace();
  return readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function saveAlbum(project: AlbumProject, photos: AlbumPhoto[]): void {
  const saved: SavedAlbum = {
    project,
    photos: photos.map((photo) => ({
      ...photo,
      url: photo.storageKey ? undefined : photo.url,
    })),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(albumKey(project.id), JSON.stringify(saved));

  const entries = readIndex();
  const existing = entries.find((entry) => entry.id === project.id);
  const summary = summarize(saved, existing?.createdAt);
  writeIndex([summary, ...entries.filter((entry) => entry.id !== project.id)]);
}

export async function loadAlbum(id: string): Promise<{
  project: AlbumProject;
  photos: AlbumPhoto[];
} | null> {
  migrateLegacyWorkspace();
  const saved = readAlbum(id);
  if (!saved) return null;
  const photos = await Promise.all(saved.photos.map(async (photo) => {
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
  return { project: saved.project, photos };
}

/** Delete an album, and with it any photo blob no other album still refers to. */
export async function deleteAlbum(id: string): Promise<void> {
  const doomed = readAlbum(id);
  localStorage.removeItem(albumKey(id));
  writeIndex(readIndex().filter((entry) => entry.id !== id));
  if (!doomed) return;

  const stillReferenced = new Set(
    readIndex()
      .map((entry) => readAlbum(entry.id))
      .filter((album): album is SavedAlbum => !!album)
      .flatMap(storageKeysOf),
  );
  const orphans = storageKeysOf(doomed).filter((key) => !stillReferenced.has(key));
  await deletePhotoBlobs(orphans);
}

export function duplicateAlbum(id: string, name: string): string | null {
  const saved = readAlbum(id);
  if (!saved) return null;
  const newId = `album-${Date.now()}`;
  /* The copy points at the SAME photo blobs on purpose — duplicating an album
   * to try a different edit should not double the disk it costs. deleteAlbum
   * only reclaims a blob once no album references it. */
  const copy: SavedAlbum = {
    ...saved,
    project: { ...saved.project, id: newId, name },
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(albumKey(newId), JSON.stringify(copy));
  writeIndex([summarize(copy), ...readIndex()]);
  return newId;
}

export function renameAlbum(id: string, name: string): void {
  const saved = readAlbum(id);
  if (!saved) return;
  const next: SavedAlbum = { ...saved, project: { ...saved.project, name } };
  localStorage.setItem(albumKey(id), JSON.stringify(next));
  writeIndex(readIndex().map((entry) => (entry.id === id ? { ...entry, name } : entry)));
}
