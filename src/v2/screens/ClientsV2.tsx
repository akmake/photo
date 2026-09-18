/* לקוחות.
 *
 * A client is not a record anyone types. It is what you get when you group the
 * projects by the name on them — so there is one source of truth for who your
 * clients are, and a client cannot read one way here and another in פרויקטים.
 * See studio/store.ts::clientSummaries.
 *
 * The order is by open balance, because the business is run on who owes, not
 * on who is newest. Every row opens that client's most recent job, so the
 * screen is never a dead end.
 *
 * An unread studio produces an empty client list that looks entirely
 * convincing — including the money, which would read as nobody owing anything.
 * So the three states are kept apart: reading, unreadable, and genuinely empty.
 */

import React, { useMemo, useState } from 'react';
import { useClientSummaries, useStudio } from '../../studio/store';
import { TzIconSearch, TzIconUsers } from '../TzIcons';
/* The search box and the filter pills are the ones פרויקטים already uses —
 * imported by name so this screen does not silently depend on another one
 * having been opened first. */
import './projects-redesign.css';
import './today-redesign.css';
import './business-v2.css';

type Filter = 'all' | 'open' | 'returning';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'הכול' },
  { id: 'open', label: 'חוב פתוח' },
  { id: 'returning', label: 'לקוחות חוזרים' },
];

export default function ClientsV2({
  onOpenProject,
}: {
  onOpenProject: (id: string, stage?: string) => void;
}) {
  const clients = useClientSummaries();
  const { status, fault } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const counts = useMemo(() => ({
    all: clients.length,
    open: clients.filter((c) => c.open > 0).length,
    returning: clients.filter((c) => c.count > 1).length,
  }), [clients]);

  const shown = useMemo(() => {
    let list = filter === 'open'
      ? clients.filter((c) => c.open > 0)
      : filter === 'returning'
        ? clients.filter((c) => c.count > 1)
        : clients;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q)
          || (c.phone ?? '').includes(q)
          || (c.email ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [clients, filter, search]);

  const totalScope = clients.reduce((sum, c) => sum + c.scope, 0);
  const totalOpen = clients.reduce((sum, c) => sum + c.open, 0);

  if (status === 'down') {
    return (
      <div className="tz-biz-container">
        <div className="tz-biz-fault">
          <h2>לא ניתן לקרוא את הלקוחות</h2>
          <p>{fault || 'המנוע המקומי אינו עונה.'}</p>
          <small>זה לא אומר שאין לקוחות — זה אומר שלא הצלחנו לקרוא אותם.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="tz-biz-container">
      <section className="tz-biz-head">
        <div>
          <div className="tz-biz-eyebrow">ספר הלקוחות</div>
          <h1>לקוחות</h1>
          <p>כל מי שצילמת עבורו, כמה עבודה הביא וכמה הוא עדיין חייב.</p>
        </div>
        <div className="tz-biz-head-figures">
          <div>
            <small>היקף כולל</small>
            <strong>₪{totalScope.toLocaleString('he-IL')}</strong>
          </div>
          <div className={totalOpen > 0 ? 'is-due' : ''}>
            <small>פתוח לגבייה</small>
            <strong>₪{totalOpen.toLocaleString('he-IL')}</strong>
          </div>
        </div>
      </section>

      <div className="tz-biz-toolbar">
        <div className="tz-psearch-box">
          <TzIconSearch size={15} />
          <input
            type="text"
            className="tz-psearch-input"
            placeholder="חיפוש לפי שם, טלפון או מייל..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="tz-psearch-clear" type="button" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
        <div className="tz-pfilter-pills">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`tz-pfilter-pill ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
            >
              {f.label} <span>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="tz-biz-empty">
          <span className="tz-biz-empty-icon"><TzIconUsers size={22} /></span>
          <h3>{status === 'loading' ? 'קוראים את הלקוחות…' : 'אין כאן לקוחות'}</h3>
          <p>
            {status === 'loading'
              ? 'רגע אחד.'
              : search || filter !== 'all'
                ? 'אף לקוח לא תואם את מה שסימנת.'
                : 'לקוח נוצר יחד עם הפרויקט הראשון שפותחים עבורו.'}
          </p>
        </div>
      ) : (
        <ul className="tz-client-list">
          {shown.map((c) => (
            <li key={c.name}>
              <div className="tz-client-row">
                <button
                  type="button"
                  className="tz-client-open"
                  onClick={() => onOpenProject(c.latestId)}
                  title={`פתיחת הפרויקט האחרון של ${c.name}`}
                >
                  <span className="tz-client-avatar" aria-hidden>{c.name.trim().charAt(0) || '·'}</span>
                  <span className="tz-client-main">
                    <strong>
                      {c.name}
                      {c.count > 1 && <i className="tz-client-tag">לקוח חוזר</i>}
                    </strong>
                    <small>
                      {c.count} {c.count === 1 ? 'פרויקט' : 'פרויקטים'}
                      {c.active > 0 && <> · <b>{c.active} בעבודה</b></>}
                      {' · '}{c.lastEvent} · {c.lastDate}
                    </small>
                  </span>
                </button>

                {/* The two things you do with a client between shoots. Absent
                    rather than empty: a dead call button is worse than none. */}
                <div className="tz-client-contact">
                  {c.phone ? (
                    <a className="tz-client-chip" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} dir="ltr">
                      {c.phone}
                    </a>
                  ) : (
                    <span className="tz-client-chip is-missing">אין טלפון</span>
                  )}
                  {c.email ? (
                    <a className="tz-client-chip" href={`mailto:${c.email}`} dir="ltr">
                      {c.email}
                    </a>
                  ) : (
                    <span className="tz-client-chip is-missing">אין מייל</span>
                  )}
                </div>

                <div className="tz-client-money">
                  <span>
                    <b>₪{c.scope.toLocaleString('he-IL')}</b>
                    <small>היקף</small>
                  </span>
                  <span className={c.open > 0 ? 'is-due' : ''}>
                    <b>{c.open > 0 ? `₪${c.open.toLocaleString('he-IL')}` : '—'}</b>
                    <small>פתוח</small>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
