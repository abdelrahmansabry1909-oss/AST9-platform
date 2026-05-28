/* ═══════════════════════════════════════════════════════════════
   NeuCore — Vanilla JS UI factory module
   Equivalent to <NeuButton/NeuCard/NeuInput/NeuSidebar> React components,
   built for this vanilla codebase. Each factory returns a real DOM node
   so you can:
       container.appendChild(NeuUI.button({ label: 'Save' }));

   Visual contract: each factory uses the .neu-* classes defined in
   css/neucore-design-system.css so they read identically to the landing
   page. Don't restyle inline — extend the CSS instead.

   Public API (window.NeuUI):
     button({ label, kind, size, icon, onClick, disabled, type, id, className })
     card({ eyebrow, title, body, glow, interactive, onClick, className })
     input({ label, name, type, value, placeholder, hint, error, onInput })
     textarea({ label, name, value, placeholder, hint, error, onInput })
     select({ label, name, options[], value, onChange })
     sidebarItem({ label, icon, active, onClick })
     spinner({ size })
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── Internals ─────────────────────────────────────────────
  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  const cx = (...parts) => parts.filter(Boolean).join(' ');

  // ── Button ────────────────────────────────────────────────
  // kind: 'primary' (default) | 'ghost' | 'gold' | 'danger'
  // size: 'sm' | 'md' (default) | 'lg'
  function button({
    label = '',
    kind = 'primary',
    size = 'md',
    icon = null,
    onClick = null,
    disabled = false,
    type = 'button',
    id = null,
    className = '',
  } = {}) {
    const sizeCls = size === 'sm' ? 'neu-btn--sm' : (size === 'lg' ? 'neu-btn--lg' : '');
    const btn = h('button', {
      type, id, disabled,
      className: cx('neu-btn', `neu-btn--${kind}`, sizeCls, className),
      onClick,
    });
    if (icon) btn.appendChild(h('span', { class: 'neu-btn-icon', html: icon }));
    if (label) btn.appendChild(document.createTextNode(label));
    return btn;
  }

  // Swap a button into loading state without rebuilding it.
  function setButtonLoading(btn, loading = true, loadingLabel = null) {
    if (!btn) return;
    if (loading) {
      btn.dataset._origHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = `<span class="neu-spinner"></span> ${loadingLabel || 'Working…'}`;
    } else if (btn.dataset._origHTML != null) {
      btn.innerHTML = btn.dataset._origHTML;
      delete btn.dataset._origHTML;
      btn.disabled = false;
    } else {
      btn.disabled = false;
    }
  }

  // ── Card ──────────────────────────────────────────────────
  function card({
    eyebrow = '',
    title = '',
    body = '',
    glow = false,
    interactive = false,
    onClick = null,
    className = '',
  } = {}) {
    const node = h('div', {
      className: cx('neu-card', glow && 'neu-card--glow', interactive && 'neu-card--interactive', className),
      onClick: interactive ? onClick : null,
    });
    if (eyebrow) node.appendChild(h('div', { class: 'neu-card-eyebrow' }, eyebrow));
    if (title)   node.appendChild(h('div', { class: 'neu-card-title'   }, title));
    if (body) {
      const b = h('div', { class: 'neu-card-body' });
      if (typeof body === 'string') b.innerHTML = body;
      else b.appendChild(body);
      node.appendChild(b);
    }
    return node;
  }

  // ── Inputs ────────────────────────────────────────────────
  function _wrapField({ label, hint, error, control }) {
    const wrap = h('div', { class: 'neu-field' });
    if (label) wrap.appendChild(h('label', { class: 'neu-label' }, label));
    wrap.appendChild(control);
    if (hint)  wrap.appendChild(h('div', { class: 'neu-field-hint'  }, hint));
    if (error) wrap.appendChild(h('div', { class: 'neu-field-error' }, error));
    return wrap;
  }

  function input({ label, name, type = 'text', value = '', placeholder = '', hint, error, onInput, id } = {}) {
    const ctl = h('input', {
      type, name, id: id || name, value, placeholder,
      className: cx('neu-input', error && 'neu-input--error'),
      onInput,
    });
    return _wrapField({ label, hint, error, control: ctl });
  }

  function textarea({ label, name, value = '', placeholder = '', hint, error, onInput, id } = {}) {
    const ctl = h('textarea', {
      name, id: id || name, placeholder,
      className: cx('neu-textarea', error && 'neu-input--error'),
      onInput,
    });
    ctl.value = value;
    return _wrapField({ label, hint, error, control: ctl });
  }

  function select({ label, name, options = [], value = '', hint, error, onChange, id } = {}) {
    const ctl = h('select', {
      name, id: id || name,
      className: cx('neu-select', error && 'neu-input--error'),
      onChange,
    });
    options.forEach((opt) => {
      const o = typeof opt === 'object' ? opt : { value: opt, label: opt };
      const node = h('option', { value: o.value }, o.label);
      if (o.value === value) node.selected = true;
      ctl.appendChild(node);
    });
    return _wrapField({ label, hint, error, control: ctl });
  }

  // ── Sidebar item ──────────────────────────────────────────
  function sidebarItem({ label, icon = '', active = false, onClick = null, id = null } = {}) {
    const node = h('div', {
      id,
      className: cx('neu-sidebar-item', active && 'is-active'),
      onClick,
      tabIndex: 0,
      role: 'button',
    });
    if (icon)  node.appendChild(h('span', { class: 'neu-sidebar-item-icon' }, icon));
    if (label) node.appendChild(h('span', { class: 'neu-sidebar-item-label' }, label));
    return node;
  }

  // ── Spinner ───────────────────────────────────────────────
  function spinner({ size = 'md' } = {}) {
    const sz = size === 'sm' ? '10px' : (size === 'lg' ? '20px' : '14px');
    return h('span', { class: 'neu-spinner', style: { width: sz, height: sz } });
  }

  // ── Animation helper — apply an entrance class with optional stagger ──
  function animateIn(rootOrSelector, animClass = 'neu-anim-fade-up') {
    const root = typeof rootOrSelector === 'string'
      ? document.querySelector(rootOrSelector) : rootOrSelector;
    if (!root) return;
    root.classList.add('neu-stagger');
    Array.from(root.children).forEach((c) => c.classList.add(animClass));
  }

  // ── Expose ────────────────────────────────────────────────
  window.NeuUI = {
    button, setButtonLoading,
    card,
    input, textarea, select,
    sidebarItem, spinner,
    animateIn,
    _h: h,
  };
})();
