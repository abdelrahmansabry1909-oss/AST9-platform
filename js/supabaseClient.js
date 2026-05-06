// ═══════════════════════════════════════════════════════════════
//  js/supabaseClient.js
//  Single source of truth for the Supabase client instance.
//  ⚠️  Replace YOUR_ANON_KEY with your actual Supabase anon key.
//  Project URL: https://byquokhcbagofshsclfy.supabase.co
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://byquokhcbagofshsclfy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cXVva2hjYmFnb2ZzaHNjbGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NzIxMjAsImV4cCI6MjA5MzM0ODEyMH0.wRJlvde8qm0TmFOQXZtAePwsb9F5djA5kdJlBzL3O1A'; // ← paste your anon key here

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,   // handles magic links & password reset redirects
  }
});

// Expose globally so all modules can import without bundler
window.sb = sb;
window.SUPABASE_URL = SUPABASE_URL;
