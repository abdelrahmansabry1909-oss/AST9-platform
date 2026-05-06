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

  // ── Check client subscription ───────────────────────────────
  async function checkSubscription(userId) {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await sb
      .from('subscriptions')
      .select('id, end_date, status')
      .eq('client_id', userId)
      .eq('status', 'active')
      .gte('end_date', today)
      .limit(1);
    return !!(data && data.length > 0);
  }

  // ── Login ────────────────────────────────────────────────────
  async function login(email, password) {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Login timed out. Supabase server may be paused or unreachable. Please try again in a moment.')), 20000));
    try {
      const { data, error } = await Promise.race([
        sb.auth.signInWithPassword({ email, password }),
        timeout
      ]);
      if (error) throw new Error(error.message);
      await loadProfile(data.user);
      // Block expired clients
      if (_profile.role === 'client') {
        const ok = await checkSubscription(data.user.id);
        if (!ok) {
          await sb.auth.signOut();
          _user = null; _profile = null;
          throw new Error('Your subscription has expired. Please contact your coach to renew access.');
        }
      }
      return _profile;
    } catch(e) {
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
        // Recheck subscription on page reload for clients
        if (_profile.role === 'client') {
          const ok = await checkSubscription(session.user.id);
          if (!ok) {
            await sb.auth.signOut();
            _user = null; _profile = null;
            return null;
          }
        }
        return _profile;
      }
      return null;
    } catch(e) {
      console.error('Auth init error:', e.message);
      return null;
    }
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

  return {
    getUser, getProfile, getRole, isAdmin, isCoach, isAdminOrCoach,
    login, logout, sendPasswordReset, updatePassword, init, listen,
    loadProfile,
  };
})();

window.Auth = Auth;
