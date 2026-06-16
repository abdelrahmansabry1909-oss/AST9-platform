// ═══════════════════════════════════════════════════════════════
//  js/communityUI.js
//  Workstream A: Community UI — DOM rendering
//  Renders: messaging thread, referrals, case shares,
//           client posts/comments, support groups, privacy panel
// ═══════════════════════════════════════════════════════════════

const CommunityUI = (() => {

  let _activeConvPartnerId = null;
  let _openPostId          = null;

  // ── Shared helpers ───────────────────────────────────────────
  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/'/g,'&#39;').replace(/"/g,'&quot;');
  }
  function _timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function _avatar(name, color = 'var(--lime)') {
    const ch = (name || '?')[0].toUpperCase();
    return `<div class="comm-avatar" style="--av-color:${color}">${ch}</div>`;
  }
  function _typeBadge(type) {
    const map = {
      progress:  { cls: 'badge-phase2', label: 'Progress' },
      question:  { cls: 'badge-phase1', label: 'Question' },
      support:   { cls: 'badge-phase3', label: 'Support' },
      milestone: { cls: 'badge-active', label: 'Milestone' },
    };
    const t = map[type] || { cls: '', label: type };
    return `<span class="badge ${t.cls}">${t.label}</span>`;
  }
  function _referralStatusBadge(status) {
    const map = {
      pending:   'badge-pending',
      accepted:  'badge-active',
      declined:  'badge-expired',
      completed: 'badge-phase3',
    };
    return `<span class="badge ${map[status] || ''}">${status}</span>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  MESSAGING
  // ═══════════════════════════════════════════════════════════

  async function renderMessaging() {
    const el = document.getElementById('comm-messaging');
    if (!el) return;

    el.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;

    const [conversations, coaches] = await Promise.all([
      Community.loadConversations(),
      Community.loadOtherCoaches(),
    ]);

    el.innerHTML = `
      <div class="comm-msg-layout">
        <div class="comm-conv-list" id="conv-list">
          <div class="comm-conv-header">
            <span>Conversations</span>
            <button class="btn btn-primary btn-xs" onclick="CommunityUI.openNewMsgModal()">+ New</button>
          </div>
          ${conversations.length ? conversations.map(c => _convItem(c)).join('') : `
            <div class="empty-state" style="padding:32px 16px">
              <span class="empty-icon">◉</span>
              <div class="empty-title">No conversations</div>
              <p class="empty-desc">Start a conversation with another coach.</p>
            </div>`}
        </div>
        <div class="comm-thread-panel" id="thread-panel">
          <div class="empty-state" style="padding:80px 32px">
            <span class="empty-icon" style="font-size:28px">◈</span>
            <div class="empty-title">Select a conversation</div>
            <p class="empty-desc">Choose a coach from the left to view messages.</p>
          </div>
        </div>
      </div>
      <div class="modal-overlay hidden" id="modal-new-msg">
        <div class="modal">
          <div class="modal-header"><h3>New Message</h3><button class="btn-icon" onclick="CommunityUI.closeNewMsgModal()">✕</button></div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Send to Coach</label>
              <select id="new-msg-coach" class="form-input">
                <option value="">— Select Coach —</option>
                ${coaches.map(c => `<option value="${c.id}">${_esc(c.full_name || c.email)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Message</label>
              <textarea id="new-msg-content" class="form-input" style="min-height:100px" placeholder="Write your message..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="CommunityUI.closeNewMsgModal()">Cancel</button>
            <button class="btn btn-primary" onclick="CommunityUI.sendNewMsg()">Send Message</button>
          </div>
        </div>
      </div>`;

    // Auto-open first conversation
    if (conversations.length) openConversation(conversations[0].partner.id, conversations[0].partner);
  }

  function _convItem(conv) {
    const uid = Auth.getUser()?.id;
    const p = conv.partner;
    const last = conv.lastMsg;
    const preview = last.content.length > 40 ? last.content.slice(0, 40) + '…' : last.content;
    const isMine = last.sender_id === uid;
    return `
      <div class="conv-item ${_activeConvPartnerId === p.id ? 'active' : ''}" onclick="CommunityUI.openConversation('${p.id}')">
        ${_avatar(p.full_name, 'var(--teal)')}
        <div class="conv-item-body">
          <div class="conv-item-name">${_esc(p.full_name || p.email)}</div>
          <div class="conv-item-preview">${isMine ? 'You: ' : ''}${_esc(preview)}</div>
        </div>
        <div class="conv-item-meta">
          <div class="conv-item-time">${_timeAgo(last.created_at)}</div>
          ${conv.unread > 0 ? `<div class="conv-unread-badge">${conv.unread}</div>` : ''}
        </div>
      </div>`;
  }

  async function openConversation(partnerId, partnerOverride = null) {
    _activeConvPartnerId = partnerId;

    // Highlight active conv
    document.querySelectorAll('.conv-item').forEach(el => {
      el.classList.toggle('active', el.onclick?.toString().includes(partnerId));
    });

    const panel = document.getElementById('thread-panel');
    if (!panel) return;
    panel.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;

    const messages = await Community.loadMessages(partnerId);
    window._refreshCommunityBadge?.();   // loadMessages marked incoming as read — re-sync the sidebar badge

    // Resolve partner name
    let partnerName = partnerOverride?.full_name || partnerOverride?.email || 'Coach';
    if (!partnerOverride) {
      const { data } = await sb.from('profiles').select('full_name,email').eq('id', partnerId).single();
      partnerName = data?.full_name || data?.email || 'Coach';
    }

    panel.innerHTML = `
      <div class="thread-header">
        ${_avatar(partnerName, 'var(--teal)')}
        <div class="thread-partner-name">${_esc(partnerName)}</div>
      </div>
      <div class="thread-messages" id="thread-messages">
        ${messages.length ? messages.map(m => _msgBubble(m)).join('') : `
          <div class="empty-state" style="padding:40px">
            <div class="empty-title">No messages yet</div>
            <p class="empty-desc">Send the first message.</p>
          </div>`}
      </div>
      <div class="thread-input-row">
        <textarea id="thread-msg-input" class="form-input thread-input" placeholder="Write a message…" rows="2"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();CommunityUI.sendThreadMsg('${partnerId}')}"></textarea>
        <button class="btn btn-primary" onclick="CommunityUI.sendThreadMsg('${partnerId}')">Send</button>
      </div>`;

    _scrollThread();

    // Real-time subscription. The thread is open and on screen, so mark each
    // arrival read and re-sync the sidebar badge (no phantom unread).
    Community.subscribeToMessages(partnerId, async msg => {
      const el = document.getElementById('thread-messages');
      if (el) { el.insertAdjacentHTML('beforeend', _msgBubble(msg)); _scrollThread(); }
      try { await Community.markMessageRead?.(msg.id); } catch (_) { /* badge re-syncs on next event */ }
      window._refreshCommunityBadge?.();
    });
  }

  function _msgBubble(m) {
    const uid = Auth.getUser()?.id;
    const mine = m.sender_id === uid;
    return `
      <div class="msg-bubble ${mine ? 'mine' : 'theirs'}">
        <div class="msg-text">${_esc(m.content)}</div>
        <div class="msg-time">${_timeAgo(m.created_at)}</div>
      </div>`;
  }

  function _scrollThread() {
    const el = document.getElementById('thread-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function sendThreadMsg(partnerId) {
    const input = document.getElementById('thread-msg-input');
    const content = input?.value?.trim();
    if (!content) return;

    try {
      const msg = await Community.sendMessage(partnerId, content);
      input.value = '';
      const el = document.getElementById('thread-messages');
      if (el) { el.insertAdjacentHTML('beforeend', _msgBubble(msg)); _scrollThread(); }
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  function openNewMsgModal() {
    document.getElementById('modal-new-msg')?.classList.remove('hidden');
  }

  function closeNewMsgModal() {
    document.getElementById('modal-new-msg')?.classList.add('hidden');
  }

  async function sendNewMsg() {
    const coachId = document.getElementById('new-msg-coach')?.value;
    const content = document.getElementById('new-msg-content')?.value?.trim();
    if (!coachId || !content) { Dashboard.toast('Select a coach and write a message', 'error'); return; }

    try {
      await Community.sendMessage(coachId, content);
      Dashboard.toast('Message sent!', 'success');
      closeNewMsgModal();
      renderMessaging();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  REFERRALS
  // ═══════════════════════════════════════════════════════════

  async function renderReferrals() {
    const el = document.getElementById('comm-referrals');
    if (!el) return;

    el.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;

    const [referrals, coaches] = await Promise.all([
      Community.loadReferrals(),
      Community.loadOtherCoaches(),
    ]);

    const uid = Auth.getUser()?.id;
    const incoming = referrals.filter(r => r.to_coach_id === uid);
    const outgoing = referrals.filter(r => r.from_coach_id === uid);

    el.innerHTML = `
      <div class="comm-section-header">
        <h3 class="comm-section-title">Client Referrals</h3>
        <button class="btn btn-primary btn-sm" onclick="CommunityUI.openReferralModal()">+ Send Referral</button>
      </div>

      <div class="grid-2" style="gap:var(--sp-5);margin-top:var(--sp-4)">
        <div class="card card-accent-lime">
          <div class="card-header"><span class="card-title">Incoming</span><span class="badge badge-phase1">${incoming.length}</span></div>
          ${incoming.length ? incoming.map(r => _referralCard(r, 'incoming')).join('') : `<div class="empty-state" style="padding:24px"><div class="empty-title">No incoming referrals</div></div>`}
        </div>
        <div class="card card-accent-teal">
          <div class="card-header"><span class="card-title">Sent</span><span class="badge badge-phase2">${outgoing.length}</span></div>
          ${outgoing.length ? outgoing.map(r => _referralCard(r, 'outgoing')).join('') : `<div class="empty-state" style="padding:24px"><div class="empty-title">No referrals sent</div></div>`}
        </div>
      </div>

      <div class="modal-overlay hidden" id="modal-send-referral">
        <div class="modal">
          <div class="modal-header"><h3>Send Client Referral</h3><button class="btn-icon" onclick="CommunityUI.closeReferralModal()">✕</button></div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Refer To Coach</label>
              <select id="ref-to-coach" class="form-input">
                <option value="">— Select Coach —</option>
                ${coaches.map(c => `<option value="${c.id}">${_esc(c.full_name || c.email)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Client</label>
              <select id="ref-client" class="form-input">
                <option value="">— Select Client —</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Notes / Reason</label>
              <textarea id="ref-notes" class="form-input" placeholder="Clinical reason for referral..." style="min-height:80px"></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="CommunityUI.closeReferralModal()">Cancel</button>
            <button class="btn btn-primary" onclick="CommunityUI.submitReferral()">Send Referral</button>
          </div>
        </div>
      </div>`;

    _populateReferralClientSelect();
  }

  function _referralCard(r, dir) {
    const other = dir === 'incoming' ? r.from_coach : r.to_coach;
    const client = r.client;
    return `
      <div class="referral-card">
        <div class="referral-card-top">
          <div>
            <div class="referral-card-name">${_esc(client?.full_name || client?.email || 'Unknown client')}</div>
            <div class="referral-card-meta">${dir === 'incoming' ? 'From' : 'To'}: ${_esc(other?.full_name || other?.email || '–')}</div>
          </div>
          ${_referralStatusBadge(r.status)}
        </div>
        ${r.notes ? `<div class="referral-card-notes">${_esc(r.notes)}</div>` : ''}
        <div class="referral-card-footer">
          <span>${_timeAgo(r.created_at)}</span>
          ${dir === 'incoming' && r.status === 'pending' ? `
            <div style="display:flex;gap:6px">
              <button class="btn btn-teal btn-xs" onclick="CommunityUI.respondRef('${r.id}','accepted')">Accept</button>
              <button class="btn btn-ghost btn-xs" onclick="CommunityUI.respondRef('${r.id}','declined')">Decline</button>
            </div>` : ''}
        </div>
      </div>`;
  }

  async function _populateReferralClientSelect() {
    const { data } = await sb.from('profiles').select('id,full_name,email')
      .eq('role','client').eq('assigned_coach', Auth.getUser()?.id || '').order('full_name');
    const sel = document.getElementById('ref-client');
    if (!sel) return;
    (data || []).forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.full_name || c.email;
      sel.appendChild(o);
    });
  }

  function openReferralModal() {
    document.getElementById('modal-send-referral')?.classList.remove('hidden');
  }

  function closeReferralModal() {
    document.getElementById('modal-send-referral')?.classList.add('hidden');
  }

  async function submitReferral() {
    const toCoachId = document.getElementById('ref-to-coach')?.value;
    const clientId  = document.getElementById('ref-client')?.value;
    const notes     = document.getElementById('ref-notes')?.value;
    if (!toCoachId || !clientId) { Dashboard.toast('Select coach and client', 'error'); return; }

    try {
      await Community.sendReferral(toCoachId, clientId, notes);
      Dashboard.toast('Referral sent!', 'success');
      closeReferralModal();
      renderReferrals();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function respondRef(referralId, status) {
    try {
      await Community.respondReferral(referralId, status);
      Dashboard.toast(`Referral ${status}`, 'success');
      renderReferrals();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CASE SHARES
  // ═══════════════════════════════════════════════════════════

  async function renderCaseShares() {
    const el = document.getElementById('comm-case-shares');
    if (!el) return;

    el.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;
    const shares = await Community.loadCaseShares();
    // CX0: case studies are coach-generated content. Clients browse read-only;
    // only coaches/admins see create actions.
    const canAuthor = (typeof Auth !== 'undefined' && Auth.isAdminOrCoach && Auth.isAdminOrCoach());

    el.innerHTML = `
      <div class="comm-section-header">
        <h3 class="comm-section-title">Case Study Board</h3>
        ${canAuthor ? `<button class="btn btn-primary btn-sm" onclick="CommunityUI.openCaseShareModal()">+ Share Case</button>` : ''}
      </div>
      <div class="case-share-grid">
        ${shares.length ? shares.map(s => _caseShareCard(s)).join('') : `
          <div class="empty-state" style="grid-column:1/-1;padding:48px">
            <span class="empty-icon">◈</span>
            <div class="empty-title">No case studies yet</div>
            <p class="empty-desc">${canAuthor ? 'Share an anonymized case to help fellow coaches learn.' : 'Approved case studies from coaches will appear here.'}</p>
          </div>`}
      </div>
      ${canAuthor ? `
      <div class="modal-overlay hidden" id="modal-case-share">
        <div class="modal">
          <div class="modal-header"><h3>Share Case Study</h3><button class="btn-icon" onclick="CommunityUI.closeCaseShareModal()">✕</button></div>
          <div class="modal-body">
            <div class="form-hint" style="margin-bottom:12px">
              Submitted cases go to an admin for review. Once approved they appear
              on the Case Study board and in the Case Studies showcase.
            </div>
            <div class="form-group"><label class="form-label">Title</label><input id="cs-title" class="form-input" placeholder="e.g. Chronic hip IR restriction — Phase 1 protocol"/></div>
            <div class="form-group"><label class="form-label">Description (anonymized)</label><textarea id="cs-desc" class="form-input" style="min-height:120px" placeholder="Client presentation, assessment findings, program applied, outcome..."></textarea></div>
            <div class="form-group"><label class="form-label">Tags (comma-separated)</label><input id="cs-tags" class="form-input" placeholder="e.g. hip, Phase 1, PRI, gait"/></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="CommunityUI.closeCaseShareModal()">Cancel</button>
            <button class="btn btn-primary" onclick="CommunityUI.submitCaseShare()">Share Case</button>
          </div>
        </div>
      </div>` : ''}`;
  }

  function _caseStatusBadge(status) {
    const map = {
      pending:  { cls: 'badge-pending', label: '⌛ Pending admin review' },
      approved: { cls: 'badge-active',  label: '✓ Approved' },
      rejected: { cls: 'badge-expired', label: '✕ Not approved' },
    };
    const t = map[status];
    return t ? `<span class="badge ${t.cls}">${t.label}</span>` : '';
  }

  function _caseShareCard(s) {
    const uid = Auth.getUser()?.id;
    const isOwner = s.coach_id === uid;
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const status = s.status || 'approved';
    // The board shows every approved case to everyone; an author additionally
    // sees their own pending/rejected submissions — flagged with a badge.
    const showBadge = status !== 'approved';
    return `
      <div class="case-share-card">
        <div class="case-share-card-header">
          <div>
            <div class="case-share-title">${_esc(s.title)}</div>
            <div class="case-share-meta">${_esc(s.coach?.full_name || 'Unknown coach')} · ${_timeAgo(s.created_at)}</div>
          </div>
          ${isOwner ? `<button class="btn-icon" style="font-size:11px;opacity:0.5" onclick="CommunityUI.deleteCase('${s.id}')">✕</button>` : ''}
        </div>
        ${showBadge ? `<div style="margin-bottom:8px">${_caseStatusBadge(status)}</div>` : ''}
        ${s.description ? `<p class="case-share-desc">${_esc(s.description)}</p>` : ''}
        ${status === 'rejected' && s.review_note
          ? `<p class="case-share-desc" style="color:#FCA5A5;font-size:12px"><b>Admin note:</b> ${_esc(s.review_note)}</p>` : ''}
        ${tags.length ? `<div class="case-share-tags">${tags.map(t => `<span class="case-tag">${_esc(t)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  function openCaseShareModal() {
    if (!(Auth.isAdminOrCoach && Auth.isAdminOrCoach())) return;  // CX0: clients cannot author
    document.getElementById('modal-case-share')?.classList.remove('hidden');
  }

  function closeCaseShareModal() {
    document.getElementById('modal-case-share')?.classList.add('hidden');
  }

  async function submitCaseShare() {
    if (!(Auth.isAdminOrCoach && Auth.isAdminOrCoach())) { Dashboard.toast('Only coaches can share case studies', 'error'); return; }  // CX0
    const title = document.getElementById('cs-title')?.value?.trim();
    const desc  = document.getElementById('cs-desc')?.value?.trim();
    const tagRaw = document.getElementById('cs-tags')?.value || '';
    const tags  = tagRaw.split(',').map(t => t.trim()).filter(Boolean);
    if (!title) { Dashboard.toast('Title required', 'error'); return; }

    try {
      await Community.createCaseShare(title, desc, {}, tags);
      Dashboard.toast('Case study submitted — an admin will review it before it goes live.', 'success');
      closeCaseShareModal();
      renderCaseShares();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function deleteCase(id) {
    if (!confirm('Delete this case study?')) return;
    try {
      await Community.deleteCaseShare(id);
      Dashboard.toast('Deleted', 'info');
      renderCaseShares();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CASE STUDY APPROVALS  (admin-only — rendered into the
  //  sidebar "Approvals" section alongside RPM phase approvals)
  // ═══════════════════════════════════════════════════════════

  async function renderCaseApprovals() {
    const el = document.getElementById('case-approvals-root');
    if (!el) return;

    // Moderation is admin-only; hide the block entirely for coaches.
    if (!Auth.isAdmin()) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;

    let pending = [];
    try {
      pending = await Community.loadPendingCaseShares();
    } catch(e) {
      el.innerHTML = `<div class="card"><p style="color:#FCA5A5;padding:12px">Could not load case-study submissions.</p></div>`;
      return;
    }

    el.innerHTML = `
      <div class="card" style="margin-bottom:var(--sp-5)">
        <div class="card-header">
          <span class="card-title">Case Study Submissions</span>
          <span class="badge ${pending.length ? 'badge-pending' : 'badge-active'}">${pending.length} pending</span>
        </div>
        ${pending.length ? `
          <div class="case-approval-list">${pending.map(_caseApprovalCard).join('')}</div>
        ` : `
          <div class="empty-state" style="padding:32px">
            <span class="empty-icon">✓</span>
            <div class="empty-title">No case studies waiting</div>
            <p class="empty-desc">When a coach submits a case study in Community, it appears here for your review.</p>
          </div>`}
      </div>`;
  }

  function _caseApprovalCard(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    return `
      <div class="case-approval-card" id="case-appr-${s.id}">
        <div class="case-approval-body">
          <div class="case-share-title">${_esc(s.title)}</div>
          <div class="case-share-meta">${_esc(s.coach?.full_name || s.coach?.email || 'Unknown coach')} · ${_timeAgo(s.created_at)}</div>
          ${s.description ? `<p class="case-share-desc">${_esc(s.description)}</p>` : ''}
          ${tags.length ? `<div class="case-share-tags">${tags.map(t => `<span class="case-tag">${_esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="case-approval-actions">
          <button class="btn btn-teal btn-sm" onclick="CommunityUI.approveCase('${s.id}')">✓ Accept</button>
          <button class="btn btn-ghost btn-sm" onclick="CommunityUI.rejectCase('${s.id}')">✕ Reject</button>
        </div>
      </div>`;
  }

  async function approveCase(id) {
    try {
      await Community.reviewCaseShare(id, 'approved');
      Dashboard.toast('Case study approved — it is now live on the board and showcase.', 'success');
      renderCaseApprovals();
      window._refreshApprovalsBadge?.();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function rejectCase(id) {
    const note = prompt('Reason for rejecting this case study (the coach will see this):');
    if (note === null) return;   // cancelled
    try {
      await Community.reviewCaseShare(id, 'rejected', note);
      Dashboard.toast('Case study rejected.', 'info');
      renderCaseApprovals();
      window._refreshApprovalsBadge?.();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CLIENT COMMUNITY FEED
  // ═══════════════════════════════════════════════════════════

  async function renderClientFeed() {
    const el = document.getElementById('comm-client-feed');
    if (!el) return;

    el.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;
    const posts = await Community.loadClientPosts();

    const canPost = ['client','coach','admin'].includes(Auth.getRole());

    el.innerHTML = `
      ${canPost ? `
      <div class="card" style="margin-bottom:var(--sp-4)">
        <div class="form-group" style="margin-bottom:10px">
          <textarea id="new-post-content" class="form-input" style="min-height:72px" placeholder="Share your progress, ask a question, or offer support..."></textarea>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;gap:6px">
            ${['progress','question','support','milestone'].map(t =>
              `<button class="btn btn-ghost btn-xs post-type-btn" data-type="${t}" onclick="CommunityUI.setPostType('${t}')">${t}</button>`
            ).join('')}
          </div>
          <button class="btn btn-primary btn-sm" onclick="CommunityUI.submitPost()">Post</button>
        </div>
      </div>` : ''}
      <div id="posts-feed">
        ${posts.length ? posts.map(p => _postCard(p)).join('') : `
          <div class="empty-state" style="padding:48px">
            <span class="empty-icon">◉</span>
            <div class="empty-title">No posts yet</div>
            <p class="empty-desc">Be the first to share your progress!</p>
          </div>`}
      </div>`;

    // Default post type
    window._newPostType = 'progress';
    document.querySelector('.post-type-btn[data-type="progress"]')?.classList.add('active');

    // Real-time new posts
    Community.subscribeToClientPosts(post => {
      const feed = document.getElementById('posts-feed');
      if (feed) feed.insertAdjacentHTML('afterbegin', _postCard(post));
    });
  }

  let _newPostType = 'progress';
  function setPostType(type) {
    _newPostType = type;
    document.querySelectorAll('.post-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  }

  function _postCard(p) {
    const uid = Auth.getUser()?.id;
    const isOwner = p.client_id === uid || Auth.isAdmin();
    const commentCount = p.comment_count?.[0]?.count || 0;
    return `
      <div class="post-card" id="post-${p.id}">
        <div class="post-card-header">
          ${_avatar(p.client?.full_name, 'var(--lime)')}
          <div class="post-card-meta">
            <div class="post-author">${_esc(p.client?.full_name || p.client?.email || 'Member')}</div>
            <div class="post-time">${_timeAgo(p.created_at)} · ${_typeBadge(p.type)}</div>
          </div>
          ${isOwner ? `<button class="btn-icon" style="font-size:11px;opacity:0.4;margin-left:auto" onclick="CommunityUI.deletePost('${p.id}')">✕</button>` : ''}
        </div>
        <div class="post-content">${_esc(p.content)}</div>
        <div class="post-actions">
          <button class="btn btn-ghost btn-xs" onclick="CommunityUI.toggleComments('${p.id}')">
            ◈ <span class="cc-count" data-post="${p.id}" data-n="${commentCount}">${commentCount} comment${commentCount !== 1 ? 's' : ''}</span>
          </button>
        </div>
        <div class="post-comments hidden" id="comments-${p.id}"></div>
      </div>`;
  }

  async function submitPost() {
    const content = document.getElementById('new-post-content')?.value?.trim();
    if (!content) { Dashboard.toast('Write something first', 'error'); return; }

    try {
      await Community.createPost(content, _newPostType);
      document.getElementById('new-post-content').value = '';
      Dashboard.toast('Posted!', 'success');
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function deletePost(id) {
    if (!confirm('Delete this post?')) return;
    try {
      await Community.deletePost(id);
      document.getElementById(`post-${id}`)?.remove();
      Dashboard.toast('Post deleted', 'info');
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // Single comment row — shared by the initial render, the author's instant
  // local echo, and live (realtime) inserts. data-cid lets us dedupe.
  function _commentItem({ id, name, role, content, time }) {
    return `
      <div class="comment-item" data-cid="${_esc(id || '')}">
        ${_avatar(name, role === 'coach' ? 'var(--teal)' : 'var(--lime)')}
        <div class="comment-body">
          <div class="comment-author">${_esc(name || 'User')} <span class="badge" style="font-size:9px">${_esc(role || '')}</span></div>
          <div class="comment-text">${_esc(content)}</div>
          <div class="comment-time">${_esc(time || 'just now')}</div>
        </div>
      </div>`;
  }

  // Keep the post's "N comments" label in sync as comments arrive.
  function _bumpCommentCount(postId, delta) {
    const el = document.querySelector(`.cc-count[data-post="${postId}"]`);
    if (!el) return;
    const n = Math.max(0, (parseInt(el.dataset.n, 10) || 0) + delta);
    el.dataset.n = n;
    el.textContent = `${n} comment${n !== 1 ? 's' : ''}`;
  }

  // Realtime insert handler — append a comment from another session, skipping
  // our own echo (already shown) and any duplicate delivery.
  async function _onLiveComment(postId, row) {
    const list = document.querySelector(`#comments-${postId} .comments-list`);
    if (!list || !row?.id) return;
    if (list.querySelector(`[data-cid="${row.id}"]`)) return;        // already shown
    let name = 'Member';
    try {
      const { data } = await sb.from('profiles').select('full_name,email').eq('id', row.author_id).maybeSingle();
      name = data?.full_name || data?.email || 'Member';
    } catch (_) { /* name is best-effort */ }
    if (list.querySelector(`[data-cid="${row.id}"]`)) return;        // re-check after await
    list.insertAdjacentHTML('beforeend', _commentItem({
      id: row.id, name, role: row.author_role, content: row.content, time: _timeAgo(row.created_at),
    }));
    _bumpCommentCount(postId, +1);
  }

  async function toggleComments(postId) {
    const el = document.getElementById(`comments-${postId}`);
    if (!el) return;

    if (!el.classList.contains('hidden')) {
      el.classList.add('hidden');
      Community.unsubscribeComments?.();          // stop live updates for this thread
      return;
    }

    el.classList.remove('hidden');
    el.innerHTML = `<div class="comm-loading" style="padding:16px"><span class="spinner"></span></div>`;

    const comments = await Community.loadComments(postId);
    el.innerHTML = `
      <div class="comments-list">
        ${comments.map(c => _commentItem({
          id: c.id, name: c.author?.full_name || c.author?.email, role: c.author_role,
          content: c.content, time: _timeAgo(c.created_at),
        })).join('')}
      </div>
      <div class="comment-input-row">
        <input class="form-input" id="comment-input-${postId}" placeholder="Add a comment…" style="flex:1"
          onkeydown="if(event.key==='Enter'){CommunityUI.submitComment('${postId}')}"/>
        <button class="btn btn-primary btn-sm" onclick="CommunityUI.submitComment('${postId}')">Reply</button>
      </div>`;

    // Live updates for this thread (RLS-scoped — only comments the viewer may see).
    Community.subscribeToComments?.(postId, row => _onLiveComment(postId, row));
  }

  async function submitComment(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    const content = input?.value?.trim();
    if (!content) return;

    try {
      const comment = await Community.addComment(postId, content);
      input.value = '';
      const list = document.querySelector(`#comments-${postId} .comments-list`);
      // Instant local echo (tagged with the real id so the realtime echo is deduped).
      if (list && comment?.id && !list.querySelector(`[data-cid="${comment.id}"]`)) {
        const profile = Auth.getProfile();
        list.insertAdjacentHTML('beforeend', _commentItem({
          id: comment.id, name: profile?.full_name || 'You', role: Auth.getRole(), content, time: 'just now',
        }));
        _bumpCommentCount(postId, +1);
      }
      Dashboard.toast('Comment added', 'success');
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // BUG 3 — called when leaving the Community section: drop all realtime
  // channels so they don't linger or double-deliver on re-entry.
  function teardown() {
    Community.unsubscribeMessages?.();
    Community.unsubscribePosts?.();
    Community.unsubscribeComments?.();
  }

  // ═══════════════════════════════════════════════════════════
  //  SUPPORT GROUPS
  // ═══════════════════════════════════════════════════════════

  async function renderSupportGroups() {
    const el = document.getElementById('comm-support-groups');
    if (!el) return;

    el.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;
    const groups = await Community.loadClientGroups();

    el.innerHTML = `
      <div class="comm-section-header">
        <h3 class="comm-section-title">Support Groups</h3>
        ${Auth.isAdminOrCoach() ? `<button class="btn btn-primary btn-sm" onclick="CommunityUI.openGroupCreateModal()">+ Create Group</button>` : ''}
      </div>
      <div class="support-group-grid">
        ${groups.map(g => _supportGroupCard(g)).join('')}
        ${!groups.length ? `<div class="empty-state" style="grid-column:1/-1;padding:48px"><span class="empty-icon">◈</span><div class="empty-title">No groups yet</div></div>` : ''}
      </div>
      <div class="modal-overlay hidden" id="modal-create-group">
        <div class="modal">
          <div class="modal-header"><h3>Create Support Group</h3><button class="btn-icon" onclick="CommunityUI.closeGroupCreateModal()">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Group Name</label><input id="sg-name" class="form-input" placeholder="e.g. Lower Back Pain Recovery"/></div>
            <div class="form-group"><label class="form-label">Focus Area</label><input id="sg-focus" class="form-input" placeholder="e.g. Lower Back Pain"/></div>
            <div class="form-group"><label class="form-label">Description</label><textarea id="sg-desc" class="form-input" placeholder="Who should join this group..."></textarea></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="CommunityUI.closeGroupCreateModal()">Cancel</button>
            <button class="btn btn-primary" onclick="CommunityUI.submitGroupCreate()">Create Group</button>
          </div>
        </div>
      </div>`;
  }

  function _supportGroupCard(g) {
    const count = g.members?.[0]?.count || 0;
    return `
      <div class="support-group-card">
        <div class="sg-card-focus">${_esc(g.focus_area || 'General')}</div>
        <div class="sg-card-name">${_esc(g.name)}</div>
        ${g.description ? `<p class="sg-card-desc">${_esc(g.description)}</p>` : ''}
        <div class="sg-card-footer">
          <span class="sg-card-count">◉ ${count} member${count !== 1 ? 's' : ''}</span>
          <button class="btn btn-teal btn-xs" onclick="CommunityUI.joinGroup('${g.id}')">Join</button>
        </div>
      </div>`;
  }

  function openGroupCreateModal() {
    document.getElementById('modal-create-group')?.classList.remove('hidden');
  }

  function closeGroupCreateModal() {
    document.getElementById('modal-create-group')?.classList.add('hidden');
  }

  async function submitGroupCreate() {
    const name  = document.getElementById('sg-name')?.value?.trim();
    const focus = document.getElementById('sg-focus')?.value?.trim();
    const desc  = document.getElementById('sg-desc')?.value?.trim();
    if (!name) { Dashboard.toast('Group name required', 'error'); return; }

    try {
      await Community.createClientGroup(name, desc, focus);
      Dashboard.toast('Group created!', 'success');
      closeGroupCreateModal();
      renderSupportGroups();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function joinGroup(groupId) {
    try {
      await Community.joinClientGroup(groupId);
      Dashboard.toast('Joined group!', 'success');
      renderSupportGroups();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVACY SETTINGS
  // ═══════════════════════════════════════════════════════════

  async function renderPrivacySettings() {
    const el = document.getElementById('comm-privacy');
    if (!el) return;

    el.innerHTML = `<div class="comm-loading"><span class="spinner"></span></div>`;
    const settings = await Community.loadPrivacySettings();
    if (!settings) { el.innerHTML = '<p style="color:var(--text-tertiary);padding:16px">Could not load settings.</p>'; return; }

    el.innerHTML = `
      <div class="card" style="max-width:540px">
        <div class="card-header"><span class="card-title">Privacy Controls</span></div>
        <div class="setting-row">
          <div class="setting-label"><h4>Share Progress</h4><p>Allow coaches to see your assessment scores</p></div>
          <label class="toggle-switch">
            <input type="checkbox" id="priv-share-progress" ${settings.share_progress ? 'checked' : ''}/>
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-label"><h4>Share Posts</h4><p>Show your community posts to other members</p></div>
          <label class="toggle-switch">
            <input type="checkbox" id="priv-share-posts" ${settings.share_posts ? 'checked' : ''}/>
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-label"><h4>Allow Comments</h4><p>Let others comment on your posts</p></div>
          <label class="toggle-switch">
            <input type="checkbox" id="priv-allow-comments" ${settings.allow_comments ? 'checked' : ''}/>
            <span class="toggle-track"></span>
          </label>
        </div>
        <div class="setting-row">
          <div class="setting-label"><h4>Visible To</h4><p>Who can see your profile and posts</p></div>
          <select id="priv-visible-to" class="form-input" style="width:160px">
            <option value="public" ${settings.visible_to === 'public' ? 'selected' : ''}>Public</option>
            <option value="coach_only" ${settings.visible_to === 'coach_only' ? 'selected' : ''}>Coach Only</option>
            <option value="private" ${settings.visible_to === 'private' ? 'selected' : ''}>Private</option>
          </select>
        </div>
        <div style="margin-top:var(--sp-4)">
          <button class="btn btn-primary" onclick="CommunityUI.savePrivacy()">Save Privacy Settings</button>
        </div>
      </div>`;
  }

  async function savePrivacy() {
    const settings = {
      share_progress:  document.getElementById('priv-share-progress')?.checked,
      share_posts:     document.getElementById('priv-share-posts')?.checked,
      allow_comments:  document.getElementById('priv-allow-comments')?.checked,
      visible_to:      document.getElementById('priv-visible-to')?.value,
    };
    try {
      await Community.updatePrivacySettings(settings);
      Dashboard.toast('Privacy settings saved', 'success');
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  COMMUNITY SECTION LOADER (called from dashboard showSection)
  // ═══════════════════════════════════════════════════════════

  // Called by the dashboard `community` loader every time the section opens.
  // Activates the role-correct default sub-tab and renders ONLY that panel,
  // so the first view is never blank and there is no duplicate render.
  //   • client       → Community Feed (coach-oriented Messages/Referrals are
  //                    hidden via role-coach-admin on their tab buttons — CX0)
  //   • coach/admin  → Messages (unchanged default)
  async function initCommunitySection() {
    const isCoach = !!(Auth.isAdminOrCoach && Auth.isAdminOrCoach());
    const defaultTab = isCoach ? 'comm-messaging' : 'comm-client-feed';

    // Activate the default tab (button + panel) so something is visible at once.
    if (typeof UI !== 'undefined' && UI.goTab) UI.goTab('community-tabs', defaultTab);

    // Render that single default panel immediately.
    const RENDERERS = {
      'comm-messaging':      renderMessaging,
      'comm-referrals':      renderReferrals,
      'comm-case-shares':    renderCaseShares,
      'comm-client-feed':    renderClientFeed,
      'comm-support-groups': renderSupportGroups,
      'comm-privacy':        renderPrivacySettings,
    };
    RENDERERS[defaultTab]?.();
  }

  return {
    // Messaging
    renderMessaging, openConversation, sendThreadMsg,
    openNewMsgModal, closeNewMsgModal, sendNewMsg,
    // Referrals
    renderReferrals, openReferralModal, closeReferralModal, submitReferral, respondRef,
    // Case shares
    renderCaseShares, openCaseShareModal, closeCaseShareModal, submitCaseShare, deleteCase,
    // Case study approvals (admin)
    renderCaseApprovals, approveCase, rejectCase,
    // Client feed
    renderClientFeed, setPostType, submitPost, deletePost, toggleComments, submitComment,
    // Support groups
    renderSupportGroups, openGroupCreateModal, closeGroupCreateModal, submitGroupCreate, joinGroup,
    // Privacy
    renderPrivacySettings, savePrivacy,
    // Init / lifecycle
    initCommunitySection, teardown,
  };

})();

window.CommunityUI = CommunityUI;
