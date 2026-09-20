// Thin client over the backend. In dev, /api is proxied to :8790 (vite.config).
// The session token lives in localStorage; every authed call carries it.

const BASE = '/api';
const TOKEN_KEY = 'teza_token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — session simply won't persist */
  }
}

async function req<T>(path: string, opts: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(BASE + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `שגיאה ${res.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data as T;
}

// ---- auth
export const api = {
  register: (email: string, password: string, name: string) =>
    req<{ token: string; email: string; name: string; is_admin: boolean }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify({ email, password, name }) },
    ),
  login: (email: string, password: string) =>
    req<{ token: string; email: string; name: string; is_admin: boolean }>(
      '/auth/login',
      { method: 'POST', body: JSON.stringify({ email, password }) },
    ),
  me: () => req<{ account: string; email: string; name: string; is_admin: boolean }>('/auth/me', {}, true),

  // ---- billing
  plans: () => req<{ plans: { id: string; name: string; price_ils: number; period: string }[]; dev: boolean }>('/billing/plans'),
  billingStatus: () => req<{ plan: string | null; status: string; current_period_end: string | null; is_current: boolean }>('/billing/status', {}, true),
  subscribe: (plan: string) => req('/billing/activate', { method: 'POST', body: JSON.stringify({ plan }) }, true),

  // ---- licenses / devices
  devices: () => req<{ max_devices: number; devices: { device_id: string; name: string; last_seen: string }[] }>('/licenses/devices', {}, true),

  // ---- galleries (photographer)
  galleries: () => req<{ galleries: { id: number; title: string; client_name: string; token: string; status: string; images: number }[] }>('/galleries', {}, true),
  createGallery: (title: string, client_name: string, access_code?: string) =>
    req<{ id: number; token: string; status: string }>('/galleries', { method: 'POST', body: JSON.stringify({ title, client_name, access_code }) }, true),

  // ---- client gallery (public, token + optional code)
  openGallery: (token: string, code?: string) =>
    req<{ title: string; client_name: string; images: { id: number; thumb_url: string | null; preview_url: string | null; selected: boolean; note: string }[] }>(
      `/g/${token}/open`, { method: 'POST', body: JSON.stringify({ code }) },
    ),
  selectImage: (token: string, image_id: number, selected: boolean, note: string, code?: string) =>
    req(`/g/${token}/select`, { method: 'POST', body: JSON.stringify({ image_id, selected, note, code }) }),
};

// The API returns storage URLs rooted at the backend origin (/galleries/asset/..).
// Through the dev proxy they must be prefixed with /api.
export function assetUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  return url.startsWith('http') ? url : BASE + url;
}
