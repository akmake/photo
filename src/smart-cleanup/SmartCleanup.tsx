import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpotCandidate, SpotDetection } from '../api';
import {
  analyzeSmartCleanup,
  applySmartCleanup,
  DEFAULT_SMART_CLEANUP_SETTINGS,
  smartCleanupAvailable,
} from './model';
import type { SmartCleanupSettings } from './model';
import './smart-cleanup.css';

type Phase = 'empty' | 'scanning' | 'cleaning' | 'ready' | 'error';
type View = 'result' | 'original';

interface LoadedImage {
  name: string;
  src: string;
  width: number;
  height: number;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ'));
    reader.readAsDataURL(file);
  });
}

function measure(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('לא ניתן לפענח את התמונה'));
    image.src = src;
  });
}

function candidatePath(item: SpotCandidate, width: number, height: number): string {
  return item.contours
    .map((ring) => `M${ring.map(([x, y]) => `${x * width} ${y * height}`).join('L')}Z`)
    .join(' ');
}

function verdictLabel(item: SpotCandidate): string {
  if (item.verdict === 'heal') return item.kind === 'debris' ? 'לכלוך בטוח' : 'כתם בטוח';
  if (item.verdict === 'line') return 'דומה לקו או שיער';
  if (item.verdict === 'shading') return 'דומה להצללה טבעית';
  return 'גדול מדי לניקוי אוטומטי';
}

