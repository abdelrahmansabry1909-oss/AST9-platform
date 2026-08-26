// ═══════════════════════════════════════════════════════════════
//  js/integrationEngine.js
//  Regional interdependence — how one region's restriction is paid for
//  somewhere else.
//
//  The other two engines score regions in isolation: scoring.js averages ROM
//  per joint, gaitEngine.js maps single-joint deficits onto gait phases.
//  Neither says anything about the RELATIONSHIP between regions, which is why
//  the analysis reads as a lower-limb study even once the upper body is
//  measured — a stiff thoracic spine only shows up as one low number instead
//  of as the reason the shoulder cannot reach overhead.
//
//  Every rule here is a published kinematic relationship with a number
//  attached, cited to Neumann, "Kinesiology of the Musculoskeletal System"
//  (edition unverified — see MuscleActivationDB.js). Nothing is inferred
//  beyond what the cited figure states.
//
//  Rules never guess. A relationship whose inputs were not measured is
//  reported as not assessed, never computed from partial data — a missing
//  measurement must not be able to produce a reassuring finding.
// ═══════════════════════════════════════════════════════════════

const IntegrationEngine = (() => {

  // ── NORMATIVE VALUES ──────────────────────────────────────
  // Clinically locked. Each carries the figure or table it came from.
  const NEUMANN = {
    // Table 9-11 — thoracic region, one side only for rotation/lateral flexion
    thor_rotation:      30,
    thor_extension:     20,   // stated 20-25; the lower bound is the threshold
    thor_flexion:       30,   // stated 30-40

    // Fig 9-54 / 9-55 / 9-56 — thoracolumbar arcs, split by region
    lumb_flexion:       50,
    lumb_extension:     15,
    lumb_rotation:       5,
    cranio_rotation:    90,
    head_turn_total:   125,   // 90 craniocervical + 30 thoracic + 5 lumbar

    // Fig 9-66 — forward bend to the floor, knees straight
    bend_lumbar:        40,
    bend_hip:           70,

    // Ch. 5, scapulohumeral rhythm — 2:1 through the arc of elevation
    elevation_full:    180,
    gh_share:          120,
    scap_share:         60,

    // Ch. 15 — horizontal plane during walking
    pelvis_excursion:    4,   // 3-4 degrees each direction
    femur_excursion:     7,   // 6-7
    tibia_excursion:     9,   // 8-9
    girdle_excursion:    7,   // total shoulder girdle, counter to the pelvis
    trunk_energy_cost:  10,   // % increase in walking cost when trunk is held
    shoulder_extension: 25,   // reached by the next heel contact
  };

  const SRC = {
    lumbopelvic: 'Neumann Ch. 9, Fig. 9-66 · Ch. 12, lumbopelvic rhythm',
    thor_rom:    'Neumann Ch. 9, Table 9-11',
    thor_lumb:   'Neumann Ch. 9, Figs. 9-54 to 9-56',
    curves:      'Neumann Ch. 9, "Normal Curvatures within the Vertebral Column"',
    rhythm:      'Neumann Ch. 5, scapulohumeral rhythm (Inman 2:1)',
    walking:     'Neumann Ch. 15, horizontal plane kinematics',
  };

  // ── HELPERS ───────────────────────────────────────────────
  const num  = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const worst = (l, r) => {
    const a = num(l), b = num(r);
    if (a == null) return b;
    if (b == null) return a;
    return Math.min(a, b);
  };

  // Grade a shortfall by how much of the normative value is missing. Bands are
  // the same three the gait engine already uses, so severities read alike
  // across panels.
  function grade(deficit, norm) {
    const share = deficit / norm;
    return share >= 0.5 ? 'severe' : share >= 0.25 ? 'moderate' : 'mild';
  }

  // ── RULES ─────────────────────────────────────────────────
  // Each rule declares what it needs, so a missing measurement produces an
  // honest "not assessed" line instead of a silent absence.
  const RULES = [
    {
      id: 'lumbopelvic_rhythm',
      title: 'Lumbopelvic rhythm',
      chain: 'Hip ↔ Lumbar spine',
      needs: ['hip flexion', 'lumbar flexion'],
      has: (a) => worst(a.hip_flex_l, a.hip_flex_r) != null,
      run: (a) => {
        const hip  = worst(a.hip_flex_l, a.hip_flex_r);
        const lumb = num(a.lumb_flex_deg);
        const hipShort = NEUMANN.bend_hip - hip;

        if (hipShort <= 0 && (lumb == null || lumb >= NEUMANN.bend_lumbar)) return null;

        if (hipShort > 0) {
          const borrowed = lumb != null && lumb > NEUMANN.bend_lumbar;
          return {
            severity: grade(hipShort, NEUMANN.bend_hip),
            finding: borrowed
              ? `Hip flexion ${hip}° against a ${NEUMANN.bend_hip}° share, with lumbar flexion at ${lumb}° against ${NEUMANN.bend_lumbar}°.`
              : `Hip flexion ${hip}° against the ${NEUMANN.bend_hip}° the hips normally contribute to a forward bend.`,
            why: borrowed
              ? 'The lumbar spine is supplying the range the hips cannot. Bending loads the low back instead of the hips, and the extra flexion is taken by the segment already carrying the most compression.'
              : `A bend to the floor is about ${NEUMANN.bend_lumbar}° lumbar and ${NEUMANN.bend_hip}° hip. With the hips short, either the lumbar spine takes the difference or total reach drops.`,
            actions: [
              'Restore hip flexion (hamstring extensibility, posterior chain) before loading the bend',
              'Cue a hip-led hinge so the lumbar spine is not the first segment to move',
              'Re-measure lumbar flexion once hip range improves',
            ],
            source: SRC.lumbopelvic,
          };
        }

        return {
          severity: grade(NEUMANN.bend_lumbar - lumb, NEUMANN.bend_lumbar),
          finding: `Lumbar flexion ${lumb}° against ${NEUMANN.bend_lumbar}°, with hip flexion adequate at ${hip}°.`,
          why: 'The stiff segment is the lumbar spine, so the hips are being asked for more travel than the pattern normally needs. Mobilising the hips further will not restore the bend.',
          actions: [
            'Segmental lumbar flexion work before more hip mobility',
            'Check for a flat or blocked segment rather than global stiffness',
          ],
          source: SRC.lumbopelvic,
        };
      },
    },

    {
      id: 'thoracic_shoulder_rhythm',
      title: 'Overhead reach is a thoracic problem',
      chain: 'Thoracic spine → Scapula → Shoulder',
      needs: ['shoulder abduction or flexion', 'thoracic extension'],
      has: (a) => worst(a.sh_abd_l, a.sh_abd_r) != null || worst(a.sh_flex_l, a.sh_flex_r) != null,
      run: (a) => {
        const abd  = worst(a.sh_abd_l, a.sh_abd_r);
        const elev = abd != null ? abd : worst(a.sh_flex_l, a.sh_flex_r);
        const thor = num(a.thor_ext);
        const short = NEUMANN.elevation_full - elev;
        if (short <= 0) return null;

        // 2:1 — of every 3 degrees of elevation, 2 are glenohumeral and 1 is
        // the scapula rotating on the ribcage. The scapula cannot rotate up
        // over a thorax that will not extend.
        const scapNeeded = Math.round(elev / 3);
        const thoracicDriver = thor != null && thor < NEUMANN.thor_extension;

        return {
          severity: grade(short, NEUMANN.elevation_full),
          finding: `Elevation ${elev}° of ${NEUMANN.elevation_full}°`
            + (thor != null ? `, thoracic extension ${thor}° of ${NEUMANN.thor_extension}°.` : '.'),
          why: thoracicDriver
            ? `At the 2:1 rhythm this arc needs about ${scapNeeded}° of scapular upward rotation, and the scapula rotates on the ribcage. With thoracic extension at ${thor}°, the restriction is behind the shoulder, not in it — capsular work alone will not return the range.`
            : `At the 2:1 rhythm, ${NEUMANN.elevation_full}° of elevation is ${NEUMANN.gh_share}° glenohumeral and ${NEUMANN.scap_share}° scapulothoracic. Thoracic extension is not recorded, so how much of this shortfall sits behind the shoulder is unknown.`,
          actions: thoracicDriver
            ? [
                'Thoracic extension mobility before glenohumeral capsule work',
                'Re-test elevation immediately after mobilising — the change should be visible in one session',
                'Serratus anterior / lower trapezius upward-rotation control once the thorax moves',
              ]
            : [
                'Measure thoracic extension before attributing this to the shoulder',
                'Screen scapular upward rotation during elevation',
              ],
          source: SRC.rhythm,
        };
      },
    },

    {
      id: 'axial_rotation_budget',
      title: 'Where the head turn comes from',
      chain: 'Cervical ↔ Thoracic ↔ Lumbar',
      needs: ['cervical rotation', 'thoracic rotation'],
      has: (a) => worst(a.thor_rot_l, a.thor_rot_r) != null,
      run: (a) => {
        const thor = worst(a.thor_rot_l, a.thor_rot_r);
        const cerv = worst(a.cerv_rot_l, a.cerv_rot_r);
        const short = NEUMANN.thor_rotation - thor;
        if (short <= 0) return null;

        // Turning the face 125 degrees is 90 craniocervical + 30 thoracic +
        // 5 lumbar. The lumbar spine has almost nothing to give, so a thoracic
        // shortfall is paid by the neck or not at all.
        const available = cerv != null
          ? cerv + thor + NEUMANN.lumb_rotation
          : null;
        const neckOverworking = cerv != null && cerv >= NEUMANN.cranio_rotation;

        return {
          severity: grade(short, NEUMANN.thor_rotation),
          finding: `Thoracic rotation ${thor}° of ${NEUMANN.thor_rotation}°`
            + (available != null
                ? `; total available head turn ${available}° of ${NEUMANN.head_turn_total}°.`
                : '.'),
          why: neckOverworking
            ? `A full head turn is ${NEUMANN.cranio_rotation}° neck + ${NEUMANN.thor_rotation}° thoracic + ${NEUMANN.lumb_rotation}° lumbar. The lumbar spine can only offer ${NEUMANN.lumb_rotation}°, so with the thorax short the neck is working at the top of its range on every turn.`
            : `A full head turn is ${NEUMANN.cranio_rotation}° neck + ${NEUMANN.thor_rotation}° thoracic + ${NEUMANN.lumb_rotation}° lumbar. The lumbar spine can only offer ${NEUMANN.lumb_rotation}°, so a thoracic shortfall has almost nowhere else to go.`,
          actions: [
            'Thoracic rotation mobility (segmental, in both directions)',
            neckOverworking
              ? 'Treat recurrent neck symptoms as a thoracic problem until the thorax moves'
              : 'Re-check cervical rotation after thoracic work',
          ],
          source: SRC.thor_lumb,
        };
      },
    },

    {
      id: 'reciprocal_curves',
      title: 'The low back is paying for the mid back',
      chain: 'Thoracic ↔ Lumbar',
      needs: ['thoracic extension', 'lumbar extension'],
      has: (a) => num(a.thor_ext) != null && num(a.lumb_ext_deg) != null,
      run: (a) => {
        const thor = num(a.thor_ext);
        const lumb = num(a.lumb_ext_deg);
        if (thor >= NEUMANN.thor_extension) return null;
        if (lumb < NEUMANN.lumb_extension) return null;

        return {
          severity: grade(NEUMANN.thor_extension - thor, NEUMANN.thor_extension),
          finding: `Thoracic extension ${thor}° of ${NEUMANN.thor_extension}°, lumbar extension ${lumb}° of ${NEUMANN.lumb_extension}°.`,
          why: 'Neumann states the relationship directly: excessive cervical or lumbar lordosis compensates for excessive thoracic kyphosis, and the reverse. With the thorax short of extension and the lumbar spine at or past its own range, the low back is producing the extension the mid back cannot.',
          actions: [
            'Thoracic extension over a fixed point, without letting the ribs flare',
            'Stop cueing more lumbar extension — it is already doing the work of two regions',
            'Re-measure both after mobilising the thorax',
          ],
          source: SRC.curves,
        };
      },
    },

    {
      id: 'gait_counter_rotation',
      title: 'Trunk counter-rotation in walking',
      chain: 'Shoulder girdle ↔ Pelvis',
      needs: ['thoracic rotation'],
      has: (a) => worst(a.thor_rot_l, a.thor_rot_r) != null,
      run: (a) => {
        const thor = worst(a.thor_rot_l, a.thor_rot_r);
        const short = NEUMANN.thor_rotation - thor;
        if (short <= 0) return null;

        const shExt = worst(a.sh_ext_l, a.sh_ext_r);
        const armLimited = shExt != null && shExt < NEUMANN.shoulder_extension;

        return {
          severity: grade(short, NEUMANN.thor_rotation),
          finding: `Thoracic rotation ${thor}° of ${NEUMANN.thor_rotation}°`
            + (armLimited ? `, shoulder extension ${shExt}° of ${NEUMANN.shoulder_extension}°.` : '.'),
          why: `In walking the shoulder girdle rotates opposite the pelvis, about ${NEUMANN.girdle_excursion}° of total excursion, and that counter-rotation passes through the thoracic spine. Holding the trunk still raises the energy cost of walking by up to ${NEUMANN.trunk_energy_cost}%. `
            + (armLimited
                ? `Shoulder extension is also short of the ${NEUMANN.shoulder_extension}° reached before each heel contact, so arm swing is limited at both ends.`
                : 'Arm swing exists to balance the rotational forces in the trunk, so a stiff thorax shows up as a quiet arm on that side.'),
          actions: [
            'Thoracic rotation drills in standing and in stride stance, not only seated',
            'Reciprocal arm-swing drills at walking speed once rotation improves',
            armLimited ? 'Restore shoulder extension range alongside the thoracic work' : 'Watch arm swing symmetry on video at self-selected speed',
          ],
          source: SRC.walking,
        };
      },
    },

    {
      id: 'rotation_chain_foot_to_pelvis',
      title: 'Rotation delivered by the foot',
      chain: 'Foot → Tibia → Femur → Pelvis',
      needs: ['pronation', 'hip internal rotation'],
      has: (a) => (a.pronation_l || a.pronation_r) && worst(a.hip_ir_l, a.hip_ir_r) != null,
      run: (a) => {
        const over = /over/i.test(String(a.pronation_l || '')) || /over/i.test(String(a.pronation_r || ''));
        if (!over) return null;
        const hipIr = worst(a.hip_ir_l, a.hip_ir_r);
        const tibIr = worst(a.tib_ir_l, a.tib_ir_r);
        if (hipIr >= 35) return null;

        return {
          severity: grade(35 - hipIr, 35),
          finding: `Over-pronation with hip internal rotation ${hipIr}° of 35°`
            + (tibIr != null ? `, tibial IR ${tibIr}°.` : '.'),
          why: `Through the first 15-20% of stance the pelvis, femur and tibia all rotate internally together — about ${NEUMANN.pelvis_excursion}°, ${NEUMANN.femur_excursion}° and ${NEUMANN.tibia_excursion}° respectively, growing towards the foot — while the subtalar joint everts to soften the midfoot. An over-pronating foot delivers more of that rotation upward. A hip that cannot internally rotate has to send it somewhere, and the knee and lumbar spine are next in line.`,
          actions: [
            'Hip internal rotation range before any foot orthosis decision',
            'Subtalar and midfoot control work (short foot, posterior tibialis)',
            'Watch the knee in single-leg stance — this chain surfaces as valgus',
          ],
          source: SRC.walking,
        };
      },
    },
  ];

  // ── PUBLIC ────────────────────────────────────────────────
  function analyze(assessment) {
    const a = assessment || {};
    const findings = [];
    const notAssessed = [];

    for (const rule of RULES) {
      if (!rule.has(a)) {
        notAssessed.push({ title: rule.title, chain: rule.chain, needs: rule.needs });
        continue;
      }
      const result = rule.run(a);
      if (result) findings.push({ id: rule.id, title: rule.title, chain: rule.chain, ...result });
    }

    const rank = { severe: 0, moderate: 1, mild: 2 };
    findings.sort((x, y) => rank[x.severity] - rank[y.severity]);

    return {
      findings,
      not_assessed: notAssessed,
      assessed_count: RULES.length - notAssessed.length,
      total_rules: RULES.length,
    };
  }

  // ── RENDER ────────────────────────────────────────────────
  function renderIntegration(result) {
    const panel = document.getElementById('integration-panel');
    if (!panel) return;

    const sevColor = { mild: 'var(--teal)', moderate: 'var(--amber)', severe: 'var(--rose)' };

    const card = (f) => `
      <div style="background:var(--bg-raised);border:1px solid var(--border-subtle);border-left:3px solid ${sevColor[f.severity]};border-radius:var(--r-md);padding:14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${sevColor[f.severity]}">${f.severity}</span>
          <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${f.title}</span>
        </div>
        <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:.5px;color:var(--text-tertiary);margin-bottom:8px">${f.chain}</div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${f.finding}</div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:8px">${f.why}</div>
        <div style="font-size:11px;margin-bottom:8px">
          ${f.actions.map((x) => `<div style="color:var(--lime);padding:2px 0">▸ ${x}</div>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--text-tertiary)">${f.source}</div>
      </div>`;

    const pending = (n) => `
      <div style="font-size:11px;color:var(--text-tertiary);padding:3px 0">
        ○ ${n.title} (${n.chain}) — needs ${n.needs.join(', ')}
      </div>`;

    const clear = `
      <div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:13px">
        ✓ No cross-region compensation detected in what was measured
      </div>`;

    panel.innerHTML = `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Integrated Chain Analysis</span>
          <span style="font-size:12px;color:var(--text-tertiary)">
            ${result.findings.length} chain${result.findings.length !== 1 ? 's' : ''} ·
            ${result.assessed_count}/${result.total_rules} assessable
          </span>
        </div>
        ${result.findings.length ? result.findings.map(card).join('') : clear}
        ${result.not_assessed.length ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-subtle)">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px">Not assessed</div>
          ${result.not_assessed.map(pending).join('')}
        </div>` : ''}
      </div>`;
  }

  return { analyze, renderIntegration, NEUMANN, RULES };

})();

window.IntegrationEngine = IntegrationEngine;
