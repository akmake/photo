import type {
  AlbumPhoto, AlbumProject, AlbumSpread, LayoutSlot, PrintProductProfile,
} from './model';
import { photoAdjustmentFilter } from './model';
import { assessCrop } from './cropEngine';
import type { GeneratedAlbumLayout } from './layoutEngine';
import { albumSourceUrl, finalizeAlbumSheet } from '../api';
import { spreadTemplate } from './templates/library';
import { elementUrl } from './templates/elementStore';
import { drawTemplateSpread, missingPhotos } from './templates/raster';
import { jpegPagesToPdf, type PdfPage } from './pdf';
import { coverSheetOf, coverTemplateOf } from './coverSheet';
import { ZIP_LIMIT_BYTES, ZipStream } from './zipWriter';

/* Getting the album out of the screen — to the couple as a proof, to the lab
 * as files it can print.
 *
 * Both roads are the same renderer, on purpose: what the photographer approved
 * on screen, what the client signs off on, and what the press receives are one
 * drawing at three resolutions. A second renderer for print would drift, and
 * the drift would only be visible once the album arrived.
 *
 * Two things separate the print road from the proof road, and neither is
 * cosmetic:
 *
 *   THE PIXELS. The pool a screen draws from is 1200px wide — a proxy, because
 *   the browser cannot read D:\Shoots and a layout must stay responsive. A
 *   56cm spread at 300dpi is 6614px. Drawing THAT from the proxy is an
 *   enlargement of five and a half times: right on the monitor, ruined on
 *   paper, and invisible until the album is delivered. So an export never
 *   touches `photo.url`. It asks the engine for the real file, at the size the
 *   place on the page actually takes.
 *
 *   THE BLEED. The lab prints on a larger sheet and cuts. A photograph ending
 *   exactly on the trim line shows a white sliver wherever the blade drifts,
 *   so the sheet carries `bleedMm` of extra paper on the four outer sides and
 *   everything that meets an edge is carried out into it. The fold in the
 *   middle of a spread is not an outer edge and is never extended.
 */

interface SpreadExportItem {
  spread: AlbumSpread;
  layout: GeneratedAlbumLayout;
}

interface WritableFileHandle {
  createWritable(): Promise<{
    write(data: Blob | string | BufferSource): Promise<void>;
    close(): Promise<void>;
  }>;
}

interface WritableDirectoryHandle {
  getFileHandle(name: string, options: { create: boolean }): Promise<WritableFileHandle>;
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<WritableDirectoryHandle>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { mode?: 'readwrite' }) => Promise<WritableDirectoryHandle>;
}

export interface ProofExportResult {
  files: number;
  destination: 'folder' | 'downloads';
  pixelSize: { width: number; height: number };
  /** The upload archive's name, when one was written. */
  archive?: string;
}

/** A proof is looked at on a screen and, at most, printed on A4 to be marked
 *  up. 150 leaves a face readable at that size without making a file too heavy
 *  to send. The press file's resolution is the printer's to state, and comes
 *  from the profile. */
const PROOF_PPI = 150;
const PROOF_QUALITY = 0.88;

interface SheetOptions {
  ppi: number;
  /** Extra paper on the four outer sides. Zero for a proof: a proof shows the
   *  album as it will be cut, not as it is printed. */
  bleedMm: number;
  watermark: boolean;
  /** The lab's paper — set only on the press road, where every photo arrives
   *  from the engine sharpened for it at the size it is printed. */
  paper?: string;
  /** A working picture for the screen (the paper preview): no proof stamp,
   *  and an empty place is drawn empty rather than refused. */
  draft?: boolean;
}

interface Sheet {
  canvas: HTMLCanvasElement;
  /** The finished sheet, bleed excluded — what the page of a PDF must be. */
  trimWidthMm: number;
  trimHeightMm: number;
}

const mmToPx = (mm: number, ppi: number) => Math.max(1, Math.round(mm / 25.4 * ppi));

function loadBitmap(url: string): Promise<ImageBitmap> {
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`לא ניתן לקרוא תמונה (${response.status})`);
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob));
}

/** How large a source this place can actually use.
 *
 *  `need` is the place in sheet pixels, zoom included. The file is scaled to
 *  cover it, so what matters is the scale that covering takes: at or above 1:1
 *  the whole file is wanted, below it the engine resizes once with Lanczos —
 *  better than the browser doing it while it draws, and far less memory.
 *
 *  With the photo's real dimensions not yet measured, ask generously: the
 *  engine never upscales, so the worst case is a file that comes back at its
 *  own size. */
