import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { writeFile, appendFile, mkdir, readdir, stat } from 'node:fs/promises';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Development only: the review pages under test-results/<round>/ write what
// the photographer does and says beside themselves, where the assistant reads
// it. A browser page cannot write to disk on its own without a folder picker;
// the dev server can, and it is already running. Never in the build.
function reviewNotes(): Plugin {
  const ROUND = /^(review|try)-[\w-]+$/;
  const FILE = /^[\w.-]+$/;
  const readBody = (req: IncomingMessage) => new Promise<string>((ok, fail) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => ok(body));
    req.on('error', fail);
  });
  const handle = (fn: (q: URLSearchParams, body: string) => Promise<string>) =>
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const q = new URL(req.url ?? '', 'http://x').searchParams;
        const round = q.get('round') ?? '';
        if (round && !ROUND.test(round)) throw new Error('bad round');
        res.end(await fn(q, req.method === 'POST' ? await readBody(req) : ''));
      } catch (e) {
        res.statusCode = 400;
        res.end(String(e));
      }
    };
  const dirOf = async (round: string, sub = '') => {
    const d = resolve(__dirname, 'test-results', round, sub);
    await mkdir(d, { recursive: true });
    return d;
  };
  return {
    name: 'review-notes',
    apply: 'serve',
    configureServer(server) {
      // the whole notes file of a review page
      server.middlewares.use('/__review/save', handle(async (q, body) => {
        JSON.parse(body);
        await writeFile(resolve(await dirOf(q.get('round')!), 'feedback.json'), body, 'utf8');
        return 'ok';
      }));
      // one line of the action log of a "try it yourself" session
      server.middlewares.use('/__review/append', handle(async (q, body) => {
        JSON.parse(body);
        await appendFile(resolve(await dirOf(q.get('round')!), 'log.jsonl'), body.replace(/\n/g, ' ') + '\n', 'utf8');
        return 'ok';
      }));
      // an image the session produced (data URL in the body)
      server.middlewares.use('/__review/image', handle(async (q, body) => {
        const name = q.get('name') ?? '';
        if (!FILE.test(name)) throw new Error('bad name');
        const b64 = body.slice(body.indexOf(',') + 1);
        await writeFile(resolve(await dirOf(q.get('round')!, 'img'), name), Buffer.from(b64, 'base64'));
        return 'ok';
      }));
      // the projects under the workspace root and the folder of photos in each
      server.middlewares.use('/__review/projects', handle(async (q) => {
        const root = q.get('root') ?? '';
        const out: { name: string; folder: string }[] = [];
        for (const name of await readdir(root)) {
          for (const sub of ['תמונות גלם', 'תמונות']) {
            const folder = resolve(root, name, sub);
            if (await stat(folder).then((s) => s.isDirectory(), () => false)) {
              out.push({ name, folder });
              break;
            }
          }
        }
        return JSON.stringify(out);
      }));
    },
  };
}

export default defineConfig({
  // The installed desktop app opens dist/index.html through file://. Absolute
  // /assets URLs point at the drive root there; relative URLs stay beside the
  // document in both the packaged app and the development build.
  base: './',
  plugins: [react(), reviewNotes()],
  build: {
    rollupOptions: {
      // The studio only. The client gallery moved to the website (ManagPhoto
      // repo, client/src/gallery) on 24.09.2026.
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    // The repo root holds ~68,000 files the client never imports: engine/.venv
    // (47,874), third_party (19,926), engine/models (1GB of weights). Vite's
    // watcher only ignores node_modules by default, so on every start chokidar
    // crawled all of them - the server printed "ready in 300ms" and then sat
    // blocked for ~75-90s, starving whichever request happened to be in flight.
    // Measured: 91s to first render before this list, ~2s after.
    watch: {
      ignored: [
        '**/engine/**',
        '**/third_party/**',
        '**/test-results/**',
        '**/experiments/**',
        '**/_archive_chabad/**',
        '**/dist/**',
        '**/.git/**',
      ],
    },
  },
});
