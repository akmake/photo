interface GalleryDesktopBridge {
  openExternal?: (url: string) => void;
}

interface GalleryWindow extends Window {
  teza?: GalleryDesktopBridge;
}

/* Where a client opens a gallery: the WEBSITE. The gallery moved there from
 * this app on 24.09.2026 (ManagPhoto repo, client/src/gallery). The address is
 * not baked in — it is the same site the app uses for its license, and it can
 * move (electron/serverOrigin.cjs) — so the engine is asked once at start
 * (engine/gallery_remote.py, action "site"). Until it answers there is no link,
 * rather than a convincing-looking wrong one. */

const ENGINE = 'http://127.0.0.1:8756';
let siteOrigin: string | null = null;
let loading: Promise<void> | null = null;

export function loadGallerySite(): Promise<void> {
  loading ??= load().finally(() => { loading = null; });
  return loading;
}

async function load(): Promise<void> {
  try {
    const response = await fetch(`${ENGINE}/api/gallery/site`, { cache: 'no-store' });
    if (!response.ok) return;
    const { origin } = await response.json() as { origin?: string };
    if (origin && /^https?:\/\//.test(origin)) siteOrigin = origin.replace(/\/$/, '');
  } catch {
    /* engine not up yet: the link stays unavailable, never a wrong one */
  }
}

/** The link the photographer sends, or null while the site address is unknown. */
export function galleryPublicUrl(slug: string): string | null {
  // Not known yet (the engine was still starting, or the license not yet
  // active): ask again in the background; the gallery screens re-render as
  // they poll the client's progress, and pick it up then.
  if (!siteOrigin) void loadGallerySite();
  return siteOrigin ? `${siteOrigin}/g/${encodeURIComponent(slug)}` : null;
}

/** Open the exact page the client will see, in the real browser. */
export function openClientGallery(slug: string, publicUrl: string | null): void {
  const url = publicUrl || galleryPublicUrl(slug);
  if (!url) return;
  const desktop = (window as GalleryWindow).teza;
  if (desktop?.openExternal) {
    desktop.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export function galleryShareText(
  clientName: string,
  url: string,
  username: string,
  password: string,
): string {
  return [
    `היי ${clientName}, הגלריה שלכם מוכנה לצפייה ובחירת תמונות!`,
    url,
    `שם משתמש: ${username}`,
    `סיסמה: ${password}`,
  ].join('\n');
}
