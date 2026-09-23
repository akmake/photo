/**
 * Tell every installed TEZA that the site moved to a new domain.
 *
 *   npm run server:move -- https://new-domain.com     announce the move
 *   npm run server:move -- --cancel                    withdraw it
 *
 * Writes /updates/server.json on the CURRENT (old) server — the one in
 * release-config/deploy.json. Installed apps read it on their next update check
 * and switch (electron/serverOrigin.cjs).
 *
 * The new address is checked FIRST, exactly the way the apps will check it: it
 * must answer as TEZA in production with the same license key this app ships.
 * An app would refuse a wrong address anyway, but refusing it here means a typo
 * is caught on your screen instead of silently in every studio.
 *
 * Keep the old domain alive for a few months after this. It is the only thing
 * that can tell an app which has not been opened yet where to go.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createServerOrigin, normalize, ANNOUNCE_PATH } = require('../electron/serverOrigin.cjs');

const root = path.join(__dirname, '..');

function fail(message) {
  process.stderr.write(`ההכרזה נכשלה: ${message}\n`);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) fail(`${cmd} לא נמצא או לא רץ (${r.error.message})`);
  if (r.status !== 0) fail(`${cmd} החזיר ${r.status}`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) fail('חסרה הכתובת החדשה. לדוגמה: npm run server:move -- https://new-domain.com');

  const deployFile = path.join(root, 'release-config', 'deploy.json');
  if (!fs.existsSync(deployFile)) fail('חסר release-config/deploy.json (פרטי השרת הנוכחי).');
  const { host, user, dir } = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
  if (!host || !user || !dir) fail('deploy.json צריך host, user ו-dir.');
  const target = `${user}@${host}`;
  const remote = `${dir}/${path.posix.basename(ANNOUNCE_PATH)}`;

  if (arg === '--cancel') {
    run('ssh', [target, `rm -f '${remote}'`]);
    process.stdout.write('ההכרזה בוטלה. תוכנות שעוד לא עברו יישארו בכתובת הנוכחית.\n');
    return;
  }

  const origin = normalize(arg);
  if (!origin) fail('כתובת לא תקינה. צריך כתובת מלאה שמתחילה ב-https://');
  const keyFile = path.join(root, 'release-config', 'license-public.pem');
  if (!fs.existsSync(keyFile)) fail('חסר release-config/license-public.pem.');

  const checker = createServerOrigin({
    defaultOrigin: origin,
    publicKeyPem: fs.readFileSync(keyFile, 'utf8'),
    stateFile: path.join(os.tmpdir(), 'teza-announce-check.json'),
  });
  try {
    await checker.verify(origin);
  } catch (e) {
    fail(`${origin}: ${e.message}`);
  }

  const local = path.join(os.tmpdir(), 'teza-server.json');
  fs.writeFileSync(local, JSON.stringify({ origin }) + '\n');
  run('scp', [local, `${target}:${remote}.uploading`]);
  run('ssh', [target, `mv -f '${remote}.uploading' '${remote}'`]);
  process.stdout.write(`הוכרז: ${host} מפנה עכשיו ל-${origin}.\n` +
    'תוכנות פתוחות יעברו תוך כמה שעות, ושאר התוכנות כשייפתחו. השאר את הדומיין הישן פעיל כמה חודשים.\n');
}

main().catch(e => fail(e.message));
