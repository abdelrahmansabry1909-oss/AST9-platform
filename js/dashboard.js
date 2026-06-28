// ═══════════════════════════════════════════════════════════════
//  js/dashboard.js
//  Handles: app shell rendering, navigation, stat cards,
//           recent sessions, program generation + output,
//           toast, modal helpers, celebration overlay.
// ═══════════════════════════════════════════════════════════════

const Dashboard = (() => {

  // In-memory PDF handoff between Generate and Export buttons (per-tab).
  let _lastBundle = null;

  // ═══════════════════════════════════════════════════════════
  //  SHELL / SIDEBAR
  // ═══════════════════════════════════════════════════════════

  function initShell() {
    const p = Auth.getProfile();
    const role = Auth.getRole();

    // Wordmark
    document.getElementById('sb-avatar-char').textContent = (p?.full_name || p?.email || '?')[0].toUpperCase();
    document.getElementById('sb-user-name').textContent = p?.full_name || p?.email || '–';
    document.getElementById('sb-user-role').textContent = _roleLabel(role);

    // Dashboard welcome header (Phase G) — "Welcome back, <name>" with an
    // intelligent text reveal; the eyebrow carries the time-of-day + date.
    const now = new Date();
    const hour = now.getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const firstName = (p?.full_name || '').split(' ')[0] || 'Coach';
    const greetEl = document.getElementById('nc-dashboard-greeting');
    if (greetEl) {
      greetEl.textContent = `Welcome back, ${firstName}`;
      _revealText(greetEl);
    }
    const ctxEl = document.getElementById('nc-dash-context');
    if (ctxEl) {
      const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      ctxEl.textContent = `${greet} · ${dateStr}`;
    }

    // Role-based nav visibility
    document.querySelectorAll('.role-coach-admin').forEach(el => {
      el.style.display = Auth.isAdminOrCoach() ? '' : 'none';
    });
    document.querySelectorAll('.role-admin-only').forEach(el => {
      el.style.display = Auth.isAdmin() ? '' : 'none';
    });
    // Phase 3 — clients only see "My Graph"; coaches/admins use the Graph Builder
    document.querySelectorAll('.role-client-only').forEach(el => {
      el.style.display = (Auth.getRole() === 'client') ? '' : 'none';
    });

    // Update Service Switcher label for coaches
    const switcherAthleticBtn = document.getElementById('switcher-athletic');
    if (switcherAthleticBtn) {
      if (Auth.getRole() === 'coach') {
        switcherAthleticBtn.innerHTML = 'Performance 🔒';
      } else {
        switcherAthleticBtn.innerHTML = 'Performance';
      }
    }

    // Admin email
    const adminEmailEl = document.getElementById('admin-email-display');
    if (adminEmailEl) adminEmailEl.textContent = p?.email || '–';

    // Populate topbar profile details (Phase R1G)
    const topbarAvatar = document.getElementById('topbar-avatar-char');
    if (topbarAvatar) topbarAvatar.textContent = (p?.full_name || p?.email || '?')[0].toUpperCase();
    const topbarName = document.getElementById('topbar-user-name');
    if (topbarName) topbarName.textContent = (p?.full_name || p?.email || 'Coach').split(' ')[0];

    loadDashboardStats();
    _populateClientSelects();
    setService('rehab');
  }

  function setService(service) {
    const validServices = ['rehab', 'athletic'];
    if (!validServices.includes(service)) service = 'rehab';

    // Gate Athletic Performance for non-admins
    if (service === 'athletic' && Auth.getRole() !== 'admin') {
      openModal('modal-athletic-locked');
      // Reset active button state to Rehab
      const rehabBtn = document.getElementById('switcher-rehab');
      const athleticBtn = document.getElementById('switcher-athletic');
      if (rehabBtn) rehabBtn.classList.add('active');
      if (athleticBtn) athleticBtn.classList.remove('active');
      document.body.classList.remove('service-athletic');
      document.body.classList.add('service-rehab');
      return false;
    }

    document.body.classList.remove('service-rehab', 'service-athletic');
    document.body.classList.add('service-' + service);

    document.querySelectorAll('.nc-service-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    const activeBtn = document.getElementById('switcher-' + service);
    if (activeBtn) activeBtn.classList.add('active');

    if (service === 'athletic') {
      showSection('athletic-dashboard');
    } else {
      showSection('dashboard');
    }
  }

  function _roleLabel(role) {
    return { admin: '⬡ Admin', coach: '◉ Coach', client: '◌ Client' }[role] || role;
  }

  // ═══════════════════════════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════════════════════════

  // Role-routing safety (Phase 1). RLS already blocks the *data* a wrong
  // role could request; these allow-lists stop the wrong *shell* from
  // rendering at all — a client who manually calls showSection('clients')
  // (stale deep-link, old nav path, console) is bounced home instead of
  // landing on an empty/broken coach screen. Source of truth mirrors the
  // nav role-classes in app.html. Coaches/admins are unaffected.
  const CLIENT_SAFE_SECTIONS = new Set([
    'dashboard', 'client-dashboard',
    'client-train', 'client-progress', 'client-coach', 'client-settings',
    'my-graph', 'nutrition-plan', 'case-studies', 'community', 'services',
  ]);
  const ADMIN_ONLY_SECTIONS = new Set(['coaches', 'admin-business', 'settings']);
  const ATHLETIC_SECTIONS = new Set([
    'athletic-dashboard',
    'athlete-story-intake',
    'athletic-movement-assessment',
    'athletic-movement-twin',
    'athlete-profile',
    'movement-deficit-profile',
    'athletic-program-design',
    'periodization-calendar',
    'performance-reports',
    'ml-insights'
  ]);

  function showSection(id) {
    // BUG 3 — capture the section we're leaving so we can tear down its
    // Community realtime subscriptions (below) instead of letting them linger.
    const _leavingSection = document.querySelector('.section.active')?.id || null;
    // Phase 1 guard — keep each role inside the sections it may use.
    const _role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : 'client';
    if (ATHLETIC_SECTIONS.has(id) && _role !== 'admin') {
      if (_role === 'client') {
        id = 'dashboard';
      } else {
        id = 'dashboard';
        openModal('modal-athletic-locked');
      }
    } else if (_role === 'client' && !CLIENT_SAFE_SECTIONS.has(id)) {
      id = 'dashboard';                          // client → own home
    } else if (_role !== 'admin' && ADMIN_ONLY_SECTIONS.has(id)) {
      id = 'dashboard';                          // coach → coach home (admin-only blocked)
    }

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Role-aware Home: the same #nav-dashboard activates the new client
    // dashboard for role=client, the existing coach dashboard for the rest.
    const isClient    = (typeof Auth !== 'undefined' && Auth.getRole?.() === 'client');
    const sectionId   = (id === 'dashboard' && isClient) ? 'client-dashboard' : id;

    const section = document.getElementById('section-' + sectionId);
    const navItem = document.getElementById('nav-' + id);
    if (section) section.classList.add('active');
    if (navItem)  navItem.classList.add('active');

    // Lazy-load section data
    const loaders = {
      'clients':          () => Clients.loadAll(),
      'subscriptions':    () => Subscriptions.loadAll(),
      'billing':          () => (typeof Billing !== 'undefined' && Billing.render?.()),
      'coach-profile':    () => (typeof CoachProfile !== 'undefined' && CoachProfile.render?.()),
      'coaches':          () => Clients.loadCoaches(),
      'admin-business':   () => (typeof AdminBusiness !== 'undefined' && AdminBusiness.load()),
      'dashboard':        () => {
                            // Clients land on the new Client Dashboard;
                            // coaches/admins keep the existing stats page.
                            if (isClient && typeof ClientDashboard !== 'undefined') {
                              ClientDashboard.render?.();
                            } else {
                              loadDashboardStats();
                            }
                          },
      'nutrition-plan':   () => { /* Phase A stub — static HTML only */ },
      'programs':         () => renderProgramsList(),
      'exercise-library': () => Clients.loadExercises?.(),
      // ── Appointments (coach/admin) — internal scheduling V1 ──
      'appointments':     () => {
                            if (typeof Appointments === 'undefined') return;
                            Appointments.mountCoachView(document.getElementById('appointments-root'));
                          },
      // ── NeuCore Intelligence (Task 5 + Phase B) ───────────
      'services':         () => { /* static content */ },
      'gait':             () => { /* placeholder — wired in future phase */ },
      'case-studies':     () => (typeof PlatformExtras !== 'undefined' && PlatformExtras.initCaseStudiesCarousel?.()),
      'analytics':        () => (typeof Charts !== 'undefined' && Charts.renderDashboardAnalytics?.()),
      // ── Community (everyone) — role-aware sub-tabs; renders the correct
      //    default panel on open so the first view is never blank (CX2). ──
      'community':        () => (typeof CommunityUI !== 'undefined' && CommunityUI.initCommunitySection?.()),
      // ── Phase 3 — Reactive Graph ───────────────────────────
      // graph builder now lives as the tab-graph panel inside New Session
      'my-graph':         () => (typeof RPMGraphViewer  !== 'undefined' && RPMGraphViewer.init?.()),
      // ── Phase 4 — Approval queue (RPM phases + case-study moderation) ──
      'rpm-approvals':    () => {
                            if (typeof RPMApproval !== 'undefined') RPMApproval.init?.();
                            if (typeof CommunityUI !== 'undefined') CommunityUI.renderCaseApprovals?.();
                          },
      // ── Daily Routine — role-aware (client tracker / coach dashboard) ──
      'daily-routine':    () => _mountDailyRoutineSection(),
      // ── Recovery Journey redesign — client Train + Progress (client-only).
      //    Shared by the mobile tab bar (clientShell) and the desktop client
      //    sidebar items. Coaches/admins never navigate to these sections.
      'client-train':     () => (typeof ClientTrain !== 'undefined'
                                 && ClientTrain.render && ClientTrain.render('#client-train-root')),
      'client-progress':  () => {
                            if (typeof ClientProgress === 'undefined' || !ClientProgress.render) return;
                            // Optional deep-link from More → Recovery (open a panel).
                            const open = window._cpOpen || null;
                            window._cpOpen = null;
                            ClientProgress.render('#client-progress-root', { open });
                          },
      'client-coach':     () => (typeof ClientCoach !== 'undefined'
                                 && ClientCoach.render && ClientCoach.render('#client-coach-root')),
      // ── Workout History (coach) — WorkoutSession.mountCoachView ──
      'workout-history':  () => {
                            if (typeof WorkoutSession === 'undefined') return;
                            const host = document.getElementById('workout-history-root');
                            const preselect = window._wsPreselectClient || null;
                            window._wsPreselectClient = null;
                            WorkoutSession.mountCoachView(host, { preselectClientId: preselect });
                          },
      // ── Client Settings (client-only) — change password + view sub state ──
      'client-settings':  () => _renderClientSettings(),
      // ── Progression (coach) — 4-score overview + per-client detail ──
      'progression':      () => {
                            if (typeof Progression === 'undefined') return;
                            const host = document.getElementById('progression-root');
                            Progression.mountCoachOverview(host);
                          },
      // ── Notifications inbox (everyone) + coach Alt-Exercise inbox ──
      'notifications':    () => {
                            const inboxHost = document.getElementById('notifications-root');
                            const altHost   = document.getElementById('alt-requests-root');
                            if (typeof Notifications !== 'undefined') {
                              Notifications.mountInbox(inboxHost);
                            }
                            if (typeof AltExercise !== 'undefined' && Auth.isAdminOrCoach?.()) {
                              // Optional deep-link preselect via notification link_params.
                              const p = window._notifParams || {};
                              window._notifParams = null;
                              AltExercise.mountInbox(altHost, {
                                preselectClientId: p.client_id || null,
                              });
                            } else if (altHost) {
                              altHost.innerHTML = '';
                            }
                          },
      'athletic-dashboard': () => {
                            if (typeof AthleticService !== 'undefined') {
                              AthleticService.populateAthleteSelects();
                              AthleticService.loadDashboard();
                            }
                          },
      'athlete-story-intake': () => {
                            if (typeof AthleticService !== 'undefined') {
                              AthleticService.populateAthleteSelects();
                              AthleticService.loadStoryIntake();
                            }
                          },
      'athletic-movement-assessment': () => {
                            if (typeof AthleticService !== 'undefined') {
                              AthleticService.populateAthleteSelects();
                              AthleticService.loadMovementAssessment();
                            }
                          },
      'athlete-profile': () => {
                            if (typeof AthleticService !== 'undefined') {
                              AthleticService.populateAthleteSelects();
                              AthleticService.loadAthleteProfile();
                            }
                          },
    };
    // BUG 3 — leaving Community: drop its realtime channels so they don't
    // linger or double-deliver if the section is re-opened.
    if (_leavingSection === 'section-community' && id !== 'community'
        && typeof CommunityUI !== 'undefined') {
      CommunityUI.teardown?.();
    }
    loaders[id]?.();
  }

  // Client Settings — populated each visit so subscription state is fresh.
  function _renderClientSettings() {
    const profile = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
    const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setText('cs-email-display', profile?.email || '–');
    setText('cs-name-display',  profile?.full_name || '–');

    const state = (typeof Auth !== 'undefined' && Auth.getSubscriptionState)
      ? Auth.getSubscriptionState() : null;
    const host  = document.getElementById('cs-sub-state');
    if (!host) return;

    if (!state || state.effective_status === 'none') {
      host.innerHTML = `<div class="empty-state" style="padding:16px 0">
        <div class="empty-title" style="font-size:14px">No subscription on file</div>
        <p class="empty-desc">Contact your coach to set up access.</p>
      </div>`;
      return;
    }
    const pill = (typeof SubscriptionService !== 'undefined')
      ? SubscriptionService.formatPill(state)
      : { label: state.effective_status, tone: 'gray' };
    const toneStyles = {
      teal:  'background:rgba(20,184,166,.14);color:var(--nc-teal,#14b8a6);border:1px solid rgba(20,184,166,.35)',
      amber: 'background:rgba(245,158,11,.14);color:#f59e0b;border:1px solid rgba(245,158,11,.35)',
      rose:  'background:rgba(244,63,94,.14);color:#f43f5e;border:1px solid rgba(244,63,94,.35)',
      gray:  'background:rgba(148,163,184,.10);color:#94a3b8;border:1px solid rgba(148,163,184,.25)',
    };
    host.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;
                     font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;
                     ${toneStyles[pill.tone] || toneStyles.gray}">
          <span style="width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.7"></span>
          ${pill.label}
        </span>
      </div>
      <div style="font-size:12px;color:var(--text-secondary);line-height:1.7">
        <div><b style="color:var(--text-primary)">Plan:</b> ${state.plan ? state.plan + ' months' : '—'}</div>
        <div><b style="color:var(--text-primary)">Start:</b> ${state.start_date || '—'}</div>
        <div><b style="color:var(--text-primary)">Ends:</b> ${state.end_date || '—'}</div>
        ${state.effective_status === 'grace' ? `
          <div style="color:#f43f5e"><b>Grace until:</b> ${state.grace_until || '—'} (${state.grace_days_left} day(s) left)</div>` : ''}
        ${state.effective_status === 'active' && state.days_remaining != null ? `
          <div><b style="color:var(--text-primary)">Days remaining:</b> ${state.days_remaining}</div>` : ''}
      </div>`;
  }

  // Populate the coach Progress Charts client picker. Called once after
  // _showApp; silently no-ops for clients/admins-without-clients.
  async function populateProgressClientSelect() {
    const sel = document.getElementById('progress-client-select');
    if (!sel) return;
    if (typeof Auth === 'undefined' || !Auth.isAdminOrCoach || !Auth.isAdminOrCoach()) return;
    let q = sb.from('profiles').select('id, full_name, email')
      .eq('role', 'client').order('full_name');
    if (Auth.isCoach && Auth.isCoach()) q = q.eq('assigned_coach', Auth.getUser()?.id);
    const { data } = await q;
    if (!data?.length) return;
    // Keep the placeholder option, append clients.
    const placeholder = sel.options[0];
    sel.innerHTML = '';
    if (placeholder) sel.appendChild(placeholder);
    data.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.full_name || c.email;
      sel.appendChild(opt);
    });
  }

  // Daily Routine section — clients get the check-off tracker, coaches/admins
  // get the adherence dashboard.
  function _mountDailyRoutineSection() {
    const host = document.getElementById('daily-routine-host');
    const sub  = document.getElementById('daily-routine-sub');
    if (!host || typeof DailyRoutine === 'undefined') return;
    let isCoach = false;
    try { isCoach = Auth.isAdminOrCoach && Auth.isAdminOrCoach(); } catch {}
    if (isCoach) {
      if (sub) sub.textContent = 'Track how consistently your clients complete their daily routine.';
      DailyRoutine.mountCoachView(host);
    } else {
      if (sub) sub.textContent = 'Move. Breathe. Reset. — your check-ins are shared with your coach.';
      DailyRoutine.mountTracker(host);
    }
  }

  // Tab switching (in-page tabs)
  function initTabs(containerSelector) {
    const rows = document.querySelectorAll(`${containerSelector} .tab-row`);
    rows.forEach(row => {
      row.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          row.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const target = btn.dataset.tab;
          const panels = row.parentElement.querySelectorAll('.tab-panel');
          panels.forEach(p => p.classList.remove('active'));
          const targetPanel = document.getElementById(target);
          if (targetPanel) targetPanel.classList.add('active');
          // Refresh Generate-tab's active-session chip whenever it opens.
          if (target === 'tab-generate') _refreshActiveSessionChip();
        });
      });
    });
  }

  // ───────────────────────────────────────────────────────────
  // Active-session chip on the Generate tab — shows the client
  // currently selected in Client Info. Replaces the legacy
  // ns-save-client dropdown so Generate has no client picker of its own.
  // ───────────────────────────────────────────────────────────
  function _activeSessionClient() {
    const sel  = document.getElementById('ns-client-select');
    const id   = sel?.value || null;
    const name = (sel && sel.selectedIndex > 0) ? sel.options[sel.selectedIndex].textContent.trim() : '';
    return { id, name };
  }

  function _refreshActiveSessionChip() {
    const host = document.getElementById('gen-active-session');
    if (!host) return;
    const { id, name } = _activeSessionClient();
    if (!id) {
      host.innerHTML = `
        <div style="color:#FCA5A5;font-weight:500;margin-bottom:6px">⚠ No active client session.</div>
        <div style="color:var(--text-secondary);font-size:12px;margin-bottom:10px">
          Please start a client session first.
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="Dashboard.openClientInfoTab()">
          → Go to Client Info
        </button>`;
      return;
    }
    const initials = (name || '?').split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
    host.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <span style="
          display:inline-flex;align-items:center;justify-content:center;
          width:34px;height:34px;border-radius:50%;
          background:linear-gradient(135deg,#14B8A6,#67E8F9);color:#07111A;
          font-weight:600;font-size:13px;">${initials}</span>
        <div>
          <div style="font-size:14px;font-weight:500;color:var(--text-primary)">${name || 'Selected client'}</div>
          <div style="font-size:11px;color:var(--text-tertiary);font-family:ui-monospace,monospace">${id.slice(0, 8)}…</div>
        </div>
      </div>`;
  }

  function openClientInfoTab() {
    // Switch the in-page tabs back to Client Info
    const btn = document.querySelector('[data-tab="tab-info"]');
    btn?.click();
  }

  // ═══════════════════════════════════════════════════════════
  //  DASHBOARD STATS
  // ═══════════════════════════════════════════════════════════

  async function loadDashboardStats() {
    const role = Auth.getRole();

    if (Auth.isAdminOrCoach()) {
      const me = Auth.getUser()?.id;
      const coachScope = Auth.isCoach();

      // KPI · Clients (coach = assigned roster, admin = all)
      let cq = sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'client');
      if (coachScope && me) cq = cq.eq('assigned_coach', me);
      const { count: clientCount } = await cq;
      _setStat('stat-clients', clientCount ?? 0);

      // KPI · Active Programs (published; RLS scopes to the coach's clients)
      const { count: programCount } = await sb.from('client_programs')
        .select('*', { count: 'exact', head: true }).eq('published', true);
      _setStat('stat-programs', programCount ?? 0);

      // KPI · Assessments (movement evaluations; coach = mine, admin = all)
      let aq = sb.from('assessments').select('*', { count: 'exact', head: true });
      if (coachScope && me) aq = aq.eq('coach_id', me);
      const { count: assessCount } = await aq;
      _setStat('stat-assessments', assessCount ?? 0);

      // Intelligence rail + KPI · Recovery Alerts (reuses the S5 pulse panel)
      await _renderBusinessGrowth();
      _renderRecoveryCenter();
    }

    // ── Reliability Sweep / Priority A ─────────────────────────────
    //  Sessions count + Recent Sessions now read from the `sessions`
    //  DB table (not localStorage `_sessions`). For coaches we scope
    //  to coach_id = me; admins see all. Filtering is client-side
    //  because the live `sessions` RLS policy "Coaches read all
    //  sessions" is permissive across coaches — that's a separate
    //  multi-tenant leak logged in RELIABILITY_SWEEP_ARCHITECTURE.md
    //  §9 to fix in a future RLS-tightening pass.
    if (Auth.isAdminOrCoach()) {
      await _loadSessionsStatAndRecent();
    } else {
      // Clients never landed here pre-sweep either; defensive no-op.
      _setStat('stat-sessions', 0);
      const el = document.getElementById('recent-sessions-list');
      if (el) el.innerHTML = '';
    }

    // Recent clients
    await _renderRecentClients();
  }

  // Priority A — single round-trip: count + last 5 rows for this coach
  // (admins get the whole platform). Joined to profiles for client name.
  async function _loadSessionsStatAndRecent() {
    const me = Auth.getUser()?.id;
    const coachScope = Auth.isCoach();

    // ── Count
    let countQ = sb.from('sessions').select('*', { count: 'exact', head: true });
    if (coachScope && me) countQ = countQ.eq('coach_id', me);
    const { count } = await countQ;
    _setStat('stat-sessions', count ?? 0);

    // ── Recent 5 (joined to profile for client name)
    let recentQ = sb.from('sessions')
      .select('id, client_id, phase, created_at, coach_id, '
            + 'client:profiles!sessions_client_id_fkey(full_name, email)')
      .order('created_at', { ascending: false })
      .limit(5);
    if (coachScope && me) recentQ = recentQ.eq('coach_id', me);
    const { data: rows, error } = await recentQ;

    const el = document.getElementById('recent-sessions-list');
    if (!el) return;
    if (error || !rows || !rows.length) {
      el.innerHTML = _emptyState('◈', 'No sessions yet',
        'Generate your first session to see it here.');
      return;
    }
    el.innerHTML = rows.map((s) => {
      const name = s.client?.full_name || s.client?.email || '—';
      const phase = s.phase || 'Phase 1';
      return `
        <div class="flex items-center gap-3" style="padding:11px 0; border-bottom:1px solid var(--border-subtle)">
          <div class="avatar avatar-sm" style="background:conic-gradient(from 180deg,var(--teal),var(--amber))">${(name||'?')[0].toUpperCase()}</div>
          <div class="flex-1 truncate">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${name}</div>
            <div style="font-size:11px;color:var(--text-tertiary)">${new Date(s.created_at).toLocaleDateString()}</div>
          </div>
          <span class="badge ${_phaseBadge(phase)}">${phase}</span>
        </div>`;
    }).join('');
  }

  function _setStat(id, val) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '0';
      _animateNumber(el, parseInt(val) || 0);
    }
    // Sync with topbar badge for alerts (Phase R1G)
    if (id === 'stat-alerts') {
      const tbBadge = document.getElementById('topbar-badge-notifications');
      if (tbBadge) {
        tbBadge.textContent = val;
        if (parseInt(val) > 0) {
          tbBadge.classList.remove('hidden');
        } else {
          tbBadge.classList.add('hidden');
        }
      }
    }
  }

  function handleGlobalSearch(query) {
    const q = (query || '').toLowerCase().trim();
    const clientRows = document.querySelectorAll('#dashboard-clients-list > div');
    clientRows.forEach(row => {
      const text = (row.textContent || '').toLowerCase();
      row.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
    const recoveryRows = document.querySelectorAll('#dash-recovery-center tr, #dash-recovery-center .flex');
    recoveryRows.forEach(row => {
      const text = (row.textContent || '').toLowerCase();
      row.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  }



  function _animateNumber(el, target) {
    const start = 0;
    const duration = 800;
    const startTime = performance.now();
    const update = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(start + (target - start) * eased);
      if (progress < 1) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);
  }

  async function _renderRecentClients() {
    const el = document.getElementById('dashboard-clients-list');
    if (!el) return;
    if (!Auth.isAdminOrCoach()) { el.innerHTML = ''; return; }

    const { data } = await sb.from('profiles').select('*')
      .eq('role','client').order('created_at', { ascending: false }).limit(5);

    if (!data?.length) {
      el.innerHTML = _emptyState('◉', 'No clients yet', 'Add your first client to get started.');
      return;
    }
    el.innerHTML = data.map(c => `
      <div class="flex items-center gap-3" style="padding:11px 0;border-bottom:1px solid var(--border-subtle)">
        <div class="avatar avatar-sm">${(c.full_name||c.email||'?')[0].toUpperCase()}</div>
        <div class="flex-1 truncate">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.full_name||c.email}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">${c.goal||'No goal set'}</div>
        </div>
        <span class="badge ${_phaseBadge(c.current_phase)}">${c.current_phase||'P1'}</span>
      </div>`).join('');
  }

  // Intelligent text reveal (Phase G) — splits a line into word spans
  // that ease in sequentially. Respects reduced-motion (instant render).
  function _revealText(el) {
    if (!el) return;
    const text = (el.textContent || '').trim();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !text) { el.textContent = text; return; }
    const words = text.split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'nc-reveal-word';
      span.textContent = w;
      span.style.setProperty('--d', `${i * 90}ms`);
      el.appendChild(span);
      if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  }

  // Business Growth — subscriptions snapshot (active plans, expiring,
  // committed months). Reuses the same subscriptions read the page relies on.
  async function _renderBusinessGrowth() {
    const el = document.getElementById('dash-business');
    if (!el) return;
    const { data: subs, error } = await sb.from('subscriptions').select('status, plan, end_date');
    if (error) { el.innerHTML = _emptyState('◌', 'Plans unavailable', 'Could not load subscriptions.'); return; }
    const active = (subs || []).filter(s => s.status === 'active');
    const now = new Date();
    const in7 = new Date(); in7.setDate(in7.getDate() + 7);
    const expiring = active.filter(s => { const e = new Date(s.end_date); return e >= now && e <= in7; });
    const months = active.reduce((sum, s) => sum + (parseInt(s.plan, 10) || 0), 0);
    el.innerHTML =
      `<div class="nc-biz-row"><span class="nc-biz-k">Active plans</span><span class="nc-biz-v">${active.length}</span></div>`
    + `<div class="nc-biz-row"><span class="nc-biz-k">Expiring in 7 days</span><span class="nc-biz-v">${expiring.length}</span></div>`
    + `<div class="nc-biz-row"><span class="nc-biz-k">Committed months</span><span class="nc-biz-v">${months}<small> mo</small></span></div>`;
  }

  // Recovery Command Center — reuses the S5 Needs-Attention renderer (the
  // single source of the pulse ranking) into the dashboard host, capped to
  // the top few; its row count drives the Recovery Alerts KPI.
  function _renderRecoveryCenter() {
    const host = document.getElementById('dash-recovery-center');
    if (!host) return;
    if (typeof Clients === 'undefined' || !Clients.renderNeedsAttention) { _setStat('stat-alerts', 0); return; }
    Clients.renderNeedsAttention(host, {
      limit: 4,
      compact: true,
      onCount: (n) => _setStat('stat-alerts', n || 0),
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  PROGRAM GENERATION
  // ═══════════════════════════════════════════════════════════

  function _gv(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }

  function buildPrompt() {
    return `You are an elite Movement Specialist and Rehabilitation Coach integrating Donald Neumann Kinesiology, PRI (Postural Restoration Institute), Integrated Kinematic Neurology, Expansion/Compression & Limb Arc Model, and FRC (Functional Range Conditioning).

🔹 CLIENT INPUT
Name: ${_gv('ns-name')||'Unknown'} | Age: ${_gv('ns-age')||'–'} | Phase: ${_gv('ns-phase')} | Goal: ${_gv('ns-goal')||'–'}
Injury History: ${_gv('ns-injury')||'None'}

🔹 SUBJECTIVE: ${_gv('ns-subjective')||'None provided'}

🔹 OBJECTIVE ASSESSMENT:
Toe Touch: ${_gv('ns-toetouch')||'–'} | Ankle Mobility: ${_gv('ns-ankle-mob')||'–'} | Pronation/Supination: ${_gv('ns-pronsup')||'–'}
Tibia IR: L(${_gv('ns-tib-ir-l')||'–'}) R(${_gv('ns-tib-ir-r')||'–'})
Hip — IR: L(${_gv('ns-hip-ir-l')||'–'}) R(${_gv('ns-hip-ir-r')||'–'}) | ER: L(${_gv('ns-hip-er-l')||'–'}) R(${_gv('ns-hip-er-r')||'–'}) | Flex: L(${_gv('ns-hip-flex-l')||'–'}) R(${_gv('ns-hip-flex-r')||'–'}) | Ext: L(${_gv('ns-hip-ext-l')||'–'}) R(${_gv('ns-hip-ext-r')||'–'}) | Abd: L(${_gv('ns-hip-abd-l')||'–'}) R(${_gv('ns-hip-abd-r')||'–'})
Spine — Flex: ${_gv('ns-sp-flex')||'–'} | Ext: ${_gv('ns-sp-ext')||'–'} | Lat Flex: L(${_gv('ns-sp-lfl')||'–'}) R(${_gv('ns-sp-lfr')||'–'}) | Rotation: L(${_gv('ns-sp-rotl')||'–'}) R(${_gv('ns-sp-rotr')||'–'})
Shoulder — Flex: L(${_gv('ns-sh-flex-l')||'–'}) R(${_gv('ns-sh-flex-r')||'–'}) | Ext: L(${_gv('ns-sh-ext-l')||'–'}) R(${_gv('ns-sh-ext-r')||'–'}) | IR: L(${_gv('ns-sh-ir-l')||'–'}) R(${_gv('ns-sh-ir-r')||'–'}) | ER: L(${_gv('ns-sh-er-l')||'–'}) R(${_gv('ns-sh-er-r')||'–'})
Load Tolerance: ${_gv('ns-load')||'–'}

🔹 TASKS: Pattern Recognition → Gait Phase Analysis → Breathing Analysis → Root Cause Chain (Foot→Tibia→Hip→Pelvis→Spine→Shoulder) → Phase Classification

🔹 PROGRAM (${_gv('ns-phase')}):
WARM UP: 1.Breathing 2.Mobility 3.PAILs/RAILs 4.Core
CONDITIONING: 2–3 compound + 2–3 accessory (match EXACTLY to dysfunction)
COOLDOWN: Breathing + Mobility
HOMEWORK: 1–2 breathing, 1–2 mobility, 1–2 activation

🔹 OUTPUT FORMAT (STRICT):
--- ANALYSIS ---
Key Findings: •...
Gait Phase Issue: •...
Breathing Pattern: •...
Root Cause Chain: Foot→Tibia→Hip→Pelvis→Spine→Shoulder

--- PROGRAM ---
WARM UP: 1. 2. 3. 4.
CONDITIONING: 1. 2. 3.
COOLDOWN: 1. 2.

--- HOMEWORK ---
Daily: 1. 2. 3.

Keep output clean, structured, and professionally precise.`;
  }

  // Read the Program Setup card — coach's chosen program shape.
  function _readProgramConfig() {
    const num = (id, def, min, max) => {
      const v = parseInt(document.getElementById(id)?.value, 10);
      if (!Number.isFinite(v)) return def;
      return Math.max(min, Math.min(max, v));
    };
    const days  = num('cfg-days', 3, 1, 7);
    const split = document.getElementById('cfg-split')?.value || 'same';
    // Translate the split choice into a number of distinct workouts.
    const distinct = split === 'ab' ? 2
      : split === 'abc' ? 3
      : split === 'unique' ? days
      : 1;
    return {
      days,
      split,
      distinctWorkouts: Math.max(1, Math.min(days, distinct)),
      warmup:   num('cfg-warmup', 3, 1, 10),
      main:     num('cfg-main', 5, 1, 14),
      cooldown: num('cfg-cooldown', 2, 1, 8),
      daily:    num('cfg-daily', 6, 2, 12),
    };
  }

  // Phase 5 — open the manual program builder for the active client. Reuses
  // the ProgramPublish editor with a blank scaffold (the same jsonb shape
  // the client Train view + publish path already understand), so manual and
  // generated programs publish + render identically.
  function buildManualProgram() {
    const { id: activeClientId, name: activeClientName } = _activeSessionClient();
    if (!activeClientId) {
      toast('Please start a client session first.', 'error');
      _refreshActiveSessionChip();
      return;
    }
    if (typeof ProgramPublish === 'undefined') { toast('Builder not loaded.', 'error'); return; }
    const program = {
      phase:               _gv('ns-phase') || 'Phase 1',
      days_per_week:       1,
      split_label:         'Manual program',
      workouts:            [{ id: 'A', label: 'Day 1', warmup: [], main: [], cooldown: [] }],
      schedule:            ['A'],
      daily_routine_tasks: [],
      manual:              true,
    };
    document.getElementById('program-panel')?.classList.add('hidden');
    document.getElementById('daily-routine-panel')?.classList.add('hidden');
    ProgramPublish.render({ program, clientId: activeClientId, clientName: activeClientName });
    document.getElementById('program-review-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Manual builder ready — add days and exercises, then publish.', 'info');
  }

  async function generateProgram() {
    // Read client from the active session (Client Info tab) — Generate no
    // longer has its own client picker.
    const { id: activeClientId, name: activeClientName } = _activeSessionClient();
    const typedName = _gv('ns-name');
    const name = activeClientName || typedName;

    if (!activeClientId) {
      toast('Please start a client session first.', 'error');
      _refreshActiveSessionChip();
      return;
    }
    if (!name) { toast('Please enter client name first', 'error'); return; }

    const btn = document.getElementById('generate-btn');
    if (!btn) return;
    const origHTML = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Analysing...';
    btn.disabled = true;

    try {
      // ── STEP 1: Local engines (instant, no network) ──────────
      const assessment = ScoringEngine.readForm();
      const scores     = ScoringEngine.calculate(assessment);
      const gait       = GaitEngine.analyze(assessment);
      if (window._setLastGait) window._setLastGait(gait);
      const cfg        = _readProgramConfig();
      const program    = ProgramGenerator.generate(assessment, scores, gait, {
        phase:            _gv('ns-phase'),
        daysPerWeek:      cfg.days,
        distinctWorkouts: cfg.distinctWorkouts,
        counts:           { warmup: cfg.warmup, main: cfg.main, cooldown: cfg.cooldown, daily: cfg.daily },
      });

      // ── STEP 2: Render engine outputs into score/gait panels ─
      ScoringEngine.renderScores(scores);
      GaitEngine.renderGaitAnalysis(gait);
      // The editable Review & Publish panel supersedes the old read-only
      // program/daily-routine panels (it shows every workout in the split).
      document.getElementById('program-panel')?.classList.add('hidden');
      document.getElementById('daily-routine-panel')?.classList.add('hidden');
      if (typeof ProgramPublish !== 'undefined') {
        ProgramPublish.render({ program, clientId: activeClientId, clientName: activeClientName });
      }

      // ── STEP 3: Update 3D body map if initialised ────────────
      if (window.BodyMap3D?.inited) {
        BodyMap3D.updateFromAssessment(assessment);
        if (gait.total_deficits > 0) {
          BodyMap3D.startGaitAnimation(gait.phase_deficiencies);
        }
      }

      // ── STEP 4: AI narrative (via the generate-program edge function)
      //
      // Reliability Sweep / Priority B — the previous in-browser
      // fetch() to api.anthropic.com (no key, CORS-blocked, silent
      // fallback that produced a fake success toast) is replaced with
      // a Supabase Functions invocation. The edge function holds the
      // GEMINI_API_KEY as a server-side secret and calls Gemini 2.0
      // Flash. Response shape from the function = raw Gemini envelope:
      //   { candidates: [{ content: { parts: [{ text: "..." }] } }], ... }
      // or, on error, the function returns the upstream error JSON.
      //
      // Per Q-B1: NO health-check ping. We attempt the call at
      // generate-time and surface a clear runtime warning toast on
      // failure — coach is never lied to about AI availability.
      btn.innerHTML = '<span class="spinner"></span> Generating AI analysis...';
      let aiText = '';
      let aiUnavailable = false;
      try {
        const { data: aiData, error: aiErr } = await sb.functions.invoke(
          'generate-program', { body: { prompt: buildPrompt() } });
        if (aiErr) throw aiErr;
        // Gemini happy path
        const parts = aiData?.candidates?.[0]?.content?.parts || [];
        aiText = parts.map((p) => p?.text || '').join('\n').trim();
        // Function may also pass through an upstream error JSON with no candidates
        if (!aiText) {
          const upstream = aiData?.error || aiData?.message;
          throw new Error(upstream || 'AI returned no narrative text');
        }
      } catch(aiErr) {
        console.warn('AI narrative unavailable:', aiErr?.message || aiErr);
        aiUnavailable = true;
        // Local fallback narrative built from engine output — keeps the
        // PDF and Programs view useful even when AI is down. Coach knows
        // because of the warning toast emitted further below.
        aiText = `[AI narrative unavailable]\n\nScores: ROM ${scores.rom_score}% · Control ${scores.control_score}% · Force ${scores.force_score}% · Neurology ${scores.neurology_score}%\nComposite: ${scores.composite_score}% → ${scores.phase_recommendation}`;
      }

      const outEl = document.getElementById('program-output-text');
      const panel = document.getElementById('output-panel');
      if (outEl) outEl.textContent = aiText;
      if (panel) panel.classList.remove('hidden');

      // ── STEP 5: PDF handoff (in-memory only) ─────────────────
      // Stabilization Pass: removed the localStorage cache write that
      // used to mirror this bundle. Persistence happens in the next
      // step via _saveToSupabase → public.sessions (single source of
      // truth). _lastBundle stays as an in-memory handoff so the
      // "Export Professional PDF" button (which fires from the same
      // tab) can rebuild the report without an extra DB round-trip.
      _lastBundle = { name, assessment, scores, gait, program, aiText, clientId: activeClientId };

      // ── STEP 6: Persist to Supabase (non-blocking) ───────────
      // Client is the one selected in the active session (Client Info tab).
      _saveToSupabase(activeClientId, scores, program, aiText, gait, assessment);

      // Reliability Sweep / Priority B — honest toasts. Program is
      // always "generated" (engines + JSON are local), but if the
      // AI narrative leg failed we surface that as a separate
      // warning so the coach knows the analysis text is the fallback.
      toast('Program generated!', 'success');
      if (aiUnavailable) {
        toast('AI narrative unavailable — program structure still generated. '
            + 'Check the GEMINI_API_KEY secret on the edge function.', 'warning', 6000);
      }

    } catch(e) {
      toast('Generation failed: ' + e.message, 'error');
      console.error(e);
    } finally {
      btn.innerHTML = origHTML;
      btn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PROFESSIONAL PDF EXPORT
  // ═══════════════════════════════════════════════════════════

  // Format a left/right pair as "L 32 / R 38" (skips missing sides).
  function _pair(l, r, unit) {
    const u = unit || '';
    const bits = [];
    if (l != null && l !== '') bits.push(`L ${l}${u}`);
    if (r != null && r !== '') bits.push(`R ${r}${u}`);
    return bits.join('  /  ');
  }

  // Curated ROM rows from the objective assessment form.
  function _objectiveRomRows(a) {
    a = a || {};
    return [
      { label: 'Hip Internal Rotation',  value: _pair(a.hip_ir_l,  a.hip_ir_r,  '°') },
      { label: 'Hip External Rotation',  value: _pair(a.hip_er_l,  a.hip_er_r,  '°') },
      { label: 'Hip Extension',          value: _pair(a.hip_ext_l, a.hip_ext_r, '°') },
      { label: 'Hip Abduction',          value: _pair(a.hip_abd_l, a.hip_abd_r, '°') },
      { label: 'Shoulder Internal Rot.', value: _pair(a.sh_ir_l,   a.sh_ir_r,   '°') },
      { label: 'Shoulder External Rot.', value: _pair(a.sh_er_l,   a.sh_er_r,   '°') },
      { label: 'Ankle Dorsiflexion',     value: _pair(a.ankle_df_l, a.ankle_df_r, ' cm') },
      { label: 'Balance — Eyes Open',    value: _pair(a.bal_eo_l,  a.bal_eo_r,  ' s') },
      { label: 'Balance — Eyes Closed',  value: _pair(a.bal_ec_l,  a.bal_ec_r,  ' s') },
    ].filter(r => r.value);
  }

  // Assessment findings (posture / movement screens / compensations).
  function _objectiveFindingRows(a, gait) {
    a = a || {};
    const rows = [
      { label: 'Foot Pronation',          value: _pair(a.pronation_l,  a.pronation_r) },
      { label: 'Foot Supination',         value: _pair(a.supination_l, a.supination_r) },
      { label: 'Toe Touch Score',         value: a.toetouch_score },
      { label: 'Single-Leg Squat',        value: _pair(a.sl_squat_l,   a.sl_squat_r) },
      { label: 'Single-Leg RDL',          value: _pair(a.sl_rdl_l,     a.sl_rdl_r) },
      { label: 'Overhead Squat',          value: a.oh_squat },
      { label: 'Spine Flexion Pain',      value: a.sp_flex_pain ? 'Present' : '' },
      { label: 'Thoracic Rotation Pain',  value: (a.sp_rotl_pain || a.sp_rotr_pain) ? 'Present' : '' },
      { label: 'Movement / Load Notes',   value: a.load_text },
    ];
    if (gait) {
      if (gait.total_deficits != null) rows.push({ label: 'Gait Deficits Detected', value: String(gait.total_deficits) });
      if (Array.isArray(gait.exercise_priorities) && gait.exercise_priorities.length) {
        rows.push({ label: 'Gait Priorities', value: gait.exercise_priorities.slice(0, 4).join(', ') });
      }
    }
    return rows.filter(r => r.value != null && r.value !== '');
  }

  // Assemble the full report data object for NeuPDF.
  async function _buildPdfData() {
    const b = _lastBundle || {};
    let coachName = '';
    try {
      const u = Auth.getUser();
      coachName = Auth.getProfile()?.full_name || u?.user_metadata?.full_name || u?.email || '';
    } catch {}

    const client = {
      name:          _gv('ns-name') || b.name || '',
      age:           _gv('ns-age'),
      gender:        '',
      height:        '',
      weight:        '',
      goal:          _gv('ns-goal'),
      caseType:      _gv('ns-phase') ? (_gv('ns-phase') + ' rehabilitation') : '',
      experience:    '',
      painAreas:     (b.scores && Array.isArray(b.scores.pain_flags)) ? b.scores.pain_flags.join(', ') : '',
      injuryHistory: _gv('ns-injury'),
      phase:         (b.program && b.program.phase) || _gv('ns-phase'),
      date:          new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
      coach:         coachName,
    };

    // Subjective — pull the latest record from Supabase when a client is linked.
    let subjective = [];
    if (b.clientId && typeof RPMGraph !== 'undefined' && RPMGraph.pullSubjectiveSummary) {
      try {
        const s = await RPMGraph.pullSubjectiveSummary(b.clientId);
        if (s) {
          const arr = (v) => Array.isArray(v) ? v.join(', ') : v;
          subjective = [
            { label: 'Dream Outcome',         value: s.dream_outcome },
            { label: 'Life Impact',           value: s.life_impact },
            { label: 'Chief Complaint / Pain', value: s.external_pain },
            { label: 'Mechanism of Injury',   value: s.mechanism_of_injury },
            { label: 'Aggravating Factors',   value: arr(s.aggravating_factors) },
            { label: 'Relieving Factors',     value: arr(s.easing_factors) },
            { label: 'Confidence Score',      value: s.confidence_score != null ? s.confidence_score + ' / 10' : '' },
            { label: 'Importance Score',      value: s.importance_score != null ? s.importance_score + ' / 10' : '' },
            { label: 'Fast-Start Opportunity', value: s.fast_start_opportunity },
            { label: 'Yellow Flags',          value: arr(s.yellow_flags) },
            { label: 'Recap Notes',           value: s.recap_notes },
            { label: 'Additional Notes',      value: s.free_form_notes },
          ].filter(r => r.value != null && r.value !== '');
        }
      } catch (e) { console.warn('[pdf] subjective pull failed:', e); }
    }

    return {
      client,
      subjective,
      objective: {
        scores:   b.scores || {},
        rom:      _objectiveRomRows(b.assessment),
        findings: _objectiveFindingRows(b.assessment, b.gait),
      },
      program: b.program,
      gait:    b.gait,
    };
  }

  async function exportProfessionalPDF() {
    const btn = document.getElementById('btn-export-pdf');
    if (!_lastBundle || !_lastBundle.program) {
      toast('Generate a program first, then export.', 'error');
      return;
    }
    if (typeof NeuPDF === 'undefined' || !NeuPDF.isReady()) {
      toast('PDF engine is still loading — please try again in a moment.', 'error');
      return;
    }
    const origHTML = btn ? btn.innerHTML : null;
    if (btn) {
      btn.disabled  = true;
      btn.innerHTML = '<span class="spinner"></span> Building PDF…';
    }
    try {
      const data = await _buildPdfData();
      NeuPDF.exportReport(data);
      toast('Professional PDF exported ✓', 'success');
    } catch (e) {
      console.error('[pdf] export failed:', e);
      toast('PDF export failed: ' + (e.message || 'unknown error'), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = origHTML; }
    }
  }

  async function _saveToSupabase(clientId, scores, program, aiOutput, gait, assessment) {
    try {
      const coachId = Auth.getUser()?.id;
      const phase   = _gv('ns-phase');
      const goal    = _gv('ns-goal');

      // Always write to legacy sessions (preserves existing dashboard stats)
      await sb.from('sessions').insert({
        client_id: clientId, coach_id: coachId, phase, goal, output: aiOutput,
      });

      // Write structured assessment
      const { data: aRow } = await sb.from('assessments').insert({
        client_id: clientId, coach_id: coachId,
        session_date: new Date().toISOString().split('T')[0], goals: goal,
      }).select().single();

      if (!aRow) return;

      // Objective assessment + computed scores
      const a = assessment;
      await sb.from('rehab_objective_assessments').insert({
        assessment_id:        aRow.id,
        toe_touch_score:      a.toe_touch_score,
        ankle_df_left_cm:     a.ankle_df_l,  ankle_df_right_cm:    a.ankle_df_r,
        ankle_pronation_left: a.pronation_l, ankle_pronation_right: a.pronation_r,
        tibia_ir_left:        a.tib_ir_l,   tibia_ir_right:        a.tib_ir_r,
        hip_ir_left:          a.hip_ir_l,   hip_ir_right:          a.hip_ir_r,
        hip_er_left:          a.hip_er_l,   hip_er_right:          a.hip_er_r,
        hip_flexion_left:     a.hip_flex_l, hip_flexion_right:     a.hip_flex_r,
        hip_extension_left:   a.hip_ext_l,  hip_extension_right:   a.hip_ext_r,
        hip_abduction_left:   a.hip_abd_l,  hip_abduction_right:   a.hip_abd_r,
        shoulder_flexion_left: a.sh_flex_l, shoulder_flexion_right: a.sh_flex_r,
        shoulder_ir_left:     a.sh_ir_l,   shoulder_ir_right:      a.sh_ir_r,
        shoulder_er_left:     a.sh_er_l,   shoulder_er_right:      a.sh_er_r,
        sl_squat_left_score:  a.sl_squat_l, sl_squat_right_score:  a.sl_squat_r,
        sl_rdl_left_score:    a.sl_rdl_l,  sl_rdl_right_score:     a.sl_rdl_r,
        oh_squat_score:       a.oh_squat,
        sl_balance_eo_left:   a.bal_eo_l,  sl_balance_eo_right:    a.bal_eo_r,
        sl_balance_ec_left:   a.bal_ec_l,  sl_balance_ec_right:    a.bal_ec_r,
        sl_reach_left:        a.reach_l,   sl_reach_right:         a.reach_r,
        rom_score:        scores.rom_score,
        control_score:    scores.control_score,
        force_score:      scores.force_score,
        neurology_score:  scores.neurology_score,
        composite_score:  scores.composite_score,
        phase_recommendation: scores.phase_recommendation,
        pain_flags:       scores.pain_flags,
        asymmetry_flags:  scores.asymmetry_flags,
        gait_flags:       gait.exercise_priorities?.slice(0, 5) || [],
        referral_required: scores.referral_required,
      });

      // Gait assessment
      await sb.from('gait_assessments').insert({
        client_id:          clientId,
        assessment_id:      aRow.id,
        phase_deficiencies: gait.phase_deficiencies,
        symmetry_index:     gait.symmetry_index,
        worst_case_scenario: gait.worst_case_scenario,
        exercise_priorities: gait.exercise_priorities,
      });

      // Body map state
      await sb.from('body_map_states').insert({
        client_id: clientId, assessment_id: aRow.id,
        joint_data: {}, animation_state: 'idle',
      });

    } catch(e) {
      console.warn('Supabase save (non-fatal):', e.message);
    }
  }

  function previewWeb() {
    const text = document.getElementById('program-output-text')?.textContent || '';
    const name  = _gv('ns-name');
    const phase = _gv('ns-phase');
    const phaseColor = phase === 'Phase 1' ? '#3df5c1' : phase === 'Phase 2' ? '#f5c842' : '#f5426c';

    const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Program — ${name}</title>
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=satoshi@500,400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Satoshi',sans-serif;background:#060709;color:#f0f2f7;min-height:100vh}
.hero{background:linear-gradient(135deg,#10131a,#060709);border-bottom:1px solid rgba(255,255,255,0.05);padding:52px 0 36px}
.c{max-width:760px;margin:0 auto;padding:0 32px}
.logo{font-family:'Cabinet Grotesk',sans-serif;font-size:18px;font-weight:800;color:${phaseColor};margin-bottom:32px;letter-spacing:-0.5px}
h1{font-family:'Cabinet Grotesk',sans-serif;font-size:clamp(36px,6vw,56px);font-weight:800;letter-spacing:-2px;line-height:0.95}
h1 em{color:${phaseColor};font-style:normal}
.meta{display:flex;gap:20px;margin-top:16px;flex-wrap:wrap}
.mi{font-size:11px;color:#7a8399;text-transform:uppercase;letter-spacing:1.5px}
.mi strong{color:#f0f2f7}
.ph{display:inline-block;padding:4px 14px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border:1px solid ${phaseColor}44;color:${phaseColor};margin-top:16px;background:${phaseColor}10}
.content{padding:44px 0}
pre{font-family:'JetBrains Mono','Courier New',monospace;font-size:13px;line-height:1.9;color:#7a8399;white-space:pre-wrap;background:#10131a;border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:28px}
.footer{text-align:center;padding:32px;color:#2d3344;font-size:12px;border-top:1px solid rgba(255,255,255,0.04)}
@media print{body,pre{background:#fff;color:#111}.hero{background:#f5f5f5;border:none}pre{border-color:#ddd}.footer{color:#999}}
</style></head>
<body>
<div class="hero"><div class="c">
  <div class="logo">⚡ AST9</div>
  <h1>Movement<br><em>Program</em></h1>
  <div class="meta">
    <div class="mi">Client: <strong>${name}</strong></div>
    <div class="mi">Generated: <strong>${new Date().toLocaleDateString()}</strong></div>
  </div>
  <div class="ph">${phase}</div>
</div></div>
<div class="c"><div class="content"><pre>${text}</pre></div></div>
<div class="footer">AST9 Elite Coaching Platform · Confidential Client Document · Print with Ctrl+P to save PDF</div>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
  }

  // Priority A — Programs page now reads from client_programs (the
  // F5/F6 source of truth), NOT localStorage. RLS scopes the result
  // automatically per `client_programs_coach_all`: admin sees all,
  // coach sees their own + assigned-clients. Per Q-A1 the card links
  // to detail rather than rendering the inline AI narrative (the
  // narrative lives in sessions.output, not in client_programs).
  async function renderProgramsList() {
    const el = document.getElementById('programs-list');
    if (!el) return;
    el.innerHTML = `<div style="text-align:center;padding:40px"><span class="spinner spinner-lg"></span></div>`;

    const { data, error } = await sb.from('client_programs')
      .select('id, client_id, published, published_at, '
            + 'program, '   // pulled for phase + days_per_week meta
            + 'client:profiles!client_programs_client_id_fkey(full_name, email, current_phase)')
      .eq('published', true)
      .order('published_at', { ascending: false });

    if (error) {
      el.innerHTML = _emptyState('⚠', 'Could not load programs', error.message);
      return;
    }
    if (!data || !data.length) {
      el.innerHTML = _emptyState(
        '◈', 'No programs published yet',
        'Run a new Assessment, generate a program, then publish it for your client.',
        { label: '+ Assessment', onclick: "Dashboard.showSection('new-session')" });
      return;
    }

    el.innerHTML = data.map((row) => {
      const name  = row.client?.full_name || row.client?.email || '—';
      const phase = row.program?.phase || row.client?.current_phase || 'Phase 1';
      const days  = row.program?.days_per_week ? `${row.program.days_per_week} days/wk` : '';
      const when  = row.published_at ? new Date(row.published_at).toLocaleDateString() : '';
      const cid   = row.client_id;
      return `
        <div class="card card-hover" style="margin-bottom:12px">
          <div class="flex items-center gap-3">
            <div class="avatar" style="background:conic-gradient(from 180deg,var(--teal),var(--amber))">${(name||'?')[0].toUpperCase()}</div>
            <div class="flex-1 truncate">
              <div style="font-weight:600;font-size:14px">${name}</div>
              <div style="font-size:12px;color:var(--text-tertiary)">Published ${when}${days ? ' · ' + days : ''}</div>
            </div>
            <span class="badge ${_phaseBadge(phase)}">${phase}</span>
            <div style="display:flex;gap:6px">
              <button class="btn btn-ghost btn-xs"
                      onclick="window._wsPreselectClient='${cid}'; Dashboard.showSection('workout-history')">◐ Workouts</button>
              <button class="btn btn-ghost btn-xs"
                      onclick="window._notifParams={client_id:'${cid}'}; Dashboard.showSection('progression')">◭ Progression</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }


  // ═══════════════════════════════════════════════════════════
  //  POPULATE CLIENT SELECTS
  // ═══════════════════════════════════════════════════════════

  async function _populateClientSelects() {
    if (!Auth.isAdminOrCoach()) return;
    const { data } = await sb.from('profiles')
      .select('id, full_name, email, current_phase')
      .eq('role','client').order('full_name');
    if (!data) return;

    // ns-save-client was removed — Generate now reads from ns-client-select.
    ['ns-client-select','sub-client','pu-client'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const placeholder = el.options[0];
      el.innerHTML = '';
      if (placeholder) el.appendChild(placeholder);
      data.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.full_name || c.email;
        opt.dataset.phase = c.current_phase || 'Phase 1';
        el.appendChild(opt);
      });
    });

    // Coach dropdown for Add Client — admin-only (BUG 4). A coach never picks
    // the owning coach (their new clients auto-assign to them), so we hide the
    // selector and show a short note instead.
    const coachSel   = document.getElementById('ac-coach');
    const coachGroup = document.getElementById('ac-coach-group');
    const coachNote  = document.getElementById('ac-coach-note');
    if (Auth.isAdmin && Auth.isAdmin()) {
      if (coachGroup) coachGroup.style.display = '';
      if (coachNote)  coachNote.style.display  = 'none';
      const { data: coaches } = await sb.from('profiles')
        .select('id, full_name, email').in('role',['coach','admin']);
      if (coachSel && coaches) {
        // Reset to the placeholder before repopulating so repeated refreshes
        // (e.g. after creating a client) never duplicate the options.
        const placeholder = coachSel.options[0];
        coachSel.innerHTML = '';
        if (placeholder) coachSel.appendChild(placeholder);
        coaches.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.full_name || c.email;
          coachSel.appendChild(opt);
        });
      }
    } else {
      if (coachGroup) coachGroup.style.display = 'none';
      if (coachNote)  coachNote.style.display  = '';
    }
  }

  // BUG 1 — after the client roster changes (e.g. a new client is created),
  // refresh the KPI cards and Billing slot usage *if* the user is looking at
  // them. The roster table and <select>s are refreshed by their own callers.
  function refreshAfterRosterChange() {
    const isActive = (id) => document.getElementById('section-' + id)?.classList.contains('active');
    if (isActive('dashboard') && Auth.isAdminOrCoach && Auth.isAdminOrCoach()) {
      loadDashboardStats();
    }
    if (isActive('billing') && typeof Billing !== 'undefined') {
      Billing.render?.();
    }
  }

  function fillClientFromSelect() {
    const sel = document.getElementById('ns-client-select');
    if (!sel) return;
    const opt = sel.options[sel.selectedIndex];
    if (opt?.dataset?.phase) {
      const nameEl = document.getElementById('ns-name');
      const phaseEl = document.getElementById('ns-phase');
      if (nameEl) nameEl.value = opt.textContent;
      if (phaseEl) phaseEl.value = opt.dataset.phase;
    }
    // Phase 2 — boot the dual-mode subjective wizard for this client
    const clientId = sel.value || null;
    if (clientId && typeof RPMSubjective !== 'undefined') {
      RPMSubjective.init(clientId);
    }
    // Keep the Generate tab's active-session chip in sync.
    _refreshActiveSessionChip();
  }

  // ═══════════════════════════════════════════════════════════
  //  PHASE UPGRADE
  // ═══════════════════════════════════════════════════════════

  async function submitPhaseUpgrade() {
    const clientId = document.getElementById('pu-client')?.value;
    const newPhase = document.getElementById('pu-phase')?.value;
    const message  = document.getElementById('pu-message')?.value;

    if (!clientId) { toast('Select a client', 'error'); return; }

    // Reliability Sweep / Priority D — defensive re-validation.
    // Re-fetch current phase server-side (don't trust the modal dataset
    // alone — defends against direct call / DOM tampering / stale modal).
    const { data: prof } = await sb.from('profiles')
      .select('current_phase').eq('id', clientId).maybeSingle();
    const currentPhase = prof?.current_phase || 'Phase 1';

    const ord = (p) => {
      const m = String(p || '').match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };
    const curOrd = ord(currentPhase);
    const newOrd = ord(newPhase);

    if (newOrd === 0) { toast('Select a target phase', 'error'); return; }
    if (newOrd === curOrd) {
      toast(`Client is already on ${currentPhase}. No change made.`, 'info');
      return;
    }
    if (newOrd < curOrd) {
      toast('Downgrade not supported via this flow. Contact an admin.', 'error');
      return;
    }
    // Skip-phase upgrade confirmation (e.g. Phase 1 → Phase 3 directly).
    if (newOrd - curOrd >= 2) {
      if (!confirm(`Skip-phase upgrade from ${currentPhase} to ${newPhase} — proceed?`)) {
        return;
      }
    }

    // Fix C1 — authoritative, server-side phase change via RPC.
    // set_client_phase() enforces authorization (admin OR assigned coach),
    // valid phase, and the no-downgrade / no-same-phase rules, then performs
    // the protected UPDATE under the Fix-C2 bypass token. We celebrate ONLY
    // when the DB returns the updated row — never optimistically (the old
    // direct UPDATE silently no-op'd for non-admin coaches yet "succeeded").
    const { data: updated, error } = await sb.rpc('set_client_phase', {
      p_client_id: clientId,
      p_new_phase: newPhase,
    });
    if (error) { toast(error.message, 'error'); return; }
    const confirmedPhase = Array.isArray(updated) ? updated[0]?.current_phase : updated?.current_phase;
    if (confirmedPhase !== newPhase) {
      toast('Phase change did not take effect — please retry.', 'error');
      return;
    }

    // Best-effort celebration email. Its failure must NOT fake success —
    // the DB change is already confirmed above.
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type: 'phase_upgrade', client_id: clientId, new_phase: confirmedPhase, message })
      });
    } catch(e) { console.warn('Email send failed:', e); }

    toast(`Client upgraded to ${confirmedPhase}! 🎉`, 'success');
    showCelebration(confirmedPhase);
    closeModal('modal-phase-upgrade');
    await Clients.loadAll?.();
    await _populateClientSelects();
  }

  // ═══════════════════════════════════════════════════════════
  //  CELEBRATION OVERLAY
  // ═══════════════════════════════════════════════════════════

  function showCelebration(newPhase) {
    const overlay = document.getElementById('celebration-overlay');
    const phaseEl = document.getElementById('celebration-phase');
    if (overlay) overlay.classList.remove('hidden');
    if (phaseEl) phaseEl.textContent = newPhase;
    _launchConfetti();
  }

  function closeCelebration() {
    document.getElementById('celebration-overlay')?.classList.add('hidden');
    _stopConfetti();
  }

  let _confettiAF = null;
  function _launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const colors = ['#c8f04a','#3df5c1','#f5426c','#f5c842','#ffffff'];
    const pieces = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 3,
      c: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 2.5,
      vy: Math.random() * 3 + 1.5,
      angle: Math.random() * 360,
      spin: (Math.random() - 0.5) * 5,
    }));
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle * Math.PI / 180);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
        p.x += p.vx; p.y += p.vy; p.angle += p.spin;
        if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      });
      _confettiAF = requestAnimationFrame(draw);
    };
    draw();
  }
  function _stopConfetti() {
    if (_confettiAF) { cancelAnimationFrame(_confettiAF); _confettiAF = null; }
  }

  // ═══════════════════════════════════════════════════════════
  //  MODAL HELPERS
  // ═══════════════════════════════════════════════════════════

  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    if (id === 'modal-add-subscription') {
      const startEl = document.getElementById('sub-start');
      if (startEl) { startEl.value = new Date().toISOString().split('T')[0]; }
      calcSubEndDate();
    }
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
  }

  function calcSubEndDate() {
    const start  = document.getElementById('sub-start')?.value;
    const months = parseInt(document.getElementById('sub-plan')?.value || '3');
    if (!start) return;
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    const endEl = document.getElementById('sub-end');
    if (endEl) endEl.value = end.toISOString().split('T')[0];
  }

  // ═══════════════════════════════════════════════════════════
  //  TOAST SYSTEM
  // ═══════════════════════════════════════════════════════════

  const _icons = { success: '✓', error: '✕', info: '◆', warning: '⚠' };

  function toast(msg, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${_icons[type] || '◆'}</span><span class="toast-msg">${msg}</span>`;
    container.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast-leaving');
      setTimeout(() => t.remove(), 260);
    }, duration);
  }

  // ═══════════════════════════════════════════════════════════
  //  CHANGE PASSWORD
  // ═══════════════════════════════════════════════════════════

  async function submitChangePassword() {
    const newPass  = document.getElementById('cp-new')?.value;
    const confirm  = document.getElementById('cp-confirm')?.value;
    if (!newPass || newPass.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    if (newPass !== confirm) { toast('Passwords do not match', 'error'); return; }
    try {
      await Auth.updatePassword(newPass);
      toast('Password updated successfully!', 'success');
      closeModal('modal-change-password');
      document.getElementById('cp-new').value = '';
      document.getElementById('cp-confirm').value = '';
    } catch(e) {
      toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════

  function _phaseBadge(phase) {
    return phase === 'Phase 1' ? 'badge-phase1' : phase === 'Phase 2' ? 'badge-phase2' : 'badge-phase3';
  }

  // Stabilization Pass: shared empty-state helper. Every dashboard
  // module should call this (or window.UI.emptyState) instead of
  // hand-rolling the markup, so Assessment / Programs / Progression /
  // Notifications / Workouts all look identical. Optional `cta` =
  // { label, onclick } renders a button under the description.
  function _emptyState(icon, title, desc, cta) {
    const btn = cta
      ? `<button class="btn btn-primary" style="margin-top:14px" onclick="${cta.onclick}">${cta.label}</button>`
      : '';
    return `<div class="empty-state"><span class="empty-icon">${icon}</span>`
         + `<div class="empty-title">${title}</div>`
         + `<p class="empty-desc">${desc}</p>${btn}</div>`;
  }

  return {
    initShell, showSection, initTabs, setService,
    loadDashboardStats,
    refreshClientSelects: _populateClientSelects,
    refreshAfterRosterChange,
    generateProgram, buildManualProgram, previewWeb, renderProgramsList,
    exportProfessionalPDF,
    fillClientFromSelect,
    openClientInfoTab,
    submitPhaseUpgrade, showCelebration, closeCelebration,
    openModal, closeModal, calcSubEndDate,
    submitChangePassword,
    populateProgressClientSelect,
    toast,
    emptyState: _emptyState,
    handleGlobalSearch,
  };

})();

window.Dashboard = Dashboard;
// Shortcut for HTML onclick
window.toast = Dashboard.toast;
