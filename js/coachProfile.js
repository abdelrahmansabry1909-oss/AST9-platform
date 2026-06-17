/* ═══════════════════════════════════════════════════════════════
   NeuCore — Coach Profile (Phase 10)

   A coach/admin-only surface where a coach manages their own business
   details: name, mobile, country, business/clinic name, professional
   title, and Calendly link. These write to the caller's OWN profiles row
   (RLS "Users update own profile"); role / assigned_coach / package /
   client-limit are NOT editable here and remain protected server-side.

   No payment, no package self-service — package + client limit are
   admin-assigned. Reuses the existing card/form premium styles and the
   UI._COUNTRIES list shared with signup.

   Public API (window.CoachProfile): render(), save()
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  const _toast = (m, k) => { if (typeof Dashboard !== 'undefined') Dashboard.toast?.(m, k); };

  let _profile = null;

  async function _fetch() {
    const uid = Auth.getUser?.()?.id;
    if (!uid || typeof sb === 'undefined') return null;
    const { data, error } = await sb.from('profiles')
      .select('full_name,email,phone,country,business_name,professional_title,calendly_url')
      .eq('id', uid).single();
    if (error) { console.warn('[coachProfile] fetch:', error.message); return null; }
    return data;
  }

  // Country <select> options, reusing the signup country list. A stored value
  // outside the list (e.g. legacy) is preserved as its own option.
  function _countryOptions(current) {
    const list = (typeof UI !== 'undefined' && Array.isArray(UI._COUNTRIES)) ? UI._COUNTRIES : [];
    const all = (!current || list.includes(current)) ? list : [current, ...list];
    return ['<option value="">Select your country…</option>']
      .concat(all.map((c) => `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(c)}</option>`))
      .join('');
  }

  function _row(label, inputHtml, hint) {
    return `<div class="form-group">
        <label class="form-label">${esc(label)}</label>
        ${inputHtml}
        ${hint ? `<div class="form-hint">${esc(hint)}</div>` : ''}
      </div>`;
  }

  async function render() {
    const host = $('coach-profile-root');
    if (!host) return;
    host.innerHTML = `<div class="card" style="text-align:center;padding:40px;color:var(--text-tertiary)"><span class="spinner"></span></div>`;
    _profile = await _fetch();
    if (!_profile) {
      host.innerHTML = `<div class="card" style="padding:24px;color:var(--text-secondary)">Could not load your profile. Please refresh.</div>`;
      return;
    }
    const p = _profile;
    host.innerHTML = `
      <div class="card" style="max-width:680px">
        <div class="card-header"><span class="card-title">Business details</span></div>
        ${_row('Full name', `<input id="cp-full-name" class="form-input" type="text" value="${esc(p.full_name)}" placeholder="Your name">`)}
        ${_row('Email', `<input class="form-input" type="email" value="${esc(p.email)}" disabled>`, 'Your sign-in email — contact your admin to change it.')}
        ${_row('Mobile number', `<input id="cp-phone" class="form-input" type="tel" value="${esc(p.phone)}" placeholder="+1 555 123 4567" autocomplete="tel">`)}
        ${_row('Country', `<select id="cp-country" class="form-input">${_countryOptions(p.country || '')}</select>`)}
        ${_row('Business / clinic name', `<input id="cp-business" class="form-input" type="text" value="${esc(p.business_name)}" placeholder="e.g. AST9 Physiotherapy">`)}
        ${_row('Professional title', `<input id="cp-title" class="form-input" type="text" value="${esc(p.professional_title)}" placeholder="e.g. Physiotherapist, DPT">`)}
        ${_row('Calendly link', `<input id="cp-calendly" class="form-input" type="url" value="${esc(p.calendly_url)}" placeholder="https://calendly.com/you">`, 'Used for client scheduling links.')}
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-primary" id="cp-save" onclick="CoachProfile.save()">Save profile</button>
        </div>
        <div class="form-hint" style="margin-top:10px">Your package and client limit are assigned by your admin and are not editable here.</div>
      </div>`;
  }

  async function save() {
    const uid = Auth.getUser?.()?.id;
    if (!uid) return;
    const patch = {
      full_name:          ($('cp-full-name')?.value || '').trim() || null,
      phone:              ($('cp-phone')?.value || '').trim() || null,
      country:            $('cp-country')?.value || null,
      business_name:      ($('cp-business')?.value || '').trim() || null,
      professional_title: ($('cp-title')?.value || '').trim() || null,
      calendly_url:       ($('cp-calendly')?.value || '').trim() || null,
    };
    const btn = $('cp-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const { error } = await sb.from('profiles').update(patch).eq('id', uid);
      if (error) throw error;
      // Refresh the cached profile so the name shown elsewhere stays in sync.
      if (typeof Auth !== 'undefined' && Auth.loadProfile && Auth.getUser) await Auth.loadProfile(Auth.getUser());
      _toast('Profile saved.', 'success');
    } catch (e) {
      console.error('[coachProfile] save:', e?.message || e);
      _toast(e?.message || 'Could not save your profile.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save profile'; }
    }
  }

  window.CoachProfile = { render, save };
})();
