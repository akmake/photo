import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { AlbumPhoto, AlbumSpread } from '../model';
import TemplatePanel from './TemplatePanel';
import { BASIC_ELEMENTS, TEXT_PRESETS, vaultElements, type ElementDef } from './elements';
import { iconElements } from './iconElements';
import { elementUrl } from './elementStore';
import type { FontEntry } from './fonts';
import type { AlbumTemplate } from './types';

/* The spread's side panel, organised the way Canva is: a rail of labelled tabs,
 * each doing one job, with a one-line explanation at the top of every tab.
 *
 *   עמוד      — which Vault page, how many photos, next / previous page
 *   צבעים     — this spread's colours and the design's own words
 *   טקסט      — add a heading, subheading, body or script text
 *   אלמנטים   — shapes, decorations (open source) and the Vault's artwork
 *   העלאות    — the photographer's own elements and fonts
 *
 * A selected photo or element replaces this panel with its own tools. */

type Tab = 'page' | 'colors' | 'text' | 'elements' | 'uploads';

interface Props {
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  spreadAspect: number;
  template: AlbumTemplate | null;
  onApply(template: AlbumTemplate, photoIds?: string[]): void;
  onCycle(direction: 1 | -1): void;
  onColor(token: string, value: string): void;
  onText(layerId: string, value: string): void;
  onEditEnd(): void;
  myElements: ElementDef[];
  userFonts: FontEntry[];
  onAddElement(element: ElementDef): void;
  onImportElements(files: FileList): void;
  onRemoveMine(element: ElementDef): void;
  onImportFonts(files: FileList): void;
  /** What this sheet is called in the panel's own words. The cover is designed
   *  in this panel too, and being told it is a "spread" is how a screen tells
   *  the photographer it was not meant for what he is doing. */
  sheetLabel?: 'כפולה' | 'כריכה';
}

const tabInfo = (sheet: 'כפולה' | 'כריכה'): Record<Tab, {
  label: string; title: string; hint: string; icon: ReactNode;
}> => ({
  page: {
    label: 'עמוד', title: 'עמוד מהכספת', hint: `בוחרים כמה תמונות ב${sheet} ואיזה עיצוב מהכספת.`,
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 5v14M6 9h4M6 12h4" /></svg>,
  },
  colors: {
    label: 'צבעים', title: `צבעי ה${sheet}`, hint: `רקע, פסים, קווים וכיתוב — ל${sheet} הזאת בלבד.`,
    icon: <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-1.2-1-1.6-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4C21 6.3 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7.5" r="1" /><circle cx="14.5" cy="7.5" r="1" /></svg>,
  },
  text: {
    label: 'טקסט', title: 'הוספת טקסט', hint: `לחיצה מוסיפה טקסט ל${sheet}. אחר כך לוחצים עליו כדי לשנות מילים, גופן וצבע.`,
    icon: <svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6" /></svg>,
  },
  elements: {
    label: 'אלמנטים', title: 'אלמנטים', hint: `צורות, קישוטים ואייקונים. לחיצה מוסיפה ל${sheet}.`,
    icon: <svg viewBox="0 0 24 24"><circle cx="7.5" cy="7.5" r="3.5" /><rect x="13" y="4" width="7" height="7" rx="1" /><path d="M7.5 13 12 20H3Z" /><path d="m16.5 13 1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4Z" /></svg>,
  },
  uploads: {
    label: 'העלאות', title: 'האלמנטים והגופנים שלך', hint: 'קבצים שלך נשמרים במחשב וזמינים בכל אלבום.',
    icon: <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>,
  },
});

