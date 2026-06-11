// src/neucore/story/ZoneStage.js
// E3 — glass restage of the Objective assessment (ASSESSMENT_STORYTELLING_ARCHITECTURE.md §11).
//
// Presentation ONLY. The existing assessment cards are MOVED (never rebuilt)
// into per-zone glass stages keyed by their data-zone attribute, so every
// field keeps its id, its ObjectiveSync/ScoringEngine listeners, and its save
// behavior byte-for-byte. If this module never runs (ESM failure, missing
// grid), the classic two-column wall renders untouched — that is the fallback.
//
// Works standalone as an accordion; ZoneDirector (camera/rail) connects later
// via connect() and the shared JointBus 'zone:change' events.
import { ZONES } from './zones.js';
import { bus } from '../core/JointBus.js';

// Completion counts answerable controls only: checkboxes are pain *flags*
// (unchecked is a valid clinical answer) and free-text notes are optional.
const COUNTABLE = (el) =>
  el.id && el.type !== 'checkbox' && !el.id.endsWith('-notes');

export class ZoneStage {
  constructor({ grid }) {
    this.grid = grid;
    this.director = null;
    this.stages = new Map();       // zone key → { root, body, header, bar, count }
    this._done  = {};              // zone key → boolean (pushed to chips on connect)
    this._raf   = null;

    this._build();
    this._bindProgress();
    bus.on('zone:change', ({ key }) => (key ? this._expand(key, false) : this._collapseAll()));
    this.expand(ZONES[0].key);     // "Begin at the ground" — disclosure only, no camera
    this.refreshAll();
  }

  // ZoneDirector mounts after the skeleton loads; sync chip completion states.
  connect(director) {
    this.director = director;
    Object.entries(this._done).forEach(([key, done]) => director.setZoneDone(key, done));
  }

  // ── restage ───────────────────────────────────────────────────────
  _build() {
    const frag = document.createDocumentFragment();

    // E4 — journey summary: the coach's sense of place in the body.
    this.journey = document.createElement('div');
    this.journey.className = 'zone-journey';
    this.journey.innerHTML = `
      <span class="zone-journey-label">Objective assessment</span>
      <span class="zone-journey-dots">${ZONES.map((z) =>
        `<i data-zone-dot="${z.key}" title="${z.label}"></i>`).join('')}</span>
      <span class="zone-journey-count"></span>`;
    frag.appendChild(this.journey);

    ZONES.forEach((zone) => {
      const cards = [...this.grid.querySelectorAll(`.card[data-zone="${zone.key}"]`)];
      if (!cards.length) return;

      const root = document.createElement('section');
      root.className = 'zone-stage collapsed';
      root.dataset.zone = zone.key;

      const bodyId = `zone-stage-body-${zone.key}`;
      root.innerHTML = `
        <button type="button" class="zone-stage-head" aria-expanded="false" aria-controls="${bodyId}">
          <span class="zone-stage-num">${zone.ordinal}</span>
          <span class="zone-stage-titles">
            <span class="zone-stage-label">${zone.label}</span>
            <span class="zone-stage-story">${zone.story}</span>
          </span>
          <span class="zone-stage-meta">
            <span class="zone-stage-count"></span>
            <span class="zone-stage-bar"><i></i></span>
            <span class="zone-stage-chev" aria-hidden="true">⌄</span>
          </span>
        </button>
        <div class="zone-stage-body" id="${bodyId}"></div>`;

      const body = root.querySelector('.zone-stage-body');
      cards.forEach((c) => body.appendChild(c));   // DOM move — listeners survive

      const next = ZONES[zone.ordinal];            // ordinal is 1-based → next zone
      if (next) {
        const cont = document.createElement('div');
        cont.className = 'zone-stage-continue';
        cont.innerHTML = `<button type="button" class="btn btn-ghost">Continue — ${next.label} →</button>`;
        cont.querySelector('button').addEventListener('click', () => this._go(next.key));
        body.appendChild(cont);
      }

      root.querySelector('.zone-stage-head').addEventListener('click', () => {
        root.classList.contains('collapsed') ? this._go(zone.key) : this._collapse(zone.key, true);
      });

      this.stages.set(zone.key, {
        root, body,
        header: root.querySelector('.zone-stage-head'),
        bar:    root.querySelector('.zone-stage-bar i'),
        count:  root.querySelector('.zone-stage-count'),
      });
      frag.appendChild(root);
    });

    this.grid.appendChild(frag);
    this.grid.classList.add('staged');             // 2-col wall → guided column
  }

  // Route through the director when it exists, so the camera/rail and the
  // stage stay one state machine; standalone otherwise.
  _go(key) {
    if (this.director) this.director.activate(key);
    else this.expand(key);
  }

  // ── disclosure ────────────────────────────────────────────────────
  expand(key) { this._expand(key, true); }

  _expand(key, scroll) {
    const stage = this.stages.get(key);
    if (!stage) return;
    this.stages.forEach((s, k) => { if (k !== key) this._collapse(k, false); });
    stage.root.classList.remove('collapsed');
    stage.header.setAttribute('aria-expanded', 'true');
    if (scroll) stage.root.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  _collapse(key, viaUser) {
    const stage = this.stages.get(key);
    if (!stage) return;
    stage.root.classList.add('collapsed');
    stage.header.setAttribute('aria-expanded', 'false');
    // Collapsing the active zone by hand = leaving it → camera back to overview.
    if (viaUser && this.director && this.director.activeKey === key) this.director.toggle(key);
  }

  _collapseAll() {
    this.stages.forEach((_, k) => this._collapse(k, false));
  }

  // ── completion (read-only derivation — no new storage, §12 pulled into E3) ──
  _bindProgress() {
    const queue = () => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this.refreshAll(); });
    };
    this.grid.addEventListener('input', queue);
    this.grid.addEventListener('change', queue);
  }

  refreshAll() {
    this.stages.forEach((stage, key) => {
      const fields = [...stage.body.querySelectorAll('input, select, textarea')].filter(COUNTABLE);
      const answered = fields.filter((el) => String(el.value ?? '').trim() !== '').length;
      const done = fields.length > 0 && answered === fields.length;
      stage.count.textContent = `${answered}/${fields.length}`;
      stage.bar.style.width = fields.length ? `${Math.round((answered / fields.length) * 100)}%` : '0';
      stage.root.classList.toggle('done', done);
      if (this._done[key] !== done) {
        this._done[key] = done;
        if (this.director) this.director.setZoneDone(key, done);
      }
    });
    this._refreshJourney();
  }

  _refreshJourney() {
    if (!this.journey) return;
    const doneCount = Object.values(this._done).filter(Boolean).length;
    this.journey.querySelector('.zone-journey-count').textContent =
      `${doneCount} of ${this.stages.size} zones complete`;
    this.journey.querySelectorAll('[data-zone-dot]').forEach((dot) => {
      dot.classList.toggle('done', !!this._done[dot.dataset.zoneDot]);
    });
  }
}
