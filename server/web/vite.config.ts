import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website is its own app, separate from the desktop client (src/). In dev it
// talks to the backend on 8790; /api is proxied so the browser stays same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8790',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
});
