import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the Express backend during dev so we don't
      // fight CORS or hard-code URLs.
      '/auth': 'http://localhost:3000',
      '/documents': 'http://localhost:3000',
      '/chat': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
