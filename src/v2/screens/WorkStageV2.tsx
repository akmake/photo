/* שלב העבודה — the photographer decides what stays and what goes to the client.
 *
 * The engine (engine/triage.py) only SUGGESTS, and only against a twin: a frame
 * is proposed for removal when the same pose, shot again, is better — eyes open
 * where these are shut, sharp where this is soft. Flawless repeats are offered
 * as duplicates of the recommended frame. Nothing leaves the set until the
 * photographer says so, and his decision (project.json `cull`) is never
 * overwritten by a new analysis.
 *
 * Built for speed the way professional culling tools are judged: the picture
 * is on screen instantly, one key decides, the next frame follows, and every
 * suggestion shows its twin so the reason is visible, not asserted.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { thumbUrl, triageSet } from '../../api';
import type { Frame, TriageFrame, TriageResult } from '../../api';
import {
  batchOfFrame, frameKey, setCull, useBatches, useCull, useProjectFiles,
} from '../../studio/store';
import type { CullDecision, Project } from '../../studio/store';
import './stages-v2.css';
import './work-stage-v2.css';

type Filter = 'all' | 'remove' | 'duplicate' | 'rejected' | 'unread';

const POLL_MS = 3000;
const REASON_WORDS: Record<string, string> = {
  'eyes-shut': 'עיניים עצומות',
  soft: 'פחות חדה',
  duplicate: 'כמעט זהה',
  blown: 'הפריים שרוף',
  dark: 'הפריים חשוך',
  unread: 'לא ניתן לקרוא',
};

/** When a keyboard event carries no physical key (some input paths leave
 *  `code` empty), the letter decides — in English and on the Hebrew layout,
 *  where the same keys type ס ל ו ב ז. */
const KEY_TO_CODE: Record<string, string> = {
  x: 'KeyX', X: 'KeyX', 'ס': 'KeyX',
  k: 'KeyK', K: 'KeyK', 'ל': 'KeyK',
  u: 'KeyU', U: 'KeyU', 'ו': 'KeyU',
  c: 'KeyC', C: 'KeyC', 'ב': 'KeyC',
  g: 'KeyG', G: 'KeyG', 'ע': 'KeyG',
  z: 'KeyZ', Z: 'KeyZ', 'ז': 'KeyZ',
};

/** What the reason says about the twin, in the photographer's words. */
function twinLine(code: string): string {
  if (code === 'eyes-shut') return 'באותה תנוחה העיניים פתוחות';
  if (code === 'soft') return 'באותה תנוחה התמונה חדה יותר';
  if (code === 'duplicate') return 'התמונה המומלצת מהרצף';
  return '';
}

interface Undo {
  frames: string[];
  before: Record<string, CullDecision | undefined>;
  label: string;
}

