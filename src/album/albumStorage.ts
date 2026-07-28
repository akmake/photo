import type { AlbumPhoto, AlbumProject } from './model';

const DB_NAME = 'teza-album-local';
const DB_VERSION = 1;
const PHOTO_STORE = 'photo-blobs';
const WORKSPACE_KEY = 'teza-album-workspace-v1';

interface SavedPhoto extends Omit<AlbumPhoto, 'url'> {
  url?: string;
  storageKey?: string;
}

interface SavedWorkspace {
  project: AlbumProject;
  photos: SavedPhoto[];
  savedAt: string;
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

export function saveWorkspace(project: AlbumProject, photos: AlbumPhoto[]): void {
  const payload: SavedWorkspace = {
    project,
    photos: photos.map((photo) => ({
      ...photo,
      url: photo.storageKey ? undefined : photo.url,
    })),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(payload));
}

export async function loadWorkspace(): Promise<{
  project: AlbumProject;
  photos: AlbumPhoto[];
} | null> {
  const raw = localStorage.getItem(WORKSPACE_KEY);
  if (!raw) return null;
  const saved = JSON.parse(raw) as SavedWorkspace;
  if (!saved?.project || !Array.isArray(saved.photos)) return null;
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
