/* Read an edit: two frames in, a description of what the retoucher did out.
 *
 * The report is split the way the analysis is, because the two halves answer
 * different questions. The GLOBAL grade is what was done to the whole picture
 * and is the part that can become a recipe. The REGIONS are what was done by
 * hand to particular places, and no recipe covers those.
 */

import { useCallback, useRef, useState } from 'react';
import { compareImages, learnColorModel } from '../api';
import type { CompareResponse, CompareRegion, LearnColorResponse } from '../api';

const KIND_LABEL: Record<string, string> = {
  added: 'נוסף',
  removed: 'נעלם',
  changed: 'שונה',
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error('read failed'));
    fr.readAsDataURL(file);
  });
}

/** The grade, in the words a photographer would use for it. */
function gradeLines(g: CompareResponse['report']['global']): string[] {
  const out: string[] = [];
  const sign = (n: number) => (n > 0 ? '+' : '');
  if (Math.abs(g.exposureStops) > 0.04)
    out.push(`חשיפה ${sign(g.exposureStops)}${g.exposureStops.toFixed(2)} סטופ`);
  if (Math.abs(g.contrastSlope - 1) > 0.03)
    out.push(
      g.contrastSlope > 1
        ? `ניגודיות +${((g.contrastSlope - 1) * 100).toFixed(0)}%`
        : `ניגודיות ${((g.contrastSlope - 1) * 100).toFixed(0)}%`,
    );
  if (Math.abs(g.warmthShift) > 1)
    out.push(g.warmthShift > 0 ? `חימום ${g.warmthShift.toFixed(1)}` : `קירור ${Math.abs(g.warmthShift).toFixed(1)}`);
  if (Math.abs(g.tintShift) > 1)
    out.push(g.tintShift > 0 ? `גוון למג'נטה ${g.tintShift.toFixed(1)}` : `גוון לירוק ${Math.abs(g.tintShift).toFixed(1)}`);
  if (Math.abs(g.saturationRatio - 1) > 0.03)
    out.push(`רוויה ×${g.saturationRatio.toFixed(2)}`);
  if (Math.abs(g.shadowsShift) > 2)
    out.push(`צלליות ${sign(g.shadowsShift)}${g.shadowsShift.toFixed(0)}`);
  if (Math.abs(g.highlightsShift) > 2)
    out.push(`היילייטים ${sign(g.highlightsShift)}${g.highlightsShift.toFixed(0)}`);
  return out;
}

