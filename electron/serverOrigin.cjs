/**
 * Which website this installed TEZA talks to — for its license AND its updates.
 *
 * The installer carries a first address (resources/license-config.json). From
 * then on the address lives in the photographer's data folder (server.json),
 * so the domain can change without anyone reinstalling:
 *
 *  1. With every update check (20s after launch, then every 4 hours) the app
 *     asks its CURRENT site for /updates/server.json. Normally there is no such
 *     file and nothing happens. When the domain moves, the OLD site holds
 *     { "origin": "https://new" } there, and the app moves — nothing shown,
 *     nothing asked.
 *  2. If the old domain is already gone, the photographer pastes the new address
 *     in Settings (setOrigin).
 *
 * Either way a new address is accepted ONLY if it proves to be our server: its
 * /licenses/public-key must be exactly the key shipped inside this app, and its
 * /health must say it is TEZA in production. So neither a hijacked old domain
 * nor a pasted wrong address can point the app at someone else's server.
 *
 * Pure Node: no Electron import, so it can be exercised with plain `node`.
 */

const fs = require('node:fs');
const path = require('node:path');

// A plain file in the site's updates folder, written by
// scripts/announce-move.cjs. Missing (404) means "no move".
const ANNOUNCE_PATH = '/updates/server.json';
const MAX_HOPS = 3;   // old → new → newer is fine; a loop is not

/** "https://Host.com/anything" → "https://host.com"; anything else → null. */
function normalize(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function getJson(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json();
}

function createServerOrigin({ defaultOrigin, publicKeyPem, stateFile, fetchImpl = fetch, log = () => {} }) {
  const installed = normalize(defaultOrigin);

  function current() {
    try {
      const saved = normalize(JSON.parse(fs.readFileSync(stateFile, 'utf8')).origin);
      if (saved) return saved;
    } catch { /* no saved address yet: the installer's is the one */ }
    return installed;
  }

  function save(origin) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ origin, savedAt: new Date().toISOString() }, null, 2));
    fs.renameSync(tmp, stateFile);   // never a half-written address
  }

  /** Is this address really our production server? Throws a Hebrew reason if not. */
  async function verify(origin) {
    let health, key;
    try {
      [health, key] = await Promise.all([
        getJson(fetchImpl, `${origin}/health`, 10_000),
        getJson(fetchImpl, `${origin}/licenses/public-key`, 10_000),
      ]);
    } catch (e) {
      log('verify failed to reach', origin, e && e.message);
      throw new Error('לא ניתן להתחבר לכתובת הזו. בדוק שהיא נכונה ושיש חיבור לאינטרנט.');
    }
    if (!health || health.service !== 'teza-platform' || health.env === 'dev') {
      throw new Error('בכתובת הזו אין שרת של FrameOps.');
    }
    if (String(key && key.public_key_pem || '').trim() !== String(publicKeyPem).trim()) {
      throw new Error('השרת בכתובת הזו אינו השרת של FrameOps (מפתח הרישוי לא תואם).');
    }
  }

  /**
   * Ask the current site where the server lives now, and move if it says so.
   * Offline, site down, or no announcement → stay where we are, silently.
   * Returns the origin in use afterwards.
   */
  async function followMoves() {
    let origin = current();
    for (let hop = 0; hop < MAX_HOPS && origin; hop++) {
      let announced;
      try {
        announced = normalize((await getJson(fetchImpl, `${origin}${ANNOUNCE_PATH}`, 10_000)).origin);
      } catch (e) {
        log('announce check failed at', origin, e && e.message);
        return origin;
      }
      if (!announced || announced === origin) return origin;
      try {
        await verify(announced);
      } catch (e) {
        log('announced address rejected:', announced, e.message);
        return origin;
      }
      log('server moved:', origin, '→', announced);
      save(announced);
      origin = announced;
    }
    return origin;
  }

  /** From Settings. Returns { ok, origin } or { ok: false, error } in Hebrew. */
  async function setOrigin(value) {
    const origin = normalize(value);
    if (!origin) return { ok: false, error: 'כתובת לא תקינה. צריך כתובת מלאה שמתחילה ב-https://' };
    try {
      await verify(origin);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    save(origin);
    log('server set by hand:', origin);
    return { ok: true, origin };
  }

  return { current, followMoves, setOrigin, verify, installed: () => installed };
}

module.exports = { createServerOrigin, normalize, ANNOUNCE_PATH };
