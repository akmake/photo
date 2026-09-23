import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { AlbumPhoto, AlbumSpread } from '../model';
import { smallUrl } from '../projectPool';
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
 * The rail is always there; the panel behind it opens only when asked, the
 * way Canva's does. Left open by default it spent the whole session taking a
 * third of the window away from the spread — and a spread is what the
 * photographer came to look at. Clicking the open tab closes it again. */

type Tab = 'design' | 'elements' | 'text' | 'background' | 'brand' | 'uploads' | 'draw' | 'projects' | 'apps';
type PhotoFilter = 'current' | 'unused' | 'all';

interface Props {
  spread: AlbumSpread;
  photos: AlbumPhoto[];
  spreadAspect: number;
  template: AlbumTemplate | null;
  onApply(template: AlbumTemplate, photoIds?: string[]): void;
  onCycle(direction: 1 | -1): void;
  onColor(token: string, value: string): void;
  background: string;
  onBackground(value: string): void;
  onApplyBackgroundToAll(value: string): void;
  onText(layerId: string, value: string): void;
  onEditEnd(): void;
  myElements: ElementDef[];
  userFonts: FontEntry[];
  onAddElement(element: ElementDef): void;
  onImportElements(files: FileList): void;
  onRemoveMine(element: ElementDef): void;
  onImportFonts(files: FileList): void;
  libraryPhotos: AlbumPhoto[];
  photoFilter: PhotoFilter;
  unusedPhotoCount: number;
  usedPhotoIds: Set<string>;
  currentPhotoIds: Set<string>;
  selectedPhotoId: string | null;
  hasMorePhotos: boolean;
  onPhotoFilter(filter: PhotoFilter): void;
  onChoosePhoto(photoId: string): void;
  onDragPhoto(event: DragEvent, photoId: string): void;
  onAddPhotos(): void;
  onLoadMorePhotos(): void;
  spreads: AlbumSpread[];
  activeSpreadId: string;
  onOpenSpread(index: number): void;
  onAddSpread(): void;
  onAutoBuild(): void;
  onPreview(): void;
  /** What this sheet is called in the panel's own words. The cover is designed
   *  in this panel too, and being told it is a "spread" is how a screen tells
   *  the photographer it was not meant for what he is doing. */
  sheetLabel?: 'כפולה' | 'כריכה';
  /** Only the rail is showing. */
  collapsed: boolean;
  onCollapsedChange(next: boolean): void;
}

const tabInfo = (sheet: 'כפולה' | 'כריכה'): Record<Tab, {
  label: string; title: string; hint: string; icon: ReactNode;
}> => ({
  design: {
    label: 'עיצוב', title: 'עיצוב', hint: `תבניות ופריסות ל${sheet}.`,
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="M12 5v14M6 9h4M6 12h4" /></svg>,
  },
  elements: {
    label: 'אלמנטים', title: 'אלמנטים', hint: `צורות, קישוטים ואייקונים. לחיצה מוסיפה ל${sheet}.`,
    icon: <svg viewBox="0 0 24 24"><circle cx="7.5" cy="7.5" r="3.5" /><rect x="13" y="4" width="7" height="7" rx="1" /><path d="M7.5 13 12 20H3Z" /><path d="m16.5 13 1.2 2.5 2.8.4-2 2 .5 2.8-2.5-1.3-2.5 1.3.5-2.8-2-2 2.8-.4Z" /></svg>,
  },
  text: {
    label: 'טקסט', title: 'טקסט', hint: `הוספת טקסט ל${sheet}.`,
    icon: <svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6" /></svg>,
  },
  background: {
    label: 'רקע', title: `רקע ה${sheet}`, hint: `צבע הרקע של ה${sheet}.`,
    icon: <svg viewBox="0 0 24 24"><path d="M12 3C9.4 6.7 6 10.3 6 14a6 6 0 0 0 12 0c0-3.7-3.4-7.3-6-11Z" /><path d="M8.5 15.5c.5 1.5 1.7 2.5 3.5 2.5" /></svg>,
  },
  brand: {
    label: 'מותג', title: 'מותג', hint: 'צבעים וגופנים קבועים לאלבום.',
    icon: <svg viewBox="0 0 24 24"><path d="M7 4h10l3 4-8 12L4 8Z" /><path d="m4 8 8 4 8-4M12 12V4" /></svg>,
  },
  uploads: {
    label: 'העלאות', title: 'העלאות', hint: 'תמונות וקבצים שהעלית.',
    icon: <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>,
  },
  draw: {
    label: 'ציור', title: 'ציור', hint: 'קווים וצורות חופשיות.',
    icon: <svg viewBox="0 0 24 24"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10Z" /><path d="m13.5 6.5 3.5 3.5M4 20l1-4.5" /></svg>,
  },
  projects: {
    label: 'פרויקטים', title: 'עמודי האלבום', hint: 'מעבר בין עמודים וכפולות.',
    icon: <svg viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3Z" /><path d="M3 7V5h7l2 2" /></svg>,
  },
  apps: {
    label: 'אפליקציות', title: 'כלים חכמים', hint: 'פעולות אוטומטיות לאלבום.',
    icon: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M17.5 14v7M14 17.5h7" /></svg>,
  },
});

