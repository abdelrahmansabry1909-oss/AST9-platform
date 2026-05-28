// src/neucore/gait/PhaseAnalysisOverlay.js
// Freeze-frame worst-phase analysis: shows per-joint callout cards that
// appear one by one with SVG connector lines to the 3D skeleton.

import * as THREE from 'three';
import { GAIT_PHASES } from '../simulation/MuscleActivationDB.js';

const MUSCLE_LABELS = {
  gluteus_maximus:    'Glute Max',
  gluteus_medius:     'Glute Med',
  gluteus_minimus:    'Glute Min',
  tensor_fascia_latae:'TFL',
  iliopsoas:          'Iliopsoas',
  rectus_femoris:     'Rect Fem',
  vastus_lateralis:   'Vast Lat',
  vastus_medialis:    'Vast Med',
  hamstrings:         'Hamstrings',
  gastrocnemius:      'Gastroc',
  soleus:             'Soleus',
  tibialis_anterior:  'Tib Ant',
  tibialis_posterior: 'Tib Post',
  erector_spinae:     'Erect Spin',
  peroneus_longus:    'Peroneus',
};

const JOINT_COLORS = {
  LeftAnkle:    '#00D4FF', RightAnkle:    '#00D4FF',
  LeftKnee:     '#00FFF0', RightKnee:     '#00FFF0',
  LeftHip:      '#FACC15', RightHip:      '#FACC15',
  LumbarSpine:  '#FF2D78', ThoracicSpine: '#FF6B6B',
  LeftShoulder: '#9B59B6', RightShoulder: '#9B59B6',
};

