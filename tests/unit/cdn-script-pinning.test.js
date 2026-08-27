// tests/unit/cdn-script-pinning.test.js
//
// Every third-party script the browser loads must be pinned to an exact version
// and locked with a Subresource Integrity hash.
//
// The defect this prevents: supabase-js shipped from a floating `@2` tag with no
// integrity attribute, so production ran whatever the newest 2.x happened to be
// at page load. That script holds the authenticated session and issues every
// database call — it is the highest-privilege third-party code on the page, and
// a compromised publish or CDN would have executed with full access to the
// signed-in user's data, unreviewed. Sentry, which only sends scrubbed error
// events, was already pinned with SRI; the careful treatment was on the wrong
// script.
//
// Static checks over the shipped HTML. This does not prove a hash is correct for
// the bytes the CDN serves — only that a pin and a hash are present. A wrong
// hash fails closed (the browser refuses the script), which is the intended
// posture for a script with database access, but it means the app goes down
// rather than degrading. Recompute the hash whenever the version is bumped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const PAGES = ['app.html', 'index.html'];

function html(page) {
  return readFileSync(new URL(page, root), 'utf8');
}

// Every <script> with an absolute http(s) src.
function externalScripts(source) {
  return [...source.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/g)]
    .map((match) => ({ tag: match[0], src: match[1] }));
}

test('every external script is pinned to an exact version', () => {
  // A bare major tag (@2) or a mutable channel (latest/next) lets the CDN swap
  // the code under us between page loads.
  const floating = [
    /@\d+\/(?:dist|umd|build)/,   // e.g. supabase-js@2/dist
    /@latest\b/,
    /@next\b/,
    /\/latest\//,
  ];

  let total = 0;
  for (const page of PAGES) {
    const scripts = externalScripts(html(page));
    total += scripts.length;

    for (const { src } of scripts) {
      for (const pattern of floating) {
        assert.doesNotMatch(src, pattern,
          `${page}: external script is not pinned to an exact version: ${src}`);
      }
    }
  }

  // A page with no external scripts satisfies this rule trivially and is the
  // safer state, so it is not required to have one — index.html dropped its
  // supabase-js tag when the landing page stopped needing a database client.
  // The suite-level count still has to be non-zero, otherwise deleting every
  // external script everywhere would make this test pass vacuously.
  assert.ok(total > 0, 'no external scripts found on any page — test would pass vacuously');
});

test('every external script carries an SRI hash and crossorigin', () => {
  for (const page of PAGES) {
    for (const { tag, src } of externalScripts(html(page))) {
      assert.match(tag, /\bintegrity="sha(?:256|384|512)-[A-Za-z0-9+/=]+"/,
        `${page}: external script has no SRI integrity hash: ${src}`);
      // Without crossorigin the browser cannot verify a cross-origin response,
      // so the integrity attribute is silently useless.
      assert.match(tag, /\bcrossorigin="anonymous"/,
        `${page}: external script has integrity but no crossorigin="anonymous": ${src}`);
    }
  }
});

test('supabase-js is pinned identically on every page that loads it', () => {
  // A version skew between the landing page and the app would mean two different
  // clients against one database.
  const seen = new Map();
  for (const page of PAGES) {
    const source = html(page);

    // "every page that loads it" is the contract — a page that does not load
    // supabase-js at all is out of scope rather than in violation. index.html
    // is exactly that case: the landing page talks to the visitor-survey edge
    // function over plain fetch and needs no database client, so shipping the
    // highest-privilege third-party script there would be a step backwards.
    // Pages that DO load it are still held to the full pinning rule below.
    if (!/@supabase\/supabase-js/.test(source)) continue;

    const match = source.match(
      /<script\b[^>]*\bsrc="(https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@([^/"]+)\/[^"]+)"[^>]*\bintegrity="([^"]+)"/);
    assert.ok(match, `${page}: references supabase-js but has no pinned, SRI-locked script tag`);
    const [, , version, integrity] = match;
    assert.match(version, /^\d+\.\d+\.\d+$/,
      `${page}: supabase-js version must be exact, got "${version}"`);
    seen.set(page, { version, integrity });
  }

  // Guards against the whole check going quiet if the tag is dropped everywhere.
  assert.ok(seen.size > 0, 'no page loads supabase-js — expected at least app.html to');

  const values = [...seen.values()];
  for (const { version, integrity } of values) {
    assert.equal(version, values[0].version, 'supabase-js version differs between pages');
    assert.equal(integrity, values[0].integrity, 'supabase-js integrity hash differs between pages');
  }
});
