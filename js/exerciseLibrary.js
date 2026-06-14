// ═══════════════════════════════════════════════════════════════
//  js/exerciseLibrary.js
//  Workstream B: Exercise Library — data + API layer
//  YouTube Data API v3 · Exercise CRUD · Search · Filter
// ═══════════════════════════════════════════════════════════════

const ExerciseLibrary = (() => {

  // YouTube Data API v3 key — replace with your key in production
  const YT_API_KEY = window.YOUTUBE_API_KEY || '';

  // ── Local cache for fast lookups (used by ProgramGenerator) ─
  let _cache = null;
  let _cacheTs = 0;
  const CACHE_TTL = 5 * 60 * 1000; // 5 min

  // ═══════════════════════════════════════════════════════════
  //  CORE CRUD
  // ═══════════════════════════════════════════════════════════

  async function loadAll(filters = {}) {
    let q = sb.from('exercises').select('*').order('name');

    if (filters.phase)    q = q.eq('phase', filters.phase);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.search) {
      q = q.ilike('name', `%${filters.search}%`);
    }
    if (filters.tag) {
      q = q.contains('tags', [filters.tag]);
    }
    if (filters.joint) {
      q = q.contains('target_joints', [filters.joint]);
    }

    const { data, error } = await q;
    if (error) { console.warn('ExerciseLibrary.loadAll:', error.message); return []; }
    return data || [];
  }

  async function getById(id) {
    const { data } = await sb.from('exercises').select('*').eq('id', id).single();
    return data || null;
  }

  // ── URL safety ───────────────────────────────────────────────
  // Coach-supplied links are stored as URLs only (never as embed/HTML),
  // and must be http(s). Anything else (javascript:, data:, garbage)
  // becomes null so it can never be turned into an unsafe embed/href.
  function sanitizeUrl(u) {
    if (!u) return null;
    const s = String(u).trim();
    if (!s) return null;
    try {
      const url = new URL(s);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null;
    } catch { return null; }
  }
  // For form validation: empty is OK; non-empty must be a valid http(s) URL.
  function isValidUrl(u) { return !u || !String(u).trim() || sanitizeUrl(u) !== null; }

  const _URL_FIELDS = ['video_url', 'youtube_url', 'thumbnail_url', 'channel_url'];

  async function create(fields) {
    const uid = Auth.getUser()?.id;
    if (!fields.name?.trim()) throw new Error('Exercise name required');

    const { data, error } = await sb.from('exercises').insert({
      name:          fields.name.trim(),
      category:      fields.category || 'Rehab',
      phase:         fields.phase || 'Phase 1',
      target_area:   fields.target_area || null,
      difficulty:    fields.difficulty || null,
      equipment:     fields.equipment || null,
      video_url:     sanitizeUrl(fields.video_url),
      youtube_url:   sanitizeUrl(fields.youtube_url),
      thumbnail_url: sanitizeUrl(fields.thumbnail_url),
      channel_url:   sanitizeUrl(fields.channel_url),
      channel_name:  fields.channel_name || null,
      cues:          fields.cues || null,
      notes:         fields.notes || null,
      common_errors: fields.common_errors || null,
      progressions:  fields.progressions || null,
      regressions:   fields.regressions || null,
      tags:          Array.isArray(fields.tags) ? fields.tags : [],
      target_joints: Array.isArray(fields.target_joints) ? fields.target_joints : [],
      created_by:    uid,
    }).select().single();

    if (error) throw new Error(error.message);
    _invalidateCache();
    return data;
  }

  async function update(id, fields) {
    const clean = { ...fields };
    _URL_FIELDS.forEach((k) => { if (k in clean) clean[k] = sanitizeUrl(clean[k]); });
    const { data, error } = await sb.from('exercises').update(clean).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    _invalidateCache();
    return data;
  }

  async function remove(id) {
    const { error } = await sb.from('exercises').delete().eq('id', id);
    if (error) throw new Error(error.message);
    _invalidateCache();
  }

  // ── Cache helpers ────────────────────────────────────────────
  function _invalidateCache() { _cache = null; _cacheTs = 0; }

  async function _getCache() {
    if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
    _cache = await loadAll();
    _cacheTs = Date.now();
    return _cache;
  }

  // ═══════════════════════════════════════════════════════════
  //  LOOKUP (used by ProgramGenerator)
  //  Returns exercise object from DB matching name, or null.
  // ═══════════════════════════════════════════════════════════

  async function lookup(name) {
    const all = await _getCache();
    const lower = name.toLowerCase();
    return all.find(e => e.name.toLowerCase() === lower) || null;
  }

  async function lookupByJoint(jointKey) {
    const all = await _getCache();
    return all.filter(e =>
      Array.isArray(e.target_joints) && e.target_joints.includes(jointKey)
    );
  }

  async function lookupByPhase(phase) {
    const all = await _getCache();
    return all.filter(e => e.phase === phase);
  }

  // ═══════════════════════════════════════════════════════════
  //  YOUTUBE API INTEGRATION
  // ═══════════════════════════════════════════════════════════

  function _ytVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function getEmbedUrl(videoUrl) {
    const id = _ytVideoId(videoUrl);
    return id ? `https://www.youtube.com/embed/${id}?rel=0&modestbranding=1` : null;
  }

  function getThumbnailUrl(videoUrl) {
    const id = _ytVideoId(videoUrl);
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
  }

  async function fetchPlaylistItems(playlistId) {
    if (!YT_API_KEY) {
      console.warn('YouTube API key not configured (window.YOUTUBE_API_KEY)');
      return [];
    }

    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${YT_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);
    const data = await res.json();

    return (data.items || []).map(item => ({
      title:        item.snippet.title,
      description:  item.snippet.description,
      video_url:    `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
      thumbnail_url: item.snippet.thumbnails?.medium?.url || null,
      youtube_id:   item.snippet.resourceId.videoId,
    }));
  }

  async function importFromPlaylist(playlistId, phaseMapping, categoryDefault = 'Mobility') {
    const items = await fetchPlaylistItems(playlistId);
    const uid = Auth.getUser()?.id;
    const results = { imported: 0, skipped: 0, errors: [] };

    for (const item of items) {
      try {
        const { data: existing } = await sb.from('exercises')
          .select('id').ilike('name', item.title).limit(1);
        if (existing?.length) { results.skipped++; continue; }

        await sb.from('exercises').insert({
          name:          item.title,
          category:      categoryDefault,
          phase:         phaseMapping !== 'All' ? phaseMapping : 'Phase 1',
          video_url:     item.video_url,
          thumbnail_url: item.thumbnail_url,
          cues:          item.description || null,
          tags:          [],
          target_joints: [],
          created_by:    uid,
        });
        results.imported++;
      } catch(e) {
        results.errors.push(`${item.title}: ${e.message}`);
      }
    }

    _invalidateCache();
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  PLAYLIST MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  async function loadPlaylists() {
    const { data, error } = await sb.from('exercise_playlists').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  }

  async function savePlaylist(playlistId, name, phaseMapping, autoSync = false) {
    const { data, error } = await sb.from('exercise_playlists').insert({
      youtube_playlist_id: playlistId,
      name:                name || playlistId,
      phase_mapping:       phaseMapping || 'All',
      auto_sync:           autoSync,
      last_synced_at:      null,
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function syncPlaylist(playlistRow) {
    const results = await importFromPlaylist(
      playlistRow.youtube_playlist_id,
      playlistRow.phase_mapping
    );
    await sb.from('exercise_playlists')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('id', playlistRow.id);
    return results;
  }

  // ═══════════════════════════════════════════════════════════
  //  SEARCH
  // ═══════════════════════════════════════════════════════════

  async function search(query, filters = {}) {
    return loadAll({ search: query, ...filters });
  }

  // ═══════════════════════════════════════════════════════════
  //  ADD-TO-PROGRAM BRIDGE
  //  Called from ExerciseUI "Add to Program" button.
  //  Inserts exercise into the current session's program panel.
  // ═══════════════════════════════════════════════════════════

  function addToProgram(exercise) {
    if (typeof ProgramGenerator === 'undefined') return;

    const phaseColor = exercise.phase === 'Phase 1' ? 'var(--teal)'
      : exercise.phase === 'Phase 2' ? 'var(--amber)' : 'var(--lime)';

    const panel = document.getElementById('program-panel');
    if (!panel || panel.classList.contains('hidden')) {
      Dashboard.toast('Generate a program first, then add exercises', 'warning');
      return;
    }

    // Find the main exercises section and append
    const mainSection = panel.querySelector('[data-section="main"]');
    const newRow = document.createElement('div');
    newRow.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto auto auto;gap:10px 16px;align-items:start;padding:12px 0;border-bottom:1px solid var(--border-subtle);opacity:0;transition:opacity 0.3s';
    newRow.innerHTML = `
      <div style="width:22px;height:22px;border-radius:50%;background:${phaseColor}18;border:1px solid ${phaseColor}30;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${phaseColor};flex-shrink:0;margin-top:1px">+</div>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${exercise.name}</div>
        ${exercise.cues ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:2px">${exercise.cues}</div>` : ''}
        ${exercise.video_url ? `<a href="${exercise.video_url}" target="_blank" style="font-size:11px;color:var(--lime);text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-top:4px">▶ Watch</a>` : ''}
      </div>
      <div style="text-align:center;min-width:40px"><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">Sets</div><div style="font-size:13px;font-weight:600;color:${phaseColor}">3</div></div>
      <div style="text-align:center;min-width:60px"><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">Reps</div><div style="font-size:13px;font-weight:600">10</div></div>
      <div style="text-align:center;min-width:50px"><div style="font-size:10px;color:var(--text-tertiary);margin-bottom:2px">Tempo</div><div style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary)">3-1-3</div></div>`;

    if (mainSection) {
      mainSection.appendChild(newRow);
    } else {
      panel.appendChild(newRow);
    }

    requestAnimationFrame(() => { newRow.style.opacity = '1'; });
    Dashboard.toast(`"${exercise.name}" added to program`, 'success');
  }

  return {
    loadAll, getById, create, update, remove,
    lookup, lookupByJoint, lookupByPhase,
    sanitizeUrl, isValidUrl,
    getEmbedUrl, getThumbnailUrl,
    fetchPlaylistItems, importFromPlaylist,
    loadPlaylists, savePlaylist, syncPlaylist,
    search, addToProgram,
  };

})();

window.ExerciseLibrary = ExerciseLibrary;
