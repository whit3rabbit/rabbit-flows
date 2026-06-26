// vite.config.js — build config for the Rabbit Flow Designer SPA.
// Root is frontend/ (the directory this file lives in).
// Output goes to frontend/dist/ — server.js always serves from frontend/ (not dist/),
// so dev and Docker both work without a build step. dist/ is for standalone static hosting.
// Vite is a devDependency only; server.js keeps importing only Node stdlib.
//
// parser.js: dynamically imported by canvas.js via import('/parser.js'). Vite detects the
// dynamic import and bundles parser.js as a hashed async chunk in dist/assets/; it also
// rewrites the import path so the built app resolves correctly without needing /parser.js.
// In dev the server serves frontend/parser.js directly at /parser.js.
//
// vendor/ (react, react-dom, reactflow UMDs): loaded at runtime via dynamic <script>
// injection in main.js (not statically imported, so not bundled by Vite). In both dev
// and Docker these are served from frontend/vendor/ at /vendor/* by server.js. A pure
// dist/ static-hosting setup would need to also serve vendor/ alongside dist/.
import { defineConfig } from 'vite';

export default defineConfig({
  // root is implicitly the directory containing vite.config.js (frontend/).
  // Explicit here for clarity.
  root: '.',

  // Build output directory (relative to root).
  build: {
    outDir: 'dist',
    // flow.html is the SPA entry; Vite will inline/bundle referenced assets.
    rollupOptions: {
      input: 'flow.html',
    },
    // Do not clear the dist dir between builds in CI (harmless locally).
    emptyOutDir: true,
  },

  // Serve from / so relative asset paths match development.
  base: './',
});
