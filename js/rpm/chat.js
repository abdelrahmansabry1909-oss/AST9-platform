/* ═══════════════════════════════════════════════════════════════
   NeuCore RPM — Progressive Per-Phase Chat
   Phase 5D · Cite: workflow Phase 5 §5D
   Shared chat widget mounted by both graph-builder (coach) and
   graph-viewer (client). Phase-aware: each phase has its own thread.

   Public API (window.RPMChat):
     mount(hostEl, { graphId, phaseId })
        — renders thread + compose box into hostEl, shows last 3 by default
═══════════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  function _role() {
    try { return Auth.getRole?.() || 'client'; } catch { return 'client'; }
  }
  function _fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return d.toLocaleDateString();
  }

  async function mount(hostEl, { graphId, phaseId }) {
    if (!hostEl || !graphId) return;
    hostEl.dataset.expanded = hostEl.dataset.expanded || '0';

    let messages = [];
    try {
      messages = await RPMGraph.listMessages(graphId, phaseId);
    } catch (e) {
      console.warn('[RPMChat] load failed:', e);
      hostEl.innerHTML = `<div class="nc-chat-empty">Could not load messages.</div>`;
      return;
    }

    _renderThread(hostEl, { graphId, phaseId, messages });
  }

  function _renderThread(hostEl, ctx) {
    const { messages } = ctx;
    const expanded = hostEl.dataset.expanded === '1';
    const shown = expanded ? messages : messages.slice(-3);
    const hiddenCount = messages.length - shown.length;

    hostEl.innerHTML = `
      ${hiddenCount > 0 ? `<button class="nc-chat-toggle" data-chat-act="expand" style="margin-bottom:8px">↑ Show ${hiddenCount} earlier message${hiddenCount === 1 ? '' : 's'}</button>` : ''}
      <div class="nc-chat-thread">
        ${shown.length
          ? shown.map(_bubble).join('')
          : `<div class="nc-chat-empty">No messages yet. Leave a note for ${_role() === 'client' ? 'your coach' : 'the client'}.</div>`}
      </div>
      <div class="nc-chat-compose">
        <textarea class="nc-chat-input" rows="1" placeholder="Write a note…" data-chat-input></textarea>
        <button class="nc-chat-send" data-chat-act="send">Send</button>
      </div>
    `;

    // Expand
    hostEl.querySelector('[data-chat-act="expand"]')?.addEventListener('click', () => {
      hostEl.dataset.expanded = '1';
      _renderThread(hostEl, ctx);
    });

    // Send
    const input = hostEl.querySelector('[data-chat-input]');
    const sendBtn = hostEl.querySelector('[data-chat-act="send"]');
    const doSend = async () => {
      const body = (input?.value || '').trim();
      if (!body) return;
      sendBtn.disabled = true;
      try {
        const msg = await RPMGraph.postMessage(ctx.graphId, ctx.phaseId, body);
        ctx.messages.push(msg);
        input.value = '';
        hostEl.dataset.expanded = '1';
        _renderThread(hostEl, ctx);
        // Scroll thread to bottom
        const thread = hostEl.querySelector('.nc-chat-thread');
        if (thread) thread.scrollTop = thread.scrollHeight;
      } catch (e) {
        console.error('[RPMChat] send failed:', e);
        if (typeof Dashboard !== 'undefined') Dashboard.toast?.('Could not send message', 'error');
        sendBtn.disabled = false;
      }
    };
    sendBtn?.addEventListener('click', doSend);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });

    // Auto-scroll to latest on initial render
    const thread = hostEl.querySelector('.nc-chat-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function _bubble(m) {
    const role = m.author_role || 'client';
    return `
      <div class="nc-chat-msg ${role}">
        <div class="nc-chat-bubble">${escHtml(m.body)}</div>
        <div class="nc-chat-meta">${role[0].toUpperCase() + role.slice(1)} · ${_fmtTime(m.created_at)}</div>
      </div>`;
  }

  window.RPMChat = { mount };
})();
