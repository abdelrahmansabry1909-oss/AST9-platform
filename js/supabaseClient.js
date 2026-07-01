// ═══════════════════════════════════════════════════════════════
//  js/supabaseClient.js
//  Single source of truth for the Supabase client instance.
//  ⚠️  Replace YOUR_ANON_KEY with your actual Supabase anon key.
//  Project URL: https://byquokhcbagofshsclfy.supabase.co
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://byquokhcbagofshsclfy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cXVva2hjYmFnb2ZzaHNjbGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NzIxMjAsImV4cCI6MjA5MzM0ODEyMH0.wRJlvde8qm0TmFOQXZtAePwsb9F5djA5kdJlBzL3O1A';

// ── Per-window sessions: sessionStorage is the DEFAULT auth store ────
// Every top-level browser window/tab has its OWN sessionStorage (it is not
// shared between windows and never broadcasts), so each normal window in the
// same browser profile can hold a DIFFERENT AST9 account at the same time
// (Coach A / Coach B / Client A ...) — no incognito, extra profile, or
// `?isolated=1` needed. The session survives reloads of that window but is
// intentionally lost when the window/browser is closed (no cross-restart
// persistence — an accepted tradeoff for per-window multi-account).
// `?isolated=1` stays supported for backward compatibility: it just uses a
// distinct storageKey within the same per-window sessionStorage.
const _ISO_FLAG = 'sb_isolated_session';
let _isolatedSession = false;
try {
  _isolatedSession = /[?&#]isolated=1\b/.test(window.location.href)
    || sessionStorage.getItem(_ISO_FLAG) === '1';
} catch { /* sessionStorage blocked — stay on the default path */ }

// Probe sessionStorage (the per-window auth backend). If it's blocked, we
// leave persistSession/autoRefreshToken off and supabase-js falls back to an
// in-memory session for this window instead of throwing.
let _storageWorks = false;
try {
  sessionStorage.setItem('__sb_test__', '1');
  sessionStorage.removeItem('__sb_test__');
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
// Per-window default: sessionStorage. Assign only when writable so a blocked
// storage cleanly falls back to supabase-js's in-memory session.
if (_storageWorks) {
  _authOptions.storage = window.sessionStorage;
  // `?isolated=1` keeps its own distinct key for side-by-side compatibility;
  // the normal per-window default uses supabase-js's standard project key.
  if (_isolatedSession) {
    _authOptions.storageKey = 'sb-byquokhcbagofshsclfy-auth-isolated';
  }
}

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: _authOptions });

// Expose globally so all modules can import without bundler
window.sb = sb;
window.SUPABASE_URL  = SUPABASE_URL;
window.SUPABASE_ANON = SUPABASE_ANON;   // needed by edge-function fetches that build their own apikey header