function sourceLongEdge(photo: AlbumPhoto, need: { width: number; height: number }): number {
  const width = photo.widthPx;
  const height = photo.heightPx;
  if (width > 0 && height > 0) {
    const cover = Math.max(need.width / width, need.height / height);
    return Math.ceil(Math.max(width, height) * Math.min(1, cover) * 1.04);
  }
  return Math.ceil(Math.max(need.width, need.height) * 2);
}

/** The pixels of one photograph for an export: the file itself.
 *
 *  A photo imported into a standalone album has no path — its blob IS the
 *  original and is already whole in the browser. */
function exportBitmap(
  photo: AlbumPhoto,
  need: { width: number; height: number },
  options?: SheetOptions,
): Promise<ImageBitmap> {
  return loadBitmap(
    photo.exportPath
      ? albumSourceUrl(photo.exportPath, sourceLongEdge(photo, need), options?.paper, options?.ppi)
      : photo.url,
  );
}

/** A place that meets an outer edge, carried out into the bleed. */
function spilledSlot(slot: LayoutSlot, spillX: number, spillY: number): LayoutSlot {
  if (!spillX && !spillY) return slot;
  const left = slot.x <= 0.004 ? spillX : 0;
  const right = slot.x + slot.width >= 0.996 ? spillX : 0;
  const top = slot.y <= 0.004 ? spillY : 0;
  const bottom = slot.y + slot.height >= 0.996 ? spillY : 0;
  if (!left && !right && !top && !bottom) return slot;
  return {
    ...slot,
    x: slot.x - left,
    y: slot.y - top,
    width: slot.width + left + right,
    height: slot.height + top + bottom,
  };
}

async function drawPhoto(
  context: CanvasRenderingContext2D,
  slot: LayoutSlot,
  photo: AlbumPhoto,
  spread: AlbumSpread,
  profile: PrintProductProfile,
  canvasWidth: number,
  canvasHeight: number,
  options?: SheetOptions,
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
  const zoom = Math.max(1, (settings?.zoom ?? 100) / 100);
  const bitmap = await exportBitmap(photo, {
    width: frame.width * zoom,
    height: frame.height * zoom,
  }, options);

  context.save();
  context.beginPath();
  context.rect(frame.x, frame.y, frame.width, frame.height);
  context.clip();
  context.filter = photoAdjustmentFilter(settings);
  if (settings?.rotation) {
    context.translate(frame.x + frame.width / 2, frame.y + frame.height / 2);
    context.rotate((settings.rotation * Math.PI) / 180);
    context.translate(-(frame.x + frame.width / 2), -(frame.y + frame.height / 2));
  }

  try {
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
  } finally {
    bitmap.close();
    context.restore();
  }
}

/** A proof must never be confused with a press-ready file. */
function stampProof(context: CanvasRenderingContext2D, width: number, height: number): void {
  const stripHeight = Math.max(24, Math.round(height * 0.018));
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.fillStyle = 'rgba(25, 25, 25, 0.74)';
  context.fillRect(0, 0, width, stripHeight);
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.direction = 'rtl';
  context.font = `${Math.max(12, Math.round(stripHeight * 0.45))}px Arial`;
  context.fillText('FrameOps PROOF • הגהה בלבד • לא לדפוס', width / 2, stripHeight / 2);
  context.restore();
}

function newSheet(
  trimWidthMm: number,
  trimHeightMm: number,
  options: SheetOptions,
): { sheet: Sheet; context: CanvasRenderingContext2D; bleedPx: number } {
  const bleedPx = options.bleedMm > 0 ? mmToPx(options.bleedMm, options.ppi) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = mmToPx(trimWidthMm, options.ppi) + bleedPx * 2;
  canvas.height = mmToPx(trimHeightMm, options.ppi) + bleedPx * 2;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('הדפדפן אינו מאפשר רינדור של האלבום');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { sheet: { canvas, trimWidthMm, trimHeightMm }, context, bleedPx };
}