export default function SpreadPanel(props: Props) {
  const [tab, setTab] = useState<Tab>(props.template ? 'colors' : 'page');
  const sheet = props.sheetLabel ?? 'כפולה';
  const TAB_INFO = tabInfo(sheet);
  const info = TAB_INFO[tab];

  return (
    <div className="sp-panel">
      <nav className="sp-rail" aria-label={`כלים ל${sheet}`}>
        {(Object.keys(TAB_INFO) as Tab[]).map((key) => (
          <button
            key={key}
            className={key === tab ? 'on' : ''}
            aria-pressed={key === tab}
            onClick={() => setTab(key)}
          >
            {TAB_INFO[key].icon}
            <span>{TAB_INFO[key].label}</span>
          </button>
        ))}
      </nav>
      <div className="sp-body">
        <header className="sp-head">
          <h3>{info.title}</h3>
          <p>{info.hint}</p>
        </header>
        {(tab === 'page' || tab === 'colors') && (
          <TemplatePanel
            key={`${props.spread.id}-${tab}`}
            section={tab}
            spread={props.spread}
            photos={props.photos}
            spreadAspect={props.spreadAspect}
            template={props.template}
            onApply={props.onApply}
            onCycle={props.onCycle}
            onColor={props.onColor}
            onText={props.onText}
            onEditEnd={props.onEditEnd}
          />
        )}
        {tab === 'text' && <TextTab {...props} />}
        {tab === 'elements' && <ElementsTab {...props} />}
        {tab === 'uploads' && <UploadsTab {...props} />}
      </div>
    </div>
  );
}

function NeedsPage({ template }: { template: AlbumTemplate | null }) {
  return template ? null : <p className="sp-note">כדי להוסיף, בחר קודם עמוד בלשונית "עמוד".</p>;
}

