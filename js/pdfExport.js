/* ═══════════════════════════════════════════════════════════════
   NeuCore — Professional PDF Report Export
   Builds a high-end rehabilitation / performance coaching report
   with jsPDF (loaded from CDN as window.jspdf).

   Public API (window.NeuPDF):
     exportReport(data)  → builds the PDF and triggers a download.
       data = {
         client:     { name, age, gender, height, weight, goal, caseType,
                       experience, painAreas, injuryHistory, date, coach },
         subjective: [ { label, value }, ... ]   (clinical key/values)
         objective:  { scores:{...}, rom:[ {label,value} ], findings:[ {label,value} ] }
         program:    ProgramGenerator output ({ phase, structure:{warmup,main,cooldown}, ... })
         gait:       GaitEngine.analyze output (optional)
       }
     isReady()  → true once jsPDF is available.

   Layout: A4 portrait, light printable pages, branded dark header band,
   page footer with page number. Pure jsPDF vector drawing — no html2canvas,
   no window.print(), so the output is crisp and consistent.
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── Page geometry (A4 in points) ──────────────────────────
  const PW = 595.28, PH = 841.89;
  const M  = 44;                       // body margin
  const CONTENT_W = PW - M * 2;
  const HEADER_H  = 74;
  const FOOTER_Y  = PH - 38;
  const BODY_TOP  = HEADER_H + 26;
  const BODY_BOT  = PH - 58;           // content must stop above this

  // ── Brand palette ─────────────────────────────────────────
  const C = {
    navy:  [7, 17, 26],
    navy2: [14, 26, 36],
    teal:  [20, 184, 166],
    cyan:  [103, 232, 249],
    gold:  [212, 175, 55],
    ink:   [26, 35, 50],
    sub:   [100, 116, 139],
    line:  [223, 230, 238],
    panel: [247, 249, 252],
    rose:  [225, 53, 95],
    white: [255, 255, 255],
  };

  // ── Build state ───────────────────────────────────────────
  let doc = null;
  let pageNum = 0;
  let cursor = 0;
  let meta = {};

  // ── Low-level helpers ─────────────────────────────────────
  const set = {
    fill: (c) => doc.setFillColor(c[0], c[1], c[2]),
    text: (c) => doc.setTextColor(c[0], c[1], c[2]),
    draw: (c) => doc.setDrawColor(c[0], c[1], c[2]),
  };
  function font(style = 'normal', size = 10) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
  }
  const clean = (v) => {
    if (v === 0) return '0';
    if (v == null || v === '' || v === '—') return '';
    return String(v).trim();
  };
  const orDash = (v) => clean(v) || '—';

  // ── Header band — drawn on every page ─────────────────────
  function drawHeader(title) {
    // dark band
    set.fill(C.navy);
    doc.rect(0, 0, PW, HEADER_H, 'F');
    // teal accent underline
    set.fill(C.teal);
    doc.rect(0, HEADER_H - 3, PW, 3, 'F');

    // logo mark — rounded square
    set.fill(C.teal);
    doc.roundedRect(M, 22, 30, 30, 7, 7, 'F');
    set.fill(C.navy);
    doc.roundedRect(M + 9, 31, 12, 12, 3, 3, 'F');

    // wordmark
    font('bold', 17);
    set.text(C.white);
    doc.text('NEUCORE', M + 42, 38);
    font('normal', 7.5);
    set.text(C.cyan);
    doc.text('MOVEMENT INTELLIGENCE · AN AST9 SOLUTION', M + 42, 49);

    // page title (right aligned)
    font('bold', 11);
    set.text(C.white);
    doc.text((title || '').toUpperCase(), PW - M, 35, { align: 'right' });
    font('normal', 8);
    set.text(C.sub);
    doc.text(meta.clientName || '', PW - M, 48, { align: 'right' });
  }

  // ── Footer — drawn on every page ──────────────────────────
  function drawFooter() {
    set.draw(C.line);
    doc.setLineWidth(0.75);
    doc.line(M, FOOTER_Y - 10, PW - M, FOOTER_Y - 10);
    font('normal', 7.5);
    set.text(C.sub);
    doc.text(`Generated ${meta.date}  ·  NeuCore Rehabilitation Report`, M, FOOTER_Y);
    doc.text(`Page ${pageNum}`, PW - M, FOOTER_Y, { align: 'right' });
    doc.text('Confidential — clinical use only', PW / 2, FOOTER_Y, { align: 'center' });
  }

  // ── Page management ───────────────────────────────────────
  function startPage(title) {
    if (pageNum > 0) doc.addPage();
    pageNum += 1;
    meta.runningTitle = title;
    drawHeader(title);
    drawFooter();
    cursor = BODY_TOP;
  }
  // Ensure `h` points of vertical space remain; otherwise break to a new page.
  function ensure(h) {
    if (cursor + h > BODY_BOT) {
      startPage(meta.runningTitle);
      return true;
    }
    return false;
  }

  // ── Content primitives ────────────────────────────────────
  function pageHeading(big, small) {
    set.text(C.ink);
    font('bold', 21);
    doc.text(big, M, cursor + 6);
    cursor += 14;
    if (small) {
      font('normal', 9.5);
      set.text(C.sub);
      doc.text(small, M, cursor + 6);
      cursor += 12;
    }
    cursor += 14;
  }

  function sectionTitle(txt) {
    ensure(38);
    // teal tick + uppercase label
    set.fill(C.teal);
    doc.rect(M, cursor - 1, 3.5, 13, 'F');
    font('bold', 11);
    set.text(C.ink);
    doc.text(txt.toUpperCase(), M + 12, cursor + 9);
    set.draw(C.line);
    doc.setLineWidth(0.75);
    doc.line(M, cursor + 16, PW - M, cursor + 16);
    cursor += 30;
  }

  // Wrapped paragraph
  function paragraph(txt, opts = {}) {
    const t = clean(txt);
    if (!t) return;
    const size = opts.size || 9.5;
    font(opts.style || 'normal', size);
    set.text(opts.color || C.ink);
    const lines = doc.splitTextToSize(t, CONTENT_W - (opts.indent || 0));
    const lh = size * 1.45;
    lines.forEach((ln) => {
      ensure(lh);
      doc.text(ln, M + (opts.indent || 0), cursor + size * 0.8);
      cursor += lh;
    });
    cursor += opts.gap == null ? 6 : opts.gap;
  }

  // Two-column key/value grid (cards)
  function kvGrid(pairs) {
    const items = pairs.filter((p) => p && p.label);
    const colW  = (CONTENT_W - 14) / 2;
    const pad   = 10;
    for (let i = 0; i < items.length; i += 2) {
      const row = items.slice(i, i + 2);
      // measure tallest cell in this row
      let rowH = 0;
      const measured = row.map((p) => {
        font('normal', 9.5);
        const vlines = doc.splitTextToSize(orDash(p.value), colW - pad * 2);
        const h = 16 + 4 + vlines.length * 12 + pad * 2 - 4;
        rowH = Math.max(rowH, h);
        return { p, vlines };
      });
      ensure(rowH + 8);
      measured.forEach((m, idx) => {
        const x = M + idx * (colW + 14);
        // card
        set.fill(C.panel);
        set.draw(C.line);
        doc.setLineWidth(0.75);
        doc.roundedRect(x, cursor, colW, rowH, 5, 5, 'FD');
        // label
        font('bold', 7.5);
        set.text(C.teal);
        doc.text(m.p.label.toUpperCase(), x + pad, cursor + pad + 5);
        // value
        font('normal', 10);
        set.text(C.ink);
        let vy = cursor + pad + 20;
        m.vlines.forEach((ln) => { doc.text(ln, x + pad, vy); vy += 12; });
      });
      cursor += rowH + 8;
    }
  }

  // A labelled stat chip row (scores)
  function statRow(stats) {
    const items = stats.filter(Boolean);
    if (!items.length) return;
    const gap = 10;
    const cw  = (CONTENT_W - gap * (items.length - 1)) / items.length;
    const h   = 56;
    ensure(h + 10);
    items.forEach((s, i) => {
      const x = M + i * (cw + gap);
      set.fill(s.accent ? C.navy : C.panel);
      set.draw(C.line);
      doc.setLineWidth(0.75);
      doc.roundedRect(x, cursor, cw, h, 6, 6, s.accent ? 'F' : 'FD');
      font('bold', 20);
      set.text(s.accent ? C.cyan : (s.color || C.teal));
      doc.text(String(s.value), x + cw / 2, cursor + 30, { align: 'center' });
      font('bold', 7);
      set.text(s.accent ? C.sub : C.sub);
      doc.text(s.label.toUpperCase(), x + cw / 2, cursor + 44, { align: 'center' });
    });
    cursor += h + 14;
  }

  // Callout box (warnings / notes)
  function callout(txt, kind) {
    const t = clean(txt);
    if (!t) return;
    const tone = kind === 'warn' ? C.rose : kind === 'note' ? C.gold : C.teal;
    font('normal', 9);
    const lines = doc.splitTextToSize(t, CONTENT_W - 28);
    const h = lines.length * 12 + 16;
    ensure(h + 6);
    // tinted bg
    doc.setFillColor(tone[0], tone[1], tone[2]);
    doc.setGState && doc.setGState(new doc.GState({ opacity: 0.08 }));
    doc.roundedRect(M, cursor, CONTENT_W, h, 4, 4, 'F');
    doc.setGState && doc.setGState(new doc.GState({ opacity: 1 }));
    // left bar
    set.fill(tone);
    doc.rect(M, cursor, 3, h, 'F');
    // text
    set.text(C.ink);
    let ty = cursor + 12;
    lines.forEach((ln) => { doc.text(ln, M + 12, ty); ty += 12; });
    cursor += h + 8;
  }

  // ── Exercise table (one program section) ──────────────────
  // cols: # | Exercise (+notes) | Sets | Reps | Tempo | Rest
  function exerciseTable(title, rows, accent) {
    if (!rows || !rows.length) return;
    const acc = accent || C.teal;
    // section sub-heading
    ensure(40);
    set.fill(acc);
    doc.rect(M, cursor, CONTENT_W, 20, 'F');
    font('bold', 9);
    set.text(C.white);
    doc.text(title.toUpperCase(), M + 10, cursor + 13.5);
    font('normal', 8);
    doc.text(`${rows.length} exercise${rows.length === 1 ? '' : 's'}`, PW - M - 10, cursor + 13.5, { align: 'right' });
    cursor += 20;

    // column geometry
    const cNum = 26, cSet = 44, cRep = 70, cTmp = 56, cRst = 44;
    const cName = CONTENT_W - cNum - cSet - cRep - cTmp - cRst;
    const xs = {
      num:  M,
      name: M + cNum,
      sets: M + cNum + cName,
      reps: M + cNum + cName + cSet,
      tmp:  M + cNum + cName + cSet + cRep,
      rst:  M + cNum + cName + cSet + cRep + cTmp,
    };

    // table header row
    set.fill(C.panel);
    doc.rect(M, cursor, CONTENT_W, 16, 'F');
    font('bold', 7);
    set.text(C.sub);
    doc.text('#',      xs.num + 6,  cursor + 11);
    doc.text('EXERCISE', xs.name + 6, cursor + 11);
    doc.text('SETS',   xs.sets + 6, cursor + 11);
    doc.text('REPS',   xs.reps + 6, cursor + 11);
    doc.text('TEMPO',  xs.tmp + 6,  cursor + 11);
    doc.text('REST',   xs.rst + 6,  cursor + 11);
    cursor += 16;

    rows.forEach((ex, i) => {
      font('bold', 9);
      const nameLines  = doc.splitTextToSize(orDash(ex.name), cName - 12);
      font('normal', 7.7);
      const noteLines  = ex.notes ? doc.splitTextToSize(clean(ex.notes), cName - 12) : [];
      const rowH = Math.max(22, 8 + nameLines.length * 11 + (noteLines.length ? noteLines.length * 9 + 2 : 0) + 6);

      // page-break safety — never split a row
      if (cursor + rowH > BODY_BOT) {
        startPage(meta.runningTitle);
        // repeat the table header on the new page
        set.fill(acc);
        doc.rect(M, cursor, CONTENT_W, 18, 'F');
        font('bold', 8);
        set.text(C.white);
        doc.text(title.toUpperCase() + ' (CONT.)', M + 10, cursor + 12.5);
        cursor += 18;
        set.fill(C.panel);
        doc.rect(M, cursor, CONTENT_W, 16, 'F');
        font('bold', 7);
        set.text(C.sub);
        doc.text('#', xs.num + 6, cursor + 11);
        doc.text('EXERCISE', xs.name + 6, cursor + 11);
        doc.text('SETS', xs.sets + 6, cursor + 11);
        doc.text('REPS', xs.reps + 6, cursor + 11);
        doc.text('TEMPO', xs.tmp + 6, cursor + 11);
        doc.text('REST', xs.rst + 6, cursor + 11);
        cursor += 16;
      }

      // zebra background
      if (i % 2 === 1) {
        set.fill([252, 253, 254]);
        doc.rect(M, cursor, CONTENT_W, rowH, 'F');
      }
      // row separator
      set.draw(C.line);
      doc.setLineWidth(0.5);
      doc.line(M, cursor + rowH, PW - M, cursor + rowH);

      // number badge
      set.fill(acc);
      doc.circle(xs.num + 13, cursor + 13, 8, 'F');
      font('bold', 8);
      set.text(C.white);
      doc.text(String(i + 1), xs.num + 13, cursor + 16, { align: 'center' });

      // name + notes
      font('bold', 9);
      set.text(C.ink);
      let ny = cursor + 14;
      nameLines.forEach((ln) => { doc.text(ln, xs.name + 6, ny); ny += 11; });
      if (noteLines.length) {
        font('normal', 7.7);
        set.text(C.sub);
        ny += 1;
        noteLines.forEach((ln) => { doc.text(ln, xs.name + 6, ny); ny += 9; });
      }

      // sets / reps / tempo / rest
      font('bold', 9);
      set.text(C.teal);
      doc.text(orDash(ex.sets), xs.sets + 6, cursor + 14);
      font('normal', 8.5);
      set.text(C.ink);
      doc.text(orDash(ex.reps), xs.reps + 6, cursor + 14);
      font('normal', 8);
      set.text(C.sub);
      doc.text(orDash(ex.tempo), xs.tmp + 6, cursor + 14);
      doc.text(orDash(ex.rest), xs.rst + 6, cursor + 14);

      cursor += rowH;
    });
    cursor += 14;
  }

  // ── PAGE 1 — Client overview ──────────────────────────────
  function pageClient(d) {
    const c = d.client || {};
    startPage('Client Overview');
    pageHeading('Rehabilitation Program Report',
      'Personalised movement-intelligence assessment & training plan');

    // Hero client card
    ensure(96);
    set.fill(C.navy);
    doc.roundedRect(M, cursor, CONTENT_W, 88, 8, 8, 'F');
    set.fill(C.teal);
    doc.roundedRect(M, cursor, 5, 88, 0, 0, 'F');
    // client initials avatar
    const initials = (clean(c.name) || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    set.fill(C.teal);
    doc.circle(M + 48, cursor + 44, 26, 'F');
    font('bold', 18);
    set.text(C.navy);
    doc.text(initials, M + 48, cursor + 50, { align: 'center' });
    // name + meta
    font('normal', 8);
    set.text(C.cyan);
    doc.text('CLIENT', M + 90, cursor + 26);
    font('bold', 19);
    set.text(C.white);
    doc.text(orDash(c.name), M + 90, cursor + 48);
    font('normal', 9);
    set.text(C.sub);
    doc.text(`Program phase: ${orDash(c.phase)}   ·   Report date: ${orDash(c.date)}`, M + 90, cursor + 66);
    cursor += 88 + 22;

    sectionTitle('Client Profile');
    kvGrid([
      { label: 'Full Name',          value: c.name },
      { label: 'Age',                value: c.age },
      { label: 'Gender',             value: c.gender },
      { label: 'Case Type',          value: c.caseType },
      { label: 'Height',             value: c.height },
      { label: 'Weight',             value: c.weight },
      { label: 'Training Experience', value: c.experience },
      { label: 'Program Phase',      value: c.phase },
    ]);

    sectionTitle('Goal & Clinical Context');
    kvGrid([
      { label: 'Primary Goal',   value: c.goal },
      { label: 'Pain Areas',     value: c.painAreas },
    ]);
    if (clean(c.injuryHistory)) {
      font('bold', 7.5); set.text(C.teal);
      ensure(20);
      doc.text('INJURY HISTORY', M, cursor + 5);
      cursor += 14;
      paragraph(c.injuryHistory, { size: 9.5, color: C.ink });
    }

    sectionTitle('Prepared By');
    kvGrid([
      { label: 'Coach',          value: c.coach },
      { label: 'Date of Report', value: c.date },
    ]);
  }

  // ── PAGE 2 — Subjective assessment ────────────────────────
  function pageSubjective(d) {
    startPage('Subjective Assessment');
    pageHeading('Subjective Assessment',
      'The client’s own account — symptoms, history, and goals');

    const rows = (d.subjective || []).filter((p) => p && p.label && clean(p.value));
    if (!rows.length) {
      callout('No subjective assessment data was recorded for this session. '
        + 'Complete the Subjective Assessment tab to populate this page.', 'note');
      return;
    }
    sectionTitle('Clinical Interview Findings');
    kvGrid(rows);
  }

  // ── PAGE 3 — Objective assessment ─────────────────────────
  function pageObjective(d) {
    startPage('Objective Assessment');
    pageHeading('Objective Assessment',
      'Measured movement, range, control and clinical scoring');

    const o = d.objective || {};
    const s = o.scores || {};
    // Movement scores
    if (s.composite_score != null || s.rom_score != null) {
      sectionTitle('Movement Scores');
      statRow([
        s.composite_score != null && { label: 'Composite', value: Math.round(s.composite_score), accent: true },
        s.rom_score       != null && { label: 'ROM',       value: Math.round(s.rom_score) },
        s.control_score   != null && { label: 'Control',   value: Math.round(s.control_score) },
        s.force_score     != null && { label: 'Force',     value: Math.round(s.force_score) },
        s.neurology_score != null && { label: 'Neuro',     value: Math.round(s.neurology_score) },
      ]);
      if (s.phase_recommendation) {
        paragraph(`Recommended phase: ${s.phase_recommendation}`, { style: 'bold', size: 9.5, color: C.teal });
      }
    }

    // ROM table
    if ((o.rom || []).length) {
      sectionTitle('Range of Motion');
      kvGrid(o.rom);
    }

    // Findings
    if ((o.findings || []).length) {
      sectionTitle('Clinical Findings');
      kvGrid(o.findings);
    }

    if (!((s.composite_score != null) || (o.rom || []).length || (o.findings || []).length)) {
      callout('No objective assessment data was recorded. Complete the Objective '
        + 'Assessment tab and run Generate to populate measured findings.', 'note');
    }
  }

  // Full-width dark "part divider" banner — used to give the Program its own
  // clean, unmistakable fresh-page start (nothing above or below it).
  function partBanner(eyebrow, title, subtitle) {
    const h = 70;
    set.fill(C.navy);
    doc.roundedRect(M, cursor, CONTENT_W, h, 8, 8, 'F');
    set.fill(C.teal);
    doc.roundedRect(M, cursor, 5, h, 0, 0, 'F');
    font('normal', 8);
    set.text(C.cyan);
    doc.text((eyebrow || '').toUpperCase(), M + 22, cursor + 24);
    font('bold', 18);
    set.text(C.white);
    doc.text(title, M + 22, cursor + 46);
    if (subtitle) {
      font('normal', 9);
      set.text(C.sub);
      doc.text(subtitle, M + 22, cursor + 60);
    }
    cursor += h + 24;
  }

  // ── PAGE 4+ — Training / rehab program ────────────────────
  // Always begins on its own fresh page (startPage) with a dedicated part
  // banner — never shares a page with the assessment sections.
  function pageProgram(d) {
    const p = d.program;
    startPage('Rehabilitation Program');
    partBanner('Part II · Prescription',
      'Training & Rehabilitation Program',
      p ? `${orDash(p.phase)} — structured corrective & conditioning plan` : 'Generated plan');

    if (!p || (!p.structure && !p.workouts)) {
      callout('No program has been generated yet. Run Generate to build the '
        + 'training plan, then export the report.', 'note');
      return;
    }

    // phase defaults badges
    if (p.defaults) {
      sectionTitle('Prescription Defaults — ' + orDash(p.phase));
      kvGrid([
        { label: 'Sets',  value: p.defaults.sets },
        { label: 'Reps',  value: p.defaults.reps },
        { label: 'Tempo', value: p.defaults.tempo },
        { label: 'Rest',  value: p.defaults.rest },
        { label: 'Workout split',  value: p.split_label },
        { label: 'Days / week',    value: p.days_per_week },
      ]);
    }

    // warnings / notes
    (p.warnings || []).forEach((w) => callout(w, 'warn'));
    (p.notes || []).forEach((n) => callout(n, 'note'));

    // Back-fill a single workout for legacy programs.
    let workouts = (Array.isArray(p.workouts) && p.workouts.length) ? p.workouts : null;
    if (!workouts) {
      const s = p.structure || { warmup: [], main: [], cooldown: [] };
      workouts = [{ id: 'A', label: 'Daily Workout', warmup: s.warmup, main: s.main, cooldown: s.cooldown }];
    }
    const schedule = (Array.isArray(p.schedule) && p.schedule.length)
      ? p.schedule
      : Array.from({ length: p.days_per_week || 1 }, (_, i) => workouts[i % workouts.length].id);

    // Weekly schedule
    sectionTitle('Weekly Schedule');
    paragraph(schedule.map((id, i) => `Day ${i + 1}: Workout ${id}`).join('     '),
      { size: 10, style: 'bold', color: C.teal });

    // Each distinct workout
    workouts.forEach((wk) => {
      sectionTitle(`${wk.label || ('Workout ' + wk.id)}  ·  Workout ${wk.id}`);
      exerciseTable('Warm-Up', wk.warmup, C.teal);
      exerciseTable('Conditioning / Correctives', wk.main, C.gold);
      exerciseTable('Cool-Down', wk.cooldown, [56, 132, 173]);
    });

    // daily routine
    if (p.daily_routine) {
      const dr = p.daily_routine;
      const daily = [...(dr.breathing || []), ...(dr.mobility || []), ...(dr.activation || [])];
      if (daily.length) {
        sectionTitle('Daily Maintenance Routine');
        exerciseTable('Every Day — ~15 min', daily, C.teal);
      }
    }

    // exclusions
    if ((p.exclusions || []).length) {
      sectionTitle('Movement Exclusions');
      paragraph('The following movement patterns are excluded for this client at the current phase:',
        { size: 9, color: C.sub });
      paragraph(p.exclusions.join('   ·   '), { size: 9.5, style: 'bold', color: C.rose });
    }
  }

  // ── Public: build + download ──────────────────────────────
  function exportReport(data) {
    if (!isReady()) throw new Error('PDF engine (jsPDF) not loaded.');
    const d = data || {};
    doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true });
    pageNum = 0;
    meta = {
      clientName: clean((d.client || {}).name) || 'Client',
      date: clean((d.client || {}).date) || new Date().toLocaleDateString(),
    };

    pageClient(d);
    pageSubjective(d);
    pageObjective(d);
    pageProgram(d);

    // filename: ClientName_Program_Date.pdf
    const safeName = (meta.clientName || 'Client').replace(/[^a-z0-9]+/gi, '');
    const safeDate = new Date().toISOString().slice(0, 10);
    doc.save(`${safeName}_Program_${safeDate}.pdf`);
    return true;
  }

  // Return a Blob URL for preview without downloading.
  function previewUrl(data) {
    if (!isReady()) throw new Error('PDF engine (jsPDF) not loaded.');
    const before = doc;
    exportReportSilent(data);
    const url = doc.output('bloburl');
    doc = before;
    return url;
  }
  function exportReportSilent(data) {
    const d = data || {};
    doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', compress: true });
    pageNum = 0;
    meta = {
      clientName: clean((d.client || {}).name) || 'Client',
      date: clean((d.client || {}).date) || new Date().toLocaleDateString(),
    };
    pageClient(d); pageSubjective(d); pageObjective(d); pageProgram(d);
  }

  function isReady() {
    return !!(window.jspdf && window.jspdf.jsPDF);
  }

  window.NeuPDF = { exportReport, previewUrl, isReady };
})();
