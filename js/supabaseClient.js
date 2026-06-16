// ═══════════════════════════════════════════════════════════════
//  js/supabaseClient.js
//  Single source of truth for the Supabase client instance.
//  ⚠️  Replace YOUR_ANON_KEY with your actual Supabase anon key.
//  Project URL: https://byquokhcbagofshsclfy.supabase.co
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://byquokhcbagofshsclfy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cXVva2hjYmFnb2ZzaHNjbGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NzIxMjAsImV4cCI6MjA5MzM0ODEyMH0.wRJlvde8qm0TmFOQXZtAePwsb9F5djA5kdJlBzL3O1A';

// ── Multi-account testing: opt-in per-tab isolated session ──────────
// PRODUCTION DEFAULT IS UNCHANGED. By default the session lives in
// localStorage, which is shared across same-origin tabs and synced by
// supabase-js (signing out/in one tab propagates to the others) — correct
// for a single-account app. For side-by-side coach/client/admin testing on
// one browser profile, open a tab with `?isolated=1`: that tab uses
// sessionStorage (per-tab, never broadcast), so it holds an independent
// account and logging out of any other tab won't sign it out. The flag is
// remembered in this tab's sessionStorage so it survives reloads that drop
// the query param. New tabs without the param behave exactly as before.
const _ISO_FLAG = 'sb_isolated_session';
let _isolatedSession = false;
try {
  _isolatedSession = /[?&#]isolated=1\b/.test(window.location.href)
    || sessionStorage.getItem(_ISO_FLAG) === '1';
} catch { /* sessionStorage blocked — stay on the default path */ }

// Probe the storage backend this tab will actually use.
let _storageWorks = false;
try {
  const probe = _isolatedSession ? sessionStorage : localStorage;
  probe.setItem('__sb_test__', '1');
  probe.removeItem('__sb_test__');
  _storageWorks = true;
  if (_isolatedSession) sessionStorage.setItem(_ISO_FLAG, '1');
} catch { /* blocked */ }

const _authOptions = {
  persistSession: _storageWorks,
  autoRefreshToken: _storageWorks,
  detectSessionInUrl: true,
  // supabase-js v2 acquires a browser-wide navigator Web Lock before every
  // auth call. That lock can DEADLOCK — a crashed/extra tab, a privacy
  // browser, or a prior hung operation leaves it held, and then every
  // signInWithPassword() waits on it forever (surfacing as a login
  // "timeout"). A pass-through lock runs the operation immediately; for a
  // single-coach app the cross-tab serialisation it gave up is not needed.
  lock: async (_name, _acquireTimeout, fn) => fn(),
};
// Only in isolated mode do we override storage — keeps the default session
// key/backend exactly as production has always used them.
if (_isolatedSession && _storageWorks) {
  _authOptions.storage = window.sessionStorage;
  _authOptions.storageKey = 'sb-byquokhcbagofshsclfy-auth-isolated';
}

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: _authOptions });

// Expose globally so all modules can import without bundler
window.sb = sb;
window.SUPABASE_URL  = SUPABASE_URL;
window.SUPABASE_ANON = SUPABASE_ANON;   // needed by edge-function fetches that build their own apikey header
