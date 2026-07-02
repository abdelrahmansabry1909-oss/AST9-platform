/* ═══════════════════════════════════════════════════════════════
   NeuCore Visitor Entry Flow — Phase 1 §1C  (dropdown variant)
   "Start Assessment" buttons open an anchored dropdown with 2 options:
     • Talk with an Expert  → Calendly booking page (new tab)
     • Take a Quick Survey  → in-page survey modal (posts to edge fn)

   Public API:
     window.Visitor.openSurvey()    — open survey form directly
     window.Visitor.close()         — dismiss the survey modal
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Config ─────────────────────────────────────────────────
  const SUPABASE_URL = 'https://byquokhcbagofshsclfy.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cXVva2hjYmFnb2ZzaHNjbGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NzIxMjAsImV4cCI6MjA5MzM0ODEyMH0.wRJlvde8qm0TmFOQXZtAePwsb9F5djA5kdJlBzL3O1A';
  const FN_URL = `${SUPABASE_URL}/functions/v1/visitor-survey`;
  const CALENDLY_URL = 'https://calendly.com/abdelrahman-sabry-1909/talk-with-an-expert';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ── Element refs (lazy) ────────────────────────────────────
  let modal, stepChoice, stepSurvey, stepSuccess, form, errorEl, submitBtn;

  function _resolve() {
    if (modal) return;
    modal       = document.getElementById('visitor-modal');
    stepChoice  = document.getElementById('visitor-step-choice');
    stepSurvey  = document.getElementById('visitor-step-survey');
    stepSuccess = document.getElementById('visitor-step-success');
    form        = document.getElementById('visitor-survey-form');
    errorEl     = document.getElementById('visitor-error');
    submitBtn   = document.getElementById('visitor-submit');
  }

  function _showStep(which) {
    _resolve();
    if (stepChoice)  stepChoice.style.display  = which === 'choice'  ? '' : 'none';
    if (stepSurvey)  stepSurvey.classList.toggle('show', which === 'survey');
    if (stepSuccess) stepSuccess.classList.toggle('show', which === 'success');
  }

  function _open(which = 'choice') {
    _resolve();
    if (!modal) return;
    _showStep(which);
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function _close() {
    _resolve();
    if (!modal) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    // Reset form for next open
    if (form) form.reset();
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('show'); }
    _showStep('choice');
  }

  function _showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.classList.add('show');
  }

  function _clearError() {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.classList.remove('show');
  }

  function _validate(payload) {
    if (!payload.full_name || payload.full_name.length < 2) return 'Please enter your full name.';
    if (payload.full_name.length > 120)                     return 'Name is too long.';
    if (!EMAIL_RE.test(payload.email))                      return 'Please enter a valid email.';
    if (payload.phone && payload.phone.length > 40)         return 'Phone number is too long.';
    if (payload.symptoms && payload.symptoms.length > 4000) return 'Please shorten your description.';
    return null;
  }

  async function _submit(e) {
    e?.preventDefault();
    _clearError();

    const payload = {
      full_name: form.full_name.value.trim(),
      email:     form.email.value.trim().toLowerCase(),
      phone:     form.phone.value.trim() || undefined,
      symptoms:  form.symptoms.value.trim() || undefined,
      source:    'survey',
    };

    const err = _validate(payload);
    if (err) { _showError(err); return; }

    submitBtn.disabled    = true;
    const originalLabel   = submitBtn.textContent;
    submitBtn.textContent = 'Sending…';

    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey':       SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      _showStep('success');
    } catch (err) {
      console.error('[Visitor] survey submit failed:', err?.message || String(err));
      _showError(err.message || 'Something went wrong. Please try again.');
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = originalLabel;
    }
  }

  // ── Dropdown menu ──────────────────────────────────────────
  const ICON_CALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0 1 22 16.92z"/></svg>';
  const ICON_SURVEY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';

  function _buildDropdown(anchorRight) {
    const dd = document.createElement('div');
    dd.className = 'nc-assess-dropdown' + (anchorRight ? '' : ' nc-assess-dropdown--left');
    dd.innerHTML = `
      <button class="nc-assess-item" type="button" data-assess="call">
        <span class="nc-assess-item-icon">${ICON_CALL}</span>
        <span class="nc-assess-item-body">
          <span class="nc-assess-item-title">Talk with an Expert</span>
          <span class="nc-assess-item-desc">Book a 15-min consult with a NeuCore clinician.</span>
        </span>
      </button>
      <button class="nc-assess-item" type="button" data-assess="survey">
        <span class="nc-assess-item-icon">${ICON_SURVEY}</span>
        <span class="nc-assess-item-body">
          <span class="nc-assess-item-title">Take a Quick Survey</span>
          <span class="nc-assess-item-desc">90 seconds — we'll match you to the right specialist.</span>
        </span>
      </button>
    `;
    return dd;
  }

  function _closeAllMenus(except) {
    document.querySelectorAll('.nc-assess-menu.open').forEach(m => {
      if (m !== except) m.classList.remove('open');
    });
  }

  function _wireTriggers() {
    document.querySelectorAll('[data-visitor-trigger]').forEach(btn => {
      if (btn._assessWired) return;
      btn._assessWired = true;

      // Wrap the button in a positioned menu container
      const menu = document.createElement('span');
      menu.className = 'nc-assess-menu';
      btn.parentNode.insertBefore(menu, btn);
      menu.appendChild(btn);

      // Nav buttons anchor right; mid-page buttons anchor left
      const anchorRight = !!btn.closest('.nc-nav');
      const dd = _buildDropdown(anchorRight);
      menu.appendChild(dd);

      // Toggle on button click
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = menu.classList.contains('open');
        _closeAllMenus(menu);
        menu.classList.toggle('open', !isOpen);
      });

      // Option clicks
      dd.querySelector('[data-assess="call"]').addEventListener('click', () => {
        menu.classList.remove('open');
        window.open(CALENDLY_URL, '_blank', 'noopener');
      });
      dd.querySelector('[data-assess="survey"]').addEventListener('click', () => {
        menu.classList.remove('open');
        _open('survey');
      });
    });
  }

  // ── Wire DOM ───────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    _resolve();

    // Build the assessment dropdowns
    _wireTriggers();

    // Close menus on outside click / Escape
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nc-assess-menu')) _closeAllMenus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _closeAllMenus();
    });

    if (!modal) return;

    // Close buttons
    document.querySelectorAll('[data-visitor-close]').forEach(btn => {
      btn.addEventListener('click', _close);
    });

    // Form submit
    form?.addEventListener('submit', _submit);

    // Backdrop click closes
    modal.addEventListener('click', (e) => {
      if (e.target === modal) _close();
    });

    // Escape closes the survey modal too
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) _close();
    });
  });

  // ── Public API ─────────────────────────────────────────────
  window.Visitor = {
    openSurvey:  () => _open('survey'),
    close:       _close,
  };
})();
