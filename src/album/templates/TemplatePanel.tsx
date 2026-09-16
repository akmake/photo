import { useState } from 'react';
import type { AlbumPhoto, AlbumSpread } from '../model';
import {
  TEMPLATE_LIBRARY, colorOf, fittedTemplate, newInstance, templateBackground, templatesFor,
  textOf, usesSourceLettering,
} from './library';
import { TemplatePage } from './TemplateLayers';
import { rankTemplates } from './choose';
import type { AlbumTemplate, TextLayer } from './types';

interface Props {
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  spreadAspect: number;
  /** The design on this spread, or null. */
  template: AlbumTemplate | null;
  /** photoIds — the photos in the order of the page's places, when known. */
  onApply(template: AlbumTemplate, photoIds?: string[]): void;
  /** Live while the control moves; `onEditEnd` closes it as one undo step. */
  onColor(token: string, value: string): void;
  onText(layerId: string, value: string): void;
  onEditEnd(): void;
}

/** Photo counts the Vault has pages for. */
const PHOTO_COUNTS = [...new Set(TEMPLATE_LIBRARY.map((item) => item.photoCount))]
  .filter((value) => value > 0)
  .sort((a, b) => a - b);

/* The side-panel section for Vault pages: which designs fit this spread, and —
 * once one is placed — this spread's own colours and words. */
export default function TemplatePanel({
  spread, photos, spreadAspect, template, onApply, onColor, onText, onEditEnd,
}: Props) {
  const placed = spread.photoIds.filter(Boolean);
  /* The photographer decides how many photos the spread holds, then picks a
   * page with that many places. With exactly the photos already on the spread,
   * the pages are ordered by how well they fit them; otherwise in Vault order,
   * with the photos already placed kept in the first places. */
  const [count, setCount] = useState<number | null>(
    () => spread.templateInstance ? spread.photoIds.length : placed.length || null,
  );
  const offered = count === null
    ? []
    : count === placed.length && count > 0
      ? rankTemplates(placed, photos, spreadAspect)
      : templatesFor(count).map((item) => ({
        template: item,
        photoIds: Array.from({ length: count }, (_, index) => placed[index] ?? ''),
      }));

  const countPicker = (
    <div className="tpl-count" role="group" aria-label="כמה תמונות בכפולה">
      {PHOTO_COUNTS.map((value) => (
        <button key={value} className={value === count ? 'on' : ''} onClick={() => setCount(value)}>
          {value}
        </button>
      ))}
    </div>
  );

  const cards = count === null ? (
    <small>בחר כמה תמונות יהיו בכפולה, ויוצגו עמודי הכספת עם מספר המקומות הזה.</small>
  ) : !offered.length ? (
    <small>{`אין בכספת עמוד ל־${count} תמונות.`}</small>
  ) : (
    <div className="tpl-cards">
      {offered.map(({ template: designed, photoIds }) => {
        const item = fittedTemplate(designed, spreadAspect);
        const instance = newInstance(item);
        const current = designed.id === spread.templateInstance?.templateId;
        return (
          <button
            key={item.id}
            className={`tpl-card ${current ? 'on' : ''}`}
            onClick={() => onApply(designed, photoIds)}
          >
            <span
              className="tpl-card-sheet"
              style={{ display: 'block', aspectRatio: `${spreadAspect}`, background: templateBackground(item, instance) }}
            >
              <TemplatePage
                template={item}
                instance={instance}
                spread={{ ...spread, photoIds: photoIds ?? spread.photoIds, frameSettings: {} }}
                photos={photos}
                spreadAspect={spreadAspect}
              />
            </span>
            <b>{item.name}</b>
          </button>
        );
      })}
    </div>
  );

  if (!template || !spread.templateInstance) {
    return (
      <section className="tpl-panel" aria-label="עמודים מהכספת">
        <strong>כמה תמונות בכפולה?</strong>
        {countPicker}
        {cards}
      </section>
    );
  }

  const instance = spread.templateInstance;
  const texts = template.layers.filter((layer): layer is TextLayer => layer.type === 'text');
  const standIn = texts.some((layer) => layer.sourceFont && !usesSourceLettering(instance, layer));
  return (
    <section className="tpl-panel" aria-label="עמוד מהכספת">
      <strong>{template.name}</strong>
      <div className="tpl-colors">
        {template.colors.map((color) => (
          <label key={color.id}>
            <span>{color.label}</span>
            <input
              type="color"
              value={colorOf(template, instance, color.id)}
              onChange={(event) => onColor(color.id, event.target.value)}
              onBlur={onEditEnd}
            />
          </label>
        ))}
      </div>
      {texts.length > 0 && (
        <div className="tpl-texts">
          {texts.map((layer) => (
            <label key={layer.id}>
              <span>{layer.name}</span>
              <input
                dir={layer.direction ?? 'rtl'}
                value={textOf(instance, layer)}
                onChange={(event) => onText(layer.id, event.target.value)}
                onBlur={onEditEnd}
                onKeyDown={(event) => {
                  // the studio's arrow/Enter shortcuts must not fire while typing
                  event.stopPropagation();
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </label>
          ))}
        </div>
      )}
      {standIn && (
        <small>הטקסט מוצג בגופן דומה. הגופן של המעצבת ייכנס כשיתקבל קובץ הגופן.</small>
      )}
      <details className="tpl-more">
        <summary>החלפת עמוד או מספר תמונות</summary>
        {countPicker}
        {cards}
      </details>
    </section>
  );
}