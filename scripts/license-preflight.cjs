/** Refuse to create a customer installer without a real, matching license server. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const root = path.join(__dirname, '..');
  const configFile = path.join(root, 'release-config', 'license.json');
  const publicFile = path.join(root, 'release-config', 'license-public.pem');
  const pinFile = path.join(root, 'engine', 'license_pin.py');
  const engineFile = path.join(root, 'engine', '.dist', 'teza-engine', 'teza-engine.exe');
  if (!fs.existsSync(engineFile)) throw new Error('מנוע ארוז חסר. הרץ קודם npm run build:engine.');
  if (fs.statSync(engineFile).mtimeMs < fs.statSync(path.join(root, 'engine', 'license_state.py')).mtimeMs ||
      fs.statSync(engineFile).mtimeMs < fs.statSync(path.join(root, 'engine', 'server.py')).mtimeMs ||
      fs.statSync(engineFile).mtimeMs < fs.statSync(path.join(root, 'engine', 'launch.py')).mtimeMs ||
      fs.statSync(engineFile).mtimeMs < fs.statSync(pinFile).mtimeMs ||
      !fs.existsSync(path.join(root, 'engine', '.dist', 'teza-engine', '_internal', 'cryptography'))) {
    throw new Error('המנוע הארוז ישן או חסרה בו ספריית אימות החתימה. התקן דרישות ובנה אותו מחדש.');
  }
  if (!fs.existsSync(configFile) || !fs.existsSync(publicFile)) {
    throw new Error('חסרה תצורת רישוי לייצור ב-release-config; אין ליצור חבילה לא מוגנת.');
  }
  const { origin } = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' ||
      ['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('שרת הרישיונות חייב להיות כתובת HTTPS ציבורית נקייה.');
  }
  const localKey = fs.readFileSync(publicFile, 'utf8').trim();
  const parsedKey = crypto.createPublicKey(localKey);
  if (parsedKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('מפתח הרישוי הציבורי אינו Ed25519.');
  }
  const fingerprint = crypto.createHash('sha256')
    .update(parsedKey.export({ format: 'der', type: 'spki' })).digest('hex');
  if (!fs.readFileSync(pinFile, 'utf8').includes(`EXPECTED_PUBLIC_KEY_SHA256 = "${fingerprint}"`)) {
    throw new Error('המנוע אינו מקובע למפתח של שרת הייצור. הרץ npm run license:pin ובנה את המנוע מחדש.');
  }
  const timeout = AbortSignal.timeout(8000);
  const [healthResponse, keyResponse] = await Promise.all([
    fetch(new URL('/health', url), { signal: timeout }),
    fetch(new URL('/licenses/public-key', url), { signal: timeout }),
  ]);
  if (!healthResponse.ok || !keyResponse.ok) throw new Error('שרת הרישיונות אינו זמין.');
  const health = await healthResponse.json();
  const key = await keyResponse.json();
  if (health.env === 'dev' || health.service !== 'teza-platform') {
    throw new Error('כתובת הרישוי אינה שרת TEZA בייצור.');
  }
  const remoteKey = String(key.public_key_pem || '').trim();
  if (remoteKey !== localKey) throw new Error('המפתח הציבורי בקובץ אינו מתאים לשרת.');
  process.stdout.write('License preflight passed: production server and signing key match.\n');
}

main().catch(error => {
  process.stderr.write(`License preflight failed: ${error.message}\n`);
  process.exitCode = 1;
});
