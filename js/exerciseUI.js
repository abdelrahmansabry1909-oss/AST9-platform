// ═══════════════════════════════════════════════════════════════
//  js/exerciseUI.js
//  Workstream B: Exercise Library UI
//  Grid rendering · Video embeds · Search/filter · Add-to-Program
// ═══════════════════════════════════════════════════════════════

const ExerciseUI = (() => {

  let _filters = { phase: '', category: '', search: '' };
  let _debounceTimer = null;

  // ── Helpers ──────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/'/g,'&#39;').replace(/"/g,'&quot;');
  }
  function _phaseBadge(p) {
    return p === 'Phase 1' ? 'badge-phase1' : p === 'Phase 2' ? 'badge-phase2' : 'badge-phase3';
  }
  function _catColor(c) {
    const map = { Rehab: 'var(--teal)', Mobility: 'var(--lime)', Strength: 'var(--amber)', Neurology: 'var(--rose)', Breathing: 'var(--blue)' };
    return map[c] || 'var(--text-tertiary)';
  }

  // ═══════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ═══════════════════════════════════════════════════════════

  async function render() {
    const section = document.getElementById('section-exercise-library');
    if (!section) return;

    // Replace the static coming-soon content with full UI
    const contentEl = section.querySelector('.coming-soon-banner');
    if (contentEl) contentEl.remove();

    // Ensure filter bar exists
    let filterBar = document.getElementById('ex-filter-bar');
    if (!filterBar) {
      const pageHeader = section.querySelector('.page-actions');
      if (pageHeader) {
        pageHeader.insertAdjacentHTML('beforebegin', _filterBarHTML());
        filterBar = document.getElementById('ex-filter-bar');
        _bindFilterBar();
      }
    }

    // Ensure grid container exists
    let grid = document.getElementById('exercise-grid-container');
    if (!grid) {
      const listEl = document.getElementById('exercise-list');
      if (listEl) {
        listEl.innerHTML = `<div id="exercise-grid-container"></div>`;
        grid = document.getElementById('exercise-grid-container');
      }
    }

    await renderGrid();

    // Render playlist panel
    let playlistPanel = document.getElementById('ex-playlist-panel');
    if (!playlistPanel && Auth.isAdminOrCoach()) {
      section.insertAdjacentHTML('beforeend', _playlistPanelHTML());
      playlistPanel = document.getElementById('ex-playlist-panel');
      await renderPlaylists();
    }
  }

  function _filterBarHTML() {
    return `
      <div id="ex-filter-bar" class="ex-filter-bar">
        <input id="ex-search" class="form-input" placeholder="Search exercises…" style="flex:1;max-width:280px" oninput="ExerciseUI.onSearch(this.value)"/>
        <select id="ex-phase-filter" class="form-input" style="width:140px" onchange="ExerciseUI.onFilter()">
          <option value="">All Phases</option>
          <option value="Phase 1">Phase 1</option>
          <option value="Phase 2">Phase 2</option>
          <option value="Phase 3">Phase 3</option>
        </select>
        <select id="ex-cat-filter" class="form-input" style="width:150px" onchange="ExerciseUI.onFilter()">
          <option value="">All Categories</option>
          <option value="Rehab">Rehab</option>
          <option value="Mobility">Mobility</option>
          <option value="Strength">Strength</option>
          <option value="Neurology">Neurology</option>
          <option value="Breathing">Breathing</option>
        </select>
      </div>`;
  }

  function _bindFilterBar() {
    // Filters are wired via inline onchange/oninput attributes
  }

  function onSearch(val) {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _filters.search = val;
      renderGrid();
    }, 280);
  }

  function onFilter() {
    _filters.phase    = document.getElementById('ex-phase-filter')?.value || '';
    _filters.category = document.getElementById('ex-cat-filter')?.value  || '';
    renderGrid();
  }

  async function renderGrid() {
    const container = document.getElementById('exercise-grid-container');
    if (!container) return;

    container.innerHTML = `<div style="display:flex;justify-content:center;padding:40px"><span class="spinner spinner-lg"></span></div>`;

    const exercises = await ExerciseLibrary.loadAll(_filters);

    if (!exercises.length) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">▶</span>
          <div class="empty-title">No exercises found</div>
          <p class="empty-desc">${_filters.search || _filters.phase || _filters.category ? 'Try different filters.' : 'Add exercises or import from a YouTube playlist.'}</p>
        </div>`;
      return;
    }

    container.innerHTML = `<div class="exercise-grid-ph3">${exercises.map(ex => _exerciseCard(ex)).join('')}</div>`;
  }

  function _exerciseCard(ex) {
    const hasVideo = !!ex.video_url;
    const thumbUrl = ex.thumbnail_url || (hasVideo ? ExerciseLibrary.getThumbnailUrl(ex.video_url) : null);
    const catColor = _catColor(ex.category);

    return `
      <div class="ex-card" id="ex-card-${ex.id}">
        ${thumbUrl ? `
          <div class="ex-card-thumb" onclick="ExerciseUI.openVideoModal('${_esc(ex.id)}','${_esc(ex.name)}','${_esc(ex.video_url || '')}')">
            <img src="${thumbUrl}" alt="${_esc(ex.name)}" loading="lazy"/>
            <div class="ex-card-play-btn">▶</div>
          </div>` : `
          <div class="ex-card-thumb-placeholder" style="background:var(--bg-raised);display:flex;align-items:center;justify-content:center;height:140px;color:var(--text-tertiary);font-size:28px">▶</div>`}
        <div class="ex-card-body">
          <div class="ex-card-title">${_esc(ex.name)}</div>
          <div class="ex-card-badges">
            <span class="badge ${_phaseBadge(ex.phase)}">${ex.phase}</span>
            <span style="font-size:10px;font-weight:600;color:${catColor};padding:2px 8px;border-radius:var(--r-full);border:1px solid ${catColor}44;background:${catColor}10">${ex.category}</span>
          </div>
          ${ex.cues ? `<p class="ex-card-cues">${_esc(ex.cues.slice(0, 80))}${ex.cues.length > 80 ? '…' : ''}</p>` : ''}
          ${Array.isArray(ex.tags) && ex.tags.length ? `
            <div class="ex-card-tags">${ex.tags.map(t => `<span class="case-tag">${_esc(t)}</span>`).join('')}</div>` : ''}
          <div class="ex-card-actions">
            <button class="btn btn-primary btn-xs" onclick="ExerciseUI.addToProgram('${ex.id}')">+ Add to Program</button>
            ${hasVideo ? `<button class="btn btn-ghost btn-xs" onclick="ExerciseUI.openVideoModal('${_esc(ex.id)}','${_esc(ex.name)}','${_esc(ex.video_url || '')}')">▶ Preview</button>` : ''}
            ${Auth.isAdminOrCoach() ? `<button class="btn btn-ghost btn-xs" onclick="ExerciseUI.openEditModal('${ex.id}')">Edit</button>` : ''}
            ${Auth.isAdminOrCoach() ? `<button class="btn btn-ghost btn-xs" style="color:var(--rose)" onclick="ExerciseUI.deleteExercise('${ex.id}','${_esc(ex.name)}')">✕</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  VIDEO MODAL
  // ═══════════════════════════════════════════════════════════

  function openVideoModal(id, name, videoUrl) {
    let modal = document.getElementById('modal-ex-video');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay hidden" id="modal-ex-video">
          <div class="modal" style="max-width:720px">
            <div class="modal-header">
              <h3 id="ex-video-title">Exercise</h3>
              <button class="btn-icon" onclick="ExerciseUI.closeVideoModal()">✕</button>
            </div>
            <div class="modal-body" style="padding:0">
              <div id="ex-video-container" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;background:#000">
                <iframe id="ex-video-iframe" style="position:absolute;inset:0;width:100%;height:100%;border:none" allowfullscreen></iframe>
              </div>
              <div id="ex-video-details" style="padding:var(--sp-4)"></div>
            </div>
          </div>
        </div>`);
      modal = document.getElementById('modal-ex-video');
      modal.addEventListener('click', e => { if (e.target === modal) closeVideoModal(); });
    }

    const embedUrl = ExerciseLibrary.getEmbedUrl(videoUrl);
    document.getElementById('ex-video-title').textContent = name;
    document.getElementById('ex-video-iframe').src = embedUrl || '';
    modal.classList.remove('hidden');
  }

  function closeVideoModal() {
    const modal = document.getElementById('modal-ex-video');
    if (modal) {
      modal.classList.add('hidden');
      const iframe = document.getElementById('ex-video-iframe');
      if (iframe) iframe.src = ''; // stop playback
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  ADD / EDIT MODALS
  // ═══════════════════════════════════════════════════════════

  function openAddModal() {
    _openExModal();
  }

  async function openEditModal(id) {
    const ex = await ExerciseLibrary.getById(id);
    if (!ex) { Dashboard.toast('Exercise not found', 'error'); return; }
    _openExModal(ex);
  }

  function _openExModal(ex = null) {
    let modal = document.getElementById('modal-ex-form');
    if (!modal) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay hidden" id="modal-ex-form">
          <div class="modal" style="max-width:560px">
            <div class="modal-header">
              <h3 id="ex-form-title">Add Exercise</h3>
              <button class="btn-icon" onclick="ExerciseUI.closeExModal()">✕</button>
            </div>
            <div class="modal-body">
              <input type="hidden" id="ex-form-id"/>
              <div class="form-group"><label class="form-label">Name *</label><input id="ex-form-name" class="form-input" placeholder="e.g. 90/90 Hip IR PAILs"/></div>
              <div class="input-row">
                <div class="form-group">
                  <label class="form-label">Category</label>
                  <select id="ex-form-category" class="form-input">
                    <option value="Rehab">Rehab</option>
                    <option value="Mobility">Mobility</option>
                    <option value="Strength">Strength</option>
                    <option value="Neurology">Neurology</option>
                    <option value="Breathing">Breathing</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Phase</label>
                  <select id="ex-form-phase" class="form-input">
                    <option value="Phase 1">Phase 1</option>
                    <option value="Phase 2">Phase 2</option>
                    <option value="Phase 3">Phase 3</option>
                  </select>
                </div>
              </div>
              <div class="form-group"><label class="form-label">YouTube URL</label><input id="ex-form-video" class="form-input" placeholder="https://youtube.com/watch?v=…"/></div>
              <div class="form-group"><label class="form-label">Coaching Cues</label><textarea id="ex-form-cues" class="form-input" style="min-height:72px" placeholder="Setup, execution, breathing cues…"></textarea></div>
              <div class="form-group"><label class="form-label">Common Errors</label><input id="ex-form-errors" class="form-input" placeholder="e.g. Lumbar extension, hip hike…"/></div>
              <div class="form-group"><label class="form-label">Tags (comma-separated)</label><input id="ex-form-tags" class="form-input" placeholder="e.g. hip, pails, mobility"/></div>
              <div class="form-group"><label class="form-label">Target Joints (comma-separated)</label><input id="ex-form-joints" class="form-input" placeholder="e.g. hip_ir, ankle_df"/></div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-ghost" onclick="ExerciseUI.closeExModal()">Cancel</button>
              <button class="btn btn-primary" onclick="ExerciseUI.submitExForm()">Save Exercise</button>
            </div>
          </div>
        </div>`);
      modal = document.getElementById('modal-ex-form');
      modal.addEventListener('click', e => { if (e.target === modal) closeExModal(); });
    }

    // Populate form
    document.getElementById('ex-form-title').textContent = ex ? 'Edit Exercise' : 'Add Exercise';
    document.getElementById('ex-form-id').value          = ex?.id || '';
    document.getElementById('ex-form-name').value        = ex?.name || '';
    document.getElementById('ex-form-category').value    = ex?.category || 'Rehab';
    document.getElementById('ex-form-phase').value       = ex?.phase || 'Phase 1';
    document.getElementById('ex-form-video').value       = ex?.video_url || '';
    document.getElementById('ex-form-cues').value        = ex?.cues || '';
    document.getElementById('ex-form-errors').value      = ex?.common_errors || '';
    document.getElementById('ex-form-tags').value        = (ex?.tags || []).join(', ');
    document.getElementById('ex-form-joints').value      = (ex?.target_joints || []).join(', ');

    modal.classList.remove('hidden');
  }

  function closeExModal() {
    document.getElementById('modal-ex-form')?.classList.add('hidden');
  }

  async function submitExForm() {
    const id       = document.getElementById('ex-form-id')?.value;
    const name     = document.getElementById('ex-form-name')?.value?.trim();
    const category = document.getElementById('ex-form-category')?.value;
    const phase    = document.getElementById('ex-form-phase')?.value;
    const videoUrl = document.getElementById('ex-form-video')?.value?.trim();
    const cues     = document.getElementById('ex-form-cues')?.value?.trim();
    const errors   = document.getElementById('ex-form-errors')?.value?.trim();
    const tagsRaw  = document.getElementById('ex-form-tags')?.value || '';
    const jointsRaw = document.getElementById('ex-form-joints')?.value || '';

    if (!name) { Dashboard.toast('Exercise name required', 'error'); return; }

    const fields = {
      name, category, phase,
      video_url:     videoUrl || null,
      thumbnail_url: videoUrl ? ExerciseLibrary.getThumbnailUrl(videoUrl) : null,
      cues:          cues || null,
      common_errors: errors || null,
      tags:          tagsRaw.split(',').map(t => t.trim()).filter(Boolean),
      target_joints: jointsRaw.split(',').map(t => t.trim()).filter(Boolean),
    };

    try {
      if (id) {
        await ExerciseLibrary.update(id, fields);
        Dashboard.toast('Exercise updated!', 'success');
      } else {
        await ExerciseLibrary.create(fields);
        Dashboard.toast('Exercise added!', 'success');
      }
      closeExModal();
      renderGrid();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function deleteExercise(id, name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await ExerciseLibrary.remove(id);
      Dashboard.toast('Exercise deleted', 'info');
      document.getElementById(`ex-card-${id}`)?.remove();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function addToProgram(id) {
    const ex = await ExerciseLibrary.getById(id);
    if (!ex) { Dashboard.toast('Could not load exercise', 'error'); return; }
    ExerciseLibrary.addToProgram(ex);
  }

  // ═══════════════════════════════════════════════════════════
  //  YOUTUBE PLAYLIST PANEL
  // ═══════════════════════════════════════════════════════════

  function _playlistPanelHTML() {
    return `
      <div class="card" id="ex-playlist-panel" style="margin-top:var(--sp-5)">
        <div class="card-header">
          <span class="card-title">YouTube Playlists</span>
          <button class="btn btn-ghost btn-sm" onclick="ExerciseUI.openPlaylistModal()">+ Connect Playlist</button>
        </div>
        <div id="playlist-list"></div>
      </div>
      <div class="modal-overlay hidden" id="modal-playlist">
        <div class="modal">
          <div class="modal-header"><h3>Connect YouTube Playlist</h3><button class="btn-icon" onclick="ExerciseUI.closePlaylistModal()">✕</button></div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">Playlist ID</label><input id="pl-id" class="form-input" placeholder="PLxxxxxxxxxxxxxxxx"/><div class="form-hint">Found in the YouTube playlist URL after ?list=</div></div>
            <div class="form-group"><label class="form-label">Name</label><input id="pl-name" class="form-input" placeholder="Phase 1 Mobility Exercises"/></div>
            <div class="form-group">
              <label class="form-label">Phase Mapping</label>
              <select id="pl-phase" class="form-input">
                <option value="All">All Phases</option>
                <option value="Phase 1">Phase 1</option>
                <option value="Phase 2">Phase 2</option>
                <option value="Phase 3">Phase 3</option>
              </select>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:4px">
              <input type="checkbox" id="pl-autosync" style="accent-color:var(--lime)"/>
              <span style="font-size:13px">Auto-sync on load</span>
            </label>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="ExerciseUI.closePlaylistModal()">Cancel</button>
            <button class="btn btn-primary" onclick="ExerciseUI.submitPlaylist()">Save & Import</button>
          </div>
        </div>
      </div>`;
  }

  async function renderPlaylists() {
    const el = document.getElementById('playlist-list');
    if (!el) return;

    const playlists = await ExerciseLibrary.loadPlaylists();
    if (!playlists.length) {
      el.innerHTML = `<div style="padding:16px;color:var(--text-tertiary);font-size:13px">No playlists connected. Add a YouTube playlist to auto-import exercises.</div>`;
      return;
    }

    el.innerHTML = playlists.map(pl => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border-subtle)">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${pl.name || pl.youtube_playlist_id}</div>
          <div style="font-size:11px;color:var(--text-tertiary)">${pl.phase_mapping} · ${pl.last_synced_at ? 'Synced ' + new Date(pl.last_synced_at).toLocaleDateString() : 'Never synced'}</div>
        </div>
        <span class="badge badge-phase${pl.phase_mapping === 'Phase 1' ? '1' : pl.phase_mapping === 'Phase 2' ? '2' : pl.phase_mapping === 'Phase 3' ? '3' : 'active'}">${pl.phase_mapping}</span>
        <button class="btn btn-teal btn-xs" onclick="ExerciseUI.syncPlaylist('${pl.id}')">Sync Now</button>
      </div>`).join('');
  }

  function openPlaylistModal() {
    document.getElementById('modal-playlist')?.classList.remove('hidden');
  }

  function closePlaylistModal() {
    document.getElementById('modal-playlist')?.classList.add('hidden');
  }

  async function submitPlaylist() {
    const playlistId = document.getElementById('pl-id')?.value?.trim();
    const name       = document.getElementById('pl-name')?.value?.trim();
    const phase      = document.getElementById('pl-phase')?.value;
    const autoSync   = document.getElementById('pl-autosync')?.checked;

    if (!playlistId) { Dashboard.toast('Playlist ID required', 'error'); return; }

    try {
      const pl = await ExerciseLibrary.savePlaylist(playlistId, name, phase, autoSync);
      Dashboard.toast('Playlist saved! Importing exercises…', 'info');
      closePlaylistModal();
      const results = await ExerciseLibrary.syncPlaylist(pl);
      Dashboard.toast(`Imported ${results.imported}, skipped ${results.skipped}`, 'success');
      renderGrid();
      renderPlaylists();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  async function syncPlaylist(id) {
    const playlists = await ExerciseLibrary.loadPlaylists();
    const pl = playlists.find(p => p.id === id);
    if (!pl) return;
    Dashboard.toast('Syncing…', 'info');
    try {
      const results = await ExerciseLibrary.syncPlaylist(pl);
      Dashboard.toast(`Sync complete: ${results.imported} new, ${results.skipped} skipped`, 'success');
      renderGrid();
      renderPlaylists();
    } catch(e) {
      Dashboard.toast(e.message, 'error');
    }
  }

  return {
    render, renderGrid, onSearch, onFilter,
    openVideoModal, closeVideoModal,
    openAddModal, openEditModal, closeExModal, submitExForm, deleteExercise,
    addToProgram,
    openPlaylistModal, closePlaylistModal, submitPlaylist, syncPlaylist,
    renderPlaylists,
  };

})();

window.ExerciseUI = ExerciseUI;
