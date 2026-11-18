import { defineConfig } from 'vite';
import { fsApi } from './server/fs-api';

export default defineConfig({
  // Relative asset paths, so the Electron app can load the build from disk.
  base: './',
  plugins: [fsApi()],
});