export default function SpreadPanel(props: Props) {
  const [tab, setTab] = useState<Tab>('uploads');
  const sheet = props.sheetLabel ?? 'כפולה';
  const TAB_INFO = tabInfo(sheet);
  const info = TAB_INFO[tab];

  return (
    <div className="sp-panel">
      <nav className="sp-rail" aria-label={`כלים ל${sheet}`}>
        {(Object.keys(TAB_INFO) as Tab[]).map((key) => (
          <button
            key={key}
            className={key === tab && !props.collapsed ? 'on' : ''}
            aria-pressed={key === tab && !props.collapsed}
            aria-expanded={key === tab && !props.collapsed}
            onClick={() => {
              if (props.collapsed) { setTab(key); props.onCollapsedChange(false); return; }
              if (key === tab) { props.onCollapsedChange(true); return; }
              setTab(key);
            }}
          >
            {TAB_INFO[key].icon}
            <span>{TAB_INFO[key].label}</span>
          </button>
        ))}
      </nav>
      <div className="sp-body">
        {/* A name, not a lecture. Every tab used to open with a sentence
          * explaining what clicking does; the clicking explains itself, and
          * the sentence was costing four lines of the panel on every tab. */}
        <header className="sp-head">
          <h3>{info.title}</h3>
        </header>
        {tab === 'design' && <DesignTab {...props} />}
        {tab === 'text' && <TextTab {...props} />}
        {tab === 'elements' && <ElementsTab {...props} />}
        {tab === 'background' && <BackgroundTab {...props} />}
        {tab === 'brand' && <BrandTab {...props} />}
        {tab === 'uploads' && <UploadsTab {...props} />}
        {tab === 'draw' && <DrawTab {...props} />}
        {tab === 'projects' && <ProjectsTab {...props} />}
        {tab === 'apps' && <AppsTab {...props} />}
      </div>
    </div>
  );
}