export default function Compare() {
  const [before, setBefore] = useState<{ name: string; url: string } | null>(null);
  const [after, setAfter] = useState<{ name: string; url: string } | null>(null);
  const [res, setRes] = useState<CompareResponse | null>(null);
  const [colour, setColour] = useState<LearnColorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [colourBusy, setColourBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'overlay' | 'before' | 'after' | 'learned'>('overlay');
  const [showWeak, setShowWeak] = useState(false);
  const [ms, setMs] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const pick = useCallback(
    async (which: 'before' | 'after', file: File) => {
      const url = await readFile(file);
      const entry = { name: file.name, url };
      if (which === 'before') setBefore(entry);
      else setAfter(entry);
      setRes(null);
      setColour(null);
      setError(null);
    },
    [],
  );

  const run = useCallback(async () => {
    if (!before || !after) return;
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      setRes(await compareImages(before.url, after.url));
      setMs(Math.round(performance.now() - t0));
    } catch (e) {
      setError((e as Error).message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  }, [before, after]);

  const learnColour = useCallback(async () => {
    if (!before || !after) return;
    setColourBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      const learned = await learnColorModel(before.url, after.url);
      setColour(learned);
      setView('learned');
      setMs(Math.round(performance.now() - t0));
    } catch (e) {
      setError((e as Error).message);
      setColour(null);
    } finally {
      setColourBusy(false);
    }
  }, [before, after]);

  const report = res?.report;
  const all: CompareRegion[] = report?.regions ?? [];
  const shown = showWeak ? all : all.filter((r) => r.strong);
  const grade = report ? gradeLines(report.global) : [];

  const src =
    view === 'before'
      ? before?.url
      : view === 'after'
        ? after?.url
        : view === 'learned'
          ? colour?.preview ?? before?.url
          : res?.overlay ?? after?.url;

  return (
    <div className="cmp">
      <aside className="cmp-side scroll-y">
        <h2>קריאת עריכה</h2>
        <p className="cmp-intro">
          שתי גרסאות של אותה תמונה — לפני ואחרי. המערכת מפרידה בין הגריידינג
          הכללי לבין עריכות מקומיות, ומדווחת מה נוסף, מה נעלם ומה שונה.
        </p>

        <div className="cmp-slots">
          <label className={`cmp-slot ${before ? 'on' : ''}`}>
            <span className="cmp-slot-tag">לפני</span>
            <span className="cmp-slot-name">{before?.name ?? 'בחר קובץ'}</span>
            <input type="file" accept="image/*" hidden
              onChange={(e) => e.target.files?.[0] && pick('before', e.target.files[0])} />
          </label>
          <label className={`cmp-slot ${after ? 'on' : ''}`}>
            <span className="cmp-slot-tag">אחרי</span>
            <span className="cmp-slot-name">{after?.name ?? 'בחר קובץ'}</span>
            <input type="file" accept="image/*" hidden
              onChange={(e) => e.target.files?.[0] && pick('after', e.target.files[0])} />
          </label>
        </div>

        <button className="btn btn-primary btn-wide" onClick={run}
          disabled={!before || !after || busy}>
          {busy ? 'מנתח…' : 'נתח את ההבדלים'}
        </button>
        <button className="btn btn-wide" onClick={learnColour}
          disabled={!before || !after || colourBusy}>
          {colourBusy ? 'לומד חוקי צבע…' : 'למד צבע והצג תוצאה'}
        </button>

        {error && <div className="lab-error">✗ {error}</div>}

        {colour && (
          <section className="cmp-block cmp-colour-result">
            <div className="spread">
              <h3>מודל צבע נלמד</h3>
              <span className={`cmp-model-state ${colour.report.safe ? 'safe' : 'unsafe'}`}>
                {colour.report.safe ? 'עבר בדיקה' : 'לא בטוח'}
              </span>
            </div>
            <div className="cmp-model-score">
              {Math.round(colour.report.gapClosed * 100)}%
              <span>מהפער נסגר</span>
            </div>
            <div className="cmp-note">
              {colour.report.samples.toLocaleString()} דגימות ·{' '}
              {colour.report.validationSamples.toLocaleString()} לבדיקה בלבד ·{' '}
              {colour.report.clusters} חוקי צבע · {colour.report.fitSeconds.toFixed(1)} שניות
            </div>
          </section>
        )}

        {report && (
          <>
            <section className="cmp-block">
              <h3>גריידינג כללי</h3>
              {grade.length === 0 ? (
                <div className="cmp-none">לא זוהה שינוי גלובלי — הצבע והטון זהים.</div>
              ) : (
                <ul className="cmp-grade">
                  {grade.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              )}
            </section>

            {report.geometry.method !== 'direct' && (
              <section className="cmp-block">
                <h3>גאומטריה</h3>
                <div className="cmp-note">
                  הפריים זז — סיבוב {report.geometry.rotationDeg}°, קנה מידה{' '}
                  {report.geometry.scale}. יושר לפני ההשוואה.
                </div>
              </section>
            )}

            <section className="cmp-block">
              <div className="spread">
                <h3>עריכות מקומיות</h3>
                <span className="muted">{ms}ms</span>
              </div>
              <div className="cmp-counts">
                <span className="cmp-pill added">{report.summary.added} נוספו</span>
                <span className="cmp-pill removed">{report.summary.removed} נעלמו</span>
                <span className="cmp-pill changed">{report.summary.changed} שונו</span>
              </div>

              <label className="lab-check" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={showWeak}
                  onChange={(e) => setShowWeak(e.target.checked)} />
                הצג גם ממצאים חלשים ({all.length - all.filter((r) => r.strong).length})
              </label>

              <ol className="cmp-list">
                {shown.map((r, i) => (
                  <li key={i} className={`cmp-item ${r.kind} ${hover === i ? 'hot' : ''}`}
                    onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <span className="cmp-idx">{i + 1}</span>
                    <div className="cmp-item-body">
                      <div className="cmp-item-head">
                        <strong>{KIND_LABEL[r.kind]}</strong>
                        {r.zone && <span className="cmp-zone">{r.zone}</span>}
                        {!r.strong && <span className="cmp-weak">חלש</span>}
                      </div>
                      <div className="cmp-item-facts">
                        {r.areaPct.toFixed(3)}% מהפריים · ΔE {r.meanDeltaE} ·
                        {' '}מבנה ×{r.structureRatio}
                      </div>
                    </div>
                  </li>
                ))}
                {shown.length === 0 && (
                  <div className="cmp-none">לא נמצאו עריכות מקומיות מובהקות.</div>
                )}
              </ol>
            </section>

            <details className="lab-step-more" style={{ marginInlineStart: 0 }}>
              <summary>נתונים גולמיים</summary>
              <pre>{JSON.stringify(report, null, 1)}</pre>
            </details>
          </>
        )}
      </aside>

      <section className="cmp-stage" ref={wrapRef}>
        {src ? (
          <img className="cmp-img" src={src} alt="" />
        ) : (
          <div className="cmp-placeholder">בחר תמונת לפני ותמונת אחרי</div>
        )}
        {(res || colour) && (
          <div className="cmp-viewbar">
            {res && (
              <button className={view === 'overlay' ? 'on' : ''} onClick={() => setView('overlay')}>
                מסומן
              </button>
            )}
            <button className={view === 'before' ? 'on' : ''} onClick={() => setView('before')}>
              לפני
            </button>
            {colour && (
              <button className={view === 'learned' ? 'on' : ''} onClick={() => setView('learned')}>
                נלמד
              </button>
            )}
            <button className={view === 'after' ? 'on' : ''} onClick={() => setView('after')}>
              אחרי
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
