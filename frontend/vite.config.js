// vite.config.js — build config for the Rabbit Flow Designer SPA.
// Root is frontend/ (the directory this file lives in).
// Output goes to frontend/dist/ — served by server.js when present,
// but the SPA can also be served directly from frontend/ without a build step
// (server.js reads static files from its own directory).
// Vite is a devDependency only; server.js keeps importing only Node stdlib.
import { defineConfig } from 'vite';

export default defineConfig({
  // root is implicitly the directory containing vite.config.js (frontend/).
  // Explicit here for clarity.
  root: '.',

  // Build output directory (relative to root).
  build: {
    outDir: 'dist',
    // flow.html is the SPA entry; Vite will inline/bundle referenced assets.
    // The vendored UMD files are loaded by flow-canvas.js as script tags
    // and must be copied to dist as-is.
    rollupOptions: {
      input: 'flow.html',
    },
    // Do not clear the dist dir between builds in CI (harmless locally).
    emptyOutDir: true,
  },

  // Serve from / so relative asset paths match development.
  base: './',
});