async function renderSpread(
  item: SpreadExportItem,
  photosById: Map<string, AlbumPhoto>,
  profile: PrintProductProfile,
  options: SheetOptions,
): Promise<Sheet> {
  const { sheet, context, bleedPx } = newSheet(
    profile.spreadWidthMm,
    profile.spreadHeightMm,
    options,
  );
  const trimWidth = sheet.canvas.width - bleedPx * 2;
  const trimHeight = sheet.canvas.height - bleedPx * 2;
  const pages = `${item.spread.pageStart}–${item.spread.pageStart + 1}`;

  /* A page from the Vault carries its own colours, lines and words, so it is
   * drawn by the template renderer — the same geometry, crop and paint order
   * the photographer approved on screen. */
  const template = spreadTemplate(item.spread, profile.spreadWidthMm / profile.spreadHeightMm);
  if (item.spread.templateInstance && !template) {
    throw new Error(`העמוד המעוצב של כפולה ${pages} לא נמצא בספריית הכספת`);
  }
  if (item.spread.templateInstance && template) {
    const photos = [...photosById.values()];
    const missing = missingPhotos({ template, spread: item.spread, photos });
    /* An empty place is a page still being worked on. A proof shows it exactly
     * as the screen does — refusing to make a proof is refusing the one thing
     * that would let anyone see the gap. The press file is another matter and
     * says no. */
    if (missing.length && !options.watermark && !options.draft) {
      throw new Error(`חסרות ${missing.length} תמונות בכפולה ${pages}`);
    }
    await drawTemplateSpread(context, trimWidth, trimHeight, {
      template,
      instance: item.spread.templateInstance,
      spread: item.spread,
      photos,
      bitmapOf: (photo, need) => exportBitmap(photo, need, options).catch(() => null),
      elementBitmapOf: async (assetId) => {
        const url = elementUrl(assetId);
        return url ? await loadBitmap(url).catch(() => null) : null;
      },
      bleedPx: { x: bleedPx, y: bleedPx },
    });
    if (options.watermark) stampProof(context, sheet.canvas.width, sheet.canvas.height);
    return sheet;
  }

  context.fillStyle = item.spread.background;
  context.fillRect(0, 0, sheet.canvas.width, sheet.canvas.height);
  context.save();
  context.translate(bleedPx, bleedPx);
  for (let index = 0; index < item.layout.slots.length; index += 1) {
    const photo = photosById.get(item.layout.photoIds[index]);
    if (!photo) {
      if (!options.watermark && !options.draft) throw new Error(`חסרה תמונה בכפולה ${pages}`);
      continue;
    }
    await drawPhoto(
      context,
      spilledSlot(item.layout.slots[index], bleedPx / trimWidth, bleedPx / trimHeight),
      photo,
      item.spread,
      profile,
      trimWidth,
      trimHeight,
      options,
    );
  }
  context.restore();

  if (options.watermark) stampProof(context, sheet.canvas.width, sheet.canvas.height);
  return sheet;
}

/** Back, spine and front on one sheet, in the order they are printed.
 *
 *  The cover is a designed sheet like any other page — the same template
 *  renderer, the same crops, the same elements and lettering. It has its own
 *  shape (the two boards plus the spine) and its own bleed, which the product
 *  states; everything else about drawing it is the album's normal machinery.
 *
 *  The two boards meet the outer edges, so they are carried into the bleed;
 *  the spine is interior and never is. */
async function renderCover(
  project: AlbumProject,
  photosById: Map<string, AlbumPhoto>,
  profile: PrintProductProfile,
  options: SheetOptions,
): Promise<Sheet> {
  const spec = profile.coverSpec;
  const cover = coverSheetOf(project, profile);
  const template = coverTemplateOf(cover, profile, project.openingDirection ?? 'rtl');
  if (!template || !cover.templateInstance) throw new Error('עיצוב הכריכה חסר');

  const { sheet, context, bleedPx } = newSheet(
    spec.totalWidthMm,
    spec.totalHeightMm,
    { ...options, bleedMm: options.bleedMm > 0 ? spec.bleedMm : 0 },
  );
  await drawTemplateSpread(
    context,
    sheet.canvas.width - bleedPx * 2,
    sheet.canvas.height - bleedPx * 2,
    {
      template,
      instance: cover.templateInstance,
      spread: cover,
      photos: [...photosById.values()],
      bitmapOf: (photo, need) => exportBitmap(photo, need, options).catch(() => null),
      elementBitmapOf: async (assetId) => {
        const url = elementUrl(assetId);
        return url ? await loadBitmap(url).catch(() => null) : null;
      },
      bleedPx: { x: bleedPx, y: bleedPx },
    },
  );

  if (options.watermark) stampProof(context, sheet.canvas.width, sheet.canvas.height);
  return sheet;
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('יצירת הקובץ נכשלה')),
      type,
      quality,
    );
  });
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function safeFileName(value: string, extension = '.jpg'): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
  const withExtension = cleaned.toLowerCase().endsWith(extension)
    ? cleaned
    : `${cleaned}${extension}`;
  return withExtension || `album${extension}`;
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

