import { useId, type CSSProperties } from 'react';
import { assessCrop } from '../cropEngine';
import type { AlbumPhoto, AlbumSpread, PhotoFrameSettings } from '../model';
import { colorOf, paintOrder, textOf, usesSourceLettering } from './library';
import type {
  AlbumTemplate, ImageLayer, LayerOutline, PhotoLayer, ShapeLayer, SpreadTemplateInstance, TemplateLayer,
  TextLayer,
} from './types';
import { elementUrl } from './elementStore';
import './templates.css';

/* One renderer for template pages, used by the editor, the thumbnails and the
 * client review — so a colour or a word changed on one screen is the same
 * everywhere.
 *
 * Layers paint in the designer's order, photos included: a frame line drawn
 * over one photo and under the next stays exactly there. Each layer is its own
 * absolutely placed element with a z-index from TEMPLATE_Z_BASE upward, so the
 * editor can slot its interactive photo frames into the same order. Artwork is
 * SVG in a viewBox whose height is 1000; edited text is HTML sized in container
 * units of the spread. */

const VIEW_HEIGHT = 1000;
export const TEMPLATE_Z_BASE = 10;

const DEFAULT_SETTINGS: PhotoFrameSettings = {
  fit: 'smart',
  positionX: 50,
  positionY: 50,
  zoom: 100,
};

const JUSTIFY: Record<TextLayer['align'], CSSProperties['justifyContent']> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

const ALIGN_ITEMS: Record<TextLayer['verticalAlign'], CSSProperties['alignItems']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

/** CSS z-index of each layer on this page, in paint order. */
export function templateZ(template: AlbumTemplate): Map<string, number> {
  return new Map(paintOrder(template).map((layer, index) => [layer.id, TEMPLATE_Z_BASE + index]));
}

function svgRotation(layer: TemplateLayer, viewWidth: number): string | undefined {
  if (!layer.rotation) return undefined;
  const cx = (layer.box.x + layer.box.width / 2) * viewWidth;
  const cy = (layer.box.y + layer.box.height / 2) * VIEW_HEIGHT;
  return `rotate(${layer.rotation} ${cx} ${cy})`;
}

function outlineTransform(outline: LayerOutline): string | undefined {
  const t = outline.transform;
  return t ? `translate(${t[2]} ${t[3]}) scale(${t[0]} ${t[1]})` : undefined;
}

/** A photo place's own look: rotation, fade, opacity and blend. Shared by the
 *  read-only page and the editor's interactive frames. */
export function photoFrameStyle(layer: PhotoLayer, spreadAspect?: number): CSSProperties {
  const style: CSSProperties = {};
  if (layer.radius && spreadAspect) {
    // circular corners on a box measured in fractions of each axis
    const corners = `${(layer.radius / (layer.box.width * spreadAspect)) * 100}% / ${(layer.radius / layer.box.height) * 100}%`;
    style.borderRadius = corners;
    // clip the element itself, so a scaled (composited) photo is cut too
    style.clipPath = `inset(0 round ${corners})`;
  }
  if (layer.rotation) style.transform = `rotate(${layer.rotation}deg)`;
  if (layer.opacity !== undefined) style.opacity = layer.opacity;
  if (layer.blendMode) style.mixBlendMode = layer.blendMode as CSSProperties['mixBlendMode'];
  if (layer.feather) Object.assign(style, featherMask(layer.feather, '100% 100%'));
  return style;
}

/** CSS mask for a fade. `size`/`position` place it when the element is larger
 *  than the faded box (a full-spread layer wrapper). */
