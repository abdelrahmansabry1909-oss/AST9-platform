// ═══════════════════════════════════════════════════════════════
//  js/progressReport.js
//  Workstream C: Exportable PDF Progress Report
//  Uses browser print + styled HTML. No external PDF lib needed.
// ═══════════════════════════════════════════════════════════════

const ProgressReport = (() => {

  // ═══════════════════════════════════════════════════════════
  //  GENERATE PDF (opens print dialog on styled HTML)
  // ═══════════════════════════════════════════════════════════

  async function generatePDF(clientId) {
    if (!clientId) { Dashboard.toast('No client selected', 'error'); return; }
    Dashboard.toast('Building report…', 'info');

    try {
      const [profile, snapshots, assessments, gaitData] = await Promise.all([
        _loadProfile(clientId),
        _loadSnapshots(clientId),
        _loadAssessments(clientId),
        _loadGait(clientId),
      ]);

      const html = _buildReportHTML(profile, snapshots, assessments, gaitData);
      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      const win  = window.open(url, '_blank');
      if (!win) Dashboard.toast('Pop-up blocked — allow pop-ups and try again', 'warning');
    } catch(e) {
      Dashboard.toast('Report error: ' + e.message, 'error');
    }
  }

  // ─── Data loaders ────────────────────────────────────────────

  async function _loadProfile(clientId) {
    const { data } = await sb.from('profiles').select('*').eq('id', clientId).single();
    return data || {};
  }

  async function _loadSnapshots(clientId) {
    const { data } = await sb
      .from('progress_snapshots')
      .select('*')
      .eq('client_id', clientId)
      .order('session_date', { ascending: true })
      .limit(20);
    return data || [];
  }

  async function _loadAssessments(clientId) {
    const { data } = await sb
      .from('assessments')
      .select('*')
      .eq('client_id', clientId)
      .order('session_date', { ascending: false })
      .limit(5);
    return data || [];
  }

  async function _loadGait(clientId) {
    const { data } = await sb
      .from('gait_assessments')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1);
    return data?.[0] || null;
  }

  // ─── HTML builder ────────────────────────────────────────────

  function _buildReportHTML(profile, snapshots, assessments, gait) {
    const name    = profile.full_name || profile.email || 'Client';
    const phase   = profile.current_phase || 'Phase 1';
    const date    = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

    const phaseColor = phase === 'Phase 1' ? '#3df5c1' : phase === 'Phase 2' ? '#f5c842' : '#c8f04a';

    const latest  = snapshots[snapshots.length - 1] || null;
    const prev    = snapshots[snapshots.length - 2] || null;

    function delta(curr, pr, field) {
      if (!curr || !pr || curr[field] == null || pr[field] == null) return '';
      const d = curr[field] - pr[field];
      const sign = d > 0 ? '+' : '';
      const col = d > 0 ? '#3df5c1' : d < 0 ? '#f5426c' : '#7a8399';
      return `<span style="color:${col};font-size:10px;margin-left:4px">${sign}${d.toFixed(1)}</span>`;
    }

    const scoreRows = [
      ['ROM',       'rom_score'],
      ['Control',   'control_score'],
      ['Force',     'force_score'],
      ['Neurology', 'neurology_score'],
      ['Composite', 'composite_score'],
    ].map(([label, field]) => `
      <tr>
        <td style="padding:8px 12px;font-weight:600;font-size:12px">${label}</td>
        <td style="padding:8px 12px;text-align:center">${latest?.[field] != null ? latest[field].toFixed(1) + '%' : '–'}${delta(latest, prev, field)}</td>
        <td style="padding:8px 12px;text-align:center;color:#7a8399">${prev?.[field] != null ? prev[field].toFixed(1) + '%' : '–'}</td>
        <td style="padding:8px 12px">
          ${latest?.[field] != null ? `
            <div style="height:6px;border-radius:3px;background:#1c2230;overflow:hidden">
              <div style="height:100%;width:${Math.min(latest[field], 100)}%;background:${phaseColor};border-radius:3px;transition:width 0.5s"></div>
            </div>` : '–'}
        </td>
      </tr>`).join('');

    const historyRows = snapshots.slice(-8).map(s => `
      <tr>
        <td style="padding:8px 12px;font-size:12px">${new Date(s.session_date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</td>
        <td style="padding:8px 12px;text-align:center;font-size:12px">${s.rom_score?.toFixed(0) ?? '–'}</td>
        <td style="padding:8px 12px;text-align:center;font-size:12px">${s.control_score?.toFixed(0) ?? '–'}</td>
        <td style="padding:8px 12px;text-align:center;font-size:12px">${s.force_score?.toFixed(0) ?? '–'}</td>
        <td style="padding:8px 12px;text-align:center;font-size:12px">${s.neurology_score?.toFixed(0) ?? '–'}</td>
        <td style="padding:8px 12px;text-align:center;font-size:12px;font-weight:700;color:${phaseColor}">${s.composite_score?.toFixed(0) ?? '–'}</td>
        <td style="padding:8px 12px;text-align:center"><span style="font-size:10px;padding:2px 8px;border-radius:9px;background:${phaseColor}20;color:${phaseColor};border:1px solid ${phaseColor}50">${s.phase || '–'}</span></td>
      </tr>`).join('');

    const gaitSection = gait ? `
      <div style="margin-top:32px">
        <h3 style="font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${phaseColor};margin-bottom:16px">Gait Analysis</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
          ${Object.entries(gait.phase_deficiencies || {}).map(([phase, defs]) => `
            <div style="background:#10131a;border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px">
              <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7a8399;margin-bottom:8px">${phase.replace(/_/g,' ')}</div>
              ${Array.isArray(defs) && defs.length ? defs.map(d => `<div style="font-size:11px;color:#f0f2f7;padding:3px 0">• ${d}</div>`).join('') : `<div style="font-size:11px;color:#3d4558">No deficits recorded</div>`}
            </div>`).join('')}
        </div>
        ${gait.worst_case_scenario ? `<div style="margin-top:12px;padding:12px 14px;background:rgba(245,66,108,0.07);border:1px solid rgba(245,66,108,0.2);border-radius:8px;font-size:12px;color:#f5426c"><strong>Worst case:</strong> ${gait.worst_case_scenario}</div>` : ''}
      </div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AST9 Progress Report — ${name}</title>
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=satoshi@500,400&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Satoshi',sans-serif;background:#060709;color:#f0f2f7;min-height:100vh;-webkit-font-smoothing:antialiased}
.page{max-width:860px;margin:0 auto;padding:48px 32px 64px}
.hero{border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:32px;margin-bottom:40px;display:flex;justify-content:space-between;align-items:flex-start}
.logo{font-family:'Cabinet Grotesk',sans-serif;font-size:22px;font-weight:800;color:${phaseColor};letter-spacing:-0.5px}
.client-name{font-family:'Cabinet Grotesk',sans-serif;font-size:clamp(28px,5vw,44px);font-weight:800;letter-spacing:-1.5px;line-height:1;margin:8px 0}
.meta{font-size:12px;color:#7a8399;letter-spacing:0.5px}
.phase-pill{display:inline-block;padding:4px 14px;border-radius:9999px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;border:1px solid ${phaseColor}44;color:${phaseColor};background:${phaseColor}10;margin-top:12px}
h2{font-family:'Cabinet Grotesk',sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.5px;margin:40px 0 16px;color:#f0f2f7}
h2 span{color:${phaseColor}}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:8px 12px;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#3d4558;border-bottom:1px solid rgba(255,255,255,0.06)}
tr:not(:last-child) td{border-bottom:1px solid rgba(255,255,255,0.04)}
.card{background:#10131a;border:1px solid rgba(255,255,255,0.06);border-radius:12px;overflow:hidden;margin-bottom:24px}
.footer{text-align:center;padding:32px 0;color:#2d3344;font-size:11px;border-top:1px solid rgba(255,255,255,0.04);margin-top:48px}
@media print{
  body,th,td{background:#fff!important;color:#111!important}
  .hero{border-color:#ddd}
  table{page-break-inside:avoid}
  .card{background:#f9f9f9!important;border-color:#e5e5e5!important}
}
</style>
</head>
<body>
<div class="page">
  <div class="hero">
    <div>
      <div class="logo">⚡ AST9</div>
      <div class="client-name">${name}</div>
      <div class="meta">Progress Report · ${date}</div>
      <div class="phase-pill">${phase}</div>
    </div>
    <div style="text-align:right;color:#3d4558;font-size:11px">
      <div>AST9 Health Hub</div>
      <div style="margin-top:4px">Confidential · Not for redistribution</div>
    </div>
  </div>

  ${latest ? `
  <h2>Current <span>Scores</span></h2>
  <div class="card">
    <table>
      <thead><tr><th>Dimension</th><th>Current</th><th>Previous</th><th style="width:40%">Progress Bar</th></tr></thead>
      <tbody>${scoreRows}</tbody>
    </table>
  </div>` : '<p style="color:#3d4558;font-size:13px;padding:16px 0">No assessment scores recorded yet.</p>'}

  ${snapshots.length > 1 ? `
  <h2>Score <span>History</span></h2>
  <div class="card">
    <table>
      <thead><tr><th>Date</th><th>ROM</th><th>Control</th><th>Force</th><th>Neurology</th><th>Composite</th><th>Phase</th></tr></thead>
      <tbody>${historyRows}</tbody>
    </table>
  </div>` : ''}

  ${gaitSection}

  <div class="footer">
    AST9 Elite Coaching Platform · Movement Quality = ROM × Control × Force × Neurology<br>
    Generated ${date} · Print with Ctrl+P to save as PDF
  </div>
</div>
</body>
</html>`;
  }

  // ─── Quick snapshot for current session ─────────────────────

  async function saveCurrentSessionSnapshot(clientId, assessmentId, scores, phase) {
    return Charts.saveSnapshot(clientId, assessmentId, scores, phase);
  }

  return { generatePDF, saveCurrentSessionSnapshot };

})();

window.ProgressReport = ProgressReport;
