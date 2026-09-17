import type { FontEntry } from './fonts';

/* The photographer's own fonts — the ones used every day — loaded from TTF,
 * OTF, WOFF or WOFF2 files, kept on this computer (IndexedDB) and registered
 * with the browser on every start, so they appear in the font list of every
 * album. A file that cannot be read or registered is reported by name. */

const DB_NAME = 'teza-album-local';
const DB_VERSION = 1;
const STORE = 'photo-blobs';
const INDEX_KEY = 'teza-album-fonts-v1';
const blobKey = (id: string) => `font:${id}`;

interface SavedFont { id: string; family: string; fileName: string }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function readIndex(): SavedFont[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed as SavedFont[] : [];
  } catch {
    return [];
  }
}

const registered = new Set<string>();

async function register(family: string, data: ArrayBuffer): Promise<void> {
  if (registered.has(family)) return;
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
  registered.add(family);
}

const toEntry = (font: SavedFont): FontEntry => ({ family: font.family, label: font.family, group: 'mine', bold: false });

export async function loadUserFonts(): Promise<{ fonts: FontEntry[]; failed: string[] }> {
  const saved = readIndex();
  const failed: string[] = [];
  const fonts: FontEntry[] = [];
  for (const font of saved) {
    try {
      const blob = await withStore<Blob | undefined>('readonly', (store) => store.get(blobKey(font.id)));
      if (!(blob instanceof Blob)) throw new Error('missing');
      await register(font.family, await blob.arrayBuffer());
      fonts.push(toEntry(font));
    } catch {
      failed.push(font.fileName);
    }
  }
  return { fonts, failed };
}

const ACCEPTED = /\.(ttf|otf|woff2?)$/i;

export async function importUserFonts(files: FileList): Promise<{ added: FontEntry[]; refused: { name: string; reason: string }[] }> {
  const index = readIndex();
  const added: FontEntry[] = [];
  const refused: { name: string; reason: string }[] = [];
  for (const file of Array.from(files)) {
    if (!ACCEPTED.test(file.name)) {
      refused.push({ name: file.name, reason: 'רק קובצי גופן TTF, OTF, WOFF או WOFF2' });
      continue;
    }
    // the file name is the name the photographer knows the font by
    const family = file.name.replace(ACCEPTED, '').replace(/[-_]+/g, ' ').trim();
    if (index.some((font) => font.family === family)) {
      refused.push({ name: file.name, reason: 'גופן בשם הזה כבר קיים' });
      continue;
    }
    try {
      await register(family, await file.arrayBuffer());
      const id = `font-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await withStore('readwrite', (store) => store.put(file, blobKey(id)));
      const saved = { id, family, fileName: file.name };
      index.push(saved);
      added.push(toEntry(saved));
    } catch {
      refused.push({ name: file.name, reason: 'הקובץ לא נקרא כגופן תקין' });
    }
  }
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  return { added, refused };
}
