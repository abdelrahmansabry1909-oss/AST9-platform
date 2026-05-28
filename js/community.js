// ═══════════════════════════════════════════════════════════════
//  js/community.js
//  Workstream A: Community Features — data layer
//  Coach messaging · Referrals · Case shares · Client posts
//  Privacy controls · Support groups
// ═══════════════════════════════════════════════════════════════

const Community = (() => {

  // ── Real-time subscription handles ──────────────────────────
  let _msgChannel = null;
  let _postChannel = null;

  // ═══════════════════════════════════════════════════════════
  //  COACH MESSAGING
  // ═══════════════════════════════════════════════════════════

  async function loadConversations() {
    const uid = Auth.getUser()?.id;
    if (!uid) return [];

    const { data, error } = await sb
      .from('coach_messages')
      .select('*, sender:profiles!coach_messages_sender_id_fkey(id,full_name,email), receiver:profiles!coach_messages_receiver_id_fkey(id,full_name,email)')
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .order('created_at', { ascending: false });

    if (error) { console.warn('loadConversations:', error.message); return []; }

    // Group by conversation partner
    const convMap = {};
    (data || []).forEach(m => {
      const partner = m.sender_id === uid ? m.receiver : m.sender;
      if (!partner) return;
      const key = partner.id;
      if (!convMap[key]) {
        convMap[key] = { partner, messages: [], unread: 0, lastMsg: m };
      }
      convMap[key].messages.push(m);
      if (m.receiver_id === uid && !m.read_at) convMap[key].unread++;
    });

    return Object.values(convMap).sort((a, b) =>
      new Date(b.lastMsg.created_at) - new Date(a.lastMsg.created_at)
    );
  }

  async function loadMessages(partnerId) {
    const uid = Auth.getUser()?.id;
    if (!uid || !partnerId) return [];

    const { data, error } = await sb
      .from('coach_messages')
      .select('*')
      .or(
        `and(sender_id.eq.${uid},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${uid})`
      )
      .order('created_at', { ascending: true });

    if (error) { console.warn('loadMessages:', error.message); return []; }

    // Mark received messages as read
    const unread = (data || []).filter(m => m.receiver_id === uid && !m.read_at).map(m => m.id);
    if (unread.length) {
      await sb.from('coach_messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', unread);
    }

    return data || [];
  }

  async function sendMessage(receiverId, content) {
    const uid = Auth.getUser()?.id;
    if (!uid || !receiverId || !content?.trim()) return null;

    const { data, error } = await sb.from('coach_messages').insert({
      sender_id: uid,
      receiver_id: receiverId,
      content: content.trim(),
    }).select().single();

    if (error) throw new Error(error.message);
    return data;
  }

  async function getUnreadCount() {
    const uid = Auth.getUser()?.id;
    if (!uid) return 0;
    const { count } = await sb
      .from('coach_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_id', uid)
      .is('read_at', null);
    return count || 0;
  }

  function subscribeToMessages(partnerId, callback) {
    if (_msgChannel) _msgChannel.unsubscribe();
    const uid = Auth.getUser()?.id;
    _msgChannel = sb
      .channel(`messages_${uid}_${partnerId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'coach_messages',
        filter: `receiver_id=eq.${uid}`,
      }, payload => callback(payload.new))
      .subscribe();
  }

  function unsubscribeMessages() {
    if (_msgChannel) { _msgChannel.unsubscribe(); _msgChannel = null; }
  }

  // ═══════════════════════════════════════════════════════════
  //  COACH GROUPS
  // ═══════════════════════════════════════════════════════════

  async function loadGroups() {
    const { data, error } = await sb
      .from('coach_groups')
      .select('*, members:coach_group_members(count)')
      .order('created_at', { ascending: false });
    if (error) { console.warn('loadGroups:', error.message); return []; }
    return data || [];
  }

  async function createGroup(name, description) {
    const uid = Auth.getUser()?.id;
    if (!uid || !name?.trim()) throw new Error('Group name required');

    const { data, error } = await sb.from('coach_groups').insert({
      name: name.trim(),
      description: description?.trim() || null,
      created_by: uid,
    }).select().single();

    if (error) throw new Error(error.message);

    // Auto-join creator
    await sb.from('coach_group_members').insert({ group_id: data.id, coach_id: uid });
    return data;
  }

  async function joinGroup(groupId) {
    const uid = Auth.getUser()?.id;
    if (!uid || !groupId) return;
    const { error } = await sb.from('coach_group_members').insert({ group_id: groupId, coach_id: uid });
    if (error && !error.message.includes('duplicate')) throw new Error(error.message);
  }

  async function leaveGroup(groupId) {
    const uid = Auth.getUser()?.id;
    if (!uid || !groupId) return;
    await sb.from('coach_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('coach_id', uid);
  }

  // ═══════════════════════════════════════════════════════════
  //  CLIENT REFERRALS
  // ═══════════════════════════════════════════════════════════

  async function loadReferrals() {
    const uid = Auth.getUser()?.id;
    if (!uid) return [];

    const { data, error } = await sb
      .from('client_referrals')
      .select(`
        *,
        from_coach:profiles!client_referrals_from_coach_id_fkey(id,full_name,email),
        to_coach:profiles!client_referrals_to_coach_id_fkey(id,full_name,email),
        client:profiles!client_referrals_client_id_fkey(id,full_name,email,current_phase)
      `)
      .or(`from_coach_id.eq.${uid},to_coach_id.eq.${uid}`)
      .order('created_at', { ascending: false });

    if (error) { console.warn('loadReferrals:', error.message); return []; }
    return data || [];
  }

  async function sendReferral(toCoachId, clientId, notes) {
    const uid = Auth.getUser()?.id;
    if (!uid || !toCoachId || !clientId) throw new Error('Missing referral fields');

    const { data, error } = await sb.from('client_referrals').insert({
      from_coach_id: uid,
      to_coach_id:   toCoachId,
      client_id:     clientId,
      notes:         notes?.trim() || null,
    }).select().single();

    if (error) throw new Error(error.message);
    return data;
  }

  async function respondReferral(referralId, status) {
    if (!['accepted','declined','completed'].includes(status)) return;
    const { error } = await sb.from('client_referrals')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', referralId);
    if (error) throw new Error(error.message);
  }

  async function getPendingReferralCount() {
    const uid = Auth.getUser()?.id;
    if (!uid) return 0;
    const { count } = await sb
      .from('client_referrals')
      .select('*', { count: 'exact', head: true })
      .eq('to_coach_id', uid)
      .eq('status', 'pending');
    return count || 0;
  }

  // ═══════════════════════════════════════════════════════════
  //  CASE SHARES
  // ═══════════════════════════════════════════════════════════

  // Case Study Board feed. RLS returns: every APPROVED case + the caller's
  // own submissions (any status) + everything for admins.
  async function loadCaseShares(filters = {}) {
    let q = sb
      .from('case_shares')
      .select('*, coach:profiles!case_shares_coach_id_fkey(id,full_name,email)')
      .order('created_at', { ascending: false });

    if (filters.status) q = q.eq('status', filters.status);
    if (filters.tag)    q = q.contains('tags', [filters.tag]);
    if (filters.limit)  q = q.limit(filters.limit);

    const { data, error } = await q;
    if (error) { console.warn('loadCaseShares:', error.message); return []; }
    return data || [];
  }

  // Approved cases only — powers the sidebar "Case Studies" carousel.
  async function loadApprovedCaseShares(limit = 20) {
    const { data, error } = await sb
      .from('case_shares')
      .select('*, coach:profiles!case_shares_coach_id_fkey(id,full_name,email)')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) { console.warn('loadApprovedCaseShares:', error.message); return []; }
    return data || [];
  }

  // Pending submissions awaiting an admin decision (admin-only via RLS).
  async function loadPendingCaseShares() {
    const { data, error } = await sb
      .from('case_shares')
      .select('*, coach:profiles!case_shares_coach_id_fkey(id,full_name,email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) { console.warn('loadPendingCaseShares:', error.message); return []; }
    return data || [];
  }

  async function getPendingCaseShareCount() {
    const { count, error } = await sb
      .from('case_shares')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) { console.warn('getPendingCaseShareCount:', error.message); return 0; }
    return count || 0;
  }

  async function createCaseShare(title, description, anonymizedData, tags) {
    const uid = Auth.getUser()?.id;
    if (!uid || !title?.trim()) throw new Error('Title required');

    // status defaults to 'pending' in the DB — the row is invisible on the
    // board (to others) and in the carousel until an admin approves it.
    const { data, error } = await sb.from('case_shares').insert({
      coach_id:        uid,
      title:           title.trim(),
      description:     description?.trim() || null,
      anonymized_data: anonymizedData || {},
      tags:            Array.isArray(tags) ? tags : [],
    }).select().single();

    if (error) throw new Error(error.message);
    return data;
  }

  // Admin decision: approve or reject a submitted case study.
  async function reviewCaseShare(id, status, note) {
    if (!['approved','rejected'].includes(status)) throw new Error('Invalid status');
    const uid = Auth.getUser()?.id;
    const { data, error } = await sb.from('case_shares')
      .update({
        status,
        reviewed_by: uid || null,
        reviewed_at: new Date().toISOString(),
        review_note: note?.trim() || null,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function deleteCaseShare(id) {
    const { error } = await sb.from('case_shares').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ═══════════════════════════════════════════════════════════
  //  CLIENT POSTS & COMMENTS
  // ═══════════════════════════════════════════════════════════

  async function loadClientPosts(type = null) {
    let q = sb
      .from('client_posts')
      .select(`
        *,
        client:profiles!client_posts_client_id_fkey(id,full_name,email,current_phase),
        comment_count:client_comments(count)
      `)
      .order('created_at', { ascending: false })
      .limit(50);

    if (type) q = q.eq('type', type);

    const { data, error } = await q;
    if (error) { console.warn('loadClientPosts:', error.message); return []; }
    return data || [];
  }

  async function createPost(content, type = 'progress') {
    const uid = Auth.getUser()?.id;
    const profile = Auth.getProfile();
    if (!uid || !content?.trim()) throw new Error('Content required');

    const { data, error } = await sb.from('client_posts').insert({
      client_id: profile.id,
      content:   content.trim(),
      type,
    }).select().single();

    if (error) throw new Error(error.message);
    return data;
  }

  async function deletePost(id) {
    const { error } = await sb.from('client_posts').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function loadComments(postId) {
    const { data, error } = await sb
      .from('client_comments')
      .select('*, author:profiles!client_comments_author_id_fkey(id,full_name,email,role)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) { console.warn('loadComments:', error.message); return []; }
    return data || [];
  }

  async function addComment(postId, content) {
    const uid = Auth.getUser()?.id;
    const role = Auth.getRole();
    if (!uid || !postId || !content?.trim()) throw new Error('Comment content required');

    const { data, error } = await sb.from('client_comments').insert({
      post_id:     postId,
      author_id:   uid,
      author_role: role,
      content:     content.trim(),
    }).select().single();

    if (error) throw new Error(error.message);
    return data;
  }

  function subscribeToClientPosts(callback) {
    if (_postChannel) _postChannel.unsubscribe();
    _postChannel = sb
      .channel('client_posts_feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'client_posts' },
        payload => callback(payload.new))
      .subscribe();
  }

  function unsubscribePosts() {
    if (_postChannel) { _postChannel.unsubscribe(); _postChannel = null; }
  }

  // ═══════════════════════════════════════════════════════════
  //  SUPPORT GROUPS
  // ═══════════════════════════════════════════════════════════

  async function loadClientGroups() {
    const { data, error } = await sb
      .from('client_groups')
      .select('*, members:client_group_members(count)')
      .order('name');
    if (error) { console.warn('loadClientGroups:', error.message); return []; }
    return data || [];
  }

  async function createClientGroup(name, description, focusArea) {
    const { data, error } = await sb.from('client_groups').insert({
      name: name.trim(),
      description: description?.trim() || null,
      focus_area: focusArea?.trim() || null,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function joinClientGroup(groupId) {
    const profile = Auth.getProfile();
    if (!profile?.id) return;
    const { error } = await sb.from('client_group_members')
      .insert({ group_id: groupId, client_id: profile.id });
    if (error && !error.message.includes('duplicate')) throw new Error(error.message);
  }

  async function leaveClientGroup(groupId) {
    const profile = Auth.getProfile();
    if (!profile?.id) return;
    await sb.from('client_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('client_id', profile.id);
  }

  // ═══════════════════════════════════════════════════════════
  //  PRIVACY SETTINGS
  // ═══════════════════════════════════════════════════════════

  async function loadPrivacySettings() {
    const uid = Auth.getUser()?.id;
    if (!uid) return null;

    let { data, error } = await sb
      .from('privacy_settings')
      .select('*')
      .eq('user_id', uid)
      .single();

    if (!data) {
      // Create default settings if missing
      const { data: created } = await sb.from('privacy_settings')
        .insert({ user_id: uid })
        .select()
        .single();
      data = created;
    }

    return data;
  }

  async function updatePrivacySettings(settings) {
    const uid = Auth.getUser()?.id;
    if (!uid) return;

    const { error } = await sb.from('privacy_settings')
      .upsert({ user_id: uid, ...settings, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  }

  // ═══════════════════════════════════════════════════════════
  //  COACHES LIST (for messaging / referral dropdowns)
  // ═══════════════════════════════════════════════════════════

  async function loadOtherCoaches() {
    const uid = Auth.getUser()?.id;
    const { data } = await sb
      .from('profiles')
      .select('id,full_name,email,role')
      .in('role', ['coach','admin'])
      .neq('id', uid || '')
      .order('full_name');
    return data || [];
  }

  return {
    // Messaging
    loadConversations, loadMessages, sendMessage, getUnreadCount,
    subscribeToMessages, unsubscribeMessages,
    // Groups (coach)
    loadGroups, createGroup, joinGroup, leaveGroup,
    // Referrals
    loadReferrals, sendReferral, respondReferral, getPendingReferralCount,
    // Case shares
    loadCaseShares, loadApprovedCaseShares, loadPendingCaseShares,
    getPendingCaseShareCount, createCaseShare, reviewCaseShare, deleteCaseShare,
    // Client posts
    loadClientPosts, createPost, deletePost,
    loadComments, addComment,
    subscribeToClientPosts, unsubscribePosts,
    // Support groups (client)
    loadClientGroups, createClientGroup, joinClientGroup, leaveClientGroup,
    // Privacy
    loadPrivacySettings, updatePrivacySettings,
    // Utility
    loadOtherCoaches,
  };

})();

window.Community = Community;
