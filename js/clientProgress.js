/* ═══════════════════════════════════════════════════════════════
   CLIENT PROGRESS — recovery momentum home (Recovery Journey · S3)

   The place a client goes to feel progress, momentum, and confidence,
   not to be evaluated. Information architecture, top to bottom:

     SUMMARY first    → recovery momentum: a calm trend line + plain
                        "Improving / Steady / Building" headline.
     DETAILS second   → check-in history (dates + score), and the latest
                        report behind disclosure.
     ADVANCED last    → body load map (3D, fullscreen on demand) and the
                        dense analytics (progression gauges + clinical
                        charts), all collapsed behind progressive
                        disclosure.

   Everything beyond the summary is collapsed by default. The hologram is
   secondary: collapsed, expands to a fullscreen experience, and disposes
   its WebGL context on close.

   Presentation-layer only. Reuses AssessmentSnapshot (F7), Progression,
   ClientCharts, and reads assessments + rehab_objective_assessments for
   the timeline. No backend, schema, or RLS changes.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // Shared helpers (S5): delegate to ClientUtil so the band scale and
  // escaping stay identical across Today / Train / Progress / Coach.
  const _esc  = (s) => ClientUtil.esc(s);
  const _band = (s) => ClientUtil.band(s);

  // Recovery timeline from real assessment history (composite score over time).
  async function _timeline(uid) {
    try {
      const { data, error } = await sb.from('assessments')
        .select('created_at, rehab_objective_assessments(composite_score)')
        .eq('client_id', uid)
        .order('created_at', { ascending: true });
      if (error) { console.warn('[progress] timeline:', error.message); return []; }
      const pts = [];
      (data || []).forEach((a) => {
        const arr = a.rehab_objective_assessments || [];
        let c = null;
        for (const r of arr) { if (r && r.composite_score != null) { c = Number(r.composite_score); break; } }
        if (c != null) pts.push({ date: a.created_at, score: c });
      });
      return pts;
    } catch (_) { return []; }
  }

  function _momentum(pts) {
    if (pts.length < 2) return { word: 'Building', arrow: '', msg: 'Your recovery trend appears as you complete more check-ins.' };
    const d = pts[pts.length - 1].score - pts[0].score;
    if (d >= 3)  return { word: 'Improving', arrow: '↑', msg: 'Your recovery is trending up. Keep going.' };
    if (d <= -3) return { word: 'Building',  arrow: '',  msg: 'Stay consistent. Momentum builds with each session.' };
    return            { word: 'Steady',    arrow: '→', msg: 'Holding steady. Consistency is paying off.' };
  }

  function _sparkline(pts, color) {
    if (pts.length < 2) return '';
    const w = 320, h = 72, pad = 6;
    const xs = pts.map((_, i) => pad + (i * (w - 2 * pad) / (pts.length - 1)));
    const vals = pts.map((p) => p.score);
    const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
    const ys = pts.map((p) => h - pad - ((p.score - min) / span) * (h - 2 * pad));
    const line = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
    const area = `${line} L${xs[xs.length - 1].toFixed(1)} ${h} L${xs[0].toFixed(1)} ${h} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="display:block;margin-top:6px">
      <path d="${area}" fill="${color}" opacity="0.10"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${xs[xs.length - 1].toFixed(1)}" cy="${ys[ys.length - 1].toFixed(1)}" r="3.5" fill="${color}"/>
    </svg>`;
  }

  // A collapsed disclosure block; onFirstOpen mounts content lazily once.
  function _disclosure(key, label) {
    return `
      <button type="button" data-disc="${key}" aria-expanded="false"
        style="margin-top:12px;width:100%;display:flex;align-items:center;justify-content:space-between;padding:14px 16px;cursor:pointer;
               border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);background:transparent;
               color:var(--nc-text-primary,#F8FAFC);-webkit-tap-highlight-color:transparent">
        <span style="font-size:14px;font-weight:600">${_esc(label)}</span>
        <span data-chev="${key}" style="font-size:14px;color:var(--nc-text-muted,#64748B);transition:transform 180ms cubic-bezier(0.16,1,0.3,1)">▾</span>
      </button>
      <div data-panel="${key}" style="display:none;margin-top:10px"></div>`;
  }

  function _wireDisclosure(host, key, onFirstOpen) {
    const btn   = host.querySelector(`[data-disc="${key}"]`);
    const panel = host.querySelector(`[data-panel="${key}"]`);
    const chev  = host.querySelector(`[data-chev="${key}"]`);
    if (!btn || !panel) return;
    let mounted = false;
    btn.addEventListener('click', () => {
      const open = panel.style.display !== 'none';
      if (open) { panel.style.display = 'none'; btn.setAttribute('aria-expanded', 'false'); if (chev) chev.style.transform = ''; }
      else {
        panel.style.display = 'block'; btn.setAttribute('aria-expanded', 'true'); if (chev) chev.style.transform = 'rotate(180deg)';
        if (!mounted) { try { onFirstOpen && onFirstOpen(panel); } catch (e) { console.warn('[progress] disclosure:', e?.message); } mounted = true; }
      }
    });
  }

  async function render(container, opts) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;

    const profile = (typeof Auth !== 'undefined' && Auth.getProfile) ? Auth.getProfile() : null;
    const uid = profile?.id || null;

    host.innerHTML = `
      <div style="max-width:520px;margin:0 auto;padding:6px 2px 8px">
        ${ClientUtil.isOffline() ? ClientUtil.offlineNote() : ''}
        <div style="margin:4px 4px 16px">
          <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Recovery Journey</div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-.01em;color:var(--nc-text-primary,#F8FAFC)">Your Progress</div>
        </div>
        <div id="cp-summary" style="border-radius:var(--nc-r-2xl,28px);background:var(--nc-bg-card,rgba(15,23,42,.7));
             border:1px solid var(--nc-border,rgba(255,255,255,.08));box-shadow:var(--nc-shadow-card,0 8px 32px rgba(0,0,0,.4));padding:20px">
          ${ClientUtil.skeleton(120, 'var(--nc-r-xl,20px)')}
        </div>
        ${_disclosure('history', 'Check-in history')}
        ${_disclosure('report',  'Your latest report')}
        ${_disclosure('story',   'Your body story')}
        ${_disclosure('holo',    'Body load map (3D)')}
        ${_disclosure('adv',     'Advanced insights')}
      </div>`;

    // Load the data we need once, in parallel.
    let snap = null, scores = null, pts = [];
    try {
      [snap, scores, pts] = await Promise.all([
        (window.AssessmentSnapshot && AssessmentSnapshot.loadLatest) ? AssessmentSnapshot.loadLatest(uid) : Promise.resolve(null),
        (window.Progression && Progression.getScores) ? Progression.getScores(uid) : Promise.resolve(null),
        _timeline(uid),
      ]);
    } catch (e) {
      // A real load failure (vs. a new client with no data, which resolves
      // empty): show a calm error with a retry rather than a blank summary.
      console.warn('[progress] load:', e?.message);
      ClientUtil.errorState(host.querySelector('#cp-summary'), 'We could not load your progress', () => render(container, opts));
      return;
    }

    _renderSummary(host, scores, pts);

    _wireDisclosure(host, 'history', (panel) => _renderHistory(panel, pts));
    _wireDisclosure(host, 'report',  (panel) => {
      if (window.AssessmentSnapshot && AssessmentSnapshot.renderReport) {
        AssessmentSnapshot.renderReport(panel, snap, {
          // Recovery-focused labels for the client (the coach keeps the
          // clinical defaults; these only apply to this client surface).
          driverLabel: 'What we are focusing on',
          symptomsLabel: 'What you have been feeling',
          notesLabel: 'From your coach',
          emptyTitle: 'No report yet',
          emptyDesc: 'Your coach will add a short recovery note after your next assessment.',
        });
      }
    });
    _wireDisclosure(host, 'story', (panel) => _renderBodyStory(panel, snap));
    _wireDisclosure(host, 'holo', (panel) => _renderHoloEntry(panel, snap));
    _wireDisclosure(host, 'adv',  (panel) => _renderAdvanced(panel, snap));

    // Optional deep-link (More → Recovery → Assessment History / Recovery
    // Reports): open the requested disclosure and bring it into view.
    const open = opts && opts.open;
    if (open) {
      const btn = host.querySelector(`[data-disc="${open}"]`);
      if (btn && btn.getAttribute('aria-expanded') !== 'true') {
        btn.click();
        btn.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  function _renderSummary(host, scores, pts) {
    const el = host.querySelector('#cp-summary');
    if (!el) return;
    const rec = scores && scores.recovery != null ? Math.round(Number(scores.recovery)) : null;
    const band = _band(rec ?? 0);
    const mo = _momentum(pts);
    const spark = _sparkline(pts, band.color);
    const since = pts.length ? new Date(pts[0].date).toLocaleDateString(undefined, { month: 'long' }) : null;

    el.innerHTML = `
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--nc-text-muted,#64748B)">Recovery momentum</div>
          <div style="font-size:26px;font-weight:800;letter-spacing:-.02em;color:${band.color};margin-top:2px">${_esc(mo.word)} ${mo.arrow}</div>
        </div>
        ${rec != null ? `<div style="text-align:right">
          <div style="font-size:30px;font-weight:800;line-height:1;color:var(--nc-text-primary,#F8FAFC)">${rec}</div>
          <div style="font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--nc-text-muted,#64748B);margin-top:3px">Recovery</div>
        </div>` : ''}
      </div>
      ${spark}
      <div style="margin-top:10px;font-size:13.5px;line-height:1.5;color:var(--nc-text-primary,#F8FAFC)">${_esc(mo.msg)}</div>
      ${pts.length ? `<div style="margin-top:4px;font-size:12px;color:var(--nc-text-secondary,#94A3B8)">Across ${pts.length} check-in${pts.length === 1 ? '' : 's'}${since ? ` since ${_esc(since)}` : ''}.</div>` : ''}`;
  }

  function _renderHistory(panel, pts) {
    if (!pts.length) {
      panel.innerHTML = `<div style="padding:14px 4px;font-size:13px;color:var(--nc-text-secondary,#94A3B8)">Your check-ins will appear here after your first assessment.</div>`;
      return;
    }
    const rows = pts.slice().reverse().map((p) => {
      const band = _band(p.score);
      const d = new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const pct = Math.max(4, Math.min(100, Math.round(p.score)));
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 4px">
          <span style="width:120px;font-size:12.5px;color:var(--nc-text-secondary,#94A3B8)">${_esc(d)}</span>
          <span style="flex:1;height:6px;border-radius:99px;background:var(--nc-track);overflow:hidden">
            <span style="display:block;height:100%;width:${pct}%;background:${band.color}"></span>
          </span>
          <span style="width:30px;text-align:right;font-size:13px;font-weight:700;color:var(--nc-text-primary,#F8FAFC)">${Math.round(p.score)}</span>
        </div>`;
    }).join('');
    panel.innerHTML = `<div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:8px 12px">${rows}</div>`;
  }

  // ═══ E5 — Your body story ═══════════════════════════════════════
  // Read-only replay of the coach's zone journey from the latest saved
  // assessment. Zone order/labels/stories come from the shared ZONES
  // config (window.NC_ZONES, exposed by src/main.js); the column lists
  // mirror what dashboard.js actually persists to
  // rehab_objective_assessments — zones whose fields are not persisted
  // today (neck/arms) are omitted rather than shown forever-empty.
  const STORY_COLS = {
    foundation: ['toe_touch_score', 'ankle_df_left_cm', 'ankle_df_right_cm', 'ankle_pronation_left', 'ankle_pronation_right'],
    knees:      ['tibia_ir_left', 'tibia_ir_right'],
    hips:       ['hip_ir_left', 'hip_ir_right', 'hip_er_left', 'hip_er_right', 'hip_flexion_left', 'hip_flexion_right',
                 'hip_extension_left', 'hip_extension_right', 'hip_abduction_left', 'hip_abduction_right'],
    spine:      null,   // persisted as computed pain_flags, rendered specially
    shoulders:  ['shoulder_flexion_left', 'shoulder_flexion_right', 'shoulder_ir_left', 'shoulder_ir_right',
                 'shoulder_er_left', 'shoulder_er_right'],
    integration: ['sl_squat_left_score', 'sl_squat_right_score', 'sl_rdl_left_score', 'sl_rdl_right_score', 'oh_squat_score',
                  'sl_balance_eo_left', 'sl_balance_eo_right', 'sl_balance_ec_left', 'sl_balance_ec_right',
                  'sl_reach_left', 'sl_reach_right'],
  };

  function _renderBodyStory(panel, snap) {
    const zones = window.NC_ZONES;
    const obj = snap && snap.objective;
    if (!zones || !obj) {
      panel.innerHTML = `<div style="padding:14px 4px;font-size:13px;color:var(--nc-text-secondary,#94A3B8)">
        Your body story appears here after your coach completes an assessment.</div>`;
      return;
    }

    const when = snap.assessment?.session_date || snap.assessment?.created_at;
    const dateLine = when
      ? `<div style="font-size:11.5px;color:var(--nc-text-muted,#64748B);padding:2px 4px 8px">From your assessment on ${_esc(new Date(when).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }))}</div>`
      : '';

    const rows = zones
      .filter((z) => z.key in STORY_COLS)
      .map((z) => {
        let detail;
        if (z.key === 'spine') {
          const flags = Array.isArray(obj.pain_flags) ? obj.pain_flags.length : 0;
          detail = flags ? `${flags} pain note${flags === 1 ? '' : 's'}` : 'No pain flagged';
        } else {
          const n = STORY_COLS[z.key].filter((c) => obj[c] != null && obj[c] !== '').length;
          detail = n ? `${n} observation${n === 1 ? '' : 's'}` : 'Not assessed';
        }
        const has = detail !== 'Not assessed';
        return `
          <div style="display:flex;align-items:center;gap:12px;padding:11px 4px">
            <span style="flex:none;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
                         font-size:11px;font-weight:700;border:1px solid ${has ? 'rgba(45,212,191,.5)' : 'var(--nc-border,rgba(255,255,255,.1))'};
                         color:${has ? '#2DD4BF' : 'var(--nc-text-muted,#64748B)'}">${z.ordinal}</span>
            <span style="flex:1;min-width:0">
              <span style="display:block;font-size:13.5px;font-weight:600;color:var(--nc-text-primary,#F8FAFC)">${_esc(z.label)}</span>
              <span style="display:block;font-size:11.5px;color:var(--nc-text-secondary,#94A3B8)">${_esc(z.story || '')}</span>
            </span>
            <span style="flex:none;font-size:12px;color:${has ? 'var(--nc-text-primary,#F8FAFC)' : 'var(--nc-text-muted,#64748B)'}">${_esc(detail)}</span>
          </div>`;
      }).join('');

    panel.innerHTML = `
      <div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:10px 12px">
        ${dateLine}${rows}
      </div>`;
  }

  // The disclosure shows a calm prompt; the hologram itself runs fullscreen.
  function _renderHoloEntry(panel, snap) {
    panel.innerHTML = `
      <div style="border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-lg,16px);background:var(--nc-fill-1);padding:18px;text-align:center">
        <div style="font-size:13px;color:var(--nc-text-secondary,#94A3B8);line-height:1.5">A 3D view of where your body carries load now, and where your plan is taking it.</div>
        <button id="cp-holo-open" type="button"
          style="margin-top:14px;min-height:48px;padding:12px 22px;border:0;border-radius:var(--nc-r-full,999px);
                 background:var(--nc-teal,#14B8A6);color:#052e2b;font-size:14px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent">
          View load map
        </button>
      </div>`;
    panel.querySelector('#cp-holo-open')?.addEventListener('click', () => _openHologram(snap));
  }

  // Fullscreen hologram overlay. Owns the WebGL lifecycle: disposes on close.
  function _openHologram(snap) {
    if (document.getElementById('cp-holo-overlay')) return;
    let state = 'A';
    const prevFocus = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';     // scroll-lock behind the overlay
    const ov = document.createElement('div');
    ov.id = 'cp-holo-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Body load map');
    ov.style.cssText = 'position:fixed;inset:0;z-index:1200;background:var(--nc-bg-primary,#07111A);display:flex;flex-direction:column';
    const tBtn = (st, label) => `<button type="button" data-st="${st}"
      style="flex:1;max-width:160px;min-height:44px;border-radius:var(--nc-r-full,999px);cursor:pointer;font-size:13px;font-weight:700;
             border:1px solid var(--nc-border,rgba(255,255,255,.12));-webkit-tap-highlight-color:transparent;
             background:${st === state ? 'var(--nc-teal,#14B8A6)' : 'transparent'};color:${st === state ? '#052e2b' : 'var(--nc-text-secondary,#94A3B8)'}">${label}</button>`;
    ov.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:calc(10px + env(safe-area-inset-top)) 14px 8px">
        <button id="cp-holo-back" type="button" style="min-height:44px;padding:8px 12px;border:0;background:transparent;color:var(--nc-text-primary,#F8FAFC);font-size:15px;font-weight:600;cursor:pointer">‹ Back</button>
        <div style="font-size:13px;font-weight:700;color:var(--nc-text-primary,#F8FAFC)">Body load map</div>
        <div style="width:64px"></div>
      </div>
      <div id="cp-holo-canvas" style="flex:1;min-height:0"></div>
      <div style="display:flex;gap:10px;justify-content:center;padding:12px 14px calc(16px + env(safe-area-inset-bottom))">
        ${tBtn('A', 'Current')}${tBtn('B', 'Target')}</div>`;
    document.body.appendChild(ov);

    const handle = (window.AssessmentSnapshot && AssessmentSnapshot.mountHologram)
      ? AssessmentSnapshot.mountHologram(ov.querySelector('#cp-holo-canvas'), snap, { state })
      : { setState() {}, destroy() {} };

    const close = () => {
      try { handle.destroy(); } catch (_) {}
      ov.remove();
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;          // restore scroll
      try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (_) {}  // restore focus
    };
    // Esc closes; Tab is trapped within the overlay (focus management).
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); return; }
      ClientUtil.trapTab(e, ov, 'button');
    };
    document.addEventListener('keydown', onKey);
    ov.querySelector('#cp-holo-back')?.addEventListener('click', close);
    ov.querySelector('#cp-holo-back')?.focus();              // move focus into the dialog
    ov.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => {
      state = b.dataset.st;
      handle.setState(state);
      ov.querySelectorAll('[data-st]').forEach((x) => {
        const on = x.dataset.st === state;
        x.style.background = on ? 'var(--nc-teal,#14B8A6)' : 'transparent';
        x.style.color = on ? '#052e2b' : 'var(--nc-text-secondary,#94A3B8)';
      });
    }));
  }

  // Densest analytics — restored but buried here per "advanced last".
  function _renderAdvanced(panel, snap) {
    panel.innerHTML = `
      <div id="cp-adv-prog" style="margin-bottom:6px"></div>
      <div style="display:grid;gap:14px">
        ${_advChart('Force steadiness', 'cp-force')}
        ${_advChart('Center of gravity', 'cp-cog')}
        ${_advChart('Risk timeline', 'cp-risk')}
      </div>`;
    if (window.Progression && Progression.mountClientPanel) Progression.mountClientPanel(panel.querySelector('#cp-adv-prog'));
    const CC = window.ClientCharts;
    if (CC) {
      const obj = snap?.objective || null, gait = snap?.gait || null, profile = snap?.profile || null;
      try { CC.renderForceSteadiness(panel.querySelector('#cp-force'), CC.deriveForceSteadiness(gait)); } catch (_) {}
      try { CC.renderCenterOfGravity(panel.querySelector('#cp-cog'), CC.deriveCenterOfGravity(obj, gait)); } catch (_) {}
      const comp = (typeof obj?.composite_score === 'number') ? obj.composite_score : null;
      try { CC.renderRiskTimeline(panel.querySelector('#cp-risk'), CC.deriveRiskTimeline(profile, comp)); } catch (_) {}
    }
  }
  function _advChart(title, id) {
    return `<div>
      <div style="font-size:12px;font-weight:600;color:var(--nc-text-secondary,#94A3B8);margin-bottom:6px">${_esc(title)}</div>
      <div id="${id}" style="min-height:150px;border:1px solid var(--nc-border,rgba(255,255,255,.08));border-radius:var(--nc-r-md,12px);padding:8px"></div>
    </div>`;
  }

  window.ClientProgress = { render };
})();
