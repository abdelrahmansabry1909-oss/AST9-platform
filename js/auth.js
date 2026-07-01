// ═══════════════════════════════════════════════════════════════
//  js/auth.js
//  Handles: login, logout, password reset, role detection,
//           profile loading, auth state listener.
//  Does NOT touch UI rendering beyond auth screens.
// ═══════════════════════════════════════════════════════════════

const Auth = (() => {

  // ── State ───────────────────────────────────────────────────
  let _user    = null;
  let _profile = null;

  // ── Subscription-gate sign-out suppression ──────────────────
  // The gate signs a blocked client out so they can't keep a live session.
  // That fires onAuthStateChange('SIGNED_OUT'), which the app-shell listener
  // uses to redirect to the landing page. We set this one-shot flag around
  // the gate's own sign-out so the shell skips the redirect and lets the
  // subscription-inactive screen show. A real user logout leaves the flag
  // false → the landing redirect still happens.
  let _suppressSignedOutRedirect = false;
  async function _gateSignOut() {
    _suppressSignedOutRedirect = true;
    await sb.auth.signOut({ scope: 'local' });
  }
  function consumeGateSignout() {
    const v = _suppressSignedOutRedirect;
    _suppressSignedOutRedirect = false;
    return v;
  }

  // ── Public API ──────────────────────────────────────────────
  const getUser    = () => _user;
  const getProfile = () => _profile;
  const getRole    = () => _profile?.role || 'client';
  const isAdmin    = () => getRole() === 'admin';
  const isCoach    = () => getRole() === 'coach';
  const isAdminOrCoach = () => ['admin','coach'].includes(getRole());

  // ── Load profile from DB ────────────────────────────────────
  async function loadProfile(user) {
    _user = user;
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (data && !error) {
      _profile = data;
    } else {
      // Graceful fallback — new user before trigger fires
      _profile = {
        id:        user.id,
        email:     user.email,
        full_name: user.user_metadata?.full_name || user.email.split('@')[0],
        role:      user.user_metadata?.role || 'client',
      };
    }
    return _profile;
  }

  // ── Subscription gating ─────────────────────────────────────
  // Delegated to SubscriptionService (single source of truth). Returns
  // the effective state object and caches it on the profile so every
  // module can read it synchronously via Auth.getSubscriptionState().
  //
  // Gate rule (locked):
  //   active | grace  → login allowed, writes allowed
  //   expired | none  → login blocked (UI shows #screen-subscription-inactive)
  //   pending         → login blocked until coach activates
  async function _refreshSubscriptionState(userId) {
    if (typeof SubscriptionService === 'undefined') {
      // Service not loaded — fail open in dev but warn loudly.
      console.warn('[auth] SubscriptionService missing; allowing login');
      return { effective_status: 'active', _unverified: true };
    }
    const state = await SubscriptionService.getEffectiveState(userId, { force: true });
    if (_profile) _profile.subscription = state;
    return state;
  }

  // Thrown by login/init when access must be denied. UI catches the
  // code and routes to the inactive screen instead of the toast path.
  class SubscriptionInactiveError extends Error {
    constructor(state) {
      super('Subscription inactive');
      this.code  = 'SUBSCRIPTION_INACTIVE';
      this.state = state;
    }
  }

  // Thrown by login/init when the user must accept the CURRENT required legal
  // documents before entering the app. The UI catches this code and shows the
  // #screen-legal-required gate (fail-closed) instead of the dashboard. Unlike
  // the subscription gate, this does NOT sign the user out — the live session is
  // deliberately kept so record_legal_acceptance() (which needs auth.uid()) can
  // run when the user accepts.
  class LegalAcceptanceRequiredError extends Error {
    constructor() {
      super('Legal acceptance required');
      this.code = 'LEGAL_ACCEPTANCE_REQUIRED';
    }
  }

  function _gateClient(state) {
    const s = state?.effective_status || 'none';
    // active + grace get through. Everything else is blocked.
    return s === 'active' || s === 'grace';
  }

  // ── Legal acceptance helpers ────────────────────────────────
  // Backend-persisted, versioned acceptance. The DB is the source of truth:
  //   has_accepted_current_legal(uid)     → compliance read (RLS self/admin)
  //   record_legal_acceptance(jsonb,text) → validated, role-stamped write
  // No raw inserts, no client-stamped role, no hard-coded versions, no pre-auth call.
  // R1C-Auth-Gate-2: the global post-login gate was REMOVED — existing users are
  // NEVER blocked at login/boot. These helpers remain for the legal-acceptance
  // shell and for recording acceptance at a post-auth point during NEW-account
  // signup only.
  const _LEGAL_REQUIRED = ['terms', 'privacy', 'medical_disclaimer', 'health_data_consent'];

  async function hasAcceptedCurrentLegal(userId) {
    const { data, error } = await sb.rpc('has_accepted_current_legal', { p_user_id: userId });
    if (error) throw error;
    return data === true;
  }

  // Fetch the CURRENT version of each legal doc from the DB (never hard-coded).
  // Throws a coded LEGAL_DOCS_UNAVAILABLE error if a required current doc is missing.
  async function getCurrentLegalVersions() {
    const { data, error } = await sb
      .from('legal_documents')
      .select('doc_type, version')
      .eq('is_current', true);
    if (error) throw error;
    const versions = {};
    (data || []).forEach(d => { versions[d.doc_type] = d.version; });
    for (const k of _LEGAL_REQUIRED) {
      if (!versions[k]) {
        const e = new Error('Legal documents are temporarily unavailable.');
        e.code = 'LEGAL_DOCS_UNAVAILABLE';
        throw e;
      }
    }
    return versions;   // {terms, privacy, medical_disclaimer, health_data_consent, refund?, cookie?}
  }

  // Safe write path — the RPC validates versions and stamps role server-side.
  async function recordLegalAcceptance(versions, source) {
    const { data, error } = await sb.rpc('record_legal_acceptance', {
      p_versions: versions, p_source: source,
    });
    if (error) throw error;
    return data;       // acceptance id
  }

  // Full accept flow for the gate UI: fetch current versions → record (correct
  // source) → re-check. Returns true on confirmed acceptance, else throws.
  async function acceptCurrentLegal() {
    if (!_user) { const e = new Error('Not authenticated.'); e.code = 'NOT_AUTHENTICATED'; throw e; }
    const versions = await getCurrentLegalVersions();
    // First acceptance vs re-acceptance after a version change (audit label only).
    let source = 'first_login_gate';
    try {
      const { count } = await sb
        .from('legal_acceptances')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', _user.id);
      if (count && count > 0) source = 'reaccept_version_change';
    } catch (_) { /* non-fatal — default to first_login_gate */ }
    await recordLegalAcceptance(versions, source);
    const ok = await hasAcceptedCurrentLegal(_user.id);
    if (!ok) throw new Error('Acceptance could not be confirmed.');
    return true;
  }

  // ── Legal acceptance gate (post-auth, all roles) ────────────
  // Fail-CLOSED: entry is blocked unless the user has already accepted the
  // CURRENT required legal documents (checked server-side via the RPC). ANY
  // error — network, RPC, missing session — is treated as "not confirmed" and
  // also blocks, so the user lands on the retry-able #screen-legal-required gate
  // and NEVER on the dashboard. Role-neutral (admin/coach/client). Does NOT sign
  // the user out: the live session is required for record_legal_acceptance().
  // Callers run this as the FINAL step, after the subscription decision, so a
  // definitively inactive client still gets the subscription screen first.
  async function _gateLegal() {
    if (!_user?.id) throw new LegalAcceptanceRequiredError();
    let accepted = false;
    try {
      accepted = await hasAcceptedCurrentLegal(_user.id);
    } catch (e) {
      console.warn('[auth] legal acceptance check failed (fail-closed):', e.message);
      throw new LegalAcceptanceRequiredError();
    }
    if (!accepted) throw new LegalAcceptanceRequiredError();
  }

  // ── Login ────────────────────────────────────────────────────
  async function login(email, password) {
    // A paused/cold Supabase project can take 30–90s to wake on the first
    // request, so we allow 75s here (was 20s — too short, it fired before
    // the server finished waking). One automatic retry covers the case
    // where the first call only triggered the wake and then errored.
    const attempt = () => {
      const timeout = new Promise((_, reject) => setTimeout(
        () => reject(new Error('Login timed out. Supabase server may be paused or unreachable. Please try again in a moment.')),
        75000));
      return Promise.race([ sb.auth.signInWithPassword({ email, password }), timeout ]);
    };
    try {
      let result;
      try {
        result = await attempt();
        if (result.error && /fetch|network|timed out/i.test(result.error.message || '')) throw result.error;
      } catch (firstErr) {
        // First call may have just woken the project — wait briefly and retry once.
        if (/timed out|fetch|network|Failed to fetch/i.test(firstErr.message || '')) {
          await new Promise((r) => setTimeout(r, 3000));
          result = await attempt();
        } else {
          throw firstErr;
        }
      }
      const { data, error } = result;
      if (error) {
        // Phase 4 — unverified coach (mailer_autoconfirm=false). Surface a
        // coded error so the UI shows the verification-required screen.
        if (/email not confirmed|not confirmed|confirm your email/i.test(error.message || '')) {
          const ne = new Error('Please verify your email before signing in.');
          ne.code = 'EMAIL_NOT_CONFIRMED'; ne.email = email;
          throw ne;
        }
        throw new Error(error.message);
      }
      await loadProfile(data.user);
      // Phase 4 — promote a verified self-signup coach BEFORE the client gate
      // (a new coach is briefly role=client and would otherwise be blocked as
      // an inactive client).
      await _maybeClaimCoach(data.user);
      // Subscription gate for clients (active + grace pass through).
      if (_profile.role === 'client') {
        const state = await _refreshSubscriptionState(data.user.id);
        // Transient read failure — do NOT sign out / bounce. Surface a retry
        // on the login screen so a valid client isn't locked out by a blip.
        if (state?.effective_status === 'unknown') {
          const ne = new Error('We couldn’t verify your subscription. Check your connection and try again.');
          ne.code = 'SUBSCRIPTION_CHECK_FAILED';
          throw ne;
        }
        if (!_gateClient(state)) {
          await _gateSignOut();
          _user = null; _profile = null;
          throw new SubscriptionInactiveError(state);
        }
      }
      // Legal acceptance gate — final step, all roles, after the subscription
      // decision above. Fail-closed; keeps the session alive (no sign-out).
      await _gateLegal();
      return _profile;
    } catch(e) {
      if (e?.code === 'SUBSCRIPTION_INACTIVE') throw e;
      if (e?.code === 'LEGAL_ACCEPTANCE_REQUIRED') throw e;
      if (e?.code === 'EMAIL_NOT_CONFIRMED') throw e;
      if (e.message.includes('timed out')) {
        throw new Error('Unable to connect to authentication server. The server may be waking up from pause - please wait a moment and try again.');
      }
      throw e;
    }
  }

  // ── Logout ───────────────────────────────────────────────────
  async function logout() {
    await sb.auth.signOut({ scope: 'local' });
    _user = null;
    _profile = null;
  }

  // ── Password Reset ───────────────────────────────────────────
  async function sendPasswordReset(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href
    });
    if (error) throw new Error(error.message);
  }

  async function updatePassword(newPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }

  // ── Init: check existing session ────────────────────────────
  async function init() {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Session check timed out')), 60000));
    try {
      const { data: { session } } = await Promise.race([sb.auth.getSession(), timeout]);
      if (session?.user) {
        await loadProfile(session.user);
        // Phase 4 — promote a verified self-signup coach before the client gate.
        await _maybeClaimCoach(session.user);
        // Recheck subscription on page reload for clients
        if (_profile.role === 'client') {
          const state = await _refreshSubscriptionState(session.user.id);
          // Transient read failure on a returning session — keep the valid
          // session read-only (via canWrite) and fall through to the legal gate
          // below; do NOT bounce. Only a definitively inactive subscription
          // blocks here with the dedicated inactive screen.
          if (state?.effective_status !== 'unknown' && !_gateClient(state)) {
            await _gateSignOut();
            _user = null; _profile = null;
            throw new SubscriptionInactiveError(state);
          }
        }
        // Legal acceptance gate — final step, all roles, after the subscription
        // decision above. Fail-closed; keeps the session alive (no sign-out).
        await _gateLegal();
        return _profile;
      }
      return null;
    } catch(e) {
      if (e?.code === 'SUBSCRIPTION_INACTIVE') throw e;
      // Must re-throw so app.html can show the legal gate. Returning null here
      // would bounce a valid, authenticated user to the marketing landing.
      if (e?.code === 'LEGAL_ACCEPTANCE_REQUIRED') throw e;
      console.error('Auth init error:', e.message);
      return null;
    }
  }

  // ── Sync accessors for cached subscription state ────────────────
  function getSubscriptionState() {
    return _profile?.subscription || null;
  }
  // Write-gate read by future workout / routine modules. Delegates
  // straight to SubscriptionService so the rule lives in one place.
  function canWrite() {
    if (!_profile) return false;
    if (_profile.role !== 'client') return true;  // coaches/admins always.
    if (typeof SubscriptionService === 'undefined') return true;
    return SubscriptionService.canWrite(_profile.subscription);
  }

  // ── Listen for auth state changes ────────────────────────────
  function listen(callback) {
    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        callback('PASSWORD_RECOVERY', null);
        return;
      }
      if (event === 'SIGNED_OUT') {
        _user = null; _profile = null;
        callback('SIGNED_OUT', null);
        return;
      }
      if (event === 'SIGNED_IN' && session?.user) {
        if (!_profile) await loadProfile(session.user);
        callback('SIGNED_IN', _profile);
      }
    });
  }

  // ── Guest / demo login ─────────────────────────────────────
  // Demo accounts aren't provisioned in this build. Rather than leaving
  // the UI button calling an undefined method (TypeError), expose a
  // graceful stub that surfaces the state to the caller.
  function loginAsGuest() {
    const err = new Error(
      'Demo accounts are not provisioned on this instance. '
      + 'Contact admin@neucore.io for a trial — or sign in with your account.'
    );
    err.code = 'DEMO_UNAVAILABLE';
    throw err;
  }

  // ── Phase 4 — public coach signup ───────────────────────────
  // Uses Supabase's real email verification (mailer_autoconfirm=false →
  // signUp sends a confirmation email and returns NO session). role is
  // requested via metadata only; handle_new_user still forces 'client' and
  // promotion happens server-side in claim-coach after verification.
  async function signUpCoach({ email, password, full_name, phone, country }) {
    const redirect = `${window.location.origin}${window.location.pathname}?login=1`;
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { full_name, role_request: 'coach', phone, country },
        emailRedirectTo: redirect,
      },
    });
    if (error) throw new Error(error.message);
    return data;                       // data.session is null until verified
  }

  async function resendVerification(email) {
    const { error } = await sb.auth.resend({ type: 'signup', email });
    if (error) throw new Error(error.message);
  }

  // Promote a freshly-verified self-signup coach (role_request metadata)
  // from client → coach via the claim-coach edge (service-role, fully
  // re-validated server-side). Best-effort + idempotent; on failure the
  // user simply stays a client (fail-closed).
  async function _maybeClaimCoach(user) {
    try {
      if (_profile?.role !== 'client') return;
      if (user?.user_metadata?.role_request !== 'coach') return;
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (!token) return;
      const base = (typeof SUPABASE_URL !== 'undefined') ? SUPABASE_URL : window.SUPABASE_URL;
      const res = await fetch(`${base}/functions/v1/claim-coach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;
      const j = await res.json();
      if (j?.role === 'coach') await loadProfile(user);   // reload → role now coach
    } catch (e) {
      console.warn('[auth] coach claim skipped:', e.message);
    }
  }

  return {
    getUser, getProfile, getRole, isAdmin, isCoach, isAdminOrCoach,
    login, logout, signOut: logout, sendPasswordReset, updatePassword, init, listen,
    loadProfile, consumeGateSignout,
    // Subscription:
    getSubscriptionState, canWrite,
    // Legal acceptance helpers (signup-time + shell; NOT a global login gate):
    hasAcceptedCurrentLegal, getCurrentLegalVersions, recordLegalAcceptance, acceptCurrentLegal,
    // Phase 4 — public coach signup:
    signUpCoach, resendVerification,
    // Demo:
    loginAsGuest,
    // Error types (UI compares e.code):
    SubscriptionInactiveError,
    LegalAcceptanceRequiredError,
  };
})();

window.Auth = Auth;
