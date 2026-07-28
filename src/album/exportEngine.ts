import type {
  AlbumPhoto, AlbumProject, AlbumSpread, LayoutSlot, PrintProductProfile,
} from './model';
import { assessCrop } from './cropEngine';
import type { GeneratedAlbumLayout } from './layoutEngine';
import { finalizeAlbumJpeg } from '../api';

interface SpreadExportItem {
  spread: AlbumSpread;
  layout: GeneratedAlbumLayout;
}

interface WritableFileHandle {
  createWritable(): Promise<{
    write(data: Blob | string): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface WritableDirectoryHandle {
  getFileHandle(name: string, options: { create: boolean }): Promise<WritableFileHandle>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<WritableDirectoryHandle>;
}

export interface ProofExportResult {
  files: number;
  destination: 'folder' | 'downloads';
  pixelSize: { width: number; height: number };
}

const PROOF_PPI = 120;

function loadBitmap(url: string): Promise<ImageBitmap> {
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`לא ניתן לקרוא תמונה (${response.status})`);
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob));
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('יצירת קובץ ההגהה נכשלה')),
      'image/jpeg',
      0.94,
    );
  });
}

function drawPhoto(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  slot: LayoutSlot,
  photo: AlbumPhoto,
  spread: AlbumSpread,
  profile: PrintProductProfile,
  canvasWidth: number,
  canvasHeight: number,
) {
  const frame = {
    x: Math.round(slot.x * canvasWidth),
    y: Math.round(slot.y * canvasHeight),
    width: Math.max(1, Math.round(slot.width * canvasWidth)),
    height: Math.max(1, Math.round(slot.height * canvasHeight)),
  };
  const settings = spread.frameSettings?.[slot.id];
  const crop = assessCrop(
    photo,
    slot,
    settings,
    profile.spreadWidthMm / profile.spreadHeightMm,
  );

  context.save();
  context.beginPath();
  context.rect(frame.x, frame.y, frame.width, frame.height);
  context.clip();

  if (crop.fit === 'contain') {
    const scale = Math.min(frame.width / bitmap.width, frame.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(
      bitmap,
      frame.x + (frame.width - width) / 2,
      frame.y + (frame.height - height) / 2,
      width,
      height,
    );
  } else {
    context.drawImage(
      bitmap,
      crop.crop.x * bitmap.width,
      crop.crop.y * bitmap.height,
      crop.crop.width * bitmap.width,
      crop.crop.height * bitmap.height,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    );
  }
  context.restore();
}

async function renderSpread(
  item: SpreadExportItem,
  photosById: Map<string, AlbumPhoto>,
  profile: PrintProductProfile,
  ppi = PROOF_PPI,
  watermark = true,
): Promise<{ blob: Blob; width: number; height: number }> {
  const width = Math.round(profile.spreadWidthMm / 25.4 * ppi);
  const height = Math.round(profile.spreadHeightMm / 25.4 * ppi);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('הדפדפן אינו מאפשר רינדור הגהה');

  context.fillStyle = item.spread.background;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < item.layout.slots.length; index += 1) {
    const photo = photosById.get(item.layout.photoIds[index]);
    if (!photo) throw new Error(`חסרה תמונה בכפולה ${item.spread.pageStart}`);
    const bitmap = await loadBitmap(photo.url);
    try {
      drawPhoto(
        context,
        bitmap,
        item.layout.slots[index],
        photo,
        item.spread,
        profile,
        width,
        height,
      );
    } finally {
      bitmap.close();
    }
  }

  if (watermark) {
    // A proof must never be confused with a press-ready file.
    const stripHeight = Math.max(24, Math.round(height * 0.018));
    context.fillStyle = 'rgba(25, 25, 25, 0.74)';
    context.fillRect(0, 0, width, stripHeight);
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `${Math.max(12, Math.round(stripHeight * 0.45))}px Arial`;
    context.fillText('TEZA PROOF • הגהה בלבד • לא לדפוס', width / 2, stripHeight / 2);
  }

  return { blob: await canvasBlob(canvas), width, height };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('קריאת הרינדור נכשלה'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
  const withExtension = cleaned.toLowerCase().endsWith('.jpg')
    || cleaned.toLowerCase().endsWith('.jpeg')
    ? cleaned
    : `${cleaned}.jpg`;
  return withExtension || 'spread.jpg';
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function writeFile(directory: WritableDirectoryHandle, name: string, data: Blob | string) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function exportAlbumProof(
  project: AlbumProject,
  items: SpreadExportItem[],
  photos: AlbumPhoto[],
  profile: PrintProductProfile,
  onProgress?: (current: number, total: number) => void,
): Promise<ProofExportResult> {
  const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
  let directory: WritableDirectoryHandle | null = null;
  if (directoryPicker) {
    directory = await directoryPicker.call(window, { mode: 'readwrite' });
  }

  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const written: Array<{ name: string; width: number; height: number }> = [];
  for (let index = 0; index < items.length; index += 1) {
    onProgress?.(index + 1, items.length);
    const rendered = await renderSpread(items[index], photosById, profile);
    const name = `${String(index + 1).padStart(3, '0')}-spread-proof.jpg`;
    if (directory) await writeFile(directory, name, rendered.blob);
    else downloadBlob(name, rendered.blob);
    written.push({ name, width: rendered.width, height: rendered.height });
  }

  const manifest = JSON.stringify({
    kind: 'TEZA_ALBUM_PROOF',
    printReady: false,
    warning: 'PROOF_ONLY_NOT_FOR_PRINT',
    projectId: project.id,
    projectName: project.name,
    generatedAt: new Date().toISOString(),
    proofPpi: PROOF_PPI,
    profile: {
      id: profile.id,
      name: profile.name,
      widthMm: profile.spreadWidthMm,
      heightMm: profile.spreadHeightMm,
      verified: false,
      colorProfile: profile.colorProfile,
    },
    files: written,
  }, null, 2);
  if (directory) await writeFile(directory, 'proof-manifest.json', manifest);
  else downloadBlob('proof-manifest.json', new Blob([manifest], { type: 'application/json' }));

  return {
    files: written.length + 1,
    destination: directory ? 'folder' : 'downloads',
    pixelSize: { width: written[0]?.width ?? 0, height: written[0]?.height ?? 0 },
  };
}

export async function exportAlbumForPrint(
  project: AlbumProject,
  items: SpreadExportItem[],
  photos: AlbumPhoto[],
  profile: PrintProductProfile,
  onProgress?: (current: number, total: number) => void,
): Promise<ProofExportResult> {
  if (!profile.verified) throw new Error('פרופיל בית הדפוס עדיין לא סומן כמאומת');
  if (profile.outputFormat !== 'jpeg') throw new Error('בשלב זה יצוא דפוס תומך ב-JPEG בלבד');
  if (profile.exportMode !== 'spreads') throw new Error('בשלב זה יצוא דפוס תומך בכפולות בלבד');
  if (profile.colorProfile.trim().toLowerCase() !== 'srgb') {
    throw new Error('יצוא דפוס זמין כרגע רק לפרופיל sRGB מאומת');
  }
  if (!profile.namingPattern.includes('{index}')) {
    throw new Error('תבנית השמות חייבת לכלול מספר כפולה');
  }
  const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!directoryPicker) throw new Error('הדפדפן אינו תומך בשמירת חבילת דפוס לתיקייה');
  const directory = await directoryPicker.call(window, { mode: 'readwrite' });
  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const written: Array<{
    name: string;
    width: number;
    height: number;
    sha256: string;
  }> = [];

  for (let index = 0; index < items.length; index += 1) {
    onProgress?.(index + 1, items.length);
    const rendered = await renderSpread(
      items[index],
      photosById,
      profile,
      profile.targetPpi,
      false,
    );
    const finalized = await finalizeAlbumJpeg(
      await blobToDataUrl(rendered.blob),
      profile.targetPpi,
    );
    const blob = await dataUrlToBlob(finalized.image);
    const sequence = String(index + 1).padStart(3, '0');
    const name = safeFileName(profile.namingPattern
      .replace('{index}', sequence)
      .replace('{pageStart}', String(items[index].spread.pageStart)));
    await writeFile(directory, name, blob);
    written.push({
      name,
      width: finalized.meta.widthPx,
      height: finalized.meta.heightPx,
      sha256: await sha256(blob),
    });
  }

  const manifest = JSON.stringify({
    kind: 'TEZA_ALBUM_PRINT_EXPORT',
    printReady: true,
    projectId: project.id,
    projectName: project.name,
    generatedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      name: profile.name,
      labName: profile.labName,
      version: profile.profileVersion,
      widthMm: profile.spreadWidthMm,
      heightMm: profile.spreadHeightMm,
      ppi: profile.targetPpi,
      format: profile.outputFormat,
      colorProfile: profile.colorProfile,
      verified: profile.verified,
    },
    files: written,
  }, null, 2);
  await writeFile(directory, 'print-manifest.json', manifest);

  return {
    files: written.length + 1,
    destination: 'folder',
    pixelSize: { width: written[0]?.width ?? 0, height: written[0]?.height ?? 0 },
  };
}
