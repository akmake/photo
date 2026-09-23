/**
 * Publish the installer that `npm run package:win:full` just built, so every
 * installed TEZA finds it (electron/updater.cjs reads <origin>/updates/).
 *
 * Order matters: the installer and its .blockmap go up first, latest.yml LAST
 * and by an atomic rename. An app that asks in the middle of an upload sees
 * either the old version or the complete new one — never a version whose file
 * is still half on the wire.
 *
 * Old installers are never deleted on the server: the partial download of the
 * next update needs the previous version's .blockmap, and rolling back means
 * re-publishing an old build under a NEW version number (apps never downgrade).
 *
 * Needs release-config/deploy.json (see deploy.example.json) and an SSH key
 * that already logs into the VPS without a password prompt.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'release');

function fail(message) {
  process.stderr.write(`העלאה נכשלה: ${message}\n`);
  process.exit(1);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) fail(`${cmd} לא נמצא או לא רץ (${r.error.message})`);
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} החזיר ${r.status}`);
}

const deployFile = path.join(root, 'release-config', 'deploy.json');
if (!fs.existsSync(deployFile)) fail('חסר release-config/deploy.json (העתק מ-deploy.example.json ומלא).');
const { host, user, dir } = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
if (!host || !user || !dir || !dir.startsWith('/')) fail('deploy.json צריך host, user ו-dir מוחלט.');

const manifest = path.join(releaseDir, 'latest.yml');
if (!fs.existsSync(manifest)) fail('אין release/latest.yml. בנה קודם: npm run package:win:full');
const yml = fs.readFileSync(manifest, 'utf8');
const version = (yml.match(/^version:\s*(\S+)/m) || [])[1];
const installer = (yml.match(/^path:\s*(.+)$/m) || [])[1]?.trim();
if (!version || !installer) fail('latest.yml לא קריא.');

const pkgVersion = require(path.join(root, 'package.json')).version;
if (version !== pkgVersion) fail(`latest.yml הוא ${version} אבל package.json הוא ${pkgVersion}. בנה מחדש.`);

const exe = path.join(releaseDir, installer);
const blockmap = `${exe}.blockmap`;
for (const f of [exe, blockmap]) if (!fs.existsSync(f)) fail(`חסר ${path.basename(f)}`);

const target = `${user}@${host}`;
process.stdout.write(`מעלה את גרסה ${version} אל ${host}:${dir}\n`);
run('ssh', [target, `mkdir -p '${dir}'`]);
run('scp', [exe, blockmap, `${target}:${dir}/`]);
run('scp', [manifest, `${target}:${dir}/latest.yml.uploading`]);
run('ssh', [target, `mv -f '${dir}/latest.yml.uploading' '${dir}/latest.yml'`]);
// The website's download button always asks for FrameOps-Setup.exe; point that name
// at the installer just published (a link, not a second 1.8GB copy).
run('ssh', [target, `ln -sfn '${installer}' '${dir}/FrameOps-Setup.exe'`]);
process.stdout.write(`גרסה ${version} פורסמה. תוכנות פתוחות ימצאו אותה תוך כמה שעות, ובפתיחה הבאה תוך דקה.\n`);
