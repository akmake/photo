/* צבעים שמורים — a colour learned in ColorMatch, kept by name so it can be laid
 * on any batch of any project without dragging the edited file in again and
 * without learning it again.
 *
 * Kept in the studio's own database (engine/db.py, collection "looks"), not in
 * the browser: a look is part of the photographer's work, and must still be
 * there after a reinstall or on the next machine.
 *
 * A read that fails is said as a failure — never shown as "no saved colours".
 */

import { useCallback, useEffect, useState } from 'react';
import { dbDelete, dbFind, dbSave } from '../db';
import type { LearnedColorModel } from '../types';

export interface SavedLook {
  id: string;
  name: string;
  model: LearnedColorModel;
  createdAt: number;
  /** How close the learning came to the edit it was taught, 0..100. */
  score?: number;
  /** The photograph it was learned from, for the photographer's memory. */
  learnedFrom?: string;
}

export interface LooksState {
  status: 'reading' | 'ready' | 'down';
  looks: SavedLook[];
  error: string | null;
  save: (name: string, model: LearnedColorModel, extra?: { score?: number; learnedFrom?: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// One list for every screen that shows it, read once per session.
let cache: SavedLook[] | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function useLooks(): LooksState {
  const [, bump] = useState(0);
  const [status, setStatus] = useState<LooksState['status']>(cache ? 'ready' : 'reading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (!cache) {
      dbFind<SavedLook>('looks')
        .then((docs) => {
          cache = docs.sort((a, b) => b.createdAt - a.createdAt);
          setStatus('ready');
          notify();
        })
        .catch((e) => {
          setStatus('down');
          setError(e instanceof Error ? e.message : 'לא ניתן לקרוא את הצבעים השמורים');
        });
    }
    return () => { listeners.delete(fn); };
  }, []);

  const save = useCallback(async (name: string, model: LearnedColorModel, extra?: { score?: number; learnedFrom?: string }) => {
    const trimmed = name.trim() || 'צבע ללא שם';
    // The same name replaces the old look rather than keeping two of it.
    const existing = (cache ?? []).find((l) => l.name === trimmed);
    const look: SavedLook = {
      id: existing?.id ?? `look-${Date.now().toString(36)}`,
      name: trimmed,
      model,
      createdAt: Date.now(),
      ...extra,
    };
    await dbSave('looks', look);
    cache = [look, ...(cache ?? []).filter((l) => l.id !== look.id)];
    setStatus('ready');
    setError(null);
    notify();
  }, []);

  const remove = useCallback(async (id: string) => {
    await dbDelete('looks', id);
    cache = (cache ?? []).filter((l) => l.id !== id);
    notify();
  }, []);

  return { status: cache ? 'ready' : status, looks: cache ?? [], error, save, remove };
}
