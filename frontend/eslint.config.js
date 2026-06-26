// eslint.config.js — flat config for the frontend directory.
// Covers both the browser SPA (src/**/*.js, flow.html) and Node ESM files
// (server.js, parser.js, test-parser.mjs, vite.config.js).
import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore vendored third-party files, build output, and HTML (not JS).
  {
    ignores: ['vendor/**', 'dist/**', 'node_modules/**', '**/*.html'],
  },

  // Browser SPA modules: src/*.js — browser globals (React loaded via UMD).
  // src/server/** is Node, not browser (see the Node block below), so it is excluded here.
  {
    files: ['src/**/*.js'],
    ignores: ['src/server/**'],
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
      // Allow unused vars/args/catch-bindings named with leading underscore (common pattern).
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all', caughtErrorsIgnorePattern: '^_' }],
    },
  },

  // Node ESM files: server entry + its src/server/ modules, parser entry, tests, config files.
  {
    files: ['server.js', 'src/server/**/*.js', 'parser.js', 'test-parser.mjs', 'vite.config.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all', caughtErrorsIgnorePattern: '^_' }],
    },
  },
];
