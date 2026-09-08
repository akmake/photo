/* The client gallery's whole conversation with the server.
 *
 * A separate app from the studio on purpose: this one is opened by the
 * photographer's client, on a phone, once. It shares the design tokens and
 * nothing else — none of the studio's screens, state or weight.
 */

export interface Album {
  id: string;
  name: string;
  quota: number;
  nameSetByClient: boolean;
}

export interface Note {
  id: string;
  text: string;
  /** normalised 0..1, so the pin means the same at every size the frame is
   *  ever shown at — and lands on the same spot in the photographer's studio */
  x: number;
  y: number;
  versionN: number;
  createdAt: number;
}

export interface Item {
  id: string;
  /* The average colour of the frame. Held in the cell until the image lands,
   * so a grid of 600 never jumps while it loads. Seven characters instead of
   * a blurred base64 thumbnail, which would be ~120KB of manifest before a
   * single photograph is fetched. */
  color: string;
  aspect: number;
  thumb: string;
  preview: string;
  version: number;
  albumIds: string[];
  clientDone: boolean;
  /** What they already asked for on this frame. Comes back with the gallery so
   *  that after a correction lands they can see it, instead of writing it
   *  again because they cannot remember whether it was sent. */
  notes: Note[];
}

/** The photographer's mark. Null when they have not uploaded one — the gallery
 *  lays out cleanly without it, and a stand-in would put a stranger's identity
 *  on someone's client-facing page. */
export interface Brand {
  logo: string;
  aspect: number;
}

export interface Manifest {
  gallery: { name: string; locked: boolean; albums: Album[]; brand: Brand | null };
  items: Item[];
}

/** What dresses the sign-in card, before anyone has a session. */
export const brandOf = (slug: string) =>
  call<{ name: string; brand: Brand | null; available: boolean }>(
    'GET', slug, 'brand', '',
  );

export interface AlbumFull {
  error: 'album_full';
  albumId: string;
  name: string;
  quota: number;
}

/* In development the gallery is served by Vite and the API is the engine on
 * its own port. Deployed, both come from the same origin and this is empty. */
const API = import.meta.env.DEV ? 'http://127.0.0.1:8756' : '';

/** The gallery's public id, from `?g=` or from a `/g/<slug>/` path. */
export function slugFromUrl(): string {
  const q = new URLSearchParams(location.search).get('g');
  if (q) return q;
  const m = location.pathname.match(/\/g\/([A-Za-z0-9]+)/);
  return m ? m[1] : '';
}

const tokenKey = (slug: string) => `teza.gallery.${slug}`;

export function savedToken(slug: string): string {
  try {
    return localStorage.getItem(tokenKey(slug)) || '';
  } catch {
    return ''; // private mode, blocked storage — sign in again, that is all
  }
}

export function saveToken(slug: string, token: string) {
  try {
    localStorage.setItem(tokenKey(slug), token);
  } catch {
    /* nothing to do: the session simply will not survive a reload */
  }
}

export function clearToken(slug: string) {
  try {
    localStorage.removeItem(tokenKey(slug));
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call<T>(
  method: 'GET' | 'POST',
  slug: string,
  action: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}/g/${slug}/${action}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-Gallery-Token': token } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    });
  } catch {
    /* A dead network and an empty gallery must never look the same. */
    throw new ApiError(0, null, 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : '') || `שגיאה ${response.status}`;
    throw new ApiError(response.status, payload, message);
  }
  return payload as T;
}

export const login = (slug: string, username: string, password: string) =>
  call<{ token: string }>('POST', slug, 'login', '', { username, password });

export const manifest = (slug: string, token: string) =>
  call<Manifest>('GET', slug, 'manifest', token);

export const select = (slug: string, token: string, itemId: string, albumIds: string[]) =>
  call<{ albumIds: string[] }>('POST', slug, 'select', token, { itemId, albumIds });

export const renameAlbum = (slug: string, token: string, albumId: string, name: string) =>
  call<{ albums: Album[] }>('POST', slug, 'album-name', token, { albumId, name });

export const lock = (slug: string, token: string) =>
  call<{ lockedAt: number }>('POST', slug, 'lock', token);

export const comment = (
  slug: string,
  token: string,
  itemId: string,
  x: number,
  y: number,
  text: string,
) => call<{ id: string; versionN: number }>('POST', slug, 'comment', token, {
  itemId, x, y, text,
});

export const markDone = (slug: string, token: string, itemId: string, done: boolean) =>
  call<{ clientDone: boolean }>('POST', slug, 'done', token, { itemId, done });
