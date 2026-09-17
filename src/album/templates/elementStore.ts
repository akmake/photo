import type { ElementDef } from './elements';

/* The photographer's own elements: transparent PNG, SVG or WebP files kept on
 * this computer (IndexedDB, beside the album photos) and offered on every album.
 * Loaded once into object URLs so every screen can draw them. */

const DB_NAME = 'teza-album-local';
const DB_VERSION = 1;
const STORE = 'photo-blobs';
const INDEX_KEY = 'teza-album-elements-v1';
const blobKey = (id: string) => `element:${id}`;

const urls = new Map<string, string>();

/** URL of an imported element, once the library has loaded. */
export function elementUrl(assetId: string): string | undefined {
  return urls.get(assetId);
}

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

function readIndex(): ElementDef[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed as ElementDef[] : [];
  } catch {
    return [];
  }
}

/** Load every imported element. `missing` lists entries whose file could not
 *  be read — reported, never silently dropped. */
export async function loadMyElements(): Promise<{ elements: ElementDef[]; missing: string[] }> {
  const elements = readIndex();
  const missing: string[] = [];
  await Promise.all(elements.map(async (element) => {
    if (!element.assetId || urls.has(element.assetId)) return;
    try {
      const blob = await withStore<Blob | undefined>('readonly', (store) => store.get(blobKey(element.assetId!)));
      if (blob instanceof Blob) urls.set(element.assetId, URL.createObjectURL(blob));
      else missing.push(element.name);
    } catch {
      missing.push(element.name);
    }
  }));
  return { elements, missing };
}

const ACCEPTED = ['image/png', 'image/svg+xml', 'image/webp'];

/** Whether the picture has any transparent pixel — a PNG without one would hide
 *  the photo under it with a solid background. */
async function hasTransparency(blob: Blob): Promise<{ transparent: boolean; aspect: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const aspect = bitmap.width / Math.max(1, bitmap.height);
  if (!context) { bitmap.close(); return { transparent: true, aspect }; }
  context.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  const data = context.getImageData(0, 0, size, size).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return { transparent: true, aspect };
  return { transparent: false, aspect };
}

export interface ImportResult {
  added: ElementDef[];
  /** Files refused, with the reason — shown to the photographer. */
  refused: { name: string; reason: string }[];
  /** Imported, but with no transparency: they will cover what is under them. */
  opaque: string[];
}

export async function importElements(files: FileList | File[]): Promise<ImportResult> {
  const result: ImportResult = { added: [], refused: [], opaque: [] };
  const index = readIndex();
  for (const file of Array.from(files)) {
    if (!ACCEPTED.includes(file.type)) {
      result.refused.push({
        name: file.name,
        reason: file.type === 'image/jpeg' ? 'JPG לא יכול להיות שקוף — שמור כ-PNG שקוף' : 'רק PNG, SVG או WebP',
      });
      continue;
    }
    try {
      const { transparent, aspect } = file.type === 'image/svg+xml'
        ? await svgAspect(file)
        : await hasTransparency(file);
      const assetId = `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await withStore('readwrite', (store) => store.put(file, blobKey(assetId)));
      urls.set(assetId, URL.createObjectURL(file));
      const element: ElementDef = {
        id: `mine-${assetId}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        group: 'mine',
        kind: 'image',
        assetId,
        aspect,
      };
      index.push(element);
      result.added.push(element);
      if (!transparent) result.opaque.push(file.name);
    } catch {
      result.refused.push({ name: file.name, reason: 'לא ניתן לקרוא את הקובץ' });
    }
  }
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  return result;
}

async function svgAspect(file: File): Promise<{ transparent: boolean; aspect: number }> {
  const text = await file.text();
  const viewBox = text.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const width = Number(viewBox?.[1] ?? text.match(/\bwidth\s*=\s*["']([\d.]+)/i)?.[1] ?? 1);
  const height = Number(viewBox?.[2] ?? text.match(/\bheight\s*=\s*["']([\d.]+)/i)?.[1] ?? 1);
  return { transparent: true, aspect: width / Math.max(1e-6, height) };
}

export async function removeMyElement(element: ElementDef): Promise<void> {
  localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((item) => item.id !== element.id)));
  if (element.assetId) {
    await withStore('readwrite', (store) => store.delete(blobKey(element.assetId!)));
  }
}
