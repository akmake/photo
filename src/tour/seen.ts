/* Which tours this photographer has already been through. A per-machine
 * convenience, so localStorage — and every access is guarded: a storage that
 * throws must cost a replayed tour, never a broken screen. */

const KEY = 'frameops.tours.seen';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function hasSeen(id: string): boolean {
  return read().includes(id);
}

/** Forget tours, so they offer themselves again on the next visit. No ids =
 *  every tour. */
export function forgetSeen(ids?: string[]): void {
  try {
    if (!ids) { localStorage.removeItem(KEY); return; }
    localStorage.setItem(KEY, JSON.stringify(read().filter((id) => !ids.includes(id))));
  } catch {
    /* nothing to forget in a storage that cannot be read */
  }
}

export function markSeen(id: string): void {
  try {
    const list = read();
    if (!list.includes(id)) localStorage.setItem(KEY, JSON.stringify([...list, id]));
  } catch {
    /* nothing to do: the tour simply offers itself again next time */
  }
}
