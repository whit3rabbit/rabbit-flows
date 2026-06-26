// eslint.config.js — flat config for the frontend directory.
// Covers both the browser SPA (flow-canvas.js, flow.html) and Node ESM files
// (server.js, parser.js, test-parser.mjs, vite.config.js).
import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore vendored third-party files and build output.
  {
    ignores: ['vendor/**', 'dist/**', 'node_modules/**'],
  },

  // Browser SPA files: flow-canvas.js gets browser globals (React loaded via UMD).
  {
    files: ['flow-canvas.js', 'flow.html'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // UMD globals provided by vendored files
        React: 'readonly',
        ReactDOM: 'readonly',
        ReactFlow: 'readonly',
      },
    },
    rules: {
      // Allow unused vars named with leading underscore (common pattern).
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Node ESM files: server, parser, tests, config files.
  {
    files: ['server.js', 'parser.js', 'test-parser.mjs', 'vite.config.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
