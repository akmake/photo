import type { CSSProperties } from 'react';
import { assessCrop } from '../cropEngine';
import type { AlbumPhoto, AlbumSpread, PhotoFrameSettings } from '../model';
import {
  colorOf, layerBands, templateSlots, textOf, usesSourceLettering,
} from './library';
import type {
  AlbumTemplate, ShapeLayer, SpreadTemplateInstance, TemplateLayer, TextLayer,
} from './types';
import './templates.css';

/* One renderer for template pages, used by the editor, the thumbnails and the
 * client review — so a colour or a word changed on one screen is the same
 * everywhere. Lines and the designer's lettering are SVG in a viewBox whose
 * height is 1000; edited text is HTML sized in container units of the spread. */

const VIEW_HEIGHT = 1000;

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

function svgRotation(layer: TemplateLayer, viewWidth: number): string | undefined {
  if (!layer.rotation) return undefined;
  const cx = (layer.box.x + layer.box.width / 2) * viewWidth;
  const cy = (layer.box.y + layer.box.height / 2) * VIEW_HEIGHT;
  return `rotate(${layer.rotation} ${cx} ${cy})`;
}

function Shape({ layer, template, instance, viewWidth }: {
  layer: ShapeLayer;
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  viewWidth: number;
}) {
  const common = {
    fill: layer.fillToken ? colorOf(template, instance, layer.fillToken) : 'none',
    stroke: layer.strokeToken ? colorOf(template, instance, layer.strokeToken) : undefined,
    strokeWidth: layer.strokeWidth ? layer.strokeWidth * VIEW_HEIGHT : undefined,
    opacity: layer.opacity,
    transform: svgRotation(layer, viewWidth),
  };
  const { x, y, width, height } = layer.box;
  if (layer.shape === 'rect') {
    return (
      <rect
        x={x * viewWidth}
        y={y * VIEW_HEIGHT}
        width={width * viewWidth}
        height={height * VIEW_HEIGHT}
        {...common}
      />
    );
  }
  if (layer.shape === 'ellipse') {
    return (
      <ellipse
        cx={(x + width / 2) * viewWidth}
        cy={(y + height / 2) * VIEW_HEIGHT}
        rx={(width / 2) * viewWidth}
        ry={(height / 2) * VIEW_HEIGHT}
        {...common}
      />
    );
  }
  return (
    <polyline
      points={(layer.points ?? []).map(([px, py]) => `${px * viewWidth},${py * VIEW_HEIGHT}`).join(' ')}
      strokeLinejoin="miter"
      strokeLinecap="butt"
      {...common}
    />
  );
}

/** The non-photo layers on one side of the photos. */
export function TemplateDecor({ template, instance, band }: {
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  band: 'below' | 'above';
}) {
  const layers = layerBands(template)[band];
  if (!layers.length) return null;
  const viewWidth = template.nativeAspect * VIEW_HEIGHT;
  const typedTexts = layers.filter((layer): layer is TextLayer => (
    layer.type === 'text' && !usesSourceLettering(instance, layer)
  ));

  return (
    <div className={`tpl-decor tpl-${band}`}>
      <svg viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        {layers.map((layer) => {
          if (layer.type === 'shape') {
            return (
              <Shape
                key={layer.id}
                layer={layer}
                template={template}
                instance={instance}
                viewWidth={viewWidth}
              />
            );
          }
          if (layer.type === 'text' && layer.outline && usesSourceLettering(instance, layer)) {
            return (
              <path
                key={layer.id}
                d={layer.outline.d}
                fill={colorOf(template, instance, layer.colorToken)}
                fillRule={layer.outline.fillRule}
                opacity={layer.opacity}
                transform={[
                  svgRotation(layer, viewWidth),
                  layer.outline.transform
                    && `translate(${layer.outline.transform[2]} ${layer.outline.transform[3]}) scale(${layer.outline.transform[0]} ${layer.outline.transform[1]})`,
                ].filter(Boolean).join(' ') || undefined}
              >
                <title>{layer.defaultText}</title>
              </path>
            );
          }
          return null;
        })}
      </svg>
      {typedTexts.map((layer) => (
        <div
          key={layer.id}
          className="tpl-text"
          style={{
            left: `${layer.box.x * 100}%`,
            top: `${layer.box.y * 100}%`,
            width: `${layer.box.width * 100}%`,
            height: `${layer.box.height * 100}%`,
            color: colorOf(template, instance, layer.colorToken),
            fontFamily: layer.fontFamily,
            fontWeight: layer.fontWeight,
            fontSize: `${layer.fontSize * 100}cqh`,
            lineHeight: layer.lineHeight,
            justifyContent: JUSTIFY[layer.align],
            alignItems: ALIGN_ITEMS[layer.verticalAlign],
            opacity: layer.opacity,
            transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
          }}
        >
          {textOf(instance, layer)}
        </div>
      ))}
    </div>
  );
}

/** A whole template page, read-only: decorations, photos, decorations. The
 *  caller supplies the sheet (its size and background). */
export function TemplatePage({
  template, instance, spread, photos, spreadAspect,
}: {
  template: AlbumTemplate;
  instance: SpreadTemplateInstance;
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  spreadAspect: number;
}) {
  return (
    <>
      <TemplateDecor template={template} instance={instance} band="below" />
      {templateSlots(template).map((slot, index) => {
        const photo = photos.find((item) => item.id === spread.photoIds[index]);
        if (!photo) return null;
        const settings = spread.frameSettings?.[slot.id] ?? DEFAULT_SETTINGS;
        const crop = assessCrop(photo, slot, settings, spreadAspect);
        return (
          <div
            key={slot.id}
            className="tpl-photo"
            style={{
              left: `${slot.x * 100}%`,
              top: `${slot.y * 100}%`,
              width: `${slot.width * 100}%`,
              height: `${slot.height * 100}%`,
            }}
          >
            <img
              src={photo.url}
              alt=""
              loading="lazy"
              decoding="async"
              style={{
                objectFit: crop.fit,
                objectPosition: `${crop.positionX}% ${crop.positionY}%`,
                transform: `scale(${crop.fit === 'contain' ? 1 : (settings.zoom ?? 100) / 100})`,
                transformOrigin: `${crop.positionX}% ${crop.positionY}%`,
              }}
            />
          </div>
        );
      })}
      <TemplateDecor template={template} instance={instance} band="above" />
    </>
  );
}