// Which joints to analyze per phase, and which muscles matter most there
const PHASE_ANALYSIS = {
  loading_response: {
    label: 'Loading Response',
    focus: 'Initial ground contact — shock absorption failure',
    camera: { target: new THREE.Vector3(0, 0.45, 0), pos: new THREE.Vector3(0.4, 0.8, 2.4) },
    joints: [
      { key:'LeftAnkle',  title:'Ankle Complex',    muscles:['tibialis_anterior','gastrocnemius','tibialis_posterior'] },
      { key:'LeftKnee',   title:'Knee Shock Abs.',  muscles:['vastus_lateralis','vastus_medialis','hamstrings'] },
      { key:'LeftHip',    title:'Hip Stabilizers',  muscles:['gluteus_maximus','gluteus_medius'] },
      { key:'LumbarSpine',title:'Lumbar Spine',     muscles:['erector_spinae'] },
    ],
  },
  mid_stance: {
    label: 'Mid Stance',
    focus: 'Single-leg support — pelvic stability peak',
    camera: { target: new THREE.Vector3(0, 0.90, 0), pos: new THREE.Vector3(0.5, 1.2, 2.2) },
    joints: [
      { key:'LeftHip',    title:'Hip Stabilizers',  muscles:['gluteus_medius','gluteus_minimus','tensor_fascia_latae'] },
      { key:'LumbarSpine',title:'Lumbar Spine',     muscles:['erector_spinae'] },
      { key:'LeftAnkle',  title:'Ankle Arch',       muscles:['soleus','tibialis_posterior','gastrocnemius'] },
      { key:'LeftKnee',   title:'Knee',             muscles:['vastus_medialis','vastus_lateralis'] },
    ],
  },
  terminal_stance: {
    label: 'Terminal Stance',
    focus: 'Hip extension + propulsion setup',
    camera: { target: new THREE.Vector3(0, 0.70, 0), pos: new THREE.Vector3(0.4, 1.0, 2.2) },
    joints: [
      { key:'LeftHip',    title:'Hip Extension',   muscles:['gluteus_maximus','iliopsoas','hamstrings'] },
      { key:'LeftAnkle',  title:'Push-off',         muscles:['gastrocnemius','soleus','tibialis_posterior'] },
      { key:'LumbarSpine',title:'Lumbar',           muscles:['erector_spinae'] },
    ],
  },
  pre_swing: {
    label: 'Pre-Swing',
    focus: 'Toe-off — hip flexion initiation',
    camera: { target: new THREE.Vector3(0, 0.75, 0), pos: new THREE.Vector3(-0.2, 1.1, 2.3) },
    joints: [
      { key:'LeftHip',   title:'Hip Flexors',   muscles:['iliopsoas','rectus_femoris','tensor_fascia_latae'] },
      { key:'LeftKnee',  title:'Knee Flexion',  muscles:['hamstrings','gastrocnemius'] },
      { key:'LeftAnkle', title:'Ankle',         muscles:['soleus','gastrocnemius'] },
    ],
  },
  initial_swing: {
    label: 'Initial Swing',
    focus: 'Limb advancement — foot clearance begins',
    camera: { target: new THREE.Vector3(0, 0.55, 0), pos: new THREE.Vector3(0.3, 0.9, 2.4) },
    joints: [
      { key:'LeftKnee',  title:'Knee Flexion',   muscles:['hamstrings','rectus_femoris'] },
      { key:'LeftAnkle', title:'Dorsiflexion',   muscles:['tibialis_anterior'] },
      { key:'LeftHip',   title:'Hip Flexion',    muscles:['iliopsoas','rectus_femoris'] },
    ],
  },
  mid_swing: {
    label: 'Mid Swing',
    focus: 'Maximum clearance — foot must clear ground',
    camera: { target: new THREE.Vector3(0, 0.55, 0), pos: new THREE.Vector3(0.2, 0.85, 2.4) },
    joints: [
      { key:'LeftAnkle', title:'Foot Clearance',  muscles:['tibialis_anterior'] },
      { key:'LeftKnee',  title:'Knee',            muscles:['hamstrings','rectus_femoris'] },
      { key:'LeftHip',   title:'Hip',             muscles:['iliopsoas'] },
    ],
  },
  terminal_swing: {
    label: 'Terminal Swing',
    focus: 'Limb deceleration — landing preparation',
    camera: { target: new THREE.Vector3(0, 0.75, 0), pos: new THREE.Vector3(0.3, 1.05, 2.3) },
    joints: [
      { key:'LeftKnee',  title:'Knee Decelerators', muscles:['hamstrings','vastus_lateralis','vastus_medialis'] },
      { key:'LeftHip',   title:'Hip Decelerators',  muscles:['gluteus_maximus','hamstrings'] },
      { key:'LeftAnkle', title:'Foot Placement',    muscles:['tibialis_anterior'] },
    ],
  },
};

export function findWorstPhase(deficits) {
  if (!deficits?.length) return 'mid_stance';
  const scores = {};
  GAIT_PHASES.forEach(p => { scores[p] = 0; });
  const weight = { severe: 3, moderate: 2, mild: 1 };
  deficits.forEach(d => {
    const w = weight[d.activeSeverity] ?? 1;
    (d.phases ?? []).forEach(p => { scores[p] = (scores[p] ?? 0) + w; });
  });
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mid_stance';
}

export class PhaseAnalysisOverlay {
  constructor(container, skeleton, bodyCanvas) {
    this.container  = container;   // canvas wrapper div (position:relative)
    this.skeleton   = skeleton;
    this.bodyCanvas = bodyCanvas;
    this._overlayEl = null;
    this._active    = false;
  }

  show(worstPhase, deficits, activation) {
    this.hide();
    this._active    = true;
    this._phase     = worstPhase;
    this._deficits  = deficits ?? [];
    this._activation = activation ?? {};
    this._build();

    // Zoom camera
    const info = PHASE_ANALYSIS[worstPhase];
    if (info?.camera) {
      this.bodyCanvas.controls.enabled = false;
      this.bodyCanvas.animateCameraTo(info.camera.target, info.camera.pos, 900);
    }
  }

