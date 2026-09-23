import { assessCrop } from '../cropEngine';
import type { AlbumPhoto, AlbumSpread, PhotoFrameSettings } from '../model';
import { colorOf, paintOrder, photoLayers, templateBackground, textOf, usesSourceLettering } from './library';
import type {
  AlbumTemplate, ImageLayer, LayerBox, PhotoLayer, ShapeLayer, SpreadTemplateInstance, TextLayer,
} from './types';

/* A designed page (הכספת) drawn onto a canvas, for export.
 *
 * Why this exists: the screen draws a template page as HTML elements with SVG
 * artwork inside them (TemplateLayers.tsx), and there is no way to photograph
 * that into a file. Until this module existed the export refused every page
 * from the Vault — which, since the automatic build puts every spread on one,
 * meant an automatically built album could not be handed to a client or to a
 * printer at all.
 *
 * The rule here is fidelity to the screen, not beauty of its own: same paint
 * order, same crop engine, same colours, same geometry. Anything drawn
 * differently here would mean the photographer approved one thing and the lab
 * printed another, which is the one failure a proof exists to prevent.
 *
 * Coordinates: photo and text places are fractions of the whole spread, so they
 * scale with the canvas. Artwork is in the designer's viewBox, whose height is
 * 1000 and whose width is 1000 × the page's aspect — the same box the screen's
 * SVG uses, stretched to the sheet exactly as `preserveAspectRatio="none"`
 * stretches it there, including its effect on line weight.
 */

const VIEW_HEIGHT = 1000;