export default function SmartCleanup() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [analysis, setAnalysis] = useState<SpotDetection | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const settings = DEFAULT_SMART_CLEANUP_SETTINGS;
  const [phase, setPhase] = useState<Phase>('empty');
  const [view, setView] = useState<View>('result');
  const [showMarks, setShowMarks] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<boolean | null>(null);
  const [meta, setMeta] = useState<Record<string, number | string>>({});
  const sequence = useRef(0);

  useEffect(() => {
    smartCleanupAvailable().then(setEngine);
  }, []);

  const apply = useCallback(async (
    loaded: LoadedImage,
    detection: SpotDetection,
    chosen: Set<string>,
    currentSettings: SmartCleanupSettings,
  ) => {
    const run = ++sequence.current;
    setPhase('cleaning');
    setError(null);
    try {
      const cleaned = await applySmartCleanup(loaded.src, detection, chosen, currentSettings);
      if (run !== sequence.current) return;
      setResult(cleaned.image);
      setMeta(cleaned.meta);
      setView('result');
      setStale(false);
      setPhase('ready');
    } catch (cause) {
      if (run !== sequence.current) return;
      setError(`הניקוי נכשל: ${(cause as Error).message}`);
      setPhase('error');
    }
  }, []);

  const scan = useCallback(async (
    loaded: LoadedImage,
    currentSettings: SmartCleanupSettings,
  ) => {
    const run = ++sequence.current;
    setPhase('scanning');
    setError(null);
    setAnalysis(null);
    setResult(null);
    setMeta({});
    try {
      const found = await analyzeSmartCleanup(loaded.src, currentSettings);
      if (run !== sequence.current) return;
      setAnalysis(found.detection);
      setSelected(found.suggested);
      setStale(false);
      await apply(loaded, found.detection, found.suggested, currentSettings);
    } catch (cause) {
      if (run !== sequence.current) return;
      setError(`הסריקה נכשלה: ${(cause as Error).message}`);
      setPhase('error');
    }
  }, [apply]);

  const load = useCallback(async (file: File) => {
    const run = ++sequence.current;
    setResult(null);
    setAnalysis(null);
    setSelected(new Set());
    setMeta({});
    setStale(false);
    setPhase('scanning');
    setError(null);
    try {
      const src = await readFile(file);
      const dimensions = await measure(src);
      if (run !== sequence.current) return;
      const loaded = { name: file.name, src, ...dimensions };
      setImage(loaded);
      await scan(loaded, settings);
    } catch (cause) {
      if (run !== sequence.current) return;
      setError((cause as Error).message);
      setPhase('error');
    }
  }, [scan, settings]);

  const safeItems = analysis?.items.filter((item) => item.verdict === 'heal') ?? [];
  const reviewItems = analysis?.items.filter((item) => item.verdict !== 'heal') ?? [];
  const selectedItems = analysis?.items.filter((item) => selected.has(item.id)) ?? [];
  const visibleSrc = view === 'original' || !result ? image?.src : result;
  const busy = phase === 'scanning' || phase === 'cleaning';

  const summary = useMemo(() => {
    if (!analysis) return 'ממתין לתמונה';
    if (analysis.faces === 0) return 'לא נמצאו פנים מתאימות לניקוי';
    return `${analysis.faces} ${analysis.faces === 1 ? 'פנים' : 'פנים'} · ${safeItems.length} בטוחים · ${reviewItems.length} לבדיקה`;
  }, [analysis, reviewItems.length, safeItems.length]);

  function toggleCandidate(id: string) {
    if (busy) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStale(true);
  }

  function download() {
    if (!image || !result) return;
    const anchor = document.createElement('a');
    anchor.href = result;
    anchor.download = `${image.name.replace(/\.[^.]+$/, '')}-smart-clean.jpg`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  if (!image) {
    return (
      <main className="smart-cleanup smart-cleanup-empty" data-surface="studio">
        <section className="sc-intro rise">
          <div className="sc-kicker"><span className="dot-live" /> מנוע מקומי משולב</div>
          <h1>ניקוי חכם</h1>
          <p>
            בוחרים תמונה והניקוי מתחיל אוטומטית. המערכת מאתרת כתמים ומטפלת בהם,
            תוך שמירה על מרקם העור. בסיום אפשר להשוות למקור ולשמור את התוצאה.
          </p>
          <div className="sc-pipeline" aria-label="שלבי הניקוי">
            <span><b>01</b> זיהוי פנים ועור</span>
            <span><b>02</b> איתור חריגות</span>
            <span><b>03</b> מסכה מדויקת</span>
            <span><b>04</b> שחזור טקסטורה</span>
          </div>
          <label className="btn btn-primary sc-pick">
            בחר תמונה לניקוי אוטומטי
            <input type="file" accept="image/*" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file);
            }} />
          </label>
          <div className={`sc-engine ${engine === false ? 'bad' : ''}`}>
            <span />
            {engine === null ? 'בודק מנוע מקומי…' : engine ? 'המנוע המקומי מוכן' : 'המנוע המקומי אינו מחובר'}
          </div>
          {error && <div className="sc-error" role="alert">{error}</div>}
          <small>AI עשוי לטעות בין פצע, שומה, נמש או צלקת. ממצאים לא בטוחים נשארים ללא שינוי.</small>
        </section>
      </main>
    );
  }

  return (
    <main className="smart-cleanup" data-surface="studio">
      <header className="sc-head">
        <div>
          <div className="sc-kicker"><span className={busy ? 'dot-live' : ''} /> ניקוי חכם מקומי</div>
          <h1>{image.name}</h1>
          <p>{busy ? (phase === 'scanning' ? 'מאתר עור וכתמים…' : 'משחזר טקסטורה רק בתוך המסכות…') : summary}</p>
        </div>
        <div className="sc-head-actions">
          <label className="btn btn-ghost">
            תמונה אחרת
            <input type="file" accept="image/*" hidden onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void load(file);
            }} />
          </label>
          <button className="btn" disabled={!result || busy || stale} onClick={download}>הורד תוצאה</button>
        </div>
      </header>

      <div className="sc-workspace">
        <section className="sc-stage" aria-label="תצוגת תמונה וסימוני ניקוי">
          <div className="sc-image-wrap">
            {visibleSrc && <img src={visibleSrc} alt={view === 'original' ? 'התמונה המקורית' : 'תוצאת הניקוי'} />}
            {showMarks && analysis && (
              <svg viewBox={`0 0 ${analysis.width} ${analysis.height}`} preserveAspectRatio="xMidYMid meet" aria-label="מסכות שזוהו">
                {analysis.items.map((item) => {
                  const chosen = selected.has(item.id);
                  return (
                    <path
                      key={item.id}
                      d={candidatePath(item, analysis.width, analysis.height)}
                      className={chosen ? 'chosen' : item.verdict === 'heal' ? 'spared' : 'review'}
                      onClick={() => toggleCandidate(item.id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${verdictLabel(item)} — ${chosen ? 'ייבחר לניקוי' : 'יישמר'}`}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') toggleCandidate(item.id);
                      }}
                    />
                  );
                })}
              </svg>
            )}
          </div>
          {busy && <div className="sc-processing"><span className="dot-live" />{phase === 'scanning' ? 'סורק' : 'מנקה'}</div>}
          <div className="sc-viewbar">
            <div className="sc-segmented">
              <button className={view === 'original' ? 'on' : ''} onClick={() => setView('original')}>מקור</button>
              <button className={view === 'result' ? 'on' : ''} onClick={() => setView('result')} disabled={!result}>תוצאה</button>
            </div>
            <label><input type="checkbox" checked={showMarks} onChange={(event) => setShowMarks(event.target.checked)} /> הצג מסכות</label>
          </div>
        </section>

        <aside className="sc-panel scroll-y">
          <section className="sc-status-card">
            <div className="spread"><span className="label">מצב</span><span className={`pill ${error ? 'pill-run' : result ? 'pill-ok' : 'pill-idle'}`}>{error ? 'נדרש טיפול' : result ? 'נוקה' : 'בבדיקה'}</span></div>
            <div className="sc-figures">
              <div><strong>{analysis?.faces ?? '—'}</strong><span>פנים</span></div>
              <div><strong>{selectedItems.length}</strong><span>לניקוי</span></div>
              <div><strong>{reviewItems.length}</strong><span>נשמרו לבדיקה</span></div>
            </div>
            {stale && <p className="sc-stale">הבחירה השתנתה. עדכן את התוצאה.</p>}
            <button
              className="btn btn-primary btn-wide"
              disabled={!analysis || busy || (!!result && !stale)}
              onClick={() => void apply(image, analysis!, selected, settings)}
            >
              {result ? `עדכן ניקוי · ${selectedItems.length} אזורים` : `נקה ${selectedItems.length} אזורים`}
            </button>
            <button className="btn btn-ghost btn-wide" disabled={busy} onClick={() => void scan(image, settings)}>סרוק ונקה מחדש</button>
          </section>

          <details className="sc-findings">
            <summary>בדיקה ותיקון של אזורים</summary>
            <div className="spread"><h2>ממצאים</h2><span className="label">לחיצה משנה החלטה</span></div>
            {!analysis?.items.length && !busy && <p className="muted">לא נמצאו כתמים נקודתיים. ייתכן שעדיין בוצע איזון אדמומיות עדין.</p>}
            {analysis?.items.map((item, index) => {
              const chosen = selected.has(item.id);
              return (
                <button key={item.id} className={`sc-finding ${chosen ? 'on' : ''}`} disabled={busy} onClick={() => toggleCandidate(item.id)}>
                  <span className={`sc-find-dot ${item.verdict === 'heal' ? 'safe' : 'review'}`} />
                  <span><b>ממצא {index + 1}</b><small>{verdictLabel(item)}</small></span>
                  <strong>{chosen ? 'נקה' : 'שמור'}</strong>
                </button>
              );
            })}
          </details>

          {Object.keys(meta).length > 0 && (
            <section className="sc-report">
              <h2>דוח מנוע</h2>
              <p>{Number(meta.spotsRemoved ?? selectedItems.length)} אזורים דווחו כשטופלו.</p>
            </section>
          )}
          {error && <div className="sc-error" role="alert">{error}</div>}
          <p className="sc-disclaimer">המערכת פועלת מקומית ושומרת על ממצאים לא בטוחים. עדיין מומלץ לבדוק שומות, נמשים וצלקות לפני מסירה.</p>
        </aside>
      </div>
    </main>
  );
}

