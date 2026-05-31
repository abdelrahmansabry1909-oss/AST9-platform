/* ═══════════════════════════════════════════════════════════════
   NeuCore — Exercise Instructions builder (reusable helper)

   ONE place that decides how a library exercise's clinical text +
   metadata become a UI-ready structure. Consumers (programPublish
   renderClientProgram, workoutSession _renderExerciseLogRow, the
   future Feature 6 alt-response modal) all call the same builder so
   the rendered instructions stay consistent across surfaces.

   The exercises table carries four free-text instruction fields
   today (cues / common_errors / progressions / regressions). The
   spec asked for "instructions" as a single client-friendly block;
   we deliver that by combining the four into labelled sections,
   skipping empty ones. When a polished `instructions` field is added
   in a future migration, build() can read it first and skip the
   per-field decomposition automatically.

   Public surface (window.ExerciseInstructions):
     build(exercise)              → { sections, chips, hasContent }
     renderSections(exercise)     → HTML string (sections only)
     renderChips(exercise)        → HTML string (joints + tags pills)
     renderFull(exercise)         → HTML string (chips + sections)
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Ordered list — segment label, source field on the exercise row,
  // optional emoji prefix. Empty segments are skipped at render time.
  const SEGMENTS = [
    { key: 'cues',          label: 'Cues',          icon: '✦' },
    { key: 'common_errors', label: 'Common errors', icon: '⚠' },
    { key: 'progressions',  label: 'Progressions',  icon: '↗' },
    { key: 'regressions',   label: 'Regressions',   icon: '↘' },
  ];

  // Build → structured object. Pure; no DOM. Easy to unit-test later.
  function build(exercise) {
    if (!exercise || typeof exercise !== 'object') {
      return { sections: [], chips: { joints: [], tags: [] }, hasContent: false };
    }
    // Forward-compat: if/when an `instructions` field lands, prefer it
    // as a single section. Today this is always falsy → skip.
    let sections;
    if (typeof exercise.instructions === 'string' && exercise.instructions.trim()) {
      sections = [{ key: 'instructions', label: 'Instructions', icon: '◈',
                    text: exercise.instructions.trim() }];
    } else {
      sections = SEGMENTS
        .map((seg) => {
          const v = exercise[seg.key];
          if (typeof v !== 'string' || !v.trim()) return null;
          return { ...seg, text: v.trim() };
        })
        .filter(Boolean);
    }

    const joints = Array.isArray(exercise.target_joints) ? exercise.target_joints.filter(Boolean) : [];
    const tags   = Array.isArray(exercise.tags)          ? exercise.tags.filter(Boolean)          : [];

    return {
      sections,
      chips: { joints, tags },
      hasContent: sections.length > 0 || joints.length > 0 || tags.length > 0,
    };
  }

  // ── Rendering helpers (pure → HTML strings, never DOM) ───────────
  function renderSections(exercise) {
    const { sections } = build(exercise);
    if (!sections.length) return '';
    return `<div class="ex-instructions" style="display:flex;flex-direction:column;gap:8px">
      ${sections.map((s) => `
        <div style="padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid var(--border-subtle);border-radius:6px">
          <div style="font-size:11px;font-weight:700;color:var(--nc-teal,#14b8a6);letter-spacing:.06em;text-transform:uppercase;margin-bottom:3px">
            ${esc(s.icon)} ${esc(s.label)}
          </div>
          <div style="font-size:12px;color:var(--text-secondary);line-height:1.55;white-space:pre-wrap">${esc(s.text)}</div>
        </div>`).join('')}
    </div>`;
  }

  function renderChips(exercise) {
    const { chips } = build(exercise);
    const items = [];
    chips.joints.forEach((j) => items.push({ label: j, tone: 'teal' }));
    chips.tags.forEach((t)   => items.push({ label: t, tone: 'gray' }));
    if (!items.length) return '';
    const tones = {
      teal: 'background:rgba(20,184,166,.12);color:var(--nc-teal,#14b8a6);border:1px solid rgba(20,184,166,.3)',
      gray: 'background:rgba(148,163,184,.10);color:#94a3b8;border:1px solid rgba(148,163,184,.25)',
    };
    return `<div class="ex-chips" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px">
      ${items.map((it) => `
        <span style="font-size:10px;letter-spacing:.04em;padding:2px 8px;border-radius:99px;${tones[it.tone] || tones.gray}">
          ${esc(it.label)}
        </span>`).join('')}
    </div>`;
  }

  function renderFull(exercise) {
    const built = build(exercise);
    if (!built.hasContent) return '';
    return renderChips(exercise) + renderSections(exercise);
  }

  window.ExerciseInstructions = { build, renderSections, renderChips, renderFull };
})();