/** The proof: ONE PDF, the album in order, cover first, every page at the
 *  album's true size and every sheet marked as a proof. One file is what a
 *  couple can open on a phone and what comes back with remarks on it; forty
 *  loose JPEGs are not. */
export async function exportAlbumProof(
  project: AlbumProject,
  items: SpreadExportItem[],
  photos: AlbumPhoto[],
  profile: PrintProductProfile,
  onProgress?: (current: number, total: number) => void,
): Promise<ProofExportResult> {
  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const options: SheetOptions = { ppi: PROOF_PPI, bleedMm: 0, watermark: true };
  const pages: PdfPage[] = [];
  const total = items.length + 1;

  const addSheet = async (sheet: Sheet) => {
    pages.push({
      jpeg: await encode(sheet.canvas, 'image/jpeg', PROOF_QUALITY),
      widthPx: sheet.canvas.width,
      heightPx: sheet.canvas.height,
      widthMm: sheet.trimWidthMm,
      heightMm: sheet.trimHeightMm,
    });
    // The canvas is 8MB and up; let it go before the next one is built.
    sheet.canvas.width = 0;
    sheet.canvas.height = 0;
  };

  /* The cover opens the proof, because it is the first thing anyone opening
   * the album sees. */
  onProgress?.(1, total);
  await addSheet(await renderCover(project, photosById, profile, options));
  for (let index = 0; index < items.length; index += 1) {
    onProgress?.(index + 2, total);
    await addSheet(await renderSpread(items[index], photosById, profile, options));
  }

  const pdf = await jpegPagesToPdf(pages, {
    title: `${project.name} — הגהה`,
    subject: 'הגהה בלבד · לא לדפוס',
  });
  const name = safeFileName(`${project.name} — הגהה`, '.pdf');

  const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (directoryPicker) {
    const directory = await directoryPicker.call(window, { mode: 'readwrite' });
    await writeFile(directory, name, pdf);
    return {
      files: 1,
      destination: 'folder',
      pixelSize: { width: pages[0]?.widthPx ?? 0, height: pages[0]?.heightPx ?? 0 },
    };
  }
  downloadBlob(name, pdf);
  return {
    files: 1,
    destination: 'downloads',
    pixelSize: { width: pages[0]?.widthPx ?? 0, height: pages[0]?.heightPx ?? 0 },
  };
}

/** One spread as a picture about `widthPx` wide, drawn by the same renderer
 *  as the press file — for the paper preview, which must show exactly what
 *  will be printed, only smaller. */
export async function renderSpreadImage(
  item: SpreadExportItem,
  photos: AlbumPhoto[],
  profile: PrintProductProfile,
  widthPx = 1800,
): Promise<string> {
  const ppi = widthPx / (profile.spreadWidthMm / 25.4);
  const sheet = await renderSpread(
    item,
    new Map(photos.map((photo) => [photo.id, photo])),
    profile,
    { ppi, bleedMm: 0, watermark: false, draft: true },
  );
  const url = sheet.canvas.toDataURL('image/png');
  sheet.canvas.width = 0;
  sheet.canvas.height = 0;
  return url;
}