export default function WorkStageV2({
  project,
  onNext,
  onBack,
}: {
  project: Project;
  onNext?: () => void;
  onBack?: () => void;
}) {
  const projectId = project.id;
  const { frames, ready } = useProjectFiles(projectId);
  const batches = useBatches(projectId);
  const cull = useCull(projectId);

  const [result, setResult] = useState<TriageResult | null>(null);
  const [fault, setFault] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [batch, setBatch] = useState<string>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [compare, setCompare] = useState(true);
  const [view, setView] = useState<'loupe' | 'grid'>('loupe');
  const [undo, setUndo] = useState<Undo | null>(null);
  const [aspect, setAspect] = useState(1.5);
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /* The stage fills the window below wherever the app's chrome ends, measured
   * rather than assumed: the top bar's height is not this screen's to know. */
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const place = () => {
      const el = rootRef.current;
      if (el) el.style.setProperty('--tz-ws-top', `${Math.max(0, Math.round(el.getBoundingClientRect().top))}px`);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  });

  /* ---- the engine's answer: asked once with `run`, then polled while the
   * background preparer is still measuring. A failed call is said as such —
   * the screen stays usable without suggestions, and never pretends the set
   * came back clean. */
  const paths = useMemo(() => frames.map((f) => f.path), [frames]);
  useEffect(() => {
    if (!ready || !paths.length) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (run: boolean) => {
      try {
        const r = await triageSet(paths, run);
        if (!alive) return;
        setResult(r);
        setFault(null);
        if (r.pending.length) timer = setTimeout(() => void ask(false), POLL_MS);
      } catch (e) {
        if (!alive) return;
        setFault(e instanceof Error ? e.message : 'המנוע לא ענה');
        timer = setTimeout(() => void ask(run), POLL_MS * 3);
      }
    };
    void ask(true);
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [ready, paths]);

  const byName = useMemo(() => {
    const m = new Map<string, TriageFrame>();
    for (const f of result?.frames ?? []) m.set(f.file, f);
    return m;
  }, [result]);
  const frameByName = useMemo(() => {
    const m = new Map<string, Frame>();
    for (const f of frames) m.set(frameKey(f.name), f);
    return m;
  }, [frames]);

  /* ---- the order the story happened in: analysed frames in capture order,
   * grouped by moment; frames still being read follow, as their own group. */
  const ordered = useMemo(() => {
    const known = (result?.frames ?? []).filter((t) => frameByName.has(t.file));
    const rest = frames
      .map((f) => frameKey(f.name))
      .filter((n) => !byName.has(n));
    return { known, rest };
  }, [result, frames, frameByName, byName]);

  const decisionOf = useCallback((name: string) => cull[name], [cull]);

  const matches = useCallback((name: string) => {
    if (batch !== 'all' && batchOfFrame(projectId, name) !== batch) return false;
    const t = byName.get(name);
    const d = decisionOf(name);
    switch (filter) {
      case 'remove': return t?.suggestion === 'remove' && d !== 'keep';
      case 'duplicate': return t?.suggestion === 'duplicate' && d !== 'keep';
      case 'rejected': return d === 'reject';
      case 'unread': return t?.suggestion === 'unread';
      default: return true;
    }
  }, [batch, byName, decisionOf, filter, projectId]);

  const moments = useMemo(() => {
    const groups: { key: string; title: string; names: string[] }[] = [];
    let cur: { key: string; title: string; names: string[] } | null = null;
    for (const t of ordered.known) {
      if (!matches(t.file)) continue;
      if (!cur || cur.key !== `m${t.moment}`) {
        cur = { key: `m${t.moment}`, title: `רגע ${t.moment + 1}`, names: [] };
        groups.push(cur);
      }
      cur.names.push(t.file);
    }
    const waiting = ordered.rest.filter(matches);
    if (waiting.length) groups.push({ key: 'pending', title: 'עדיין בניתוח', names: waiting });
    return groups;
  }, [ordered, matches]);

  const flat = useMemo(() => moments.flatMap((m) => m.names), [moments]);

  // Keep a selection that still exists in the current view.
  useEffect(() => {
    if (!flat.length) { setSel(null); return; }
    if (!sel || !flat.includes(sel)) setSel(flat[0]);
  }, [flat, sel]);

  /* ---- counts, for the filters and the way forward */
  const counts = useMemo(() => {
    let remove = 0; let duplicate = 0; let rejected = 0; let unread = 0;
    for (const f of frames) {
      const n = frameKey(f.name);
      const t = byName.get(n);
      const d = cull[n];
      if (d === 'reject') rejected += 1;
      if (t?.suggestion === 'remove' && d !== 'keep' && d !== 'reject') remove += 1;
      if (t?.suggestion === 'duplicate' && d !== 'keep' && d !== 'reject') duplicate += 1;
      if (t?.suggestion === 'unread') unread += 1;
    }
    return { remove, duplicate, rejected, unread, going: frames.length - rejected };
  }, [frames, byName, cull]);

  /* ---- deciding, with one level of undo that says what it undoes */
  const decide = useCallback((names: string[], decision: CullDecision | null, label: string) => {
    if (!names.length) return;
    const before: Record<string, CullDecision | undefined> = {};
    for (const n of names) before[n] = cull[n];
    setCull(projectId, names, decision);
    setUndo({ frames: names, before, label });
  }, [cull, projectId]);

  const undoLast = useCallback(() => {
    if (!undo) return;
    const back: Record<string, string[]> = { keep: [], reject: [], none: [] };
    for (const n of undo.frames) back[undo.before[n] ?? 'none'].push(n);
    setCull(projectId, back.keep, 'keep');
    setCull(projectId, back.reject, 'reject');
    setCull(projectId, back.none, null);
    setUndo(null);
  }, [projectId, undo]);

  const step = useCallback((delta: number) => {
    if (!flat.length) return;
    const i = sel ? flat.indexOf(sel) : -1;
    setSel(flat[Math.max(0, Math.min(flat.length - 1, i + delta))]);
  }, [flat, sel]);

  const decideAndAdvance = useCallback((decision: CullDecision | null) => {
    if (!sel) return;
    const words = decision === 'reject' ? 'הוצאה' : decision === 'keep' ? 'נשארת' : 'ההחלטה בוטלה';
    decide([sel], decision, `${sel} · ${words}`);
    // In a filtered view the frame may leave the list; step to what follows it.
    const i = flat.indexOf(sel);
    const next = flat[i + 1] ?? flat[i - 1] ?? null;
    if (decision !== null && next) setSel(next);
  }, [decide, flat, sel]);

  /* ---- the keyboard. By key POSITION (e.code), so the Hebrew layout works
   * the same as the English one. Arrow keys follow the page: in RTL the next
   * frame is to the LEFT. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      const code = e.code || KEY_TO_CODE[e.key] || e.key;
      if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); undoLast(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (code) {
        case 'ArrowLeft': case 'ArrowDown': e.preventDefault(); step(1); break;
        case 'ArrowRight': case 'ArrowUp': e.preventDefault(); step(-1); break;
        case 'KeyX': case 'Delete': e.preventDefault(); decideAndAdvance('reject'); break;
        case 'KeyK': case 'Enter': e.preventDefault(); decideAndAdvance('keep'); break;
        case 'KeyU': case 'Backspace': e.preventDefault(); decideAndAdvance(null); break;
        case 'KeyC': e.preventDefault(); setCompare((v) => !v); break;
        case 'KeyG': e.preventDefault(); setView((v) => (v === 'loupe' ? 'grid' : 'loupe')); break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decideAndAdvance, step, undoLast]);

  const selT = sel ? byName.get(sel) : undefined;
  const selFrame = sel ? frameByName.get(sel) : undefined;
  const twinRef = selT?.reasons.find((r) => r.ref)?.ref;
  const twinFrame = twinRef ? frameByName.get(twinRef) : undefined;
  const flaggedFace = selT?.reasons.find((r) => typeof r.face === 'number')?.face;
  const showTwin = Boolean(compare && twinFrame);

  const bulk = filter === 'remove' || filter === 'duplicate'
    ? flat.filter((n) => cull[n] !== 'reject' && cull[n] !== 'keep')
    : [];

  const analysed = result ? result.frames.length : 0;
  const pending = result ? result.pending.length : frames.length;

  // The loupe is sized in pixels from its own box: a picture that must fit a
  // height cannot be sized by percentages of a box whose height is its own.
  const loupeRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = loupeRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: Math.max(200, r.width), h: Math.max(160, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, ready]);
  // Two pictures go side by side or one above the other — whichever lets each
  // be LARGER in this box. A fixed rule by orientation lost half the screen.
  const fit = (w: number, h: number) => Math.max(40, Math.floor(Math.min(w, (h - 22) * aspect)));
  const sideW = fit((box.w - 12) / 2, box.h);
  const stackW = fit(box.w, (box.h - 12) / 2);
  const stack = showTwin && stackW > sideW;
  const imgW = showTwin ? Math.max(sideW, stackW) : fit(box.w, box.h);
  const imgH = Math.floor(imgW / aspect);

  // The filmstrip keeps the selected frame in view.
  useEffect(() => {
    if (sel) tileRefs.current[sel]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [sel, view]);

  if (!ready) {
    return <div className="tz-ws"><p className="tz-ws-muted">טוען את תיקיית הפרויקט…</p></div>;
  }

  const suggestion = selT && sel && !cull[sel] && (selT.suggestion === 'remove' || selT.suggestion === 'duplicate')
    ? selT : null;
  const mainReason = selT?.reasons.find((r) => r.code !== 'duplicate') ?? selT?.reasons[0];

  const tile = (n: string, big: boolean) => {
    const f = frameByName.get(n);
    if (!f) return null;
    const t = byName.get(n);
    const d = cull[n];
    const cls = [
      'tz-ws-tile', big ? 'is-big' : '',
      n === sel ? 'is-sel' : '',
      d === 'reject' ? 'is-out' : '',
      d === 'keep' ? 'is-kept' : '',
      !d && t?.suggestion === 'remove' ? 'is-suggest' : '',
      !d && t?.suggestion === 'duplicate' ? 'is-dup' : '',
    ].filter(Boolean).join(' ');
    return (
      <button
        key={n}
        ref={(el) => { tileRefs.current[n] = el; }}
        type="button"
        className={cls}
        onClick={() => setSel(n)}
        onDoubleClick={() => { setSel(n); setView('loupe'); }}
        title={n}
      >
        <img src={thumbUrl(f.path, 320)} alt="" loading="lazy" draggable={false} />
        {/* The mark sits UNDER the picture: a bar, never a badge on a face. */}
        <i className="tz-ws-mark" />
        {t?.star && <b className="tz-ws-star" title="התמונה המומלצת מהרצף">★</b>}
      </button>
    );
  };

  return (
    <div className="tz-ws" ref={rootRef}>
      {/* ---- one line: where we are, the views, the way on */}
      <header className="tz-ws-head">
        <div className="tz-ws-title">
          <strong>שלב העבודה</strong>
          <span className="tz-ws-muted">מה עולה ל{project.client || 'לקוח'} ומה יוצא</span>
        </div>
        <div className="tz-ws-filters" role="tablist">
          {([
            ['all', 'הכול', frames.length],
            ['remove', 'מוצע להסיר', counts.remove],
            ['duplicate', 'כפולות', counts.duplicate],
            ['rejected', 'הוצאו', counts.rejected],
            ...(counts.unread ? [['unread', 'לא נקראו', counts.unread] as const] : []),
          ] as [Filter, string, number][]).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              className={`tz-ws-filter${filter === id ? ' is-on' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label} <span className="tz-ws-num">{n.toLocaleString('he-IL')}</span>
            </button>
          ))}
          {batches.length > 0 && (
            <select className="tz-ws-batch" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="all">כל המקבצים</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button
            type="button"
            className="tz-ws-filter"
            onClick={() => setView((v) => (v === 'loupe' ? 'grid' : 'loupe'))}
            title="מעבר בין תמונה גדולה לרשת"
          >
            {view === 'loupe' ? 'רשת' : 'תמונה גדולה'} <kbd>G</kbd>
          </button>
        </div>
        <div className="tz-ws-way">
          {onBack && <button className="tz-btn-projects-secondary" type="button" onClick={onBack}>← מקבצים</button>}
          {onNext && (
            <button className="tz-btn-projects-primary" type="button" onClick={onNext}>
              לשליחה ללקוח · {counts.going.toLocaleString('he-IL')} ←
            </button>
          )}
        </div>
      </header>

      {/* ---- the tool, said out loud */}
      <div className="tz-ws-advice" aria-live="polite">
        {fault ? (
          <span className="tz-ws-fault">
            לא ניתן לקבל הצעות מהמנוע: {fault}. אפשר להחליט ידנית; ההצעות יופיעו כשהמנוע יחזור.
          </span>
        ) : frames.length === 0 ? (
          <span>אין עדיין תמונות בפרויקט — מייבאים קודם, והניתוח מתחיל מעצמו.</span>
        ) : !result ? (
          <span className="tz-ws-muted">פונה למנוע…</span>
        ) : (
          <>
            <span className="tz-ws-advice-text">
              {pending > 0 ? (
                <>
                  המערכת מנתחת את הצילום · {analysed.toLocaleString('he-IL')} מתוך {frames.length.toLocaleString('he-IL')}
                  <span className="tz-ws-bar"><i style={{ width: `${(analysed / frames.length) * 100}%` }} /></span>
                  {' '}עד עכשיו:
                </>
              ) : 'המערכת מציעה:'}
              {' '}<b>{counts.remove.toLocaleString('he-IL')}</b> להסרה (יש להן תאומה טובה יותר)
              {' · '}<b>{counts.duplicate.toLocaleString('he-IL')}</b> כפולות של תמונה מומלצת
            </span>
            {counts.remove > 0 && filter !== 'remove' && (
              <button type="button" className="tz-ws-go" onClick={() => { setFilter('remove'); setView('loupe'); }}>
                עבור על ההצעות להסרה
              </button>
            )}
            {counts.duplicate > 0 && filter !== 'duplicate' && (
              <button type="button" className="tz-ws-go is-soft" onClick={() => { setFilter('duplicate'); setView('loupe'); }}>
                עבור על הכפולות
              </button>
            )}
            {bulk.length > 0 && (
              <button
                type="button"
                className="tz-ws-go is-soft"
                onClick={() => decide(bulk, 'reject', `${bulk.length} הצעות התקבלו`)}
              >
                הוצא את כל {bulk.length.toLocaleString('he-IL')} שבתצוגה
              </button>
            )}
          </>
        )}
      </div>

      {view === 'grid' ? (
        <div className="tz-ws-gridview">
          {moments.length === 0 && <p className="tz-ws-muted tz-ws-empty">{emptyLine(filter, pending)}</p>}
          {moments.map((m) => (
            <section key={m.key} className="tz-ws-moment">
              <h3>{m.title} <span className="tz-ws-muted">· {m.names.length}</span></h3>
              <div className="tz-ws-tiles">{m.names.map((n) => tile(n, true))}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className="tz-ws-loupe-wrap">
          {/* ---- what the tool says about THIS frame, above the picture */}
          <div className={`tz-ws-verdict${suggestion?.suggestion === 'remove' ? ' is-remove' : ''}`}>
            {!sel || !selFrame ? (
              <span className="tz-ws-muted">{emptyLine(filter, pending)}</span>
            ) : cull[sel] ? (
              <span>
                <b>{cull[sel] === 'reject' ? 'הוצאה מהסט' : 'נשארת בסט'}</b>
                {' · '}<button type="button" className="tz-ws-link" onClick={() => decideAndAdvance(null)}>בטל החלטה (U)</button>
              </span>
            ) : !selT ? (
              <span className="tz-ws-muted">עוד לא נותחה</span>
            ) : suggestion && mainReason ? (
              <span>
                <b>{suggestion.suggestion === 'remove' ? 'מוצע להסיר' : 'כפולה'}: {REASON_WORDS[mainReason.code] ?? mainReason.label}</b>
                {mainReason.ref && <> — {twinLine(mainReason.code)}</>}
              </span>
            ) : selT.suggestion === 'unread' ? (
              <span className="tz-ws-fault">לא ניתן לקרוא את הקובץ</span>
            ) : (
              <span className="tz-ws-muted">{selT.star ? '★ התמונה המומלצת מהרצף שלה' : 'אין הצעה לתמונה הזו'}</span>
            )}
            {selFrame && (
              <span className="tz-ws-decide">
                <button type="button" className={`tz-ws-btn is-out${cull[sel!] === 'reject' ? ' is-on' : ''}`} onClick={() => decideAndAdvance('reject')}>
                  הוצא <kbd>X</kbd>
                </button>
                <button type="button" className={`tz-ws-btn is-keep${cull[sel!] === 'keep' ? ' is-on' : ''}`} onClick={() => decideAndAdvance('keep')}>
                  השאר <kbd>K</kbd>
                </button>
                {twinFrame && (
                  <button type="button" className={`tz-ws-btn${showTwin ? ' is-on' : ''}`} onClick={() => setCompare((v) => !v)}>
                    השוואה <kbd>C</kbd>
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="tz-ws-loupe">
            <div className={`tz-ws-stage${stack ? ' is-stack' : ''}`} ref={loupeRef}>
              {selFrame && (
                <figure>
                  <div className="tz-ws-imgbox" style={{ width: imgW, height: imgH }}>
                    <img
                      src={thumbUrl(selFrame.path, 1600)}
                      alt=""
                      draggable={false}
                      onLoad={(e) => {
                        const im = e.currentTarget;
                        if (im.naturalWidth && im.naturalHeight) setAspect(im.naturalWidth / im.naturalHeight);
                      }}
                    />
                    {typeof flaggedFace === 'number' && selT?.faces[flaggedFace] && (
                      <i
                        className="tz-ws-facebox"
                        style={{
                          left: `${selT.faces[flaggedFace].box.x * 100}%`,
                          top: `${selT.faces[flaggedFace].box.y * 100}%`,
                          width: `${selT.faces[flaggedFace].box.width * 100}%`,
                          height: `${selT.faces[flaggedFace].box.height * 100}%`,
                        }}
                      />
                    )}
                  </div>
                  <figcaption dir="ltr">{sel}</figcaption>
                </figure>
              )}
              {showTwin && twinFrame && (
                <figure>
                  <div className="tz-ws-imgbox" style={{ width: imgW, height: imgH }}>
                    <img src={thumbUrl(twinFrame.path, 1600)} alt="" draggable={false} />
                  </div>
                  <figcaption>
                    <span dir="ltr">{twinRef}</span> · התאומה הטובה יותר{' '}
                    <button type="button" className="tz-ws-link" onClick={() => setSel(twinRef!)}>עבור אליה</button>
                  </figcaption>
                </figure>
              )}
            </div>

            {selT && selT.faces.length > 0 && selFrame && (
              <FaceStrip src={thumbUrl(selFrame.path, 1600)} aspect={aspect} faces={selT.faces} flagged={flaggedFace} />
            )}
          </div>

          {/* ---- the whole set, moment by moment, along the bottom */}
          <div className="tz-ws-strip" role="listbox" aria-label="תמונות הצילום">
            {moments.map((m) => (
              <div key={m.key} className="tz-ws-strip-moment" title={m.title}>
                {m.names.map((n) => tile(n, false))}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="tz-ws-keys tz-ws-muted">
        חצים — הבאה/קודמת · X הוצא · K השאר · U בטל · C השוואה לתאומה · G רשת · Ctrl+Z ביטול הפעולה האחרונה
      </p>

      {undo && (
        <div className="tz-ws-toast" role="status">
          <span>{undo.label}</span>
          <button type="button" className="tz-ws-link" onClick={undoLast}>בטל</button>
          <button type="button" className="tz-ws-link" onClick={() => setUndo(null)} aria-label="סגור">✕</button>
        </div>
      )}
    </div>
  );
}

function emptyLine(filter: Filter, pending: number): string {
  if (filter === 'remove') return pending > 0 ? 'הניתוח עוד רץ — ההצעות יופיעו כאן.' : 'אין הצעות להסרה בתצוגה הזו.';
  if (filter === 'duplicate') return pending > 0 ? 'הניתוח עוד רץ — הכפולות יופיעו כאן.' : 'אין כפולות בתצוגה הזו.';
  if (filter === 'rejected') return 'עוד לא הוצאה אף תמונה.';
  return 'אין תמונות בתצוגה הזו.';
}

/** Every face in the frame, enlarged side by side — the view a photographer
 *  otherwise builds by zooming into each face in turn. Cropped from the same
 *  preview the large view shows, so nothing new is fetched. */
function FaceStrip({
  src, aspect, faces, flagged,
}: {
  src: string;
  aspect: number;
  faces: TriageFrame['faces'];
  flagged?: number;
}) {
  const shown = faces
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    .slice(0, 8);
  return (
    <div className="tz-ws-faces" aria-label="הפנים בתמונה">
      {shown.map((f) => {
        // A square window around the face, in the image's own proportions.
        const side = Math.max(f.box.width, f.box.height / aspect) * 1.5;
        const w = Math.min(1, side);
        const h = Math.min(1, side * aspect);
        const cx = f.box.x + f.box.width / 2;
        const cy = f.box.y + f.box.height / 2;
        const x = Math.max(0, Math.min(1 - w, cx - w / 2));
        const y = Math.max(0, Math.min(1 - h, cy - h / 2));
        return (
          <span
            key={f.i}
            className={`tz-ws-face${f.i === flagged ? ' is-flagged' : ''}`}
            style={{
              backgroundImage: `url("${src}")`,
              backgroundSize: `${100 / w}% ${100 / h}%`,
              backgroundPosition: `${w < 1 ? (x / (1 - w)) * 100 : 0}% ${h < 1 ? (y / (1 - h)) * 100 : 0}%`,
            }}
          />
        );
      })}
    </div>
  );
}
