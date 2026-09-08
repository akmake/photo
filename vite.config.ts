import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two apps out of one repo. The studio is the photographer's desk; the
      // gallery is a link their client opens once, on a phone, possibly on hall
      // wi-fi. Sharing a bundle would mean shipping the editor and the album
      // machine to reach a login form.
      input: {
        main: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'gallery.html'),
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
