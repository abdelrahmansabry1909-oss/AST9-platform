/* ═══════════════════════════════════════════════════════════════
   NeuCore RPM — Dual-Mode Subjective Assessment
   Phase 2 of the workflow. Cite: docs/rehab-book/o-sullivan-subjective-assessment.md
   (the 13 aims, §2.1).

   Public API (window.RPMSubjective):
     init(clientId)                 — entry point, fetches/creates draft row
     setMode('osullivan'|'free_form')
     savePartial(field, value)      — debounced upsert
     finalize()                     — marks status='complete', returns row id

   Storage: public.subjective_assessments
   Module pattern: vanilla IIFE, exposes as window.RPMSubjective
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ───────────────────────────────────────────────────────────
  // Step definitions — each maps to one of NeuCore's 13 aims
  // ───────────────────────────────────────────────────────────
  const STEPS = [
    {
      n: 1, key: 'rapport',
      aim: 'Establish rapport, set expectations.',
      sub: 'Before clinical questions: make the patient feel safe, understood, and in control. Use eye contact, tonality, and empathy while keeping expert authority.',
      cite: 'NeuCore §2.1 · Aims 1–2',
      fields: [{ kind: 'check', col: '_rapport_done', label: 'Rapport established — patient feels safe and in control.' }],
    },
    {
      n: 2, key: 'internal',
      aim: 'Internal motivators — what is the pain stopping them from doing?',
      sub: 'External pain is just the symptom. The internal problem (the thing pain is preventing) is what builds adherence and retention.',
      cite: 'NeuCore §2.1 · Aim 4',
      quote: '"Happiness = Reality – Expectations." — NeuCore',
      fields: [
        { kind: 'textarea', col: 'life_impact', label: 'What is the pain stopping them from doing?', placeholder: 'e.g. Lifting their grandchildren, walking up stairs without resting, sleeping through the night…' },
      ],
    },
    {
      n: 3, key: 'mechanism',
      aim: 'Mechanism of injury.',
      sub: 'Identify peripheral tissues involved and any protective responses. Connect tissues that may be shortening or lengthening.',
      cite: 'NeuCore §2.1 · Aim 5',
      fields: [
        { kind: 'textarea', col: 'mechanism_of_injury', label: 'How did this start? Specific event, gradual onset, or unknown?', placeholder: 'e.g. Twisted right ankle 10 years ago landing from a jump, low back pain started 3 years later, gradually worsening…' },
      ],
    },
    {
      n: 4, key: 'aggrav',
      aim: 'Aggravating and easing factors.',
      sub: 'Use these to piece together which tissues are shortening or lengthening, and which positions provide relief vs. provocation.',
      cite: 'NeuCore §2.1 · Aim 6',
      fields: [
        { kind: 'chips', col: 'aggravating_factors', label: 'What makes it WORSE?', placeholder: 'Type a factor + Enter (e.g. sitting > 30 min)' },
        { kind: 'chips', col: 'easing_factors',     label: 'What makes it BETTER?', placeholder: 'Type a factor + Enter (e.g. lying on side, walking)' },
      ],
    },
    {
      n: 5, key: 'stressors',
      aim: 'Stressors timeline.',
      sub: 'Map physical injuries AND emotional/life stressors chronologically. Prolonged stress sensitises the respiratory and nervous systems.',
      cite: 'NeuCore §2.1 · Aim 7',
      fields: [
        { kind: 'rows', col: 'stress_timeline', label: 'Stressors (chronological)',
          schema: [
            { name: 'year',  ph: 'Year',                   type: 'text' },
            { name: 'event', ph: 'Event / injury / trauma', type: 'text' },
            { name: 'type',  type: 'select', options: [{ v: 'physical', l: 'Physical' }, { v: 'emotional', l: 'Emotional' }, { v: 'medical', l: 'Medical' }] },
          ],
        },
      ],
    },
    {
      n: 6, key: 'objections',
      aim: 'Past treatments and hidden objections.',
      sub: 'What have they tried, what worked, what didn\'t? Surface objections that could sabotage the outcome.',
      cite: 'NeuCore §2.1 · Aim 8',
      fields: [
        { kind: 'rows', col: 'past_treatments', label: 'Past treatments tried',
          schema: [
            { name: 'modality', ph: 'Modality (physio, chiro…)', type: 'text' },
            { name: 'duration', ph: 'For how long?',             type: 'text' },
            { name: 'outcome',  type: 'select', options: [{ v: 'helped', l: 'Helped' }, { v: 'no_change', l: 'No change' }, { v: 'worse', l: 'Made it worse' }] },
          ],
        },
        { kind: 'textarea', col: 'hidden_objections', label: 'Hidden objections (in their own words)', placeholder: 'e.g. "I don\'t think exercise will help — I\'ve tried." or "I want to run before session 4 because I feel fine."' },
      ],
    },
    {
      n: 7, key: 'likelihood',
      aim: 'Perceived likelihood of achievement.',
      sub: 'Two scores set the baseline for adherence strategy. Low confidence + high importance = need for early "fast start" wins.',
      cite: 'NeuCore §2.1 · Aim 9',
      fields: [
        { kind: 'slider', col: 'confidence_score', label: 'Confidence this gets sorted (0–10)', min: 0, max: 10, ticks: ['Not at all', '5', 'Very confident'] },
        { kind: 'slider', col: 'importance_score', label: 'Importance to get sorted now (0–10)', min: 0, max: 10, ticks: ['Not urgent', '5', 'Critical'] },
      ],
    },
    {
      n: 8, key: 'fast_start',
      aim: 'Fast-start opportunity.',
      sub: 'Find ways to add value immediately. The first emotional win in session 1 is what secures buy-in to the long plan.',
      cite: 'NeuCore §2.1 · Aim 10',
      fields: [
        { kind: 'textarea', col: 'fast_start_opportunity', label: 'What can we deliver in session 1 that they\'ll feel today?', placeholder: 'e.g. Reduce pain on toe-touch via diaphragmatic breathing reset…' },
      ],
    },
    {
      n: 9, key: 'red_flags',
      aim: 'Red flags screen.',
      sub: 'Any "yes" warrants immediate medical referral before any rehab work begins.',
      cite: 'NeuCore §2.1 · Aim 11',
      fields: [
        { kind: 'redflags', col: 'red_flag_screen', items: [
          { k: 'bladder_bowel',  l: 'Bladder or bowel dysfunction',           h: 'Saddle anaesthesia, retention, incontinence' },
          { k: 'night_pain',     l: 'Constant unrelenting night pain',         h: 'Pain not relieved by rest or position' },
          { k: 'weight_loss',    l: 'Unexplained weight loss',                 h: '> 5% body weight in 6 months without dieting' },
          { k: 'fever',          l: 'Fever, chills, or recent infection',      h: '' },
          { k: 'cancer_history', l: 'Personal history of cancer',              h: '' },
          { k: 'trauma',         l: 'Significant recent trauma',               h: 'Fall from height, RTC, etc.' },
          { k: 'neuro_deficit',  l: 'Progressive neurological deficit',        h: 'Worsening weakness, numbness, or coordination' },
          { k: 'age_concern',    l: 'Age > 50 with new back pain',             h: '' },
        ]},
      ],
    },
    {
      n: 10, key: 'yellow_flags',
      aim: 'Yellow flags & medical history.',
      sub: 'Medications and chronic conditions are clues to a sensitised nervous system (anxiety meds, asthma inhalers, chronic pain meds…).',
      cite: 'NeuCore §2.1 · Aim 12',
      fields: [
        { kind: 'chips', col: 'medications', label: 'Current medications', placeholder: 'Type a medication + Enter (e.g. sertraline)' },
        { kind: 'textarea', col: 'yellow_flags', label: 'Other medical history / yellow flags', placeholder: 'e.g. Anxiety, asthma, chronic stress at work, sleep < 6 hrs/night…' },
      ],
    },
    {
      n: 11, key: 'external_pain',
      aim: 'External pain — describe the symptom.',
      sub: 'The external problem (where it hurts, when, how it feels). This is the symptom — not the root cause, but it must be documented.',
      cite: 'NeuCore §2.1 · Aim 4 (external)',
      fields: [
        { kind: 'textarea', col: 'external_pain', label: 'Where, when, and how does it hurt?', placeholder: 'e.g. Right lower back, dull ache 4/10 baseline rising to 7/10 after 30 min sitting, sharper on extension…' },
      ],
    },
    {
      n: 12, key: 'dream_outcome',
      aim: 'Dream outcome — the Northern Star.',
      sub: 'The patient\'s definition of success. This is what the entire treatment plan inverts back from.',
      cite: 'NeuCore §2.1 · Aim 3',
      quote: '"What needs to happen before you are confident to do [dream outcome]?" — Inversion question',
      fields: [
        { kind: 'textarea', col: 'dream_outcome', label: 'What is the patient\'s dream outcome?', placeholder: 'e.g. Garden for two hours per day without back pain.' },
      ],
    },
    {
      n: 13, key: 'recap',
      aim: 'Recap and confirm.',
      sub: 'Read the story back. The patient should feel heard, and you should be able to "connect the dots" between mechanism, stressors, and dream outcome.',
      cite: 'NeuCore §2.1 · Aim 13',
      fields: [
        { kind: 'recap' },
        { kind: 'textarea', col: 'recap_notes', label: 'Coach recap notes (optional)', placeholder: 'Summary you read back to the patient. Note any reactions, missing pieces, or next-step agreements.' },
      ],
    },
  ];

  // ───────────────────────────────────────────────────────────
  // State
  // ───────────────────────────────────────────────────────────
  const state = {
    clientId:  null,
    coachId:   null,
    rowId:     null,        // PK in subjective_assessments
    mode:      'osullivan', // 'osullivan' | 'free_form'
    step:      1,
    record:    {},          // local cache of the row
    saveTimer: null,
    saveStatus: 'idle',     // idle | saving | saved | error
  };

  const SAVE_DEBOUNCE_MS = 600;

  // ───────────────────────────────────────────────────────────
  // DOM helpers
  // ───────────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  // ───────────────────────────────────────────────────────────
  // Supabase access (assumes window.sb set by supabaseClient.js)
  // ───────────────────────────────────────────────────────────
  function _sb() {
    if (typeof sb === 'undefined' || !sb) throw new Error('Supabase client not loaded');
    return sb;
  }

  function _coachId() {
    try { return Auth.getUser()?.id ?? null; } catch { return null; }
  }

  // ───────────────────────────────────────────────────────────
  // Save indicator
  // ───────────────────────────────────────────────────────────
  function _setSaveStatus(s) {
    state.saveStatus = s;
    const el = $('#nc-wizard-save');
    if (!el) return;
    el.classList.remove('saving', 'saved', 'error');
    if (s !== 'idle') el.classList.add(s);
    const text = $('#nc-wizard-save-text');
    if (text) {
      text.textContent =
        s === 'saving' ? 'Saving…' :
        s === 'saved'  ? 'All changes saved' :
        s === 'error'  ? 'Save failed — retrying' : 'Auto-save on';
    }
  }

  // ───────────────────────────────────────────────────────────
  // Load or create draft row for (client, mode)
  // ───────────────────────────────────────────────────────────
  async function _loadOrCreate() {
    const sbc = _sb();
    const coachId = _coachId();
    state.coachId = coachId;

    // Look for existing draft for this client (any mode, prefer same mode)
    const { data: rows, error } = await sbc
      .from('subjective_assessments')
      .select('*')
      .eq('client_id', state.clientId)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('[RPMSubjective] load failed:', error);
      throw error;
    }

    let row = (rows || []).find(r => r.mode === state.mode) || (rows || [])[0];

    if (!row) {
      // Create fresh draft
      const insert = await sbc
        .from('subjective_assessments')
        .insert({
          client_id: state.clientId,
          coach_id:  coachId,
          mode:      state.mode,
          status:    'draft',
          wizard_step: 1,
        })
        .select()
        .single();
      if (insert.error) throw insert.error;
      row = insert.data;
    } else if (row.mode !== state.mode) {
      // Existing row uses different mode — switch to it (this is the user's last work)
      state.mode = row.mode;
    }

    state.rowId  = row.id;
    state.record = row;
    state.step   = row.wizard_step || 1;
  }

  // ───────────────────────────────────────────────────────────
  // Debounced save
  // ───────────────────────────────────────────────────────────
  function _scheduleSave() {
    if (!state.rowId) return;
    _setSaveStatus('saving');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(_flushSave, SAVE_DEBOUNCE_MS);
  }

  async function _flushSave() {
    if (!state.rowId) return;
    const sbc = _sb();
    const payload = { ...state.record };
    delete payload.id; delete payload.created_at;
    // Strip any non-column keys (e.g. UI-only fields like _rapport_done) —
    // sending an unknown column to Supabase fails the whole update.
    Object.keys(payload).forEach(k => { if (k.startsWith('_')) delete payload[k]; });
    payload.updated_at = new Date().toISOString();
    payload.wizard_step = state.step;

    const { error } = await sbc
      .from('subjective_assessments')
      .update(payload)
      .eq('id', state.rowId);

    if (error) {
      console.error('[RPMSubjective] save failed:', error);
      _setSaveStatus('error');
      return;
    }
    _setSaveStatus('saved');
  }

  function savePartial(field, value) {
    state.record[field] = value;
    _scheduleSave();
  }

  // ───────────────────────────────────────────────────────────
  // Field renderers
  // ───────────────────────────────────────────────────────────
  function _renderField(f) {
    const v = state.record[f.col];

    if (f.kind === 'check') {
      return `
        <label class="nc-w-check">
          <input type="checkbox" data-field="${f.col}" ${v ? 'checked' : ''}/>
          <span class="nc-w-check-label">${escHtml(f.label)}</span>
        </label>`;
    }

    if (f.kind === 'textarea') {
      return `
        <div class="nc-w-field">
          <label class="nc-w-label">${escHtml(f.label)}</label>
          <textarea class="nc-w-textarea" data-field="${f.col}" placeholder="${escHtml(f.placeholder || '')}">${escHtml(v || '')}</textarea>
        </div>`;
    }

    if (f.kind === 'chips') {
      const arr = Array.isArray(v) ? v : [];
      return `
        <div class="nc-w-field">
          <label class="nc-w-label">${escHtml(f.label)}</label>
          <div class="nc-w-chips" data-chips="${f.col}">
            ${arr.map((it, i) => `
              <span class="nc-w-chip">${escHtml(it)}<button class="nc-w-chip-x" data-chip-rm="${i}" type="button" aria-label="Remove">×</button></span>
            `).join('')}
            <input class="nc-w-chip-input" type="text" placeholder="${escHtml(f.placeholder || 'Type and press Enter')}"/>
          </div>
        </div>`;
    }

    if (f.kind === 'rows') {
      const arr = Array.isArray(v) ? v : [];
      return `
        <div class="nc-w-field">
          <label class="nc-w-label">${escHtml(f.label)}</label>
          <div class="nc-w-rows" data-rows="${f.col}" data-schema='${escHtml(JSON.stringify(f.schema))}'>
            ${arr.map((row, idx) => _renderRow(f.schema, row, idx)).join('')}
          </div>
          <button type="button" class="nc-w-add" data-rows-add="${f.col}">+ Add row</button>
        </div>`;
    }

    if (f.kind === 'slider') {
      const val = (typeof v === 'number') ? v : 5;
      const ticks = f.ticks || [String(f.min), '', String(f.max)];
      return `
        <div class="nc-w-field nc-w-slider-wrap">
          <div class="nc-w-slider-head">
            <label class="nc-w-label" style="margin-bottom:0">${escHtml(f.label)}</label>
            <span class="nc-w-slider-val" data-slider-val="${f.col}">${val}</span>
          </div>
          <input class="nc-w-slider" type="range" min="${f.min}" max="${f.max}" value="${val}" data-slider="${f.col}"/>
          <div class="nc-w-slider-ticks"><span>${escHtml(ticks[0])}</span><span>${escHtml(ticks[1])}</span><span>${escHtml(ticks[2])}</span></div>
        </div>`;
    }

    if (f.kind === 'redflags') {
      const obj = v && typeof v === 'object' ? v : {};
      return `
        <div class="nc-w-field">
          <div class="nc-w-checks">
            ${f.items.map(it => `
              <label class="nc-w-check danger">
                <input type="checkbox" data-redflag="${it.k}" ${obj[it.k] ? 'checked' : ''}/>
                <span>
                  <span class="nc-w-check-label">${escHtml(it.l)}</span>
                  ${it.h ? `<span class="nc-w-check-helper">${escHtml(it.h)}</span>` : ''}
                </span>
              </label>
            `).join('')}
          </div>
        </div>`;
    }

    if (f.kind === 'recap') {
      return `<div class="nc-w-recap">${_buildRecap()}</div>`;
    }

    return '';
  }

  function _renderRow(schema, row, idx) {
    return `
      <div class="nc-w-rrow" data-row-idx="${idx}">
        ${schema.map(c => {
          const v = row?.[c.name] ?? '';
          if (c.type === 'select') {
            return `<select data-row-col="${c.name}">
              <option value="">${escHtml(c.ph || '— select —')}</option>
              ${c.options.map(o => `<option value="${escHtml(o.v)}" ${v===o.v?'selected':''}>${escHtml(o.l)}</option>`).join('')}
            </select>`;
          }
          return `<input type="${c.type}" data-row-col="${c.name}" placeholder="${escHtml(c.ph || '')}" value="${escHtml(v)}"/>`;
        }).join('')}
        <button class="nc-w-rrow-rm" type="button" data-row-rm="${idx}" aria-label="Remove row">×</button>
      </div>`;
  }

  function _buildRecap() {
    const r = state.record;
    const rows = [
      ['Dream outcome',   r.dream_outcome],
      ['Internal motivator',  r.life_impact],
      ['External pain',   r.external_pain],
      ['Mechanism',       r.mechanism_of_injury],
      ['Aggravating',     (r.aggravating_factors || []).join(', ')],
      ['Easing',          (r.easing_factors || []).join(', ')],
      ['Stressors',       (r.stress_timeline || []).map(s => `${s.year || '?'} — ${s.event || ''}`).join(' · ')],
      ['Past treatments', (r.past_treatments || []).map(p => `${p.modality || '?'} (${p.outcome || '?'})`).join(' · ')],
      ['Confidence',      r.confidence_score != null ? `${r.confidence_score}/10` : null],
      ['Importance',      r.importance_score != null ? `${r.importance_score}/10` : null],
      ['Fast start',      r.fast_start_opportunity],
      ['Red flags',       _formatRedFlags(r.red_flag_screen)],
      ['Medications',     (r.medications || []).join(', ')],
      ['Yellow flags',    r.yellow_flags],
    ];
    return rows.map(([k, v]) => `
      <div class="nc-w-recap-row">
        <div class="nc-w-recap-key">${escHtml(k)}</div>
        <div class="nc-w-recap-val ${v ? '' : 'empty'}">${v ? escHtml(v) : '—'}</div>
      </div>`).join('');
  }

  function _formatRedFlags(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const flags = Object.entries(obj).filter(([_, v]) => v).map(([k]) => k.replace(/_/g, ' '));
    return flags.length ? `${flags.length} flagged: ${flags.join(', ')}` : 'None';
  }

  // ───────────────────────────────────────────────────────────
  // Render whole wizard
  // ───────────────────────────────────────────────────────────
  function _render() {
    const root = $('#nc-wizard-root');
    if (!root) return;

    const total = STEPS.length;
    const stepDef = STEPS[state.step - 1];
    const pct = Math.round(((state.step - 1) / (total - 1)) * 100);

    root.innerHTML = `
      <div class="nc-wizard">
        <div class="nc-wizard-head">
          <div class="nc-wizard-step-meta">
            <span class="nc-wizard-step-num">Step ${state.step} <span class="nc-wizard-step-of">of ${total}</span></span>
            <span class="nc-wizard-cite">${escHtml(stepDef.cite)}</span>
          </div>
          <div class="nc-wizard-save" id="nc-wizard-save"><span class="nc-wizard-save-dot"></span><span id="nc-wizard-save-text">Auto-save on</span></div>
        </div>
        <div class="nc-wizard-progress"><div class="nc-wizard-progress-fill" style="width:${pct}%"></div></div>

        <div class="nc-wizard-step active">
          <h3 class="nc-wizard-aim">${escHtml(stepDef.aim)}</h3>
          <p class="nc-wizard-aim-sub">${escHtml(stepDef.sub)}</p>
          ${stepDef.quote ? `<blockquote class="nc-wizard-quote">${escHtml(stepDef.quote)}</blockquote>` : ''}
          ${stepDef.fields.map(_renderField).join('')}
        </div>

        <div class="nc-wizard-foot">
          <div class="nc-wizard-foot-side">
            <button class="nc-btn nc-btn--ghost" id="nc-w-prev" ${state.step === 1 ? 'disabled' : ''}>← Back</button>
          </div>
          <div class="nc-wizard-foot-side">
            ${state.step < total
              ? `<button class="nc-btn nc-btn--primary" id="nc-w-next">Next →</button>`
              : `<button class="nc-btn nc-btn--primary" id="nc-w-finalize">✓ Finalize Assessment</button>`}
          </div>
        </div>
      </div>
    `;

    _bindStepEvents();
    _setSaveStatus(state.saveStatus);
  }

  // ───────────────────────────────────────────────────────────
  // Event binding for current step
  // ───────────────────────────────────────────────────────────
  function _bindStepEvents() {
    // Textarea / input fields
    $$('[data-field]').forEach(el => {
      const col = el.dataset.field;
      el.addEventListener('input', () => {
        const val = el.type === 'checkbox' ? el.checked : el.value;
        savePartial(col, val);
      });
    });

    // Chips
    $$('[data-chips]').forEach(box => {
      const col = box.dataset.chips;
      const input = box.querySelector('.nc-w-chip-input');
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const v = input.value.trim();
          if (!v) return;
          const arr = Array.isArray(state.record[col]) ? state.record[col].slice() : [];
          arr.push(v);
          state.record[col] = arr;
          input.value = '';
          _render();
          $(`[data-chips="${col}"] .nc-w-chip-input`)?.focus();
          _scheduleSave();
        } else if (e.key === 'Backspace' && !input.value) {
          const arr = Array.isArray(state.record[col]) ? state.record[col].slice() : [];
          if (arr.length) {
            arr.pop();
            state.record[col] = arr;
            _render();
            $(`[data-chips="${col}"] .nc-w-chip-input`)?.focus();
            _scheduleSave();
          }
        }
      });
      box.querySelectorAll('[data-chip-rm]').forEach(btn => {
        btn.addEventListener('click', () => {
          const i = parseInt(btn.dataset.chipRm, 10);
          const arr = Array.isArray(state.record[col]) ? state.record[col].slice() : [];
          arr.splice(i, 1);
          state.record[col] = arr;
          _render();
          _scheduleSave();
        });
      });
    });

    // Repeating rows
    $$('[data-rows]').forEach(host => {
      const col = host.dataset.rows;
      const schema = JSON.parse(host.dataset.schema);
      // Edit row cells
      host.querySelectorAll('[data-row-idx]').forEach(rowEl => {
        const idx = parseInt(rowEl.dataset.rowIdx, 10);
        rowEl.querySelectorAll('[data-row-col]').forEach(cell => {
          cell.addEventListener('input', () => {
            const arr = Array.isArray(state.record[col]) ? state.record[col].slice() : [];
            if (!arr[idx]) arr[idx] = {};
            arr[idx][cell.dataset.rowCol] = cell.value;
            state.record[col] = arr;
            _scheduleSave();
          });
        });
        // Remove
        rowEl.querySelector('[data-row-rm]')?.addEventListener('click', () => {
          const arr = Array.isArray(state.record[col]) ? state.record[col].slice() : [];
          arr.splice(idx, 1);
          state.record[col] = arr;
          _render();
          _scheduleSave();
        });
      });
      // Add row
      const addBtn = host.parentElement.querySelector(`[data-rows-add="${col}"]`);
      addBtn?.addEventListener('click', () => {
        const arr = Array.isArray(state.record[col]) ? state.record[col].slice() : [];
        const blank = {}; schema.forEach(c => { blank[c.name] = ''; });
        arr.push(blank);
        state.record[col] = arr;
        _render();
        _scheduleSave();
      });
    });

    // Sliders
    $$('[data-slider]').forEach(el => {
      const col = el.dataset.slider;
      el.addEventListener('input', () => {
        const v = parseInt(el.value, 10);
        state.record[col] = v;
        const out = $(`[data-slider-val="${col}"]`);
        if (out) out.textContent = v;
        _scheduleSave();
      });
    });

    // Red flags
    $$('[data-redflag]').forEach(el => {
      el.addEventListener('change', () => {
        const obj = (state.record.red_flag_screen && typeof state.record.red_flag_screen === 'object')
          ? { ...state.record.red_flag_screen } : {};
        obj[el.dataset.redflag] = el.checked;
        state.record.red_flag_screen = obj;
        _scheduleSave();
      });
    });

    // Nav
    $('#nc-w-prev')?.addEventListener('click', () => goToStep(state.step - 1));
    $('#nc-w-next')?.addEventListener('click', () => goToStep(state.step + 1));
    $('#nc-w-finalize')?.addEventListener('click', () => finalize());
  }

  function goToStep(n) {
    const total = STEPS.length;
    state.step = Math.max(1, Math.min(n, total));
    _render();
    _flushSave();
  }

  // ───────────────────────────────────────────────────────────
  // Mode switching
  // ───────────────────────────────────────────────────────────
  async function setMode(mode) {
    if (mode !== 'osullivan' && mode !== 'free_form') return;
    if (mode === state.mode) {
      _renderModePanes();
      return;
    }
    // Flush current row first
    if (state.saveTimer) { clearTimeout(state.saveTimer); await _flushSave(); }

    state.mode = mode;
    state.rowId = null;
    state.record = {};
    state.step = 1;

    _renderModePanes();

    if (state.clientId) {
      try {
        await _loadOrCreate();
        if (mode === 'osullivan') _render();
        else _renderFreeForm();
      } catch (e) {
        console.error('[RPMSubjective] mode switch failed:', e);
      }
    }
  }

  function _renderModePanes() {
    $$('.nc-subj-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
    $$('.nc-subj-pane').forEach(p => p.classList.toggle('active', p.dataset.mode === state.mode));
  }

  // ───────────────────────────────────────────────────────────
  // Free-form mode wiring (existing #ns-subjective textarea)
  // ───────────────────────────────────────────────────────────
  function _renderFreeForm() {
    const ta = $('#ns-subjective');
    if (!ta) return;
    // Restore from existing row
    if (state.record.free_form_notes != null && !ta.value) ta.value = state.record.free_form_notes;
    if (!ta._rpmBound) {
      ta.addEventListener('input', () => savePartial('free_form_notes', ta.value));
      ta._rpmBound = true;
    }
  }

  // ───────────────────────────────────────────────────────────
  // Public: init
  // ───────────────────────────────────────────────────────────
  async function init(clientId) {
    if (!clientId) {
      _renderNoClient();
      return;
    }
    if (state.clientId === clientId && state.rowId) {
      // Already initialised for this client — re-render in case DOM changed
      _renderModePanes();
      if (state.mode === 'osullivan') _render();
      else _renderFreeForm();
      return;
    }

    state.clientId = clientId;
    state.rowId = null;
    state.record = {};
    state.step = 1;

    try {
      await _loadOrCreate();
      _renderModePanes();
      if (state.mode === 'osullivan') _render();
      else _renderFreeForm();
    } catch (e) {
      console.error('[RPMSubjective] init failed:', e);
      _renderError(e.message || 'Could not load the subjective assessment.');
    }
  }

  function _renderNoClient() {
    const root = $('#nc-wizard-root');
    if (!root) return;
    root.innerHTML = `
      <div class="nc-subj-no-client">
        <span class="nc-w-empty-icon">◈</span>
        <p>Select a client in the Client Info tab to start the structured NeuCore subjective assessment.</p>
      </div>
    `;
  }

  function _renderError(msg) {
    const root = $('#nc-wizard-root');
    if (!root) return;
    root.innerHTML = `
      <div class="nc-subj-no-client">
        <span class="nc-w-empty-icon">⚠</span>
        <p style="color:#FCA5A5">${escHtml(msg)}</p>
      </div>
    `;
  }

  // ───────────────────────────────────────────────────────────
  // Public: finalize
  // ───────────────────────────────────────────────────────────
  async function finalize() {
    if (!state.rowId) return null;
    const sbc = _sb();
    if (state.saveTimer) { clearTimeout(state.saveTimer); await _flushSave(); }

    const { error } = await sbc
      .from('subjective_assessments')
      .update({ status: 'complete' })
      .eq('id', state.rowId);
    if (error) {
      console.error('[RPMSubjective] finalize failed:', error);
      if (typeof Dashboard !== 'undefined') Dashboard.toast?.('Could not finalize — please retry', 'error');
      return null;
    }
    if (typeof Dashboard !== 'undefined') Dashboard.toast?.('Subjective assessment finalized ✓', 'success');
    return state.rowId;
  }

  // ───────────────────────────────────────────────────────────
  // Wire mode toggle on first DOMContentLoaded (idempotent)
  // ───────────────────────────────────────────────────────────
  function _wireModeToggle() {
    $$('.nc-subj-mode-btn').forEach(btn => {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });
  }

  document.addEventListener('DOMContentLoaded', _wireModeToggle);

  // ───────────────────────────────────────────────────────────
  // Expose
  // ───────────────────────────────────────────────────────────
  window.RPMSubjective = {
    init,
    setMode,
    savePartial,
    finalize,
    // Read-only state for debugging
    _state: () => ({ ...state }),
  };
})();