function PhotosTab({
  libraryPhotos, photoFilter, unusedPhotoCount, usedPhotoIds, currentPhotoIds,
  selectedPhotoId, hasMorePhotos, onPhotoFilter, onChoosePhoto, onDragPhoto,
  onAddPhotos, onLoadMorePhotos, sheetLabel,
}: Props) {
  const sheet = sheetLabel ?? 'כפולה';
  const [query, setQuery] = useState('');
  const shown = query.trim()
    ? libraryPhotos.filter((photo) => photo.name.toLowerCase().includes(query.trim().toLowerCase()))
    : libraryPhotos;
  return (
    <div className="sp-photos-section">
      <input className="sp-search" type="search" placeholder="חיפוש בתמונות שהועלו" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button className="sp-photo-upload" onClick={onAddPhotos}>＋ הוספת תמונות</button>
      <div className="sp-photo-summary">
        <strong>{shown.length ? `${shown.length} מוצגות` : 'לא נמצאו תמונות'}</strong>
        <span>{unusedPhotoCount} לא שובצו</span>
      </div>
      <div className="sp-photo-filters" role="group" aria-label="סינון תמונות">
        {([
          ['all', 'הכול'],
          ['unused', 'לא שובצו'],
          ['current', sheetLabel === 'כריכה' ? 'בכריכה' : `ב${sheet}`],
        ] as const).map(([value, label]) => (
          <button key={value} className={photoFilter === value ? 'on' : ''} onClick={() => onPhotoFilter(value)}>{label}</button>
        ))}
      </div>
      <div className="sp-photo-grid">
        {shown.map((photo) => (
          <button
            key={photo.id}
            className={`sp-photo-thumb ${selectedPhotoId === photo.id ? 'selected' : ''}`}
            onClick={() => onChoosePhoto(photo.id)}
            aria-label={`בחר ${photo.name}`}
            title={`${photo.name} · לחיצה לשיבוץ או בחירה`}
            draggable
            onDragStart={(event) => onDragPhoto(event, photo.id)}
          >
            <img src={smallUrl(photo.url)} alt="" loading="lazy" decoding="async" />
            {usedPhotoIds.has(photo.id) && (
              <span className={`sp-photo-used ${currentPhotoIds.has(photo.id) ? 'current' : ''}`} title={currentPhotoIds.has(photo.id) ? `נמצאת ב${sheet}` : 'כבר שובצה באלבום'}>✓</span>
            )}
          </button>
        ))}
        {!shown.length && (
          <div className="sp-photo-empty">
            <strong>התמונות לא נעלמו</strong>
            <span>עברו ל״הכול״ או הוסיפו תמונות לפרויקט.</span>
            {photoFilter !== 'all' && <button onClick={() => onPhotoFilter('all')}>הצגת כל התמונות</button>}
          </div>
        )}
      </div>
      {hasMorePhotos && <button className="sp-photo-more" onClick={onLoadMorePhotos}>הצגת תמונות נוספות</button>}
    </div>
  );
}

function DesignTab(props: Props) {
  const [section, setSection] = useState<'templates' | 'styles'>('templates');
  const palettes = [
    ['נקי', ['#ffffff', '#111111', '#8b3dff']],
    ['חם', ['#f7f0e6', '#9b6b43', '#2e2118']],
    ['רומנטי', ['#fff5f7', '#d66b88', '#6f3045']],
    ['טבעי', ['#eef2e8', '#71805f', '#263421']],
    ['לילה', ['#17191f', '#c7a66a', '#f5f2ea']],
    ['ים', ['#eaf8f8', '#00a8b2', '#164c56']],
  ] as const;
  const applyPalette = (colors: readonly string[]) => {
    if (!props.template) return;
    props.template.colors.forEach((token, index) => props.onColor(token.id, colors[index % colors.length]));
    props.onEditEnd();
  };
  return (
    <div className="sp-section sp-design-section">
      <input className="sp-search" type="search" placeholder="חיפוש תבניות ופריסות" />
      <div className="sp-panel-tabs">
        <button className={section === 'templates' ? 'on' : ''} onClick={() => setSection('templates')}>תבניות</button>
        <button className={section === 'styles' ? 'on' : ''} onClick={() => setSection('styles')}>סגנונות</button>
      </div>
      {section === 'templates' ? (
        <TemplatePanel
          key={`${props.spread.id}-design`}
          section="page" spread={props.spread} photos={props.photos} spreadAspect={props.spreadAspect}
          template={props.template} onApply={props.onApply} onCycle={props.onCycle} onColor={props.onColor}
          onText={props.onText} onEditEnd={props.onEditEnd}
        />
      ) : (
        <div className="sp-style-grid">
          {palettes.map(([name, colors]) => (
            <button key={name} disabled={!props.template} onClick={() => applyPalette(colors)}>
              <i>{colors.map((color) => <b key={color} style={{ background: color }} />)}</i>
              <span>{name}</span>
            </button>
          ))}
          {!props.template && <p className="sp-note">בחרו תבנית כדי להחיל עליה סגנון צבעים.</p>}
        </div>
      )}
    </div>
  );
}

function BrandTab(props: Props) {
  return (
    <div className="sp-section sp-brand-section">
      <strong className="sp-sub">צבעי העיצוב</strong>
      <TemplatePanel
        section="colors" spread={props.spread} photos={props.photos} spreadAspect={props.spreadAspect}
        template={props.template} onApply={props.onApply} onCycle={props.onCycle} onColor={props.onColor}
        onText={props.onText} onEditEnd={props.onEditEnd} excludeBackground
      />
      <strong className="sp-sub">גופני מותג</strong>
      <div className="sp-brand-fonts">
        {props.userFonts.length ? props.userFonts.map((font) => <button key={font.family} style={{ fontFamily: `'${font.family}'` }}>{font.family}</button>) : <p className="sp-note">אפשר להעלות גופן בלשונית העלאות.</p>}
      </div>
    </div>
  );
}