function featherMask(f: NonNullable<PhotoLayer['feather']>, size: string, position = '0 0'): CSSProperties {
  {
    const stops = f.stops
      .map((stop) => `<stop offset='${stop.offset}' stop-color='white' stop-opacity='${stop.opacity}'/>`)
      .join('');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'>`
      + `<defs><linearGradient id='f' gradientUnits='userSpaceOnUse' x1='${f.x1}' y1='${f.y1}' x2='${f.x2}' y2='${f.y2}'>${stops}</linearGradient></defs>`
      + `<rect width='1' height='1' fill='url(#f)'/></svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    return {
      maskImage: url,
      WebkitMaskImage: url,
      maskSize: size,
      WebkitMaskSize: size,
      maskPosition: position,
      WebkitMaskPosition: position,
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
    } as CSSProperties;
  }
}

function Shape({ layer, template, instance, viewWidth }: {
  layer: ShapeLayer;
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  viewWidth: number;
}) {
  const common = {
    fill: layer.fillColor ?? (layer.fillToken ? colorOf(template, instance, layer.fillToken) : 'none'),
    stroke: layer.strokeColor ?? (layer.strokeToken ? colorOf(template, instance, layer.strokeToken) : undefined),
    strokeWidth: layer.strokeWidth ? layer.strokeWidth * VIEW_HEIGHT : undefined,
  };
  const rotation = svgRotation(layer, viewWidth);
  const shadowId = useId().replace(/:/g, '');
  const { x, y, width, height } = layer.box;
  if (layer.shape === 'rect') {
    const radius = layer.radius ? layer.radius * VIEW_HEIGHT : undefined;
    if (layer.shadow) {
      const strength = layer.shadow / 100;
      return (
        <>
          <defs>
            <filter id={shadowId} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={6 + 22 * strength} />
            </filter>
          </defs>
          <rect
            x={x * viewWidth}
            y={y * VIEW_HEIGHT + 4 + 10 * strength}
            width={width * viewWidth}
            height={height * VIEW_HEIGHT}
            rx={radius}
            fill="#000"
            fillOpacity={0.2 + 0.45 * strength}
            filter={`url(#${shadowId})`}
            transform={rotation}
          />
        </>
      );
    }
    return (
      <rect
        x={x * viewWidth}
        y={y * VIEW_HEIGHT}
        width={width * viewWidth}
        height={height * VIEW_HEIGHT}
        rx={radius}
        transform={rotation}
        {...common}
      />
    );
  }
  if (layer.shape === 'ellipse' && !layer.outline) {
    return (
      <ellipse
        cx={(x + width / 2) * viewWidth}
        cy={(y + height / 2) * VIEW_HEIGHT}
        rx={(width / 2) * viewWidth}
        ry={(height / 2) * VIEW_HEIGHT}
        transform={rotation}
        {...common}
      />
    );
  }
  if (layer.outline) {
    let transform = outlineTransform(layer.outline);
    let strokeWidth = common.strokeWidth;
    if (layer.outlineBox) {
      // added artwork: scale its own bounds into the box, centred, undistorted
      const ob = layer.outlineBox;
      const bw = width * viewWidth;
      const bh = height * VIEW_HEIGHT;
      const s = Math.min(bw / ob.width, bh / ob.height);
      const tx = x * viewWidth + (bw - ob.width * s) / 2 - ob.x * s;
      const ty = y * VIEW_HEIGHT + (bh - ob.height * s) / 2 - ob.y * s;
      transform = [rotation, `translate(${tx} ${ty}) scale(${s})`].filter(Boolean).join(' ');
      if (strokeWidth) strokeWidth /= s;
    }
    return (
      <path
        d={layer.outline.d}
        fillRule={layer.outline.fillRule}
        transform={transform}
        {...common}
        strokeWidth={strokeWidth}
      />
    );
  }
  return (
    <polyline
      points={(layer.points ?? []).map(([px, py]) => `${px * viewWidth},${py * VIEW_HEIGHT}`).join(' ')}
      strokeLinejoin="miter"
      strokeLinecap="butt"
      transform={rotation}
      {...common}
      fill="none"
    />
  );
}

