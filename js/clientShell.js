/* ═══════════════════════════════════════════════════════════════
   js/clientShell.js — Mobile client shell (Recovery Journey, S0)

   A role-gated bottom tab bar for clients on mobile. It is purely
   additive: it drives the EXISTING Dashboard.showSection() router, so
   no existing section, coach flow, or desktop layout is changed.

   Tabs (current routing):
     Today    -> dashboard         client home (status-first, S1)
     Train    -> client-train      guided recovery journey (S2)
     Progress -> client-progress   recovery momentum home (S3)
     Coach    -> client-coach      recovery support screen (S4)
     More     -> bottom sheet      Recovery / Wellness / Resources / Account (S4)

   init() is called from UI._showApp() after Dashboard.initShell(). For
   non-clients it removes the body flag and does nothing else.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // Primary tab id -> existing section id (routed via Dashboard.showSection).
  const TAB_SECTION = {
    today:    'dashboard',
    train:    'client-train',
    progress: 'client-progress',
    coach:    'client-coach',
  };

  let _wired = false;

  function init() {
    const isClient = (typeof Auth !== 'undefined' && Auth.getRole && Auth.getRole() === 'client');
    if (!isClient) { document.body.classList.remove('nc-client'); return; }
    document.body.classList.add('nc-client');
    _wireOnce();
    setActive('today');            // _showApp lands on the client dashboard
  }

  function _wireOnce() {
    if (_wired) return;
    _wired = true;

    document.querySelectorAll('#nc-tabbar .nc-tab').forEach((btn) => {
      btn.addEventListener('click', () => go(btn.dataset.tab));
    });

    const sheet = document.getElementById('nc-more-sheet');
    sheet?.querySelector('.nc-sheet-scrim')?.addEventListener('click', closeMore);
    sheet?.querySelectorAll('[data-section]').forEach((link) => {
      link.addEventListener('click', () => {
        const id = link.dataset.section;
        closeMore();
        if (id === '__logout') { (typeof UI !== 'undefined') && UI.handleLogout?.(); return; }
        // Optional deep-link into a Progress disclosure (Recovery group).
        if (link.dataset.open) window._cpOpen = link.dataset.open;
        if (typeof Dashboard !== 'undefined') Dashboard.showSection(id);
        setActive(null);           // More destinations are not a primary tab
      });
    });
  }

  function go(tab) {
    if (tab === 'more') { openMore(); return; }
    const section = TAB_SECTION[tab];
    if (!section || typeof Dashboard === 'undefined') return;
    // Section content is mounted by the Dashboard.showSection loaders, shared
    // by these mobile tabs and the desktop client sidebar items (S3).
    Dashboard.showSection(section);
    setActive(tab);
  }

  function setActive(tab) {
    document.querySelectorAll('#nc-tabbar .nc-tab').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
    });
  }

  function openMore()  { document.getElementById('nc-more-sheet')?.classList.add('is-open'); }
  function closeMore() { document.getElementById('nc-more-sheet')?.classList.remove('is-open'); }

  window.ClientShell = { init, go };
})();