function BackgroundTab(props: Props) {
  const [hex, setHex] = useState(props.background.toUpperCase());
  const [recent, setRecent] = useState<string[]>([]);
  const sheet = props.sheetLabel ?? 'כפולה';
  const templateColors = props.template && props.spread.templateInstance
    ? props.template.colors.map((token) => props.spread.templateInstance?.colors[token.id]).filter((color): color is string => Boolean(color))
    : [];
  const documentColors = Array.from(new Set([props.background, ...templateColors, '#FFFFFF', '#111111']));
  const suggested = ['#F8F6F1', '#F4EFE7', '#E9E2D8', '#C9BFB2', '#FFF5F7', '#EEF2E8', '#EAF8F8', '#DCE7F8', '#222326', '#111111'];

  useEffect(() => setHex(props.background.toUpperCase()), [props.background]);

  const choose = (color: string) => {
    const next = color.toUpperCase();
    setHex(next);
    setRecent((items) => [next, ...items.filter((item) => item !== next)].slice(0, 6));
    props.onBackground(next);
  };
  const applyHex = () => {
    const raw = hex.trim();
    const normalized = /^#[0-9a-f]{3}$/i.test(raw)
      ? `#${raw.slice(1).split('').map((char) => char + char).join('')}`
      : raw;
    if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
      setHex(props.background.toUpperCase());
      return;
    }
    choose(normalized);
  };
  const sampleScreen = async () => {
    const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropperCtor) return;
    try {
      const result = await new EyeDropperCtor().open();
      choose(result.sRGBHex);
    } catch {
      // Closing the browser's picker is a cancellation, not an error.
    }
  };

  const swatches = (colors: string[]) => (
    <div className="sp-background-swatches">
      {colors.map((color) => (
        <button
          key={color}
          className={color.toLowerCase() === props.background.toLowerCase() ? 'on' : ''}
          style={{ background: color }}
          aria-label={`בחירת רקע ${color}`}
          aria-pressed={color.toLowerCase() === props.background.toLowerCase()}
          onClick={() => choose(color)}
        >{color.toLowerCase() === props.background.toLowerCase() ? <span>✓</span> : null}</button>
      ))}
    </div>
  );

  return (
    <div className="sp-section sp-background-section">
      <div className="sp-background-current">
        <label className="sp-background-picker" title="בחירת צבע חופשית">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(props.background) ? props.background : '#ffffff'} onChange={(event) => choose(event.target.value)} />
          <i style={{ background: props.background }} />
        </label>
        <label className="sp-background-hex">
          <span>צבע נוכחי</span>
          <input
            value={hex}
            dir="ltr"
            maxLength={7}
            onChange={(event) => setHex(event.target.value)}
            onBlur={applyHex}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyHex(); } }}
            aria-label="קוד צבע הרקע"
          />
        </label>
      </div>

      <div className="sp-background-actions">
        <button onClick={() => choose('#FFFFFF')}>↶ איפוס ללבן</button>
        {'EyeDropper' in window && <button onClick={() => { void sampleScreen(); }}>⌖ דגימה מהמסך</button>}
      </div>

      <strong className="sp-sub">צבעים במסמך</strong>
      {swatches(documentColors)}
      <strong className="sp-sub">צבעים מוצעים</strong>
      {swatches(suggested)}
      {recent.length > 0 && <><strong className="sp-sub">בשימוש לאחרונה</strong>{swatches(recent)}</>}

      {sheet === 'כפולה' && (
        <div className="sp-background-all">
          <strong>רוצים רקע אחיד באלבום?</strong>
          <span>הצבע הנוכחי יוחל על כל הכפולות, כולל עמודים מהכספת.</span>
          <button onClick={() => props.onApplyBackgroundToAll(props.background)}>החל על כל הכפולות</button>
        </div>
      )}
      <p className="sp-note">הרקע נשמר באיכות מלאה ומופיע גם בקובצי ההגהה והדפוס.</p>
    </div>
  );
}