  hide() {
    this._active = false;
    this._closeExpandedCard();
    this._overlayEl?.remove();
    this._overlayEl = null;
    if (this.bodyCanvas?.controls) this.bodyCanvas.controls.enabled = true;
  }

  _build() {
    const info = PHASE_ANALYSIS[this._phase] ?? PHASE_ANALYSIS['mid_stance'];

    this._overlayEl = document.createElement('div');
    this._overlayEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20;overflow:hidden;';
    this.container.appendChild(this._overlayEl);

    // Dark vignette to focus attention on skeleton
    const vignette = document.createElement('div');
    vignette.style.cssText = `
      position:absolute;inset:0;
      background:radial-gradient(ellipse at center, transparent 35%, rgba(3,8,16,0.65) 100%);
      pointer-events:none;z-index:0;
    `;
    this._overlayEl.appendChild(vignette);

    // Phase header banner
    const banner = document.createElement('div');
    banner.style.cssText = `
      position:absolute;top:14px;left:50%;transform:translateX(-50%);
      background:rgba(5,13,26,0.92);
      border:0.5px solid rgba(0,212,255,0.45);
      border-radius:99px;padding:8px 24px;text-align:center;
      backdrop-filter:blur(16px);z-index:22;white-space:nowrap;
      box-shadow:0 0 24px rgba(0,212,255,0.12);
      opacity:0;transition:opacity 400ms ease;
    `;
    banner.innerHTML = `
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:rgba(0,212,255,0.5);margin-bottom:3px">
        ⚠ Worst Phase Detected
      </div>
      <div style="font-size:15px;font-weight:600;color:#00D4FF;letter-spacing:.02em">${info.label}</div>
      <div style="font-size:11px;color:rgba(200,240,255,0.55);margin-top:3px">${info.focus}</div>
    `;
    this._overlayEl.appendChild(banner);
    requestAnimationFrame(() => { banner.style.opacity = '1'; });

    // SVG for connector lines (behind cards)
    this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this._svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:20;';
    this._overlayEl.appendChild(this._svg);

    // Stagger cards
    info.joints.forEach((jInfo, idx) => {
      setTimeout(() => {
        if (!this._active) return;
        this._addCard(jInfo, idx, info.joints.length);
      }, 600 + idx * 480);
    });
  }