/** The press package: one file per spread at the printer's resolution, with
 *  bleed, plus the cover and a manifest the lab can check the delivery
 *  against. Each sheet is compressed exactly once — it leaves the browser
 *  lossless and the engine encodes it. */
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
  const options: SheetOptions = {
    ppi: profile.targetPpi,
    bleedMm: profile.bleedMm,
    watermark: false,
    paper: profile.paper ?? 'luster',
  };
  const written: Array<{
    name: string;
    width: number;
    height: number;
    sha256: string;
  }> = [];
  /* A leather or linen cover is chosen by model number: there is no file to
   * send, and sending one would only confuse the order. */
  const printsCover = profile.coverMode !== 'material';
  const total = items.length + (printsCover ? 1 : 0);
  const firstIndex = Math.max(0, profile.firstIndex ?? 1);

  /* ONE ARCHIVE for the upload form, beside the loose files: some labs take
   * only an archive, the rest take one file more easily than forty. */
  const albumName = safeFileName(`${project.name} — לדפוס`, '.zip');
  const zip = new ZipStream(
    await (await directory.getFileHandle(albumName, { create: true })).createWritable(),
  );
  let zipSkipped = false;

  /* THE OVERVIEW: every sheet small, in order, named — so the photographer
   * and the lab see the sequence at a glance. It goes in its own folder, never
   * in the archive: a lab that prints every JPEG it is sent must not print it. */
  const overview = newOverview(items.length + (printsCover ? 1 : 0), profile);

  const finalize = async (sheet: Sheet, name: string, cell: number) => {
    drawOverviewCell(overview, sheet.canvas, cell, name);
    const lossless = await encode(sheet.canvas, 'image/png');
    sheet.canvas.width = 0;
    sheet.canvas.height = 0;
    const finished = await finalizeAlbumSheet(lossless, options.ppi);
    await writeFile(directory, name, finished.blob);
    if (!zipSkipped && zip.size + finished.blob.size < ZIP_LIMIT_BYTES) {
      await zip.add(name, finished.blob);
    } else {
      zipSkipped = true;
    }
    written.push({
      name,
      width: finished.widthPx,
      height: finished.heightPx,
      sha256: await sha256(finished.blob),
    });
  };

  for (let index = 0; index < items.length; index += 1) {
    onProgress?.(index + 1, total);
    const sequence = String(index + firstIndex).padStart(3, '0');
    await finalize(
      await renderSpread(items[index], photosById, profile, options),
      safeFileName(profile.namingPattern
        .replace('{index}', sequence)
        .replace('{pageStart}', String(items[index].spread.pageStart))),
      index + (printsCover ? 1 : 0),
    );
  }

  if (printsCover) {
    onProgress?.(total, total);
    await finalize(
      await renderCover(project, photosById, profile, options),
      safeFileName(profile.coverFileName ?? 'cover.jpg'),
      0,
    );
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
      bleedMm: profile.bleedMm,
      ppi: profile.targetPpi,
      format: profile.outputFormat,
      colorProfile: profile.colorProfile,
      verified: profile.verified,
      labSpecId: profile.labSpecId ?? null,
      trimInsideMm: profile.trimInsideMm ?? 0,
      safeMarginMm: profile.safeMarginMm,
    },
    cover: {
      mode: profile.coverMode ?? 'wrap',
      totalWidthMm: profile.coverSpec.totalWidthMm,
      totalHeightMm: profile.coverSpec.totalHeightMm,
      spineWidthMm: profile.coverSpec.spineWidthMm,
      bleedMm: profile.coverSpec.bleedMm,
    },
    files: written,
    archive: zipSkipped ? null : albumName,
  }, null, 2);
  await writeFile(directory, 'print-manifest.json', manifest);
  if (!zipSkipped) {
    await zip.add('print-manifest.json', new Blob([manifest], { type: 'application/json' }));
  }
  await zip.close();

  const checkFolder = await directory.getDirectoryHandle('_לבדיקה-לא-להדפסה', { create: true });
  await writeFile(checkFolder, 'סקירת-האלבום.jpg', await encode(overview.canvas, 'image/jpeg', 0.86));

  return {
    files: written.length + 1,
    destination: 'folder',
    pixelSize: { width: written[0]?.width ?? 0, height: written[0]?.height ?? 0 },
    archive: zipSkipped ? undefined : albumName,
  };
}

interface Overview {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  cellWidth: number;
  cellHeight: number;
  columns: number;
}

const OVERVIEW_CELL = 520;
const OVERVIEW_LABEL = 30;
const OVERVIEW_GAP = 16;

function newOverview(count: number, profile: PrintProductProfile): Overview {
  const columns = 4;
  const rows = Math.max(1, Math.ceil(count / columns));
  const cellWidth = OVERVIEW_CELL;
  const cellHeight = Math.round(OVERVIEW_CELL * (profile.spreadHeightMm / profile.spreadWidthMm));
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth + (columns + 1) * OVERVIEW_GAP;
  canvas.height = rows * (cellHeight + OVERVIEW_LABEL) + (rows + 1) * OVERVIEW_GAP;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#f2f1ee';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context, cellWidth, cellHeight, columns };
}

/** One sheet into its place on the overview, right to left like the book. */
function drawOverviewCell(overview: Overview, sheet: HTMLCanvasElement, cell: number, name: string) {
  const { context, cellWidth, cellHeight, columns, canvas } = overview;
  const row = Math.floor(cell / columns);
  const column = cell % columns;
  const x = canvas.width - OVERVIEW_GAP - (column + 1) * cellWidth - column * OVERVIEW_GAP;
  const y = OVERVIEW_GAP + row * (cellHeight + OVERVIEW_LABEL + OVERVIEW_GAP);
  const scale = Math.min(cellWidth / sheet.width, cellHeight / sheet.height);
  const width = sheet.width * scale;
  const height = sheet.height * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(sheet, x + (cellWidth - width) / 2, y + (cellHeight - height) / 2, width, height);
  context.fillStyle = '#3b3833';
  context.font = '18px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.fillText(name, x + cellWidth / 2, y + cellHeight + 6);
}
