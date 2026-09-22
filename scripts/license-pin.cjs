/** Stamp the production public-key fingerprint into the frozen engine source. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const publicFile = path.join(root, 'release-config', 'license-public.pem');
if (!fs.existsSync(publicFile)) {
  process.stderr.write('Missing release-config/license-public.pem. No engine key was pinned.\n');
  process.exit(1);
}
const key = crypto.createPublicKey(fs.readFileSync(publicFile));
if (key.asymmetricKeyType !== 'ed25519') {
  process.stderr.write('License public key must be Ed25519.\n');
  process.exit(1);
}
const der = key.export({ format: 'der', type: 'spki' });
const hash = crypto.createHash('sha256').update(der).digest('hex');
fs.writeFileSync(path.join(root, 'engine', 'license_pin.py'),
  '"""Pinned production Ed25519 public-key fingerprint. Generated for this release."""\n' +
  `EXPECTED_PUBLIC_KEY_SHA256 = "${hash}"\n`);
process.stdout.write('Production license key pinned. Rebuild the engine now.\n');
