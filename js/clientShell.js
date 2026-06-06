/* ═══════════════════════════════════════════════════════════════
   js/clientShell.js — Mobile client shell (Recovery Journey, S0)

   A role-gated bottom tab bar for clients on mobile. It is purely
   additive: it drives the EXISTING Dashboard.showSection() router, so
   no existing section, coach flow, or desktop layout is changed.

   Tabs (S0 routing; later steps refine each destination's content):
     Today    -> dashboard         client home
     Train    -> daily-routine     guided journey lands here; Program merges in S2
     Progress -> client-progress   analytics home; mounts existing panel in S0
     Coach    -> notifications     inbox + nudges
     More     -> bottom sheet      Advanced Insights, Nutrition, Settings, ...

   init() is called from UI._showApp() after Dashboard.initShell(). For
   non-clients it removes the body flag and does nothing else.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // Primary tab id -> existing section id (routed via Dashboard.showSection).
  const TAB_SECTION = {
    today:    'dashboard',
    train:    'daily-routine',
    progress: 'client-progress',
    coach:    'notifications',
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
        if (typeof Dashboard !== 'undefined') Dashboard.showSection(id);
        setActive(null);           // More destinations are not a primary tab
      });
    });
  }

  function go(tab) {
    if (tab === 'more') { openMore(); return; }
    const section = TAB_SECTION[tab];
    if (!section || typeof Dashboard === 'undefined') return;
    Dashboard.showSection(section);
    // S0: the Progress tab section has no Dashboard loader yet, so mount the
    // existing client progression panel here to land on a real screen.
    // S3 replaces this with trends + assessment history + hologram.
    if (tab === 'progress') _mountProgress();
    setActive(tab);
  }

  function _mountProgress() {
    const host = document.getElementById('client-progress-root');
    if (host && typeof Progression !== 'undefined' && Progression.mountClientPanel) {
      Progression.mountClientPanel(host);
    }
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