  _addCard(jInfo, idx, total) {
    const worldPos = this.skeleton.getJointWorldPos(jInfo.key);
    const screen   = this._worldToScreen(worldPos);
    const cw       = this.container.offsetWidth;
    const ch       = this.container.offsetHeight;

    const CARD_W   = 230;
    const CARD_H_APPROX = 196;
    // Distribute cards across BOTH sides instead of cramming on the side the
    // joint isn't on. Even indices → left, odd → right; per-side stack uses
    // the joint's screen-Y when possible to keep connector lines short.
    const onRight   = (idx % 2 === 1);
    const perSide   = Math.ceil(total / 2);
    const sideIdx   = Math.floor(idx / 2);
    const spacing   = Math.min(CARD_H_APPROX + 12, (ch - 80) / Math.max(perSide, 1));
    const cardY     = 64 + sideIdx * spacing;
    const cardX     = onRight ? cw - CARD_W - 12 : 12;

    // Card element — now clickable: click toggles a focused/expanded state
    // that raises the card above its siblings and reveals deeper detail.
    const card = document.createElement('div');
    card.className = 'nc-phase-card';
    card.dataset.jointKey = jInfo.key;
    card.style.cssText = `
      position:absolute;
      ${onRight ? `right:12px` : `left:12px`};
      top:${cardY}px;
      width:${CARD_W}px;
      background:rgba(4,10,22,0.97);
      border:0.5px solid ${JOINT_COLORS[jInfo.key] ?? 'rgba(0,212,255,0.3)'}66;
      border-radius:10px;
      padding:13px 15px;
      z-index:21;
      opacity:0;
      pointer-events:auto;
      cursor:pointer;
      transform:translateX(${onRight ? '18px' : '-18px'});
      transition:opacity 380ms ease, transform 380ms ease, box-shadow 280ms ease, border-color 280ms ease;
      backdrop-filter:blur(20px);
      box-shadow:0 4px 20px rgba(0,0,0,0.4),0 0 0 0.5px ${JOINT_COLORS[jInfo.key] ?? '#00D4FF'}22;
      font-size:12px;
    `;

    card.innerHTML = this._buildCardHTML(jInfo);
    this._overlayEl.appendChild(card);

    requestAnimationFrame(() => {
      card.style.opacity = '1';
      card.style.transform = 'translateX(0)';
    });

    // Click → expand modal with the full card content + every muscle (not the
    // top-3 subset). Click again on backdrop to close.
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openExpandedCard(jInfo);
    });
    // Hover lift for affordance
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = JOINT_COLORS[jInfo.key] ?? '#00D4FF';
      card.style.boxShadow = `0 8px 28px rgba(0,0,0,0.5), 0 0 0 1px ${JOINT_COLORS[jInfo.key] ?? '#00D4FF'}66, 0 0 22px ${JOINT_COLORS[jInfo.key] ?? '#00D4FF'}22`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = `${JOINT_COLORS[jInfo.key] ?? 'rgba(0,212,255,0.3)'}66`;
      card.style.boxShadow = `0 4px 20px rgba(0,0,0,0.4),0 0 0 0.5px ${JOINT_COLORS[jInfo.key] ?? '#00D4FF'}22`;
    });

    // SVG connector line: joint position → card left/right edge mid
    const lineX2 = onRight ? cardX : cardX + CARD_W;
    const lineY2 = cardY + 60;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const midX  = (screen.x + lineX2) / 2;
    path.setAttribute('d', `M${screen.x},${screen.y} C${midX},${screen.y} ${midX},${lineY2} ${lineX2},${lineY2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', JOINT_COLORS[jInfo.key] ?? '#00D4FF');
    path.setAttribute('stroke-width', '0.6');
    path.setAttribute('stroke-dasharray', '5 4');
    path.setAttribute('opacity', '0.4');
    this._svg.appendChild(path);

    // Pulsing dot at joint position
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', screen.x);
    dot.setAttribute('cy', screen.y);
    dot.setAttribute('r', '5');
    dot.setAttribute('fill', JOINT_COLORS[jInfo.key] ?? '#00D4FF');
    dot.setAttribute('opacity', '0.85');
    this._svg.appendChild(dot);

    // Outer ring pulse
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', screen.x);
    ring.setAttribute('cy', screen.y);
    ring.setAttribute('r', '9');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', JOINT_COLORS[jInfo.key] ?? '#00D4FF');
    ring.setAttribute('stroke-width', '1');
    ring.setAttribute('opacity', '0.4');
    this._svg.appendChild(ring);
  }

  _buildCardHTML(jInfo) {
    const phase   = this._phase;
    const muscles = jInfo.muscles.slice(0, 3);
    const color   = JOINT_COLORS[jInfo.key] ?? '#00D4FF';

    const muscleRows = muscles.map(mKey => {
      const label  = MUSCLE_LABELS[mKey] ?? mKey;
      const norm   = this._activation[mKey]?.[phase]?.normative ?? 0;
      const actual = this._activation[mKey]?.[phase]?.actual ?? norm;
      const delta  = actual - norm;
      const isLow  = delta < -8;
      const isHigh = delta > 10;
      const barColor = isLow ? '#FF2D78' : isHigh ? '#FACC15' : '#00FFF0';
      const tag    = isLow ? `<span style="color:#FF2D78;font-size:9px">↓WEAK</span>`
                   : isHigh ? `<span style="color:#FACC15;font-size:9px">↑OVER</span>` : '';

      return `
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:11px;color:rgba(210,240,255,0.85)">${label} ${tag}</span>
            <span style="font-size:11px;font-weight:600;color:${barColor}">${actual}%</span>
          </div>
          <div style="position:relative;height:5px;background:rgba(0,212,255,0.08);border-radius:3px">
            <div style="position:absolute;height:100%;width:${norm}%;max-width:100%;background:rgba(0,212,255,0.2);border-radius:3px"></div>
            <div style="position:absolute;height:100%;width:${actual}%;max-width:100%;background:${barColor};border-radius:3px;opacity:0.9"></div>
          </div>
          <div style="font-size:10px;color:rgba(120,180,210,0.5);margin-top:2px">norm ${norm}%</div>
        </div>
      `;
    }).join('');

    const comps = this._deficits
      .filter(d => d.phases?.includes(phase))
      .flatMap(d => d.compensations ?? [])
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 2);

    const risks = this._deficits
      .filter(d => d.phases?.includes(phase))
      .flatMap(d => d.future_risk ?? [])
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 2);

    return `
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
        <div style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;box-shadow:0 0 6px ${color}"></div>
        <div>
          <div style="font-size:12px;font-weight:600;color:rgba(210,245,255,0.95);line-height:1.2">${jInfo.title}</div>
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:rgba(0,212,255,0.4)">${phase.replace(/_/g,' ')}</div>
        </div>
      </div>

      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,212,255,0.4);margin-bottom:6px">
        Muscle Activation
      </div>
      ${muscleRows}

      ${comps.length ? `
        <div style="margin-top:8px;padding-top:7px;border-top:0.5px solid rgba(255,140,0,0.15)">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,140,0,0.55);margin-bottom:4px">⚡ Compensation</div>
          ${comps.map(c => `<div style="font-size:10px;color:rgba(255,200,100,0.72);padding:1px 0;line-height:1.4">→ ${c}</div>`).join('')}
        </div>
      ` : ''}

      ${risks.length ? `
        <div style="margin-top:7px;padding-top:7px;border-top:0.5px solid rgba(255,45,120,0.12)">
          <div style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,45,120,0.5);margin-bottom:4px">💥 Pain Risk</div>
          ${risks.map(r => `<div style="font-size:10px;color:rgba(255,110,110,0.68);padding:1px 0;line-height:1.4">→ ${r}</div>`).join('')}
        </div>
      ` : ''}
    `;
  }

  _worldToScreen(worldPos) {
    const canvas = this.bodyCanvas.renderer.domElement;
    const v = worldPos.clone().project(this.bodyCanvas.camera);
    return {
      x: (v.x + 1) / 2 * canvas.offsetWidth,
      y: -(v.y - 1) / 2 * canvas.offsetHeight,
    };
  }

  // Click-to-expand modal: shows the full breakdown for the selected joint
  // (all muscles, both compensations and risks unclipped). Backdrop closes it.
  _openExpandedCard(jInfo) {
    this._closeExpandedCard();
    const phase  = this._phase;
    const color  = JOINT_COLORS[jInfo.key] ?? '#00D4FF';
    const allMuscles = jInfo.muscles;

    const muscleRows = allMuscles.map(mKey => {
      const label  = MUSCLE_LABELS[mKey] ?? mKey;
      const norm   = this._activation[mKey]?.[phase]?.normative ?? 0;
      const actual = this._activation[mKey]?.[phase]?.actual    ?? norm;
      const delta  = actual - norm;
      const isLow  = delta < -8;
      const isHigh = delta > 10;
      const barColor = isLow ? '#FF2D78' : isHigh ? '#FACC15' : '#00FFF0';
      const tag    = isLow ? 'WEAK' : isHigh ? 'OVER' : 'OK';
      return `
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <span style="font-size:14px;color:rgba(220,240,255,0.95);font-weight:500">${label}</span>
            <span style="font-size:12px;font-weight:600;color:${barColor};letter-spacing:.04em">${tag} · ${actual}%</span>
          </div>
          <div style="position:relative;height:8px;background:rgba(0,212,255,0.08);border-radius:4px">
            <div style="position:absolute;height:100%;width:${norm}%;max-width:100%;background:rgba(0,212,255,0.22);border-radius:4px"></div>
            <div style="position:absolute;height:100%;width:${actual}%;max-width:100%;background:${barColor};border-radius:4px;opacity:0.92"></div>
          </div>
          <div style="font-size:11px;color:rgba(120,180,210,0.6);margin-top:4px">normative ${norm}% · Δ ${delta > 0 ? '+' : ''}${delta}%</div>
        </div>
      `;
    }).join('');

    const comps = this._deficits.filter(d => d.phases?.includes(phase))
      .flatMap(d => d.compensations ?? [])
      .filter((v, i, a) => a.indexOf(v) === i);
    const risks = this._deficits.filter(d => d.phases?.includes(phase))
      .flatMap(d => d.future_risk ?? [])
      .filter((v, i, a) => a.indexOf(v) === i);

    const backdrop = document.createElement('div');
    backdrop.id = 'nc-phase-card-modal';
    backdrop.style.cssText = `
      position:fixed; inset:0; z-index:9999;
      background:rgba(3,7,14,0.78);
      backdrop-filter:blur(6px);
      display:flex; align-items:center; justify-content:center;
      animation: neu-fade-in 220ms var(--nc-ease, ease) both;
      pointer-events:auto;
    `;
    const panel = document.createElement('div');
    panel.style.cssText = `
      max-width:520px; width:92%;
      max-height:85vh; overflow-y:auto;
      background:rgba(4,10,22,0.98);
      border:1px solid ${color}66;
      border-radius:14px;
      padding:24px 26px;
      box-shadow:0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px ${color}33, 0 0 60px ${color}22;
      animation: neu-scale-in 280ms var(--nc-ease-spring, ease) both;
      font-family:'Inter',system-ui,sans-serif;
    `;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:12px;height:12px;border-radius:50%;background:${color};box-shadow:0 0 10px ${color}"></div>
          <div>
            <div style="font-family:'Space Grotesk','Inter',sans-serif;font-size:20px;font-weight:600;color:rgba(220,240,255,0.97);letter-spacing:-0.01em">${jInfo.title}</div>
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(120,180,210,0.6);margin-top:2px">${phase.replace(/_/g,' ')}</div>
          </div>
        </div>
        <button type="button" aria-label="Close" style="
          width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,0.12);
          background:rgba(255,255,255,0.04);color:rgba(220,240,255,0.7);font-size:18px;cursor:pointer;
        ">✕</button>
      </div>

      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:rgba(120,180,210,0.55);margin-bottom:12px">
        Muscle Activation — all measured fibres
      </div>
      ${muscleRows}

      ${comps.length ? `
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(255,140,0,0.18)">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,140,0,0.65);margin-bottom:8px">⚡ Compensations</div>
          ${comps.map(c => `<div style="font-size:13px;color:rgba(255,200,100,0.82);padding:3px 0;line-height:1.55">→ ${c}</div>`).join('')}
        </div>` : ''}

      ${risks.length ? `
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,45,120,0.18)">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,45,120,0.65);margin-bottom:8px">💥 Future-risk pain pattern</div>
          ${risks.map(r => `<div style="font-size:13px;color:rgba(255,110,110,0.82);padding:3px 0;line-height:1.55">→ ${r}</div>`).join('')}
        </div>` : ''}
    `;

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this._closeExpandedCard(); });
    panel.querySelector('button[aria-label="Close"]').addEventListener('click', () => this._closeExpandedCard());
    this._escHandler = (e) => { if (e.key === 'Escape') this._closeExpandedCard(); };
    document.addEventListener('keydown', this._escHandler);
    this._modalEl = backdrop;
  }

  _closeExpandedCard() {
    if (this._modalEl) { this._modalEl.remove(); this._modalEl = null; }
    if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
  }
}
