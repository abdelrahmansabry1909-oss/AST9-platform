import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const monitoringSrc = readFileSync(new URL('../../js/monitoring.js', import.meta.url), 'utf8');
const viteConfigSrc = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
const appHtmlSrc = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');

test('js/monitoring.js does not contain a hardcoded version literal matching /\\d{8}[a-z]?/', () => {
  assert.doesNotMatch(
    monitoringSrc,
    /'\d{8}[a-z]?'/,
    'js/monitoring.js contains a hardcoded date/version string'
  );
});

test('js/monitoring.js references AST9_BUILD_ID', () => {
  assert.match(
    monitoringSrc,
    /AST9_BUILD_ID/,
    'js/monitoring.js missing AST9_BUILD_ID reference'
  );
});

test('js/monitoring.js still contains ast9-frontend@ prefix', () => {
  assert.match(
    monitoringSrc,
    /'ast9-frontend@'/,
    'js/monitoring.js missing ast9-frontend@ release prefix'
  );
});

test('vite.config.js references AST9_BUILD_ID, GITHUB_SHA and head-prepend', () => {
  assert.match(viteConfigSrc, /AST9_BUILD_ID/, 'vite.config.js missing AST9_BUILD_ID');
  assert.match(viteConfigSrc, /GITHUB_SHA/, 'vite.config.js missing GITHUB_SHA');
  assert.match(viteConfigSrc, /'head-prepend'/, 'vite.config.js missing head-prepend');
});

test('app.html contains js/monitoring.js?v=20260802a', () => {
  assert.match(
    appHtmlSrc,
    /js\/monitoring\.js\?v=20260802a/,
    'app.html missing bumped js/monitoring.js?v=20260802a tag'
  );
});
