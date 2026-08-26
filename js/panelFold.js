// ═══════════════════════════════════════════════════════════════
//  js/panelFold.js
//  Folds a rendered analysis panel down to its own header.
//
//  Running a movement analysis used to drop four full-height reports onto the
//  Generate page at once. This turns each panel's EXISTING header into the fold
//  control — no second bar above it, no restyling — so the page opens as a short
//  list of headlines and the coach expands the one they want.
//
//  Collapsing deliberately never sets `display` on an element the app already
//  styles. Every stuck-visible regression this codebase has had (PR #105,
//  PR #108, the 2026-08-24 service-lane leak) came from two `display` rules
//  fighting over one element. The closed state hides `.nc-fold-body` instead —
//  a wrapper this feature creates and nothing else in the app styles.
// ═══════════════════════════════════════════════════════════════

const PanelFold = (() => {

  const COLLAPSED = 'nc-fold-collapsed';
  const BODY      = 'nc-fold-body';
  const CHEVRON   = 'nc-fold-chevron';

  let bodyIdSeq = 0;

  // config.headerSelector — the header to hang the chevron on.
  // config.regionSelector — element that carries the collapsed class; defaults
  //                         to the header's parent.
  // config.bodyMode       — 'wrap' moves everything after the header into an
  //                         .nc-fold-body div. 'css' is for a header whose
  //                         siblings are grid items (the simulation page):
  //                         wrapping them would collapse the grid, so the
  //                         stylesheet hides them by name instead.
  function attach(panel, config) {
    if (!panel) return null;

    const header = panel.querySelector(config.headerSelector);
    if (!header) return null;

    const region = config.regionSelector
      ? panel.querySelector(config.regionSelector)
      : header.parentElement;
    if (!region) return null;

    // Renderers rewrite innerHTML on every analysis run, so a fold is normally
    // built fresh. Re-attaching to a panel that was not re-rendered must not
    // stack a second chevron.
    if (header.querySelector(`:scope > .${CHEVRON}`)) return region;

    const bodyId = config.bodyMode === 'wrap' ? _wrapAfter(header) : null;

    region.classList.add(COLLAPSED);
    header.appendChild(_buildChevron(region, bodyId, _titleOf(header)));
    return region;
  }

  function _wrapAfter(header) {
    const body = document.createElement('div');
    body.className = BODY;
    body.id = `nc-fold-body-${++bodyIdSeq}`;
    while (header.nextSibling) body.appendChild(header.nextSibling);
    header.parentElement.appendChild(body);
    return body.id;
  }

  // The panels name themselves in their own header; reusing that text keeps the
  // screen-reader label in step with whatever the renderer wrote.
  function _titleOf(header) {
    const title = header.querySelector('.card-title, .gait-title');
    return title ? title.textContent.trim() : 'section';
  }

  function _buildChevron(region, bodyId, title) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = CHEVRON;
    if (bodyId) btn.setAttribute('aria-controls', bodyId);
    btn.innerHTML = '<span aria-hidden="true">&#9662;</span>';
    _describe(btn, true, title);
    btn.addEventListener('click', () => _toggle(region, btn, title));
    return btn;
  }

  function _toggle(region, btn, title) {
    const collapsed = region.classList.toggle(COLLAPSED);
    _describe(btn, collapsed, title);

    // The 3D viewport sizes its canvas from the container. While the fold is
    // shut that container has no box, so the canvas keeps whatever dimensions
    // it was built with. BodyCanvas already re-measures on window resize —
    // reuse that rather than reaching into the simulation from here.
    if (!collapsed) window.dispatchEvent(new Event('resize'));
  }

  function _describe(btn, collapsed, title) {
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title}`);
  }

  return { attach };

})();

window.PanelFold = PanelFold;
