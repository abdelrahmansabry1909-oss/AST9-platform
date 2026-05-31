/* ═══════════════════════════════════════════════════════════════
   NeuCore — Notifications Service
   Single inbox for every cross-module event: alt-exercise requests,
   RPM approvals, case-study approvals, subscription expiring/grace.

   Public surface (window.Notifications):

   Data
     list({ unreadOnly, limit })        → rows[]
     markRead(id)                       → row
     markAllRead()                      → void
     archive(id)                        → void
     remove(id)                         → void
     unreadCount()                      → number (cached)
     ensureSubscriptionForCurrent()     → calls RPC (no-op for non-clients)

   Realtime
     subscribe(callback)                → unsubscribe()
                                          fires on every change for the
                                          current user; falls back to a
                                          60s poll if realtime not wired

   UI
     mountInbox(host)                   → renders the inbox panel
     bindBell(el)                       → wires badge + click → openSection

   Deep-linking
     row.link_section + row.link_params drives Dashboard.showSection(...)
     and stashes params on window._notifParams for the target loader.
═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ── State ───────────────────────────────────────────────────────
  let _unread     = 0;
  let _listeners  = new Set();   // callbacks for any list change
  let _channel    = null;        // Supabase realtime channel
  let _pollTimer  = null;

  // ── Helpers ─────────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function _userId() { return Auth.getUser?.()?.id || null; }

  function _emit() { _listeners.forEach((cb) => { try { cb(); } catch {} }); }

  function _ago(iso) {
    if (!iso) return '';
    const sec = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (sec < 60)    return sec + 's';
    const min = Math.round(sec / 60);
    if (min < 60)    return min + 'm';
    const hr = Math.round(min / 60);
    if (hr < 24)     return hr + 'h';
    const d  = Math.round(hr / 24);
    if (d  < 30)    return d  + 'd';
    return new Date(iso).toLocaleDateString();
  }

  const TYPE_ICON = {
    alt_exercise_request:   '⇄',
    alt_exercise_decided:   '✓',
    rpm_approval_pending:   '⚑',
    rpm_approval_decided:   '✓',
    case_approval_pending:  '◧',
    case_approval_decided:  '✓',
    subscription_expiring:  '⏳',
    subscription_grace:     '⚠',
    subscription_expired:   '⏸',
  };
  const SEV_COLOR = {
    info:     'rgba(20,184,166,.9)',
    warning:  'rgba(245,158,11,.95)',
    critical: 'rgba(244,63,94,.95)',
  };

  // ── DATA LAYER ──────────────────────────────────────────────────
  async function list({ unreadOnly = false, limit = 50 } = {}) {
    const uid = _userId(); if (!uid) return [];
    let q = sb.from('notifications').select('*')
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (unreadOnly) q = q.is('read_at', null);
    const { data, error } = await q;
    if (error) { console.warn('[notif] list:', error.message); return []; }
    return data || [];
  }

  async function unreadCount() {
    const uid = _userId(); if (!uid) return 0;
    const { count } = await sb.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('archived', false).is('read_at', null);
    _unread = count || 0;
    _emit();
    return _unread;
  }

  async function markRead(id) {
    if (!id) return;
    const { data } = await sb.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id).select('*').single();
    await unreadCount();
    return data;
  }

  async function markAllRead() {
    const uid = _userId(); if (!uid) return;
    await sb.from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', uid).is('read_at', null);
    await unreadCount();
  }

  async function archive(id) {
    if (!id) return;
    await sb.from('notifications').update({ archived: true }).eq('id', id);
    await unreadCount();
  }

  async function remove(id) {
    if (!id) return;
    await sb.from('notifications').delete().eq('id', id);
    await unreadCount();
  }

  async function ensureSubscriptionForCurrent() {
    if (!Auth.isAdminOrCoach?.() && Auth.getRole?.() !== 'client') return;
    const uid = _userId(); if (!uid) return;
    try { await sb.rpc('ensure_subscription_notifications', { p_client_id: uid }); }
    catch (e) { console.warn('[notif] ensureSubscription:', e?.message); }
  }

  // ── REALTIME ────────────────────────────────────────────────────
  function subscribe(callback) {
    if (typeof callback === 'function') _listeners.add(callback);
    _ensureChannel();
    _ensurePoll();
    return () => {
      if (callback) _listeners.delete(callback);
      if (!_listeners.size) _teardown();
    };
  }

  function _ensureChannel() {
    if (_channel) return;
    const uid = _userId(); if (!uid) return;
    try {
      _channel = sb.channel('notifications:' + uid)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'notifications',
          filter: 'recipient_id=eq.' + uid,
        }, () => { unreadCount(); _emit(); })
        .subscribe();
    } catch (e) {
      // Realtime not enabled or unavailable — polling will cover it.
      console.warn('[notif] realtime unavailable, polling instead:', e?.message);
    }
  }

  function _ensurePoll() {
    if (_pollTimer) return;
    _pollTimer = setInterval(() => { unreadCount(); }, 60_000);
  }

  function _teardown() {
    try { _channel?.unsubscribe?.(); } catch {}
    _channel = null;
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── UI — BELL + BADGE ───────────────────────────────────────────
  function bindBell(el) {
    if (!el) return;
    // Badge child
    let badge = el.querySelector('.notif-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'notif-badge';
      badge.style.cssText = `
        position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;
        padding:0 4px;border-radius:99px;background:#f43f5e;color:#fff;
        font-size:10px;font-weight:700;display:none;align-items:center;
        justify-content:center;line-height:1`;
      el.style.position = el.style.position || 'relative';
      el.appendChild(badge);
    }
    el.addEventListener('click', () => {
      if (typeof Dashboard !== 'undefined') Dashboard.showSection('notifications');
    });
    subscribe(() => {
      badge.textContent = _unread > 99 ? '99+' : String(_unread);
      badge.style.display = _unread > 0 ? 'flex' : 'none';
    });
    unreadCount();
  }

  // ── UI — INBOX PANEL ────────────────────────────────────────────
  async function mountInbox(host) {
    if (!host) return;
    host.innerHTML = `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <span class="card-title">Inbox <span id="ni-count" style="font-size:11px;color:var(--text-tertiary);font-weight:400;margin-left:6px"></span></span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" id="ni-mark-all">Mark all read</button>
          </div>
        </div>
        <div id="ni-list" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>`;

    const refresh = async () => {
      const rows = await list({ limit: 100 });
      _render(host, rows);
    };
    host.querySelector('#ni-mark-all').onclick = async () => {
      await markAllRead();
      refresh();
    };
    subscribe(refresh);
    refresh();
  }

  function _render(host, rows) {
    const listEl  = host.querySelector('#ni-list');
    const countEl = host.querySelector('#ni-count');
    countEl.textContent = `${rows.filter((r) => !r.read_at).length} unread / ${rows.length} total`;
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:32px">
        <span class="empty-icon">◌</span>
        <div class="empty-title">No notifications yet</div>
        <p class="empty-desc">Cross-module events (requests, approvals, subscription updates) land here.</p>
      </div>`;
      return;
    }
    listEl.innerHTML = rows.map(_renderRow).join('');
    listEl.querySelectorAll('[data-notif-row]').forEach((el) => {
      const id  = el.dataset.notifRow;
      const row = rows.find((r) => r.id === id);
      el.querySelector('[data-act="open"]').onclick = () => _openRow(row);
      el.querySelector('[data-act="archive"]').onclick = async (ev) => {
        ev.stopPropagation();
        await archive(id);
        el.remove();
      };
    });
  }

  function _renderRow(row) {
    const icon = TYPE_ICON[row.type] || '◆';
    const sev  = SEV_COLOR[row.severity] || SEV_COLOR.info;
    const unread = !row.read_at;
    return `
      <div data-notif-row="${esc(row.id)}"
           style="display:grid;grid-template-columns:32px 1fr auto;gap:12px;align-items:start;
                  padding:12px;border:1px solid var(--border-subtle);border-radius:10px;
                  background:${unread ? 'rgba(20,184,166,.04)' : 'transparent'};cursor:pointer"
           data-act="open">
        <div style="width:32px;height:32px;border-radius:8px;
                    background:rgba(255,255,255,.05);border:1px solid var(--border-subtle);
                    display:flex;align-items:center;justify-content:center;color:${sev};font-weight:700">
          ${esc(icon)}
        </div>
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
            ${unread ? '<span style="width:6px;height:6px;border-radius:50%;background:#14b8a6;flex-shrink:0"></span>' : ''}
            <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(row.title || '')}</div>
          </div>
          ${row.body ? `<div style="font-size:12px;color:var(--text-secondary);line-height:1.5">${esc(row.body)}</div>` : ''}
          <div style="font-size:11px;color:var(--text-tertiary);margin-top:4px">${esc(_ago(row.created_at))} ago · ${esc(row.type)}</div>
        </div>
        <button class="btn-icon" data-act="archive" title="Archive" style="font-size:14px">×</button>
      </div>`;
  }

  function _openRow(row) {
    if (!row) return;
    markRead(row.id);
    if (row.link_section) {
      window._notifParams = row.link_params || {};
      if (typeof Dashboard !== 'undefined') Dashboard.showSection(row.link_section);
    }
  }

  // ── Public surface ──────────────────────────────────────────────
  window.Notifications = {
    list, unreadCount, markRead, markAllRead, archive, remove,
    ensureSubscriptionForCurrent,
    subscribe,
    mountInbox, bindBell,
  };
})();
