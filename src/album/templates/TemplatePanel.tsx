import type { AlbumPhoto, AlbumSpread } from '../model';
import {
  TEMPLATE_LIBRARY, colorOf, fitsSpread, libraryFitsAspect, newInstance, templateBackground,
  templatesFor, textOf, usesSourceLettering,
} from './library';
import { TemplatePage } from './TemplateLayers';
import type { AlbumTemplate, TextLayer } from './types';

interface Props {
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  spreadAspect: number;
  /** The design on this spread, or null. */
  template: AlbumTemplate | null;
  onApply(template: AlbumTemplate): void;
  onRemove(): void;
  /** Live while the control moves; `onEditEnd` closes it as one undo step. */
  onColor(token: string, value: string): void;
  onText(layerId: string, value: string): void;
  onEditEnd(): void;
}

/* The side-panel section for Vault pages: which designs fit this spread, and —
 * once one is placed — this spread's own colours and words. */
export default function TemplatePanel({
  spread, photos, spreadAspect, template, onApply, onRemove, onColor, onText, onEditEnd,
}: Props) {
  if (template && spread.templateInstance) {
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
        <div className="tpl-texts">
          {texts.map((layer) => (
            <label key={layer.id}>
              <span>{layer.name}</span>
              <input
                dir="rtl"
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
        {standIn && (
          <small>טקסט שנערך מוצג בגופן זמני. הגופן של המעצב ייכנס כשיגיע קובץ המקור.</small>
        )}
        <button className="tpl-remove" onClick={onRemove}>החזרת הכפולה לפריסה רגילה</button>
      </section>
    );
  }

  const photoCount = spread.photoIds.filter(Boolean).length;
  const offered = photoCount === 0
    ? TEMPLATE_LIBRARY.filter((item) => fitsSpread(item, spreadAspect))
    : templatesFor(photoCount, spreadAspect);

  return (
    <section className="tpl-panel" aria-label="עמודים מהכספת">
      <strong>עמודים מהכספת</strong>
      {!libraryFitsAspect(spreadAspect) ? (
        <small>עמודי הכספת מעוצבים לאלבום רוחב 28×21 ס״מ. כדי להשתמש בהם יש לשנות את מידת האלבום.</small>
      ) : !offered.length ? (
        <small>{`אין עדיין עמוד מהכספת ל־${photoCount} תמונות בכפולה.`}</small>
      ) : (
        <div className="tpl-cards">
          {offered.map((item) => {
            const instance = newInstance(item);
            return (
              <button key={item.id} className="tpl-card" onClick={() => onApply(item)}>
                <span
                  className="tpl-card-sheet"
                  style={{ display: 'block', aspectRatio: `${item.nativeAspect}`, background: templateBackground(item, instance) }}
                >
                  <TemplatePage
                    template={item}
                    instance={instance}
                    spread={{ ...spread, frameSettings: {} }}
                    photos={photos}
                    spreadAspect={spreadAspect}
                  />
                </span>
                <b>{item.name}</b>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
