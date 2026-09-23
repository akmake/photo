import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  // The installed desktop app opens dist/index.html through file://. Absolute
  // /assets URLs point at the drive root there; relative URLs stay beside the
  // document in both the packaged app and the development build.
  base: './',
  plugins: [react()],
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