const DEFAULT_SETTINGS: PhotoFrameSettings = {
  fit: 'smart',
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

export interface TemplateRasterInput {
  /** The page as the screen resolved it — `spreadTemplate(spread, aspect)`. */
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  /** The pixels of one photograph. `need` is how many pixels the place will
   *  actually take on this canvas, zoom included, so an export can ask the
   *  engine for that size and no more and a screen can ignore it.
   *  Returning null is a missing file, and the caller decides what that means. */
  bitmapOf(photo: AlbumPhoto, need: { width: number; height: number }): Promise<ImageBitmap | null>;
  /** Pixels of an element the photographer imported, by asset id. */
  elementBitmapOf?(assetId: string): Promise<ImageBitmap | null>;
  /** Leave the photo places empty and transparent. The print path uses this to
   *  take the decoration alone, because there the engine draws the originals. */
  withoutPhotos?: boolean;
  /** Fill the sheet with the page's designed background before drawing.
   *  Off for the decoration-only pass, which must stay transparent. */
  withBackground?: boolean;
  /** Extra paper around the finished spread, in pixels of THIS canvas, which
   *  the guillotine removes. `width`/`height` stay the finished size; the
   *  canvas is that plus this on each of the four outer sides.
   *
   *  A photograph printed exactly to the trim line shows a white sliver
   *  wherever the cut drifts, so anything touching an outer edge — a photo
   *  place, a designed band, the background — is carried out into the margin.
   *  The fold down the middle of a spread is not an outer edge and is never
   *  extended. */
  bleedPx?: { x: number; y: number };
}

/** Every photograph a page needs, in the order of its photo places. Missing
 *  ones are reported by id so the caller can refuse to export with a name
 *  rather than a blank rectangle. */
export function missingPhotos(input: Pick<TemplateRasterInput, 'template' | 'spread' | 'photos'>): string[] {
  const known = new Set(input.photos.map((photo) => photo.id));
  return photoLayers(input.template)
    .map((_, index) => input.spread.photoIds[index])
    .filter((id) => !id || !known.has(id)) as string[];
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number, y: number, width: number, height: number, radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  if (!r) {
    context.rect(x, y, width, height);
    return;
  }
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/** The element's own rotation, around the centre of its box. */
function rotateAround(
  context: CanvasRenderingContext2D,
  degrees: number | undefined,
  centreX: number, centreY: number,
): void {
  if (!degrees) return;
  context.translate(centreX, centreY);
  context.rotate((degrees * Math.PI) / 180);
  context.translate(-centreX, -centreY);
}

/** A layer's opacity and blend, as the wrapper element carries them. CSS blend
 *  names and canvas composite names are the same words. */
function applyLayerCompositing(
  context: CanvasRenderingContext2D,
  layer: { opacity?: number; blendMode?: string },
): void {
  if (layer.opacity !== undefined) context.globalAlpha = layer.opacity;
  if (layer.blendMode && layer.blendMode !== 'normal') {
    context.globalCompositeOperation = layer.blendMode as GlobalCompositeOperation;
  }
}

/** The fade, as an alpha ramp over a box of this size. Mirrors the SVG mask the
 *  screen builds in `featherMask`. */
function applyFeather(
  context: CanvasRenderingContext2D,
  feather: NonNullable<PhotoLayer['feather']>,
  width: number, height: number,
): void {
  const gradient = context.createLinearGradient(
    feather.x1 * width, feather.y1 * height, feather.x2 * width, feather.y2 * height,
  );
  feather.stops.forEach((stop) => {
    gradient.addColorStop(
      Math.max(0, Math.min(1, stop.offset)),
      `rgba(255, 255, 255, ${stop.opacity})`,
    );
  });
  const previous = context.globalCompositeOperation;
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = previous;
}

/** One photograph in its place: object-fit and object-position as the screen
 *  computed them, then the frame's own zoom about that same point, then the
 *  designed flip. Drawn in the place's own coordinates, origin at its corner. */
function drawPhotoContent(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  layer: PhotoLayer,
  fit: 'contain' | 'cover',
  positionX: number, positionY: number, zoom: number, rotation: number,
  width: number, height: number,
): void {
  const byWidth = width / bitmap.width;
  const byHeight = height / bitmap.height;
  const scale = fit === 'contain' ? Math.min(byWidth, byHeight) : Math.max(byWidth, byHeight);
  const drawnWidth = bitmap.width * scale;
  const drawnHeight = bitmap.height * scale;
  const shareX = positionX / 100;
  const shareY = positionY / 100;
  const originX = width * shareX;
  const originY = height * shareY;
  const factor = fit === 'contain' ? 1 : zoom;

  context.save();
  context.translate(originX, originY);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(factor * (layer.flipX ? -1 : 1), factor * (layer.flipY ? -1 : 1));
  context.translate(-originX, -originY);
  context.drawImage(bitmap, (width - drawnWidth) * shareX, (height - drawnHeight) * shareY, drawnWidth, drawnHeight);
  context.restore();
}

function drawShape(
  context: CanvasRenderingContext2D,
  layer: ShapeLayer,
  template: AlbumTemplate,
  instance: SpreadTemplateInstance,
  viewWidth: number,
): void {
  const fill = layer.fillColor ?? (layer.fillToken ? colorOf(template, instance, layer.fillToken) : null);
  const stroke = layer.strokeColor ?? (layer.strokeToken ? colorOf(template, instance, layer.strokeToken) : null);
  const { x, y, width, height } = layer.box;
  const left = x * viewWidth;
  const top = y * VIEW_HEIGHT;
  const boxWidth = width * viewWidth;
  const boxHeight = height * VIEW_HEIGHT;
  let strokeWidth = layer.strokeWidth ? layer.strokeWidth * VIEW_HEIGHT : 0;

  context.save();
  rotateAround(context, layer.rotation, left + boxWidth / 2, top + boxHeight / 2);

  if (layer.shape === 'rect' && !layer.outline) {
    const radius = layer.radius ? layer.radius * VIEW_HEIGHT : 0;
    if (layer.shadow) {
      // The screen blurs a black copy of the rectangle below it; same here.
      const strength = layer.shadow / 100;
      context.filter = `blur(${6 + 22 * strength}px)`;
      context.fillStyle = `rgba(0, 0, 0, ${0.2 + 0.45 * strength})`;
      roundedRectPath(context, left, top + 4 + 10 * strength, boxWidth, boxHeight, radius);
      context.fill();
      context.filter = 'none';
      context.restore();
      return;
    }
    roundedRectPath(context, left, top, boxWidth, boxHeight, radius);
  } else if (layer.shape === 'ellipse' && !layer.outline) {
    context.beginPath();
    context.ellipse(left + boxWidth / 2, top + boxHeight / 2, boxWidth / 2, boxHeight / 2, 0, 0, Math.PI * 2);
  } else if (layer.outline) {
    const transform = layer.outline.transform;
    if (layer.outlineBox) {
      // Added artwork: its own bounds scaled into the box, centred, undistorted.
      const bounds = layer.outlineBox;
      const scale = Math.min(boxWidth / bounds.width, boxHeight / bounds.height);
      context.translate(
        left + (boxWidth - bounds.width * scale) / 2 - bounds.x * scale,
        top + (boxHeight - bounds.height * scale) / 2 - bounds.y * scale,
      );
      context.scale(scale, scale);
      if (strokeWidth) strokeWidth /= scale;
    } else if (transform) {
      context.translate(transform[2], transform[3]);
      context.scale(transform[0], transform[1]);
    }
    const path = new Path2D(layer.outline.d);
    if (fill && fill !== 'none') {
      context.fillStyle = fill;
      context.fill(path, layer.outline.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
    }
    if (stroke && strokeWidth) {
      context.strokeStyle = stroke;
      context.lineWidth = strokeWidth;
      context.stroke(path);
    }
    context.restore();
    return;
  } else {
    context.beginPath();
    (layer.points ?? []).forEach(([px, py], index) => {
      const pointX = px * viewWidth;
      const pointY = py * VIEW_HEIGHT;
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    });
    if (stroke && strokeWidth) {
      context.strokeStyle = stroke;
      context.lineWidth = strokeWidth;
      context.lineJoin = 'miter';
      context.lineCap = 'butt';
      context.stroke();
    }
    context.restore();
    return;
  }

  if (fill && fill !== 'none') {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke && strokeWidth) {
    context.strokeStyle = stroke;
    context.lineWidth = strokeWidth;
    context.stroke();
  }
  context.restore();
}

/** Words the photographer typed, in the place the designer drew for them. The
 *  screen sets `white-space: pre`, so lines break where they were typed and
 *  nowhere else. */
function drawText(
  context: CanvasRenderingContext2D,
  layer: TextLayer,
  template: AlbumTemplate,
  instance: SpreadTemplateInstance,
  width: number, height: number,
): void {
  const rawText = textOf(instance, layer);
  const text = layer.textTransform === 'uppercase'
    ? rawText.toLocaleUpperCase()
    : layer.textTransform === 'lowercase'
      ? rawText.toLocaleLowerCase()
      : layer.textTransform === 'capitalize'
        ? rawText.replace(/(^|\s)(\p{L})/gu, (match) => match.toLocaleUpperCase())
        : rawText;
  if (!text) return;
  const left = layer.box.x * width;
  const top = layer.box.y * height;
  const boxWidth = layer.box.width * width;
  const boxHeight = layer.box.height * height;
  const fontSize = layer.fontSize * height;
  const lineHeight = fontSize * layer.lineHeight;
  const lines = text.split('\n');
  const block = lineHeight * lines.length;

  context.save();
  rotateAround(context, layer.rotation, left + boxWidth / 2, top + boxHeight / 2);
  context.fillStyle = layer.color ?? colorOf(template, instance, layer.colorToken);
  context.font = `${layer.italic ? 'italic ' : ''}${layer.fontWeight} ${fontSize}px ${layer.fontFamily}`;
  (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(layer.letterSpacing ?? 0) * fontSize}px`;
  if (layer.effect === 'shadow') {
    context.shadowColor = 'rgba(0,0,0,.34)';
    context.shadowBlur = fontSize * 0.16;
    context.shadowOffsetY = fontSize * 0.09;
  } else if (layer.effect === 'lift') {
    context.shadowColor = 'rgba(0,0,0,.2)';
    context.shadowBlur = fontSize * 0.08;
    context.shadowOffsetY = fontSize * 0.16;
  }
  context.direction = layer.direction ?? 'rtl';
  context.textAlign = layer.align === 'center' ? 'center' : layer.align;
  context.textBaseline = 'middle';

  const anchorX = layer.align === 'center'
    ? left + boxWidth / 2
    : (layer.align === 'start') === ((layer.direction ?? 'rtl') === 'ltr')
      ? left
      : left + boxWidth;
  const firstY = layer.verticalAlign === 'top'
    ? top
    : layer.verticalAlign === 'bottom'
      ? top + boxHeight - block
      : top + (boxHeight - block) / 2;

  lines.forEach((line, index) => {
    const baselineY = firstY + lineHeight * (index + 0.5);
    if (layer.effect === 'outline') {
      context.strokeStyle = context.fillStyle as string;
      context.lineWidth = Math.max(1, fontSize * 0.07);
      context.lineJoin = 'round';
      context.strokeText(line, anchorX, baselineY);
    }
    context.fillText(line, anchorX, baselineY);
    if (layer.underline || layer.strikeThrough) {
      const measured = context.measureText(line).width;
      const lineLeft = layer.align === 'center' ? anchorX - measured / 2 : context.textAlign === 'left' ? anchorX : anchorX - measured;
      context.save();
      context.shadowColor = 'transparent';
      context.strokeStyle = context.fillStyle as string;
      context.lineWidth = Math.max(1, fontSize * 0.055);
      if (layer.underline) {
        context.beginPath();
        context.moveTo(lineLeft, baselineY + fontSize * 0.38);
        context.lineTo(lineLeft + measured, baselineY + fontSize * 0.38);
        context.stroke();
      }
      if (layer.strikeThrough) {
        context.beginPath();
        context.moveTo(lineLeft, baselineY);
        context.lineTo(lineLeft + measured, baselineY);
        context.stroke();
      }
      context.restore();
    }
  });
  context.restore();
}

async function drawImageLayer(
  context: CanvasRenderingContext2D,
  layer: ImageLayer,
  bitmap: ImageBitmap | null,
  width: number, height: number,
): Promise<void> {
  if (!bitmap) return;
  const left = layer.box.x * width;
  const top = layer.box.y * height;
  const boxWidth = layer.box.width * width;
  const boxHeight = layer.box.height * height;
  context.save();
  rotateAround(context, layer.rotation, left + boxWidth / 2, top + boxHeight / 2);
  context.drawImage(bitmap, left, top, boxWidth, boxHeight);
  context.restore();
}

/* Does this box reach an outer edge of the spread, and by how much does it
 * have to grow to cross the trim line? The middle of a spread is the fold, and
 * a design that meets it must NOT be pushed past it. */
const TOUCHES = 0.004;

function spilled<T extends { box: LayerBox }>(layer: T, fx: number, fy: number): T {
  if (!fx && !fy) return layer;
  const { x, y, width, height } = layer.box;
  const left = x <= TOUCHES ? fx : 0;
  const right = x + width >= 1 - TOUCHES ? fx : 0;
  const top = y <= TOUCHES ? fy : 0;
  const bottom = y + height >= 1 - TOUCHES ? fy : 0;
  if (!left && !right && !top && !bottom) return layer;
  return {
    ...layer,
    box: {
      x: x - left,
      y: y - top,
      width: width + left + right,
      height: height + top + bottom,
    },
  };
}

/** Draw one designed page onto a canvas of `width` × `height` pixels.
 *
 * `width`/`height` are the FINISHED spread. With `bleedPx` the canvas is
 * larger than that — the page is drawn inset by the bleed and everything that
 * meets an outer edge is carried out into it. */
export async function drawTemplateSpread(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: TemplateRasterInput,
): Promise<void> {
  const {
    template, instance, spread, photos, bitmapOf, elementBitmapOf,
    withoutPhotos = false, withBackground = true, bleedPx,
  } = input;
  const viewWidth = template.nativeAspect * VIEW_HEIGHT;
  const spreadAspect = width / height;
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const bleedX = Math.max(0, bleedPx?.x ?? 0);
  const bleedY = Math.max(0, bleedPx?.y ?? 0);
  const spillX = bleedX / width;
  const spillY = bleedY / height;

  context.save();
  context.translate(bleedX, bleedY);

  if (withBackground) {
    context.fillStyle = templateBackground(template, instance);
    context.fillRect(-bleedX, -bleedY, width + bleedX * 2, height + bleedY * 2);
  }

  // Photo places bind to spread.photoIds in the order they appear in `layers`,
  // which is not the paint order — so the index is counted there.
  const photoIndexById = new Map<string, number>();
  photoLayers(template).forEach((layer, index) => photoIndexById.set(layer.id, index));

  for (const drawn of paintOrder(template)) {
    /* Into the bleed go the photographs and the designed fills behind them.
     * Artwork and lettering are not stretched: a flourish drawn to the edge is
     * meant to be cut there, and scaling it would move the drawing itself. */
    const layer = drawn.type === 'photo'
      || (drawn.type === 'shape' && drawn.shape === 'rect' && !drawn.outline
        && (drawn.fillToken || drawn.fillColor))
      ? spilled(drawn, spillX, spillY)
      : drawn;
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';

    if (layer.type === 'photo') {
      if (withoutPhotos) { context.restore(); continue; }
      const photo = byId.get(spread.photoIds[photoIndexById.get(layer.id) ?? -1] ?? '');
      const boxWidth = layer.box.width * width;
      const boxHeight = layer.box.height * height;
      const left = layer.box.x * width;
      const top = layer.box.y * height;
      const settings = spread.frameSettings?.[layer.id] ?? DEFAULT_SETTINGS;
      const zoom = Math.max(1, (settings.zoom ?? 100) / 100);
      const bitmap = photo
        ? await bitmapOf(photo, { width: boxWidth * zoom, height: boxHeight * zoom })
        : null;
      if (photo && bitmap) {
        const crop = assessCrop(
          photo,
          { ...layer.box, id: layer.id, role: layer.role, preferred: layer.preferred },
          settings,
          spreadAspect,
        );
        applyLayerCompositing(context, layer);
        rotateAround(context, layer.rotation, left + boxWidth / 2, top + boxHeight / 2);

        if (layer.feather) {
          /* A fade needs the place's own pixels before they reach the sheet, so
           * the ramp cuts the photograph and not what is already under it. */
          const scratch = document.createElement('canvas');
          scratch.width = Math.max(1, Math.round(boxWidth));
          scratch.height = Math.max(1, Math.round(boxHeight));
          const scratchContext = scratch.getContext('2d');
          if (scratchContext) {
            drawPhotoContent(
              scratchContext, bitmap, layer, crop.fit, crop.positionX, crop.positionY,
              (settings.zoom ?? 100) / 100, settings.rotation ?? 0, scratch.width, scratch.height,
            );
            applyFeather(scratchContext, layer.feather, scratch.width, scratch.height);
            roundedRectPath(context, left, top, boxWidth, boxHeight, (layer.radius ?? 0) * height);
            context.clip();
            context.drawImage(scratch, left, top, boxWidth, boxHeight);
          }
        } else {
          roundedRectPath(context, left, top, boxWidth, boxHeight, (layer.radius ?? 0) * height);
          context.clip();
          context.translate(left, top);
          drawPhotoContent(
            context, bitmap, layer, crop.fit, crop.positionX, crop.positionY,
            (settings.zoom ?? 100) / 100, settings.rotation ?? 0, boxWidth, boxHeight,
          );
        }
        bitmap.close();
      }
      context.restore();
      continue;
    }

    applyLayerCompositing(context, layer);

    if (layer.type === 'image') {
      await drawImageLayer(
        context, layer, elementBitmapOf ? await elementBitmapOf(layer.assetId) : null, width, height,
      );
    } else if (layer.type === 'text' && !usesSourceLettering(instance, layer)) {
      drawText(context, layer, template, instance, width, height);
    } else {
      /* Shapes and the designer's own lettering live in the viewBox, stretched
       * to the sheet on both axes independently — which is also what makes a
       * hairline thicker on the long axis of a wide album, on screen and here
       * alike. */
      context.scale(width / viewWidth, height / VIEW_HEIGHT);
      if (layer.type === 'shape') {
        drawShape(context, layer, template, instance, viewWidth);
      } else if (layer.outline) {
        context.fillStyle = colorOf(template, instance, layer.colorToken);
        context.save();
        rotateAround(
          context, layer.rotation,
          (layer.box.x + layer.box.width / 2) * viewWidth,
          (layer.box.y + layer.box.height / 2) * VIEW_HEIGHT,
        );
        const transform = layer.outline.transform;
        if (transform) {
          context.translate(transform[2], transform[3]);
          context.scale(transform[0], transform[1]);
        }
        context.fill(
          new Path2D(layer.outline.d),
          layer.outline.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        );
        context.restore();
      }
    }
    context.restore();
  }

  context.restore();
}