/** One non-photo layer, as its own element at its place in the paint order. */
export function TemplateLayerView({ template, instance, layer, zIndex }: {
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  layer: ShapeLayer | TextLayer | ImageLayer;
  zIndex: number;
}) {
  if (layer.type === 'image') {
    const url = elementUrl(layer.assetId);
    const place: CSSProperties = {
      position: 'absolute',
      left: `${layer.box.x * 100}%`,
      top: `${layer.box.y * 100}%`,
      width: `${layer.box.width * 100}%`,
      height: `${layer.box.height * 100}%`,
      transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    };
    return (
      <div className="tpl-decor" style={{ zIndex, opacity: layer.opacity, mixBlendMode: layer.blendMode as CSSProperties['mixBlendMode'] }}>
        {url
          ? <img className="tpl-element-image" src={url} alt="" draggable={false} style={place} />
          : <span className="tpl-element-missing" style={place}>האלמנט לא נמצא במחשב</span>}
      </div>
    );
  }
  const viewWidth = template.nativeAspect * VIEW_HEIGHT;
  const wrapper: CSSProperties = {
    zIndex,
    opacity: layer.opacity,
    mixBlendMode: layer.blendMode as CSSProperties['mixBlendMode'],
  };
  if (layer.type === 'shape' && layer.feather && layer.box.width < 1 && layer.box.height < 1) {
    // the wrapper spans the spread; place the fade over this layer's box
    const { x, y, width, height } = layer.box;
    Object.assign(wrapper, featherMask(
      layer.feather,
      `${width * 100}% ${height * 100}%`,
      `${(x / (1 - width)) * 100}% ${(y / (1 - height)) * 100}%`,
    ));
  }

  if (layer.type === 'text' && !usesSourceLettering(instance, layer)) {
    return (
      <div className="tpl-decor" style={wrapper}>
        <div
          className="tpl-text"
          style={{
            left: `${layer.box.x * 100}%`,
            top: `${layer.box.y * 100}%`,
            width: `${layer.box.width * 100}%`,
            height: `${layer.box.height * 100}%`,
            direction: layer.direction ?? 'rtl',
            color: layer.color ?? colorOf(template, instance, layer.colorToken),
            fontFamily: layer.fontFamily,
            fontWeight: layer.fontWeight,
            fontSize: `${layer.fontSize * 100}cqh`,
            lineHeight: layer.lineHeight,
            justifyContent: JUSTIFY[layer.align],
            alignItems: ALIGN_ITEMS[layer.verticalAlign],
            transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
          }}
        >
          {textOf(instance, layer)}
        </div>
      </div>
    );
  }

  return (
    <div className="tpl-decor" style={wrapper}>
      <svg viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {layer.type === 'shape' ? (
          <Shape layer={layer} template={template} instance={instance} viewWidth={viewWidth} />
        ) : layer.outline ? (
          <path
            d={layer.outline.d}
            fill={colorOf(template, instance, layer.colorToken)}
            fillRule={layer.outline.fillRule}
            transform={[svgRotation(layer, viewWidth), outlineTransform(layer.outline)]
              .filter(Boolean).join(' ') || undefined}
          >
            <title>{layer.defaultText}</title>
          </path>
        ) : null}
      </svg>
    </div>
  );
}

/** Every non-photo layer of a page. The caller draws the photos. */
export function TemplateDecor({ template, instance }: {
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
}) {
  const z = templateZ(template);
  return (
    <>
      {template.layers.map((layer) => (layer.type === 'photo' ? null : (
        <TemplateLayerView
          key={layer.id}
          template={template}
          instance={instance}
          layer={layer}
          zIndex={z.get(layer.id)!}
        />
      )))}
    </>
  );
}

/** A whole template page, read-only. The caller supplies the sheet (its size
 *  and background). */
export function TemplatePage({
  template, instance, spread, photos, spreadAspect,
}: {
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  spreadAspect: number;
}) {
  const z = templateZ(template);
  let photoIndex = -1;
  return (
    <>
      {template.layers.map((layer) => {
        if (layer.type !== 'photo') return null;
        photoIndex += 1;
        const photo = photos.find((item) => item.id === spread.photoIds[photoIndex]);
        const slot = { ...layer.box, id: layer.id, role: layer.role, preferred: layer.preferred };
        const settings = spread.frameSettings?.[layer.id] ?? DEFAULT_SETTINGS;
        const crop = photo ? assessCrop(photo, slot, settings, spreadAspect) : null;
        return (
          <div
            key={layer.id}
            className={`tpl-photo ${photo ? '' : 'empty'}`}
            style={{
              left: `${layer.box.x * 100}%`,
              top: `${layer.box.y * 100}%`,
              width: `${layer.box.width * 100}%`,
              height: `${layer.box.height * 100}%`,
              zIndex: z.get(layer.id),
              /* An empty place shows its outline plainly — no fade, which on an
               * empty place reads as a smudge. */
              ...(photo ? photoFrameStyle(layer, spreadAspect) : { transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined }),
            }}
          >
            {!photo && <span className="tpl-place-number">{photoIndex + 1}</span>}
            {photo && crop && (
              <img
                src={photo.url}
                alt=""
                loading="lazy"
                decoding="async"
                style={{
                  objectFit: crop.fit,
                  objectPosition: `${crop.positionX}% ${crop.positionY}%`,
                  transform: `scale(${(crop.fit === 'contain' ? 1 : (settings.zoom ?? 100) / 100) * (layer.flipX ? -1 : 1)}, ${(crop.fit === 'contain' ? 1 : (settings.zoom ?? 100) / 100) * (layer.flipY ? -1 : 1)})`,
                  transformOrigin: `${crop.positionX}% ${crop.positionY}%`,
                }}
              />
            )}
          </div>
        );
      })}
      <TemplateDecor template={template} instance={instance} />
    </>
  );
}