function TextTab({ template, onAddElement, userFonts }: Props) {
  return (
    <div className="sp-section">
      <NeedsPage template={template} />
      <div className="sp-text-presets">
        {TEXT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            disabled={!template}
            onClick={() => onAddElement(preset)}
            style={{ fontFamily: preset.fontFamily, fontWeight: preset.fontWeight, fontSize: `${Math.max(13, (preset.fontSize ?? 0.05) * 260)}px` }}
          >
            {preset.id === 'text-script' || preset.id === 'text-hebrew-hand' ? preset.text : `הוסף ${preset.name}`}
          </button>
        ))}
      </div>
      {userFonts.length > 0 && (
        <>
          <strong className="sp-sub">בגופנים שלך</strong>
          <div className="sp-text-presets">
            {userFonts.map((font) => (
              <button
                key={font.family}
                disabled={!template}
                style={{ fontFamily: `'${font.family}'`, fontSize: '18px' }}
                onClick={() => onAddElement({
                  id: `text-${font.family}`, name: font.family, group: 'basic', kind: 'text',
                  text: font.family, fontFamily: `'${font.family}', sans-serif`, fontSize: 0.06, fill: '#ffffff',
                })}
              >
                {font.family}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="sp-note">את הגופנים שלך מעלים בלשונית "העלאות".</p>
    </div>
  );
}

function ElementsTab({ template, onAddElement }: Props) {
  const [query, setQuery] = useState('');
  const icons = useMemo(() => iconElements(), []);
  const vault = useMemo(() => vaultElements(), []);
  const q = query.trim().toLowerCase();
  const found = q
    ? icons.filter((icon) => `${icon.name} ${icon.keywords ?? ''}`.toLowerCase().includes(q))
    : icons;

  return (
    <div className="sp-section">
      <NeedsPage template={template} />
      <strong className="sp-sub">צורות</strong>
      <ElementGrid elements={BASIC_ELEMENTS} disabled={!template} onAdd={onAddElement} />
      <strong className="sp-sub">{`מהכספת · ${vault.length}`}</strong>
      <ElementGrid elements={vault} disabled={!template} onAdd={onAddElement} />
      <strong className="sp-sub">קישוטים ואייקונים</strong>
      <input
        className="sp-search"
        type="search"
        placeholder="חיפוש באנגלית: heart, star, flower, baby…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <ElementGrid elements={found.slice(0, 240)} disabled={!template} onAdd={onAddElement} />
      {found.length > 240 && <p className="sp-note">{`מוצגים 240 מתוך ${found.length} — חפש כדי לצמצם.`}</p>}
      <p className="sp-credit">אייקונים: Phosphor Icons · רישיון MIT</p>
    </div>
  );
}

function UploadsTab({ template, myElements, userFonts, onAddElement, onImportElements, onRemoveMine, onImportFonts }: Props) {
  const elementInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  return (
    <div className="sp-section">
      <strong className="sp-sub">אלמנטים שלי</strong>
      <button className="sp-upload" onClick={() => elementInput.current?.click()}>＋ העלאת אלמנטים · PNG / SVG / WebP שקופים</button>
      <input
        ref={elementInput} type="file" multiple hidden
        accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
        onChange={(event) => { if (event.target.files?.length) onImportElements(event.target.files); event.target.value = ''; }}
      />
      {myElements.length
        ? <ElementGrid elements={myElements} disabled={!template} onAdd={onAddElement} onRemove={onRemoveMine} />
        : <p className="sp-note">עוד לא הועלו אלמנטים.</p>}

      <strong className="sp-sub">גופנים שלי</strong>
      <button className="sp-upload" onClick={() => fontInput.current?.click()}>＋ העלאת גופנים · TTF / OTF / WOFF</button>
      <input
        ref={fontInput} type="file" multiple hidden
        accept=".ttf,.otf,.woff,.woff2"
        onChange={(event) => { if (event.target.files?.length) onImportFonts(event.target.files); event.target.value = ''; }}
      />
      {userFonts.length
        ? (
          <ul className="sp-fonts">
            {userFonts.map((font) => <li key={font.family} style={{ fontFamily: `'${font.family}'` }}>{font.family}</li>)}
          </ul>
        )
        : <p className="sp-note">עוד לא הועלו גופנים. אחרי העלאה הם יופיעו ברשימת הגופנים של כל טקסט.</p>}
    </div>
  );
}

function ElementGrid({ elements, disabled, onAdd, onRemove }: {
  elements: ElementDef[];
  disabled: boolean;
  onAdd(element: ElementDef): void;
  onRemove?(element: ElementDef): void;
}) {
  return (
    <div className="tpl-element-grid">
      {elements.map((element) => (
        <div key={element.id} className="tpl-element-cell">
          <button className="tpl-element" disabled={disabled} title={element.name} onClick={() => onAdd(element)}>
            <ElementThumb element={element} />
          </button>
          {onRemove && (
            <button className="tpl-element-remove" title="הסרה מהספרייה" onClick={() => onRemove(element)}>×</button>
          )}
        </div>
      ))}
    </div>
  );
}

function ElementThumb({ element }: { element: ElementDef }) {
  if (element.kind === 'path' && element.d && element.bounds) {
    const b = element.bounds;
    const pad = Math.max(b.width, b.height) * 0.08;
    return (
      <svg viewBox={`${b.x - pad} ${b.y - pad} ${b.width + 2 * pad} ${b.height + 2 * pad}`} aria-hidden="true">
        <path
          d={element.d}
          fill={element.fill || !element.stroke ? 'currentColor' : 'none'}
          stroke={element.stroke ? 'currentColor' : undefined}
          strokeWidth={element.stroke ? Math.max(b.width, b.height) * 0.02 : undefined}
        />
      </svg>
    );
  }
  if (element.kind === 'text') {
    return <span className="tpl-element-text" style={{ fontFamily: element.fontFamily }}>{element.text}</span>;
  }
  if (element.kind === 'image' && element.assetId) {
    const url = elementUrl(element.assetId);
    return url ? <img src={url} alt="" draggable={false} /> : <span className="tpl-element-text">חסר</span>;
  }
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      {element.kind === 'line' && <line x1="4" y1="20" x2="36" y2="20" stroke="currentColor" strokeWidth="2" />}
      {element.kind === 'rect' && <rect x="6" y="9" width="28" height="22" fill="none" stroke="currentColor" strokeWidth="2" />}
      {element.kind === 'ellipse' && <ellipse cx="20" cy="20" rx="14" ry="12" fill="none" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}