function DrawTab({ template, onAddElement }: Props) {
  const drawingTools = BASIC_ELEMENTS.filter((item) => item.kind === 'line' || item.kind === 'rect' || item.kind === 'ellipse');
  return (
    <div className="sp-section sp-draw-section">
      <NeedsPage template={template} />
      <div className="sp-draw-tools">
        {drawingTools.map((tool) => <button key={tool.id} disabled={!template} onClick={() => onAddElement(tool)}><ElementThumb element={tool} /><span>{tool.name}</span></button>)}
      </div>
      <strong className="sp-sub">צבע</strong>
      <div className="sp-draw-colors">{['#111111', '#ffffff', '#8b3dff', '#00c4cc', '#ff4d6d'].map((color) => <i key={color} style={{ background: color }} />)}</div>
      <label className="sp-draw-range"><span>עובי הקו</span><input type="range" min="1" max="40" defaultValue="8" /></label>
      <label className="sp-draw-range"><span>שקיפות</span><input type="range" min="10" max="100" defaultValue="100" /></label>
    </div>
  );
}

function ProjectsTab({ spreads, activeSpreadId, onOpenSpread, onAddSpread }: Props) {
  return (
    <div className="sp-section sp-projects-section">
      <input className="sp-search" type="search" placeholder="חיפוש בפרויקט" />
      <strong className="sp-sub">האלבום הזה</strong>
      <div className="sp-project-pages">
        {spreads.map((item, index) => (
          <button key={item.id} className={activeSpreadId === item.id ? 'on' : ''} onClick={() => onOpenSpread(index)}>
            <i style={{ background: item.background }} />
            <span>כפולה {index + 1}<small>עמודים {item.pageStart}–{item.pageStart + 1}</small></span>
          </button>
        ))}
      </div>
      <button className="sp-upload" onClick={onAddSpread}>＋ הוספת כפולה</button>
    </div>
  );
}

function AppsTab({ onAutoBuild, onPreview }: Props) {
  return (
    <div className="sp-section sp-apps-section">
      <input className="sp-search" type="search" placeholder="חיפוש כלים" />
      <div className="sp-app-grid">
        <button onClick={onAutoBuild}><b>✦</b><span>בנייה אוטומטית</span><small>סידור תמונות בכל האלבום</small></button>
        <button onClick={onPreview}><b>◫</b><span>תצוגה מקדימה</span><small>דפדוף לפני מסירה</small></button>
        <button onClick={() => onAutoBuild()}><b>▦</b><span>פריסה חכמה</span><small>התאמת עמודים לתמונות</small></button>
        <button onClick={onPreview}><b>✓</b><span>בדיקת דפוס</span><small>חיתוך, איכות ושוליים</small></button>
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

function UploadsTab(props: Props) {
  const { template, myElements, userFonts, onAddElement, onImportElements, onRemoveMine, onImportFonts } = props;
  const elementInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'images' | 'graphics' | 'fonts'>('images');
  return (
    <div className="sp-section sp-uploads-section">
      <div className="sp-upload-kinds" role="tablist">
        <button className={kind === 'images' ? 'on' : ''} onClick={() => setKind('images')}>תמונות</button>
        <button className={kind === 'graphics' ? 'on' : ''} onClick={() => setKind('graphics')}>גרפיקה</button>
        <button className={kind === 'fonts' ? 'on' : ''} onClick={() => setKind('fonts')}>גופנים</button>
      </div>
      {kind === 'images' && <PhotosTab {...props} />}
      {kind === 'graphics' && <>
      <button className="sp-upload" onClick={() => elementInput.current?.click()}>＋ העלאת PNG / SVG / WebP</button>
      <input
        ref={elementInput} type="file" multiple hidden
        accept=".png,.svg,.webp,image/png,image/svg+xml,image/webp"
        onChange={(event) => { if (event.target.files?.length) onImportElements(event.target.files); event.target.value = ''; }}
      />
      {myElements.length
        ? <ElementGrid elements={myElements} disabled={!template} onAdd={onAddElement} onRemove={onRemoveMine} />
        : <p className="sp-note">עוד לא הועלו קבצי גרפיקה.</p>}
      </>}

      {kind === 'fonts' && <>
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
      </>}
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
