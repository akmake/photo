interface GalleryDesktopBridge {
  openClientGallery?: (slug: string) => void;
}

interface GalleryWindow extends Window {
  teza?: GalleryDesktopBridge;
}

/** A real client URL when the gallery web app has a public home.
 *
 * In development the current HTTP origin is useful. In the installed app the
 * page runs from file://, which is not a link a photographer can send. The
 * public base is therefore explicit instead of turning a local file path into
 * a convincing-looking broken URL. */
export function galleryPublicUrl(slug: string): string | null {
  const configured = String(import.meta.env.VITE_PUBLIC_GALLERY_URL || '').trim();
  if (configured) {
    return `${configured.replace(/\/$/, '')}/gallery.html?g=${encodeURIComponent(slug)}`;
  }
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    return `${location.origin}/gallery.html?g=${encodeURIComponent(slug)}`;
  }
  return null;
}

/** Open the exact client application. Desktop uses a dedicated Electron
 * window backed by the local engine; the browser build opens its public URL. */
export function openClientGallery(slug: string, publicUrl: string | null): void {
  const desktop = (window as GalleryWindow).teza;
  if (desktop?.openClientGallery) {
    desktop.openClientGallery(slug);
    return;
  }
  window.open(publicUrl || `gallery.html?g=${encodeURIComponent(slug)}`, '_blank', 'noopener');
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
