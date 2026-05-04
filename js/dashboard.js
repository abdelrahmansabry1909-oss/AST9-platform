// ═══════════════════════════════════════════════════════════════
//  js/dashboard.js
//  Handles: app shell rendering, navigation, stat cards,
//           recent sessions, program generation + output,
//           toast, modal helpers, celebration overlay.
// ═══════════════════════════════════════════════════════════════

const Dashboard = (() => {

  // ── Local session storage ────────────────────────────────────
  const SESSIONS_KEY = 'ast9_sessions_v2';
  let _sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');

  function saveSessions() {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(_sessions));
  }

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

    const section = document.getElementById('section-' + id);
    const navItem = document.getElementById('nav-' + id);
    if (section) section.classList.add('active');
    if (navItem)  navItem.classList.add('active');

    // Lazy-load section data
    const loaders = {
      'clients':          () => Clients.loadAll(),
      'subscriptions':    () => { Subscriptions.loadAll(); _populateClientSelects(); },
      'coaches':          () => Clients.loadCoaches(),
      'dashboard':        () => loadDashboardStats(),
      'programs':         () => renderProgramsList(),
      'exercise-library': () => Clients.loadExercises?.(),
      'new-session':      () => _populateClientSelects(),
    };
    loaders[id]?.();
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
        });
      });
    });
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

  async function generateProgram() {
    const name = _gv('ns-name');
    if (!name) { toast('Please enter client name first', 'error'); return; }

    const btn = document.getElementById('generate-btn');
    if (!btn) return;
    const origHTML = btn.innerHTML;
    btn.innerHTML = '<span class="spinner"></span> Generating...';
    btn.disabled = true;

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) {
        toast('Session expired — please sign in again.', 'error');
        return;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ prompt: buildPrompt() }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || result.message || `Server error ${res.status}`);
      if (result.error) throw new Error(result.error?.message || JSON.stringify(result.error));

      const text = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No output generated.';

      // Display
      const outEl = document.getElementById('program-output-text');
      const panel = document.getElementById('output-panel');
      if (outEl) outEl.textContent = text;
      if (panel) panel.classList.remove('hidden');

      // Save locally
      const session = {
        name, phase: _gv('ns-phase'), goal: _gv('ns-goal'),
        output: text, createdAt: new Date().toISOString()
      };
      _sessions.unshift(session);
      saveSessions();

      // Optionally save to Supabase
      const clientId = _gv('ns-save-client');
      if (clientId) {
        await sb.from('sessions').insert({
          client_id: clientId,
          coach_id: Auth.getUser()?.id,
          phase: _gv('ns-phase'),
          goal: _gv('ns-goal'),
          output: text,
        });
      }

      toast('Program generated!', 'success');
    } catch(e) {
      toast(e.message || 'Generation failed', 'error');
      console.error('Generate program error:', e);
    } finally {
      btn.innerHTML = origHTML;
      btn.disabled = false;
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
    const open = !body.classList.toggle('hidden');
    if (arrow) arrow.style.transform = open ? 'rotate(90deg)' : '';
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

    ['ns-client-select','ns-save-client','sub-client','pu-client'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const placeholderText = el.options[0] ? el.options[0].textContent : '— Select —';
      el.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = placeholderText;
      el.appendChild(opt0);
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
      const sessionData = await sb.auth.getSession();
      const token = sessionData?.data?.session?.access_token;
      if (!token) throw new Error('Session expired. Please sign in again.');
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
    fillClientFromSelect,
    refreshClientSelects: _populateClientSelects,
    submitPhaseUpgrade, showCelebration, closeCelebration,
    openModal, closeModal, calcSubEndDate,
    submitChangePassword,
    toast,
  };

})();

window.Dashboard = Dashboard;
// Shortcut for HTML onclick
window.toast = Dashboard.toast;
