/* The studio's records, over the engine, in MongoDB.
 *
 * The browser cannot speak to a database, and it should not hold the studio
 * either: everything here used to live in localStorage, which meant one key in
 * one browser profile with no backup and no way to move machines. Clearing
 * site data deleted the business. See engine/db.py.
 *
 * The photographs are NOT here and never will be — an album stores the path to
 * a frame, the engine serves its pixels from disk. The database holds what is
 * known ABOUT the work; the disk holds the work.
 */

const ENGINE = 'http://127.0.0.1:8756';

/** A collection the engine will address. Anything else is rejected there. */
export type Collection = 'projects' | 'folders' | 'photoStatus' | 'albums';

/** The database could not be reached.
 *
 * This is a DIFFERENT thing from "there is nothing saved", and the two must
 * never collapse into one: an empty studio is a fact, an unreachable database
 * is a fault, and showing the first when the second is true tells a
 * photographer their work is gone. */
export class DatabaseDown extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseDown';
  }
}

async function call<T>(action: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ENGINE}/db/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // the engine itself is not running — same consequence for the screen
    throw new DatabaseDown('המנוע המקומי אינו פועל');
  }
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (parsed as { error?: string })?.error ?? `engine ${response.status}`;
    if (response.status === 503) throw new DatabaseDown(detail);
    throw new Error(detail);
  }
  return parsed as T;
}

export interface DbHealth {
  ok: boolean;
  db: string;
  uri: string;
  counts?: Record<string, number>;
  error?: string;
}

export async function dbHealth(): Promise<DbHealth> {
  try {
    const response = await fetch(`${ENGINE}/db/health`);
    return await response.json() as DbHealth;
  } catch {
    return { ok: false, db: 'teza', uri: '', error: 'המנוע המקומי אינו פועל' };
  }
}

/** Every document in a collection, or those matching a filter. */
export async function dbFind<T>(
  collection: Collection,
  where?: Record<string, unknown>,
): Promise<T[]> {
  const { docs } = await call<{ docs: T[] }>('find', { collection, where });
  return docs;
}

/** Insert or replace one document, keyed by its own `id`. */
export async function dbSave<T extends { id: string }>(
  collection: Collection,
  doc: T,
): Promise<void> {
  await call('save', { collection, doc });
}

export async function dbSaveMany<T extends { id: string }>(
  collection: Collection,
  docs: T[],
): Promise<void> {
  if (!docs.length) return;
  await call('save-many', { collection, docs });
}

export async function dbDelete(collection: Collection, id: string): Promise<void> {
  await call('delete', { collection, id });
}

export async function dbDeleteWhere(
  collection: Collection,
  where: Record<string, unknown>,
): Promise<void> {
  await call('delete-where', { collection, where });
}

/** Move records saved in the browser into the database, without overwriting
 *  anything already there. See engine/db.py::import_once. */
export async function dbImport(
  collections: Partial<Record<Collection, unknown[]>>,
): Promise<Record<string, { imported: number; skipped: number; alreadyThere: number }>> {
  const { report } = await call<{
    report: Record<string, { imported: number; skipped: number; alreadyThere: number }>;
  }>('import', { collections });
  return report;
}
