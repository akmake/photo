/* Capture and inspect the renderer of an already-running packaged TEZA app.
 *
 * Start TEZA with --remote-debugging-port=9223, then run this file. It uses
 * only Node's built-in WebSocket and fetch implementations so the release
 * smoke test does not add another browser automation dependency.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEBUG_ORIGIN = process.env.TEZA_DEBUG_ORIGIN || 'http://127.0.0.1:9223';
const OUTPUT = process.env.TEZA_SMOKE_SCREENSHOT ||
  path.join(__dirname, '..', 'release', 'packaged-smoke.png');

async function main() {
  const targets = await fetch(`${DEBUG_ORIGIN}/json`).then((response) => response.json());
  const target = targets.find((item) =>
    item.type === 'page' && item.url.includes('/dist/index.html'),
  );
  if (!target) throw new Error('The packaged application page is not open');

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await call('Page.enable');
  await call('Runtime.enable');
  const inspected = await call('Runtime.evaluate', {
    expression: `JSON.stringify({
      readyState: document.readyState,
      title: document.title,
      text: document.body.innerText.slice(0, 500),
      rootChildren: document.querySelector('#root')?.childElementCount || 0,
      scripts: document.scripts.length,
      stylesheets: document.styleSheets.length,
      width: innerWidth,
      height: innerHeight
    })`,
    returnByValue: true,
  });
  const screenshot = await call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, Buffer.from(screenshot.data, 'base64'));
  socket.close();

  process.stdout.write(`${inspected.result.value}\n${OUTPUT}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
