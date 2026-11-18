import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { fsApi } from './server/fs-api';

export default defineConfig({
  // Relative asset paths, so the Electron apps can load the build from disk.
  base: './',
  plugins: [fsApi()],
  build: {
    // Two pages: App Mapper (index.html) and the standalone MD Editor (md-app.html).
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        'md-app': resolve(import.meta.dirname, 'md-app.html'),
      },
    },
  },
});
