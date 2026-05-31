/* ═══════════════════════════════════════════════════════════════
   NeuCore — Daily Routine
   Vanilla port + enhancement of the RoutineTracker artifact.

   Two surfaces, one module (window.DailyRoutine):
     • mountTracker(container, opts)   — client-facing checklist.
         Checks persist per calendar day to Supabase (daily_routine_logs),
         so progress survives reload and the coach can see adherence.
     • mountCoachView(container, opts) — coach-facing adherence dashboard:
         pick a client → 30-day heatmap, streak, 7/30-day averages.

   Data: public.daily_routine_logs  (single source of truth as of the
                                     System Stabilization Pass — the
                                     localStorage fallback was removed
                                     because its shape did not match the
                                     live schema and silently produced
                                     unreadable rows when SB failed).
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── The NeuCore daily routine (from the RoutineTracker artifact) ──
  const ROUTINE = [
    { id: 0, label: 'Zen Swing', section: 'morning', emoji: '🌀', meta: '⏱ 1–2 minutes',
      details: ['Gentle rhythmic movement to loosen the body and reset the nervous system.'] },
    { id: 1, label: 'Spine Segmentation', section: 'morning', emoji: '🦴', meta: '🔁 5–8 reps',
      details: ['Slowly roll down and up, moving one vertebra at a time.'] },
    { id: 2, label: 'Side-Lying Chest Expansion (180°)', section: 'morning', emoji: '🌬️', meta: '🔁 5 reps each side',
      details: ['Lie on your side.', 'Open top arm across your body toward the floor behind.',
        'Let chest rotate fully.', 'Move slowly with breath.'] },
    { id: 3, label: 'Rib Cage Breathing', section: 'morning', emoji: '🫁', meta: '🌬 6–10 breaths',
      details: ['Hands on ribs.', 'Inhale → expand sideways.', 'Exhale → ribs soften inward.',
        'Keep shoulders relaxed.'] },
    { id: 4, label: 'Pelvic Tilts', section: 'morning', emoji: '⚖️', meta: '🔁 8–12 reps',
      details: ['Gentle forward/back tilt.', 'Move with control.', 'Optional: sync with breath.'] },
    { id: 5, label: 'Spine Segmentation', section: 'evening', emoji: '🦴', meta: '🔁 5 slow reps',
      details: ['Move slower than morning, focus on releasing tension.'] },
    { id: 6, label: 'Belly Breathing', section: 'evening', emoji: '🌙', meta: '🌬 2–5 minutes',
      details: ['Inhale → belly rises.', 'Exhale → belly falls.', 'Slow rhythm: 4 sec inhale / 6 sec exhale.'] },
  ];
  const SECTION_META = {
    morning: { title: '🌅 Morning', goal: 'Wake up body • Improve mobility • Activate breath',
      duration: '10–15 min', endFeeling: 'Open • Awake • Grounded' },
    evening: { title: '🌙 Evening', goal: 'Release tension • Relax body • Prepare for sleep',
      duration: '5–8 min', endFeeling: 'Calm • Heavy • Relaxed' },
  };
  const NOTES = ['Move slowly and with awareness', 'No pain — only gentle stretch', 'Consistency > intensity'];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const arcColor = (p) => (p === 100 ? '#4ade80' : p >= 60 ? '#60a5fa' : p > 0 ? '#f59e0b' : '#d1d5db');

  // ── One-time stylesheet ───────────────────────────────────
  function injectCSS() {
    if (document.getElementById('dr-styles')) return;
    const el = document.createElement('style');
    el.id = 'dr-styles';
    el.textContent = `
.dr-wrap{font-family:Georgia,'Times New Roman',serif;display:flex;justify-content:center;padding:8px 4px 24px;}
.dr-card{width:100%;max-width:440px;background:#fff;border-radius:24px;padding:26px 22px;
  box-shadow:0 12px 40px rgba(0,0,0,.10);border:1px solid #eef1f4;}
.dr-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;}
.dr-title-row{display:flex;align-items:center;gap:8px;}
.dr-title-icon{font-size:24px;}
.dr-title{margin:0;font-size:22px;font-weight:700;color:#111827;letter-spacing:-.5px;}
.dr-sub{margin:4px 0 0;font-size:11px;color:#9ca3af;letter-spacing:1.5px;text-transform:uppercase;font-family:system-ui,sans-serif;}
.dr-bartrack{height:6px;background:#f3f4f6;border-radius:99px;overflow:hidden;margin-bottom:8px;}
.dr-barfill{height:100%;border-radius:99px;transition:width .4s ease,background .4s ease;}
.dr-count{font-size:12px;color:#9ca3af;margin:0 0 8px;font-family:system-ui,sans-serif;display:flex;align-items:center;gap:8px;}
.dr-badge{background:#dcfce7;color:#16a34a;font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600;}
.dr-meta-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;font-family:system-ui,sans-serif;}
.dr-chip{font-size:11px;background:#f3f4f6;color:#6b7280;padding:3px 10px;border-radius:99px;display:flex;gap:5px;align-items:center;}
.dr-chip b{color:#374151;font-weight:600;}
.dr-section{margin-bottom:22px;}
.dr-sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}
.dr-sec-title{font-size:13px;font-weight:700;color:#374151;letter-spacing:.5px;margin:0;font-family:system-ui,sans-serif;}
.dr-dur{font-size:11px;background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:99px;font-family:system-ui,sans-serif;}
.dr-goal{font-size:11px;color:#9ca3af;margin:0 0 12px;font-family:system-ui,sans-serif;font-style:italic;}
.dr-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;border:1.5px solid #e5e7eb;
  background:#fafafa;user-select:none;cursor:pointer;transition:all .25s ease;}
.dr-item.done{background:#f0fdf4;border-color:#bbf7d0;}
.dr-item.open{border-bottom-left-radius:0;border-bottom-right-radius:0;border-color:#bfdbfe;}
.dr-item.pop{transform:scale(1.02);}
.dr-emoji{font-size:18px;width:24px;text-align:center;flex-shrink:0;}
.dr-label{font-size:15px;font-weight:500;display:block;color:#111827;transition:color .3s ease;}
.dr-item.done .dr-label{color:#86efac;text-decoration:line-through;}
.dr-metatag{font-size:11px;color:#9ca3af;font-family:system-ui,sans-serif;margin-top:2px;display:block;}
.dr-chev{font-size:14px;color:#9ca3af;transition:transform .25s ease;flex-shrink:0;}
.dr-chev.open{transform:rotate(180deg);}
.dr-check{width:22px;height:22px;border-radius:50%;border:2px solid #d1d5db;background:#fff;display:flex;
  align-items:center;justify-content:center;flex-shrink:0;transition:all .25s ease;cursor:pointer;}
.dr-check.done{background:#4ade80;border-color:#4ade80;}
.dr-detail{border:1.5px solid #bfdbfe;border-top:none;border-bottom-left-radius:12px;border-bottom-right-radius:12px;padding:12px 16px;}
.dr-detail.done{border-color:#bbf7d0;background:#f0fdf4;}
.dr-detail.todo{background:#eff6ff;}
.dr-detail-line{margin:5px 0;font-size:13px;color:#374151;font-family:system-ui,sans-serif;display:flex;gap:6px;line-height:1.5;}
.dr-detail-dot{color:#60a5fa;font-weight:700;flex-shrink:0;}
.dr-rowgap{margin-bottom:8px;}
.dr-endfeel{font-size:12px;color:#6b7280;margin:10px 0 0;font-family:system-ui,sans-serif;}
.dr-notes{background:#fafafa;border-radius:12px;padding:14px 16px;margin-bottom:16px;border:1.5px solid #f3f4f6;}
.dr-notes-title{margin:0 0 8px;font-size:13px;font-weight:700;color:#374151;font-family:system-ui,sans-serif;}
.dr-note{margin:4px 0;font-size:12px;color:#6b7280;font-family:system-ui,sans-serif;}
.dr-reset{width:100%;padding:12px;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:12px;
  font-size:13px;color:#6b7280;font-family:system-ui,sans-serif;cursor:pointer;letter-spacing:.5px;}
.dr-reset:hover{background:#f3f4f6;}
.dr-save{font-size:11px;font-family:system-ui,sans-serif;}
/* Coach view */
.dr-coach{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;}
.dr-coach-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:22px 24px;box-shadow:0 8px 28px rgba(0,0,0,.06);margin-bottom:16px;}
.dr-stat-row{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0;}
.dr-stat{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:14px;text-align:center;}
.dr-stat-val{font-size:26px;font-weight:700;color:#111827;}
.dr-stat-lbl{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-top:3px;}
.dr-heat{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;}
.dr-heat-cell{width:20px;height:20px;border-radius:4px;border:1px solid rgba(0,0,0,.05);}
.dr-heat-legend{display:flex;gap:14px;font-size:11px;color:#6b7280;margin-top:10px;align-items:center;flex-wrap:wrap;}
.dr-day-list{margin-top:14px;}
.dr-day-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;}
.dr-day-bar{flex:1;height:7px;background:#f1f5f9;border-radius:99px;overflow:hidden;}
.dr-day-bar-fill{height:100%;border-radius:99px;}
`;
    document.head.appendChild(el);
  }

  // ── Supabase persistence — single source of truth ──────────────
  const _hasSB = () => typeof sb !== 'undefined' && sb;

  async function loadLog(clientId, date) {
    if (!_hasSB()) return null;
    try {
      const { data, error } = await sb.from('daily_routine_logs')
        .select('completed_tasks, total_tasks, completed_count, percent')
        .eq('client_id', clientId).eq('log_date', date).maybeSingle();
      if (error) throw error;
      return data || null;
    } catch (e) {
      console.warn('[dailyRoutine] load failed:', e.message);
      return null;
    }
  }

  async function saveLog(clientId, date, completedIds, total) {
    const completed_count = completedIds.length;
    const percent = total ? Math.round((completed_count / total) * 100) : 0;
    const row = {
      client_id: clientId, log_date: date,
      completed_tasks: completedIds, total_tasks: total,
      completed_count, percent, updated_at: new Date().toISOString(),
    };
    if (!_hasSB()) {
      // No Supabase = no persistence. Surface to the caller so the UI
      // can warn instead of silently dropping the user's check-ins.
      throw new Error('Storage unavailable — your check-in was not saved.');
    }
    const { error } = await sb.from('daily_routine_logs')
      .upsert(row, { onConflict: 'client_id,log_date' });
    if (error) throw error;
    return row;
  }

  // Load the routine the COACH published for this client (client_routines).
  // Falls back to the standard NeuCore routine ONLY when the coach hasn't
  // published one yet (that's a normal product state, not a failure).
  async function loadRoutine(clientId) {
    if (!_hasSB()) return ROUTINE.slice();
    try {
      const { data, error } = await sb.from('client_routines')
        .select('tasks, published').eq('client_id', clientId).maybeSingle();
      if (error) throw error;
      if (data && data.published && Array.isArray(data.tasks) && data.tasks.length) {
        return data.tasks.map((t, i) => ({
          id:      i,
          label:   t.label || `Task ${i + 1}`,
          section: t.section === 'evening' ? 'evening' : 'morning',
          emoji:   t.emoji || '🌀',
          meta:    t.meta || '',
          details: Array.isArray(t.details) ? t.details : (t.details ? [String(t.details)] : []),
        }));
      }
    } catch (e) { console.warn('[dailyRoutine] published routine load failed:', e.message); }
    return ROUTINE.slice();
  }

  async function historyFor(clientId, days) {
    if (!_hasSB()) return [];
    const since = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    try {
      const { data, error } = await sb.from('daily_routine_logs')
        .select('log_date, percent, completed_count, total_tasks')
        .eq('client_id', clientId).gte('log_date', since)
        .order('log_date', { ascending: true });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[dailyRoutine] history failed:', e.message);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CLIENT TRACKER
  // ═══════════════════════════════════════════════════════════
  async function mountTracker(container, opts = {}) {
    injectCSS();
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;

    let clientId = opts.clientId;
    if (!clientId) {
      try { clientId = Auth.getUser()?.id; } catch {}
    }
    if (!clientId) {
      host.innerHTML = `<div class="dr-wrap"><div class="dr-card">
        <p style="font-family:system-ui;color:#6b7280;font-size:14px">Sign in to track your daily routine.</p>
      </div></div>`;
      return;
    }

    const date = opts.date || todayStr();
    const readOnly = !!opts.readOnly;

    // Stabilization Pass: parallelize the two independent reads. With
    // the LS fast-path removed, doing these sequentially adds a full
    // network round-trip to every tracker mount. Promise.all collapses
    // them into one frame.
    const [routine, log] = await Promise.all([
      opts.routine ? Promise.resolve(opts.routine) : loadRoutine(clientId),
      loadLog(clientId, date),
    ]);

    const state = { checked: {}, expanded: {}, pop: null, saving: false, savedAt: null };

    // Restore today's progress
    if (log && Array.isArray(log.completed_tasks)) {
      log.completed_tasks.forEach((id) => { state.checked[id] = true; });
    }

    let saveTimer = null;
    const persist = () => {
      if (readOnly) return;
      const ids = routine.filter((t) => state.checked[t.id]).map((t) => t.id);
      state.saving = true;
      renderSaveState();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          await saveLog(clientId, date, ids, routine.length);
          state.saving = false;
          state.savedAt = new Date();
        } catch (e) {
          console.error('[dailyRoutine] save failed:', e);
          state.saving = false;
          state.savedAt = 'error';
        }
        renderSaveState();
      }, 450);
    };

    function renderSaveState() {
      const el = host.querySelector('#dr-save');
      if (!el) return;
      if (state.saving) { el.textContent = '• Saving…'; el.style.color = '#60a5fa'; }
      else if (state.savedAt === 'error') { el.textContent = '• Save failed — please retry'; el.style.color = '#ef4444'; }
      else if (state.savedAt) { el.textContent = '✓ Saved'; el.style.color = '#16a34a'; }
      else { el.textContent = ''; }
    }

    function render() {
      const total = routine.length || 1;
      const completed = Object.values(state.checked).filter(Boolean).length;
      const percent = Math.round((completed / total) * 100);
      const col = arcColor(percent);
      const R = 30, CIRC = 2 * Math.PI * R;
      const niceDate = new Date(date + 'T00:00:00').toLocaleDateString(undefined,
        { weekday: 'long', month: 'short', day: 'numeric' });

      const sectionHTML = (key) => {
        const meta = SECTION_META[key];
        const items = routine.filter((t) => t.section === key);
        if (!items.length) return '';
        return `
          <div class="dr-section">
            <div class="dr-sec-head">
              <h2 class="dr-sec-title">${esc(meta.title)}</h2>
              <span class="dr-dur">${esc(meta.duration)}</span>
            </div>
            <p class="dr-goal">${esc(meta.goal)}</p>
            ${items.map((task) => {
              const done = !!state.checked[task.id];
              const open = !!state.expanded[task.id];
              const pop  = state.pop === task.id;
              return `
                <div class="dr-rowgap">
                  <div class="dr-item ${done ? 'done' : ''} ${open ? 'open' : ''} ${pop ? 'pop' : ''}"
                       data-expand="${task.id}">
                    <span class="dr-emoji">${task.emoji}</span>
                    <div style="flex:1">
                      <span class="dr-label">${esc(task.label)}</span>
                      <span class="dr-metatag">${esc(task.meta)}</span>
                    </div>
                    <span class="dr-chev ${open ? 'open' : ''}">▾</span>
                    <div class="dr-check ${done ? 'done' : ''}" data-check="${task.id}" role="checkbox"
                         aria-checked="${done}" tabindex="0">
                      ${done ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
                    </div>
                  </div>
                  ${open ? `
                    <div class="dr-detail ${done ? 'done' : 'todo'}">
                      ${task.details.map((l) => `<p class="dr-detail-line"><span class="dr-detail-dot">›</span> ${esc(l)}</p>`).join('')}
                    </div>` : ''}
                </div>`;
            }).join('')}
            <p class="dr-endfeel">✅ End feeling: <em>${esc(meta.endFeeling)}</em></p>
          </div>`;
      };

      host.innerHTML = `
        <div class="dr-wrap"><div class="dr-card">
          <div class="dr-head">
            <div>
              <div class="dr-title-row">
                <span class="dr-title-icon">𓆸</span>
                <h1 class="dr-title">Daily Routine</h1>
              </div>
              <p class="dr-sub">Move. Breathe. Reset.</p>
            </div>
            <svg width="72" height="72" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r="${R}" fill="none" stroke="#e5e7eb" stroke-width="6"/>
              <circle cx="36" cy="36" r="${R}" fill="none" stroke="${col}" stroke-width="6"
                stroke-linecap="round" stroke-dasharray="${CIRC}"
                stroke-dashoffset="${CIRC * (1 - percent / 100)}"
                transform="rotate(-90 36 36)"
                style="transition:stroke-dashoffset .5s ease,stroke .4s ease"/>
              <text x="36" y="40" text-anchor="middle" style="font-size:14px;font-weight:700;fill:#111">${percent}%</text>
            </svg>
          </div>

          <div class="dr-bartrack"><div class="dr-barfill" style="width:${percent}%;background:${col}"></div></div>
          <p class="dr-count">
            ${completed} of ${total} completed
            ${completed === total ? '<span class="dr-badge">✦ Done!</span>' : ''}
            <span id="dr-save" class="dr-save" style="margin-left:auto"></span>
          </p>

          <div class="dr-meta-strip">
            <span class="dr-chip">📅 <b>${esc(niceDate)}</b></span>
            <span class="dr-chip">🔥 Streak <b id="dr-streak">…</b></span>
          </div>

          ${sectionHTML('morning')}
          ${sectionHTML('evening')}

          <div class="dr-notes">
            <p class="dr-notes-title">🧩 Notes</p>
            ${NOTES.map((n) => `<p class="dr-note">· ${esc(n)}</p>`).join('')}
          </div>

          ${readOnly ? '' : '<button class="dr-reset" id="dr-reset">↺ Reset Day</button>'}
        </div></div>`;

      // wire events
      host.querySelectorAll('[data-expand]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if (e.target.closest('[data-check]')) return;
          const id = +el.dataset.expand;
          state.expanded[id] = !state.expanded[id];
          render();
        });
      });
      if (!readOnly) {
        host.querySelectorAll('[data-check]').forEach((el) => {
          const toggle = (e) => {
            e.stopPropagation();
            const id = +el.dataset.check;
            state.checked[id] = !state.checked[id];
            state.pop = state.checked[id] ? id : null;
            persist();
            render();
            if (state.pop != null) setTimeout(() => { state.pop = null; render(); }, 320);
          };
          el.addEventListener('click', toggle);
          el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') toggle(e); });
        });
        host.querySelector('#dr-reset')?.addEventListener('click', () => {
          state.checked = {}; state.expanded = {};
          persist();
          render();
        });
      }
      renderSaveState();
      paintStreak();
    }

    async function paintStreak() {
      try {
        const hist = await historyFor(clientId, 60);
        const byDate = {};
        hist.forEach((h) => { byDate[h.log_date] = h.percent; });
        let streak = 0;
        for (let i = 0; i < 60; i++) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          if ((byDate[d] || 0) >= 60) streak++;
          else if (i === 0) continue;     // today not done yet — don't break the streak
          else break;
        }
        const el = host.querySelector('#dr-streak');
        if (el) el.textContent = `${streak} day${streak === 1 ? '' : 's'}`;
      } catch {
        const el = host.querySelector('#dr-streak');
        if (el) el.textContent = '—';
      }
    }

    render();
  }

  // ═══════════════════════════════════════════════════════════
  //  COACH ADHERENCE VIEW
  // ═══════════════════════════════════════════════════════════
  async function mountCoachView(container, opts = {}) {
    injectCSS();
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;

    // Load this coach's clients
    let clients = [];
    try {
      let q = sb.from('profiles').select('id, full_name, email').eq('role', 'client');
      if (typeof Auth !== 'undefined' && Auth.isCoach && Auth.isCoach() && !Auth.isAdmin()) {
        q = q.eq('assigned_coach', Auth.getUser()?.id);
      }
      const { data } = await q.order('full_name', { ascending: true });
      clients = data || [];
    } catch (e) { console.warn('[dailyRoutine] client load failed:', e); }

    host.innerHTML = `
      <div class="dr-coach">
        <div class="dr-coach-card">
          <h2 style="margin:0 0 4px;font-size:18px;color:#111827">Daily Routine — Client Adherence</h2>
          <p style="margin:0 0 14px;font-size:13px;color:#6b7280">
            See which clients are completing their daily routine, and how consistently.
          </p>
          <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:6px">Select client</label>
          <select id="dr-coach-client" class="form-input" style="max-width:340px">
            <option value="">— Choose a client —</option>
            ${clients.map((c) => `<option value="${esc(c.id)}">${esc(c.full_name || c.email)}</option>`).join('')}
          </select>
        </div>
        <div id="dr-coach-detail"></div>
      </div>`;

    const sel = host.querySelector('#dr-coach-client');
    sel.addEventListener('change', () => renderClient(sel.value, sel.options[sel.selectedIndex]?.textContent));

    async function renderClient(clientId, name) {
      const detail = host.querySelector('#dr-coach-detail');
      if (!clientId) { detail.innerHTML = ''; return; }
      detail.innerHTML = `<div class="dr-coach-card"><p style="color:#6b7280;font-size:13px">Loading adherence…</p></div>`;

      let hist = [];
      try { hist = await historyFor(clientId, 30); }
      catch (e) {
        detail.innerHTML = `<div class="dr-coach-card"><p style="color:#ef4444;font-size:13px">Could not load adherence: ${esc(e.message)}</p></div>`;
        return;
      }

      const byDate = {};
      hist.forEach((h) => { byDate[h.log_date] = h; });

      // build 30-day window (oldest → newest)
      const days = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        days.push({ date: d, log: byDate[d] || null });
      }

      const pctOf = (day) => day.log ? (day.log.percent || 0) : -1;   // -1 = no entry
      const cellColor = (p) => p < 0 ? '#f1f5f9' : p === 0 ? '#fee2e2'
        : p >= 100 ? '#4ade80' : p >= 60 ? '#60a5fa' : '#fbbf24';

      // streak (consecutive most-recent days with >=60%)
      let streak = 0;
      for (let i = days.length - 1; i >= 0; i--) {
        const p = pctOf(days[i]);
        if (p >= 60) streak++;
        else if (i === days.length - 1 && p < 0) continue; // today blank — ignore
        else break;
      }
      const logged = days.filter((d) => d.log);
      const avg = (arr) => arr.length ? Math.round(arr.reduce((s, d) => s + (d.log.percent || 0), 0) / arr.length) : 0;
      const last7 = logged.filter((d) => d.date >= new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
      const activeDays = logged.length;

      detail.innerHTML = `
        <div class="dr-coach-card">
          <h3 style="margin:0 0 2px;font-size:16px;color:#111827">${esc(name || 'Client')}</h3>
          <p style="margin:0;font-size:12px;color:#9ca3af">Last 30 days</p>

          <div class="dr-stat-row">
            <div class="dr-stat"><div class="dr-stat-val" style="color:#16a34a">${streak}</div><div class="dr-stat-lbl">Day Streak</div></div>
            <div class="dr-stat"><div class="dr-stat-val">${avg(last7)}%</div><div class="dr-stat-lbl">7-Day Avg</div></div>
            <div class="dr-stat"><div class="dr-stat-val">${avg(logged)}%</div><div class="dr-stat-lbl">30-Day Avg</div></div>
            <div class="dr-stat"><div class="dr-stat-val">${activeDays}<span style="font-size:14px;color:#9ca3af">/30</span></div><div class="dr-stat-lbl">Active Days</div></div>
          </div>

          <div style="font-size:12px;color:#6b7280;margin:4px 0 6px;font-weight:600">30-Day Heatmap</div>
          <div class="dr-heat">
            ${days.map((d) => {
              const p = pctOf(d);
              const lbl = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
              return `<div class="dr-heat-cell" style="background:${cellColor(p)}"
                title="${esc(lbl)} — ${p < 0 ? 'no entry' : p + '%'}"></div>`;
            }).join('')}
          </div>
          <div class="dr-heat-legend">
            <span><span class="dr-heat-cell" style="display:inline-block;width:12px;height:12px;vertical-align:-2px;background:#4ade80"></span> 100%</span>
            <span><span class="dr-heat-cell" style="display:inline-block;width:12px;height:12px;vertical-align:-2px;background:#60a5fa"></span> 60–99%</span>
            <span><span class="dr-heat-cell" style="display:inline-block;width:12px;height:12px;vertical-align:-2px;background:#fbbf24"></span> 1–59%</span>
            <span><span class="dr-heat-cell" style="display:inline-block;width:12px;height:12px;vertical-align:-2px;background:#fee2e2"></span> 0%</span>
            <span><span class="dr-heat-cell" style="display:inline-block;width:12px;height:12px;vertical-align:-2px;background:#f1f5f9"></span> No entry</span>
          </div>

          ${logged.length ? `
            <div class="dr-day-list">
              <div style="font-size:12px;color:#6b7280;margin-bottom:4px;font-weight:600">Recent activity</div>
              ${logged.slice(-10).reverse().map((d) => {
                const p = d.log.percent || 0;
                const c = cellColor(p);
                const lbl = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                return `<div class="dr-day-row">
                  <span style="width:120px;color:#374151">${esc(lbl)}</span>
                  <div class="dr-day-bar"><div class="dr-day-bar-fill" style="width:${p}%;background:${c}"></div></div>
                  <span style="width:78px;text-align:right;color:#6b7280">${d.log.completed_count}/${d.log.total_tasks} · ${p}%</span>
                </div>`;
              }).join('')}
            </div>
          ` : `<p style="font-size:13px;color:#9ca3af;margin-top:14px">No routine activity logged yet for this client.</p>`}
        </div>`;
    }
  }

  window.DailyRoutine = { mountTracker, mountCoachView, ROUTINE, loadLog, saveLog, historyFor, loadRoutine };
})();
