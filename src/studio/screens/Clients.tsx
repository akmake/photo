/* לקוחות — the client ledger.
 *
 * Rebuilt in the instrument language and DERIVED from the project store, not a
 * separate demo array. The old screen was a generic table with status pills and
 * stat cards, running on its own list of names — so a client could read one way
 * here and another in פרויקטים, and the whole point of a client (their history,
 * their money) was nowhere.
 *
 * A client is one row: who they are, how much work they have brought, and what
 * they still owe. Rows are ordered by open balance — the business is run on who
 * owes, not on who is newest — and each opens the client's most recent project,
 * so the screen is never a dead end.
 */

import { useMemo, useState } from 'react';
import { useClientSummaries, useStudio } from '../store';
import { CannotRead, StillReading } from './Screens';

type Filter = 'all' | 'open' | 'returning';

export default function Clients({ onOpen }: { onOpen: (id: string) => void }) {
  const clients = useClientSummaries();
  const { status, fault } = useStudio();
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => ({
    all: clients.length,
    open: clients.filter((c) => c.open > 0).length,
    returning: clients.filter((c) => c.count > 1).length,
  }), [clients]);

  const shown = filter === 'open'
    ? clients.filter((c) => c.open > 0)
    : filter === 'returning'
      ? clients.filter((c) => c.count > 1)
      : clients;

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: 'הכול' },
    { id: 'open', label: 'חוב פתוח' },
    { id: 'returning', label: 'לקוחות חוזרים' },
  ];

  /* A client is DERIVED from the projects, so an unread studio produces an
   * empty client list that looks entirely convincing — including the money,
   * which would read as zero owed by everybody. */
  if (status === 'down') return <CannotRead what="את הלקוחות" fault={fault} />;
  if (status === 'loading' && clients.length === 0) {
    return <StillReading what="את הלקוחות" />;
  }

  return (
    <div className="pj">
      <header className="pj-head">
        <h1>לקוחות</h1>
        <span className="pj-total mono">{clients.length}</span>
      </header>

      <nav className="pj-filters" aria-label="סינון לקוחות">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`pj-filter ${f.id === filter ? 'on' : ''}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={f.id === filter}
          >
            {f.label}
            <span className="mono">{counts[f.id]}</span>
          </button>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="pj-empty">אין לקוחות בקטגוריה הזאת.</p>
      ) : (
        <ul className="cl-list">
          {shown.map((c) => (
            <li key={c.name}>
              <button className="cl-row" onClick={() => onOpen(c.latestId)}>
                <span className="cl-avatar" aria-hidden="true">{c.name.trim()[0] ?? '·'}</span>
                <span className="cl-main">
                  <b>
                    {c.name}
                    {c.count > 1 && <i className="cl-tag">לקוח חוזר</i>}
                  </b>
                  <span className="cl-sub">
                    {c.count} {c.count === 1 ? 'פרויקט' : 'פרויקטים'}
                    {c.active > 0 && <> · <span className="cl-active">{c.active} {c.active === 1 ? 'פעיל' : 'פעילים'}</span></>}
                    <i>·</i>
                    {c.lastEvent}
                    <i>·</i>
                    <span className="mono">{c.lastDate}</span>
                  </span>
                </span>
                <span className="cl-money">
                  <span className="cl-fig">
                    <b className="mono">₪{c.scope.toLocaleString('he-IL')}</b>
                    <span>היקף</span>
                  </span>
                  <span className={`cl-fig ${c.open > 0 ? 'due' : ''}`}>
                    <b className="mono">{c.open > 0 ? `₪${c.open.toLocaleString('he-IL')}` : '—'}</b>
                    <span>פתוח</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
