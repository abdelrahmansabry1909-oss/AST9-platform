// ═══════════════════════════════════════════════════════════════
//  js/supabaseClient.js
//  Single source of truth for the Supabase client instance.
//  ⚠️  Replace YOUR_ANON_KEY with your actual Supabase anon key.
//  Project URL: https://byquokhcbagofshsclfy.supabase.co
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://byquokhcbagofshsclfy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cXVva2hjYmFnb2ZzaHNjbGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NzIxMjAsImV4cCI6MjA5MzM0ODEyMH0.wRJlvde8qm0TmFOQXZtAePwsb9F5djA5kdJlBzL3O1A';

// Test if localStorage actually works (Edge Tracking Prevention may block it)
let _storageWorks = false;
try {
  localStorage.setItem('__sb_test__', '1');
  localStorage.removeItem('__sb_test__');
  _storageWorks = true;
} catch { /* blocked */ }

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
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
  }
});

// Expose globally so all modules can import without bundler
window.sb = sb;
window.SUPABASE_URL  = SUPABASE_URL;
window.SUPABASE_ANON = SUPABASE_ANON;   // needed by edge-function fetches that build their own apikey header
