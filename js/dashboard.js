// ═══════════════════════════════════════════════════════════════
//  js/dashboard.js
//  Handles: app shell rendering, navigation, stat cards,
//           recent sessions, program generation + output,
//           toast, modal helpers, celebration overlay.
// ═══════════════════════════════════════════════════════════════

const Dashboard = (() => {

  // ── Local session storage ────────────────────────────────────
  const SESSIONS_KEY = 'ast9_sessions_v2';
  let _sessions = (() => {
    try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
    catch { return []; }
  })();

  function saveSessions() {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(_sessions)); } catch { /* storage blocked */ }
  }

  // Last generated program bundle — consumed by exportProfessionalPDF().
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

    // Dashboard greeting
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const firstName = (p?.full_name || '').split(' ')[0] || 'Coach';
    const greetEl = document.getElementById('dashboard-greeting');
    if (greetEl) greetEl.textContent = `${greet}, ${firstName} 👋`;

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

    // Admin email
    const adminEmailEl = document.getElementById('admin-email-display');
    if (adminEmailEl) adminEmailEl.textContent = p?.email || '–';

    loadDashboardStats();
    _populateClientSelects();
  }

  function _roleLabel(role) {
    return { admin: '⬡ Admin', coach: '◉ Coach', client: '◌ Client' }[role] || role;
  }

  // ═══════════════════════════════════════════════════════════
  //  NAVIGATION
  // ═══════════════════════════════════════════════════════════

  function showSection(id) {
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
      'coaches':          () => Clients.loadCoaches(),
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
      // ── NeuCore Intelligence (Task 5 + Phase B) ───────────
      'services':         () => { /* static content */ },
      'gait':             () => { /* placeholder — wired in future phase */ },
      'case-studies':     () => (typeof PlatformExtras !== 'undefined' && PlatformExtras.initCaseStudiesCarousel?.()),
      'analytics':        () => (typeof Charts !== 'undefined' && Charts.renderDashboardAnalytics?.()),
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
      // ── My Program — client's read-only published training program ──
      'my-program':       () => (typeof ProgramPublish !== 'undefined'
                                 && ProgramPublish.renderClientProgram('#my-program-host')),
    };
    loaders[id]?.();
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
      // Client count
      let q = sb.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'client');
      if (Auth.isCoach()) q = q.eq('assigned_coach', Auth.getUser()?.id);
      const { count: clientCount } = await q;
      _setStat('stat-clients', clientCount ?? 0);

      // Active subscriptions
      const { data: subs } = await sb.from('subscriptions').select('*').eq('status', 'active');
      _setStat('stat-subs', subs?.length ?? 0);

      // Expiring in 7 days
      const in7 = new Date(); in7.setDate(in7.getDate() + 7);
      const expiring = (subs || []).filter(s => {
        const end = new Date(s.end_date);
        return end <= in7 && end >= new Date();
      });
      _setStat('stat-expiring', expiring.length);
    }

    // Sessions count (local)
    _setStat('stat-sessions', _sessions.length);

    // Recent sessions
    _renderRecentSessions();

    // Recent clients
    await _renderRecentClients();
  }

  function _setStat(id, val) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '0';
      _animateNumber(el, parseInt(val) || 0);
    }
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

  function _renderRecentSessions() {
    const el = document.getElementById('recent-sessions-list');
    if (!el) return;
    const sessions = _sessions.slice(0, 5);
    if (!sessions.length) {
      el.innerHTML = _emptyState('◈', 'No sessions yet', 'Generate your first session to see it here.');
      return;
    }
    el.innerHTML = sessions.map(s => `
      <div class="flex items-center gap-3" style="padding:11px 0; border-bottom:1px solid var(--border-subtle)">
        <div class="avatar avatar-sm" style="background:conic-gradient(from 180deg,var(--teal),var(--amber))">${(s.name||'?')[0].toUpperCase()}</div>
        <div class="flex-1 truncate">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${s.name}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">${new Date(s.createdAt).toLocaleDateString()}</div>
        </div>
        <span class="badge ${_phaseBadge(s.phase)}">${s.phase}</span>
      </div>`).join('');
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

Keep output clean, structured, and clinically precise.`;
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

      // ── STEP 4: AI narrative (Claude) ────────────────────────
      btn.innerHTML = '<span class="spinner"></span> Generating AI analysis...';
      let aiText = '';
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model:      'claude-sonnet-4-20250514',
            max_tokens: 1200,
            messages:   [{ role: 'user', content: buildPrompt() }],
          }),
        });
        const result = await res.json();
        if (result.error) throw new Error(result.error.message);
        aiText = result.content?.map(i => i.text || '').join('\n') || '';
      } catch(aiErr) {
        // AI narrative is a bonus — don't fail the whole flow
        console.warn('AI narrative skipped:', aiErr.message);
        aiText = `[AI narrative unavailable — check API key]\n\nScores: ROM ${scores.rom_score}% · Control ${scores.control_score}% · Force ${scores.force_score}% · Neurology ${scores.neurology_score}%\nComposite: ${scores.composite_score}% → ${scores.phase_recommendation}`;
      }

      const outEl = document.getElementById('program-output-text');
      const panel = document.getElementById('output-panel');
      if (outEl) outEl.textContent = aiText;
      if (panel) panel.classList.remove('hidden');

      // ── STEP 5: Save locally ─────────────────────────────────
      const session = {
        name, phase: _gv('ns-phase'), goal: _gv('ns-goal'),
        output: aiText, scores, program, createdAt: new Date().toISOString(),
      };
      _sessions.unshift(session);
      saveSessions();

      // Keep the full bundle so "Export Professional PDF" can build the report.
      _lastBundle = { name, assessment, scores, gait, program, aiText, clientId: activeClientId };

      // ── STEP 6: Persist to Supabase (non-blocking) ───────────
      // Client is the one selected in the active session (Client Info tab).
      _saveToSupabase(activeClientId, scores, program, aiText, gait, assessment);

      toast('Program generated!', 'success');

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

  // Clinical findings (posture / movement screens / compensations).
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

  function renderProgramsList() {
    const el = document.getElementById('programs-list');
    if (!el) return;
    if (!_sessions.length) {
      el.innerHTML = `<div class="empty-state"><span class="empty-icon">◈</span><div class="empty-title">No programs yet</div><p class="empty-desc">Generate your first session to see it here.</p><button class="btn btn-primary" onclick="Dashboard.showSection('new-session')">+ New Session</button></div>`;
      return;
    }
    el.innerHTML = _sessions.map((s, i) => `
      <div class="card card-hover" style="margin-bottom:12px;cursor:pointer" onclick="Dashboard.toggleProgram(${i},this)">
        <div class="flex items-center gap-3">
          <div class="avatar" style="background:conic-gradient(from 180deg,var(--teal),var(--amber))">${(s.name||'?')[0].toUpperCase()}</div>
          <div class="flex-1 truncate">
            <div style="font-weight:600;font-size:14px">${s.name}</div>
            <div style="font-size:12px;color:var(--text-tertiary)">${s.goal||''} · ${new Date(s.createdAt).toLocaleDateString()}</div>
          </div>
          <span class="badge ${_phaseBadge(s.phase)}">${s.phase}</span>
          <span style="color:var(--text-tertiary);font-size:18px;transition:transform 0.2s" class="prog-arrow">›</span>
        </div>
        <div class="prog-body hidden" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-subtle)">
          <pre class="program-output">${s.output}</pre>
          <div style="margin-top:12px;display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();Dashboard.rePreviewWeb(${i})">🌐 Web Preview</button>
          </div>
        </div>
      </div>`).join('');
  }

  function toggleProgram(i, card) {
    const body  = card.querySelector('.prog-body');
    const arrow = card.querySelector('.prog-arrow');
    const open  = body.classList.toggle('hidden');
    if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
  }

  function rePreviewWeb(i) {
    const s = _sessions[i];
    const setVal = (id, v) => { const e = document.getElementById(id); if(e) e.value = v; };
    setVal('ns-name', s.name);
    setVal('ns-phase', s.phase);
    setVal('ns-goal', s.goal || '');
    const outEl = document.getElementById('program-output-text');
    if (outEl) outEl.textContent = s.output;
    previewWeb();
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

    // Coach dropdown for Add Client
    const { data: coaches } = await sb.from('profiles')
      .select('id, full_name, email').in('role',['coach','admin']);
    const coachSel = document.getElementById('ac-coach');
    if (coachSel && coaches) {
      coaches.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.full_name || c.email;
        coachSel.appendChild(opt);
      });
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

    const { error } = await sb.from('profiles')
      .update({ current_phase: newPhase })
      .eq('id', clientId);

    if (error) { toast(error.message, 'error'); return; }

    // Send celebration email
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type: 'phase_upgrade', client_id: clientId, new_phase: newPhase, message })
      });
    } catch(e) { console.warn('Email send failed:', e); }

    toast(`Client upgraded to ${newPhase}! 🎉`, 'success');
    showCelebration(newPhase);
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

  function _emptyState(icon, title, desc) {
    return `<div class="empty-state"><span class="empty-icon">${icon}</span><div class="empty-title">${title}</div><p class="empty-desc">${desc}</p></div>`;
  }

  return {
    initShell, showSection, initTabs,
    loadDashboardStats,
    generateProgram, previewWeb, renderProgramsList,
    toggleProgram, rePreviewWeb,
    exportProfessionalPDF,
    fillClientFromSelect,
    openClientInfoTab,
    submitPhaseUpgrade, showCelebration, closeCelebration,
    openModal, closeModal, calcSubEndDate,
    submitChangePassword,
    toast,
  };

})();

window.Dashboard = Dashboard;
// Shortcut for HTML onclick
window.toast = Dashboard.toast;
