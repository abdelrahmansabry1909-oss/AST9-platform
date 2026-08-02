// vite.config.js
// Multi-page build for AST9 Health Hub.
//
//   - index.html  → public marketing landing page
//   - app.html    → authenticated SPA shell (the dashboard)
//
// Both pages live at the repo root. Vite's default is to build only
// the root `index.html`; this config tells Rollup about the second
// entry so `app.html` is bundled, hashed, and its `<script type="module"
// src="/src/main.js">` is rewritten to point at the produced bundle.
//
// `base` matters for production deploys on GitHub Pages where the site
// lives at `<owner>.github.io/AST9_HUB/`. Vite uses `base` to prefix
// every emitted asset URL (and exposes the same value to runtime code
// via `import.meta.env.BASE_URL`, which `GLBSkeleton.js` uses for the
// GLB asset). In dev (`vite`) the base stays `/` so localhost is
// unaffected.

import { defineConfig } from 'vite';
import { resolve }      from 'path';
import { cpSync, existsSync } from 'node:fs';
import { execSync }     from 'node:child_process';

function resolveBuildId() {
  const envSha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.trim() : '';
  if (envSha) return envSha;
  try {
    const gitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    if (gitSha) return gitSha;
  } catch (e) {
    // fallback to 'unknown' if git command fails
  }
  return 'unknown';
}

function buildStampPlugin() {
  const buildId = resolveBuildId();
  return {
    name: 'inject-build-stamp',
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          children: `window.AST9_BUILD_ID = ${JSON.stringify(buildId)};`,
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/AST9_HUB/' : '/',
  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        app:     resolve(__dirname, 'app.html'),
      },
    },
  },
  plugins: [
    buildStampPlugin(),
    {
      // Vite only bundles ES-module scripts (`<script type="module">`).
      // The 28 classic `<script src="js/*.js">` tags in app.html — the
      // legacy IIFE layer — are left untouched in the emitted HTML, so
      // the entire `js/` directory must be present alongside `dist/app.html`
      // for those tags to resolve. Copy it on every build.
      name: 'copy-legacy-js',
      apply: 'build',
      closeBundle() {
        const src = resolve(__dirname, 'js');
        const dst = resolve(__dirname, 'dist', 'js');
        if (existsSync(src)) cpSync(src, dst, { recursive: true });
      },
    },
  ],
}));
