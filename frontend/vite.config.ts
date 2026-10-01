import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the Express backend during dev so we don't
      // fight CORS or hard-code URLs.
      //
      // Scoped to /api only — NOT /documents, /chat, etc. Those are also
      // React Router route paths in the SPA. A proxy on the bare path would
      // intercept full-page navigations (e.g. a hard refresh on /documents)
      // and forward them to Express, which has no Authorization header for
      // a browser navigation and returns 401 JSON instead of index.html.
      '/api': 'http://localhost:3000',
    },
  },
});
