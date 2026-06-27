// ═══════════════════════════════════════════════════════════════
//  js/athleticService.js
//  Controller and rendering logic for AST9 Athletic Performance Lane
//  Includes: Story Intake, Battery Builder, Telemetry Assessment, Athlete Profile.
// ═══════════════════════════════════════════════════════════════

const AthleticService = (() => {

  const CATEGORIES = [
    'Strength', 'Power', 'Speed', 'Acceleration', 'Max Velocity',
    'Agility / Change of Direction', 'Deceleration', 'Jumping', 'Landing',
    'Single-leg Control', 'Aerobic Capacity', 'Anaerobic Capacity',
    'Mobility / Flexibility', 'Dynamic ROM', 'Body Composition',
    'Readiness / Fatigue', 'Injury / Pain Flags', 'Sport / Position Needs Analysis'
  ];

  let cachedClients = [];
  let cachedBatteries = [];
  let cachedAssessments = [];
  let currentStoryStep = 0;
  let activeBattery = null;
  let activeAssessmentTests = [];

  const FINDING_TAGS = [
    'limited_range', 'range_loss_under_load', 'poor_control', 'asymmetry',
    'delayed_braking', 'early_collapse', 'insufficient_stiffness', 'excessive_stiffness',
    'poor_trunk_control', 'poor_pelvic_control', 'low_force_projection', 'low_force_absorption',
    'energy_leak', 'timing_fault', 'pain_limited', 'fatigue_limited'
  ];

  const PHASE_LABELS = {
    off: 'Off-Season',
    pre: 'Pre-Season',
    in: 'In-Season',
    post: 'Post-Season',
    unknown: 'Unknown'
  };

  const SIDE_LABELS = {
    left: 'Left',
    right: 'Right',
    bilateral: 'Bilateral',
    na: 'N/A',
    unknown: 'Unknown'
  };

  const TAG_LABELS = {
    limited_range: 'Limited Range',
    range_loss_under_load: 'Range Loss Under Load',
    poor_control: 'Poor Control',
    asymmetry: 'Asymmetry',
    delayed_braking: 'Delayed Braking',
    early_collapse: 'Early Collapse',
    insufficient_stiffness: 'Insufficient Stiffness',
    excessive_stiffness: 'Excessive Stiffness',
    poor_trunk_control: 'Poor Trunk Control',
    poor_pelvic_control: 'Poor Pelvic Control',
    low_force_projection: 'Low Force Projection',
    low_force_absorption: 'Low Force Absorption',
    energy_leak: 'Energy Leak',
    timing_fault: 'Timing Fault',
    pain_limited: 'Pain Limited',
    fatigue_limited: 'Fatigue Limited'
  };

  const DOMAIN_LABELS = {
    accel: 'Acceleration',
    maxv: 'Max Velocity',
    jump_takeoff: 'Jump Takeoff',
    landing: 'Landing',
    decel: 'Deceleration',
    cod: 'Change of Direction',
    sl_control: 'Single-Leg Control',
    lateral: 'Lateral Movement',
    rotation: 'Rotational Control',
    dyn_mobility: 'Dynamic Mobility'
  };

  function normalizeSide(value) {
    const v = String(value || '').trim().toLowerCase();
    if (['left', 'right', 'bilateral', 'na'].includes(v)) return v;
    return 'na';
  }

  function safeJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return { raw_notes: String(value) };
    }
  }

  // Initialize and populate dropdown selectors
  async function populateAthleteSelects() {
    try {
      let q = sb.from('profiles').select('id, full_name, email')
        .eq('role', 'client').order('full_name');

      if (typeof Auth !== 'undefined' && Auth.isCoach()) {
        q = q.eq('assigned_coach', Auth.getUser()?.id);
      }

      const { data, error } = await q;
      if (error) throw error;

      cachedClients = data || [];

      const selectIds = ['story-athlete-select', 'assess-athlete-select', 'profile-athlete-select'];
      selectIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const currentVal = el.value;
        el.innerHTML = '<option value="">— Select Athlete —</option>';
        cachedClients.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.full_name || c.email;
          el.appendChild(opt);
        });
        if (currentVal) el.value = currentVal;
      });
    } catch (e) {
      console.error('[AthleticService] Failed to populate athlete lists:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  1. ATHLETE STORY INTAKE
  // ═══════════════════════════════════════════════════════════════

  function loadStoryIntake() {
    switchStoryStep(0);
    loadSelectedAthleteStory();
  }

  async function loadSelectedAthleteStory() {
    const select = document.getElementById('story-athlete-select');
    const loading = document.getElementById('story-loading-state');
    const empty = document.getElementById('story-empty-state');
    const container = document.getElementById('story-form-container');
    const form = document.getElementById('story-form');
    const accessDenied = document.getElementById('story-access-denied-state');

    if (!select || !loading || !empty || !container) return;

    if (accessDenied) accessDenied.style.display = 'none';

    const athleteId = select.value;
    if (!athleteId) {
      empty.style.display = 'block';
      container.style.display = 'none';
      loading.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    container.style.display = 'none';
    loading.style.display = 'block';

    try {
      const { data, error } = await sb.from('athlete_profiles')
        .select('*')
        .eq('client_id', athleteId)
        .maybeSingle();

      if (error) throw error;

      form.reset();

      if (data) {
        document.getElementById('story-sport').value = data.sport || '';
        document.getElementById('story-position').value = data.position || '';
        document.getElementById('story-level').value = data.level || 'Collegiate';
        document.getElementById('story-training-age').value = data.training_age_years || '';
        document.getElementById('story-dominant-side').value = data.dominant_side || 'right';
        document.getElementById('story-season-phase').value = data.season_phase || 'off';
        document.getElementById('story-comp-dates').value = Array.isArray(data.competition_dates) ? data.competition_dates.join(', ') : '';
        
        const goalsVal = data.goals;
        document.getElementById('story-goals').value = (goalsVal && typeof goalsVal === 'object')
          ? (goalsVal.raw_notes || JSON.stringify(goalsVal))
          : (goalsVal || '');

        document.getElementById('story-days-week').value = data.available_days_per_week || '3';
        document.getElementById('story-duration').value = data.session_duration_minutes || '';
        document.getElementById('story-equipment').value = Array.isArray(data.equipment) ? data.equipment.join(', ') : '';
        document.getElementById('story-environment').value = data.training_environment || '';
        
        const injuryVal = data.injury_history;
        document.getElementById('story-injury-history').value = (injuryVal && typeof injuryVal === 'object')
          ? (injuryVal.raw_notes || JSON.stringify(injuryVal))
          : (injuryVal || '');

        document.getElementById('story-flags').value = Array.isArray(data.current_flags) ? data.current_flags.join(', ') : '';
      }

      loading.style.display = 'none';
      container.style.display = 'block';
      switchStoryStep(0);
    } catch (e) {
      loading.style.display = 'none';
      const isRls = e && (e.code === '42501' || e.status === 403 || (e.message && (e.message.includes('policy') || e.message.toLowerCase().includes('permission') || e.message.toLowerCase().includes('row-level security'))));
      if (isRls && accessDenied) {
        accessDenied.style.display = 'block';
        container.style.display = 'none';
        empty.style.display = 'none';
      } else {
        empty.style.display = 'block';
        if (typeof toast !== 'undefined') {
          toast('Error loading profile: ' + e.message, 'error');
        } else {
          alert('Error loading profile: ' + e.message);
        }
      }
    }
  }

  function switchStoryStep(idx) {
    currentStoryStep = idx;
    document.querySelectorAll('.story-step-panel').forEach((p, i) => {
      p.style.display = i === idx ? 'block' : 'none';
    });

    for (let i = 0; i < 4; i++) {
      const btn = document.getElementById('story-step-btn-' + i);
      if (btn) {
        if (i === idx) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    }

    const prevBtn = document.getElementById('story-prev-btn');
    const nextBtn = document.getElementById('story-next-btn');
    const submitBtn = document.getElementById('story-submit-btn');

    if (prevBtn) prevBtn.style.display = idx === 0 ? 'none' : 'inline-block';
    if (nextBtn) nextBtn.style.display = idx === 3 ? 'none' : 'inline-block';
    if (submitBtn) submitBtn.style.display = idx === 3 ? 'inline-block' : 'none';
  }

  function nextStoryStep() {
    if (currentStoryStep < 3) switchStoryStep(currentStoryStep + 1);
  }

  function prevStoryStep() {
    if (currentStoryStep > 0) switchStoryStep(currentStoryStep - 1);
  }

  async function saveAthleteStory() {
    const select = document.getElementById('story-athlete-select');
    if (!select || !select.value) return;

    const athleteId = select.value;
    const coachId = Auth.getUser()?.id;

    const compDates = document.getElementById('story-comp-dates').value.split(',').map(s => s.trim()).filter(Boolean);
    const equip = document.getElementById('story-equipment').value.split(',').map(s => s.trim()).filter(Boolean);
    const flags = document.getElementById('story-flags').value.split(',').map(s => s.trim()).filter(Boolean);

    const payload = {
      client_id: athleteId,
      sport: document.getElementById('story-sport').value,
      position: document.getElementById('story-position').value,
      level: document.getElementById('story-level').value,
      training_age_years: parseInt(document.getElementById('story-training-age').value) || 0,
      dominant_side: document.getElementById('story-dominant-side').value,
      season_phase: document.getElementById('story-season-phase').value,
      goals: safeJsonObject(document.getElementById('story-goals').value),
      competition_dates: compDates,
      available_days_per_week: parseInt(document.getElementById('story-days-week').value) || 3,
      session_duration_minutes: parseInt(document.getElementById('story-duration').value) || 60,
      equipment: equip,
      training_environment: document.getElementById('story-environment').value,
      injury_history: safeJsonObject(document.getElementById('story-injury-history').value),
      current_flags: flags,
      coach_id: coachId,
      created_by: coachId
    };

    try {
      const { error } = await sb.from('athlete_profiles')
        .upsert(payload, { onConflict: 'client_id' });

      if (error) throw error;
      if (typeof toast !== 'undefined') {
        toast('Athlete story profile saved successfully!', 'success');
      } else {
        alert('Athlete story profile saved successfully!');
      }
    } catch (e) {
      if (typeof toast !== 'undefined') {
        toast('Failed to save profile: ' + e.message, 'error');
      } else {
        alert('Failed to save profile: ' + e.message);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  2. ASSESSMENT BATTERY BUILDER
  // ═══════════════════════════════════════════════════════════════

  async function loadMovementAssessment() {
    switchAssessSubtab('record');
    loadSelectedAthleteAssessment();
    await populateBatterySelects();
    await loadBatteryBuilderRail();
  }

  function switchAssessSubtab(tabName) {
    document.querySelectorAll('.assess-tab-panel').forEach(p => {
      p.style.display = p.id === 'assess-tab-' + tabName ? 'block' : 'none';
    });
    ['record', 'builder', 'observations'].forEach(t => {
      const btn = document.getElementById('assess-subtab-btn-' + t);
      if (btn) {
        if (t === tabName) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });
    if (tabName === 'observations') {
      loadObservationsTab();
    }
  }

  async function populateBatterySelects() {
    const select = document.getElementById('assess-battery-select');
    if (!select) return;

    try {
      const { data, error } = await sb.from('assessment_batteries')
        .select('id, name, is_default');

      if (error) throw error;

      cachedBatteries = data || [];
      select.innerHTML = '<option value="">— Free Form Session —</option>';
      cachedBatteries.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.name + (b.is_default ? ' (System)' : '');
        select.appendChild(opt);
      });
    } catch (e) {
      console.error('[AthleticService] Failed to populate batteries list:', e.message);
      const isRls = e && (e.code === '42501' || e.status === 403 || (e.message && (e.message.includes('policy') || e.message.toLowerCase().includes('permission') || e.message.toLowerCase().includes('row-level security'))));
      if (isRls) {
        const accessDenied = document.getElementById('assess-access-denied-state');
        if (accessDenied) {
          accessDenied.style.display = 'block';
          const empty = document.getElementById('assess-empty-athlete');
          const formContainer = document.getElementById('assess-form-container');
          if (empty) empty.style.display = 'none';
          if (formContainer) formContainer.style.display = 'none';
        }
      }
    }
  }

  async function loadBatteryBuilderRail() {
    const container = document.getElementById('battery-list-container');
    if (!container) return;
    container.innerHTML = '<span class="spinner spinner-sm"></span>';

    try {
      const { data, error } = await sb.from('assessment_batteries')
        .select('*')
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;

      container.innerHTML = '';
      if (!data || data.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:var(--nc-text-muted)">No batteries.</div>';
        return;
      }

      data.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-block';
        btn.style.textAlign = 'left';
        btn.style.justifyContent = 'flex-start';
        btn.style.fontSize = '12.5px';
        btn.innerHTML = b.is_default
          ? `🔒 <span style="margin-left:4px">${b.name}</span>`
          : `⚡ <span style="margin-left:4px">${b.name}</span>`;

        btn.onclick = () => editBattery(b);
        container.appendChild(btn);
      });
    } catch (e) {
      container.innerHTML = '<div style="font-size:11px;color:#F5426C">Load error.</div>';
    }
  }

  function editBattery(b) {
    activeBattery = JSON.parse(JSON.stringify(b)); // deep copy

    document.getElementById('battery-editor-empty').style.display = 'none';
    document.getElementById('battery-editor-form').style.display = 'block';

    const isLocked = activeBattery.is_default;
    document.getElementById('battery-system-badge').style.display = isLocked ? 'inline-block' : 'none';

    // Set fields
    document.getElementById('bat-name').value = activeBattery.name || '';
    document.getElementById('bat-name').disabled = isLocked;
    document.getElementById('bat-sport').value = activeBattery.sport || '';
    document.getElementById('bat-sport').disabled = isLocked;
    document.getElementById('bat-position').value = activeBattery.position || '';
    document.getElementById('bat-position').disabled = isLocked;
    document.getElementById('bat-level').value = activeBattery.level || '';
    document.getElementById('bat-level').disabled = isLocked;

    // Controls
    document.getElementById('bat-delete-btn').style.display = isLocked ? 'none' : 'inline-block';
    document.getElementById('bat-save-btn').style.display = isLocked ? 'none' : 'inline-block';
    const addRowBtn = document.getElementById('bat-add-row-btn');
    if (addRowBtn) addRowBtn.style.display = isLocked ? 'none' : 'inline-block';

    renderBatteryTests();
  }

  function createNewBattery() {
    editBattery({
      id: null,
      name: 'New Custom Battery',
      sport: 'All',
      position: 'All',
      level: 'All',
      category: 'General',
      is_default: false,
      test_order: []
    });
  }

  function renderBatteryTests() {
    const list = document.getElementById('battery-tests-list');
    if (!list) return;
    list.innerHTML = '';

    if (!activeBattery || !Array.isArray(activeBattery.test_order)) return;

    const isLocked = activeBattery.is_default;

    if (activeBattery.test_order.length === 0) {
      list.innerHTML = `<div style="font-size:12px;color:var(--nc-text-muted);text-align:center;padding:12px">No tests. Add a test row.</div>`;
      return;
    }

    activeBattery.test_order.forEach((t, idx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '8px';
      row.style.alignItems = 'center';
      row.style.background = 'rgba(255, 255, 255, 0.01)';
      row.style.border = '1px solid var(--nc-border)';
      row.style.padding = '8px';
      row.style.borderRadius = '8px';

      const catSelect = document.createElement('select');
      catSelect.className = 'form-input';
      catSelect.style.flex = '1';
      catSelect.disabled = isLocked;
      CATEGORIES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        catSelect.appendChild(opt);
      });
      catSelect.value = t.category || 'Strength';
      catSelect.onchange = (e) => { t.category = e.target.value; };

      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'form-input';
      keyInput.style.flex = '1.5';
      keyInput.placeholder = 'Test Name (e.g. 40yd Sprint)';
      keyInput.value = t.test_key || '';
      keyInput.disabled = isLocked;
      keyInput.oninput = (e) => { t.test_key = e.target.value; };

      const targetInput = document.createElement('input');
      targetInput.type = 'text';
      targetInput.className = 'form-input';
      targetInput.style.flex = '1';
      targetInput.placeholder = 'Target (Optional)';
      targetInput.value = t.target_value || '';
      targetInput.disabled = isLocked;
      targetInput.oninput = (e) => { t.target_value = e.target.value; };

      row.appendChild(catSelect);
      row.appendChild(keyInput);
      row.appendChild(targetInput);

      if (!isLocked) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-secondary btn-xs';
        delBtn.style.borderColor = '#F5426C';
        delBtn.style.color = '#F5426C';
        delBtn.textContent = '✕';
        delBtn.onclick = () => {
          activeBattery.test_order.splice(idx, 1);
          renderBatteryTests();
        };
        row.appendChild(delBtn);
      }

      list.appendChild(row);
    });
  }

  function addTestToBattery() {
    if (!activeBattery || activeBattery.is_default) return;
    activeBattery.test_order = activeBattery.test_order || [];
    activeBattery.test_order.push({
      category: 'Strength',
      test_key: '',
      target_value: '',
      notes: ''
    });
    renderBatteryTests();
  }

  async function saveBattery() {
    if (!activeBattery || activeBattery.is_default) return;

    const name = document.getElementById('bat-name').value;
    if (!name) {
      if (typeof toast !== 'undefined') {
        toast('Battery name is required!', 'error');
      } else {
        alert('Battery name is required!');
      }
      return;
    }

    const payload = {
      name,
      sport: document.getElementById('bat-sport').value,
      position: document.getElementById('bat-position').value,
      level: document.getElementById('bat-level').value,
      category: activeBattery.category || 'General',
      test_order: activeBattery.test_order || [],
      is_default: false,
      created_by: Auth.getUser()?.id
    };

    try {
      let err;
      if (activeBattery.id) {
        const { error } = await sb.from('assessment_batteries')
          .update(payload)
          .eq('id', activeBattery.id);
        err = error;
      } else {
        const { error } = await sb.from('assessment_batteries')
          .insert([payload]);
        err = error;
      }

      if (err) throw err;

      if (typeof toast !== 'undefined') {
        toast('Battery template saved!', 'success');
      } else {
        alert('Battery template saved!');
      }
      await populateBatterySelects();
      await loadBatteryBuilderRail();
      document.getElementById('battery-editor-form').style.display = 'none';
      document.getElementById('battery-editor-empty').style.display = 'block';
    } catch (e) {
      if (typeof toast !== 'undefined') {
        toast('Save failed: ' + e.message, 'error');
      } else {
        alert('Save failed: ' + e.message);
      }
    }
  }

  async function deleteBattery() {
    if (!activeBattery || !activeBattery.id || activeBattery.is_default) return;

    if (!confirm('Are you sure you want to delete this custom battery template?')) return;

    try {
      const { error } = await sb.from('assessment_batteries')
        .delete()
        .eq('id', activeBattery.id);

      if (error) throw error;

      if (typeof toast !== 'undefined') {
        toast('Battery template deleted.', 'success');
      } else {
        alert('Battery template deleted.');
      }
      await populateBatterySelects();
      await loadBatteryBuilderRail();
      document.getElementById('battery-editor-form').style.display = 'none';
      document.getElementById('battery-editor-empty').style.display = 'block';
    } catch (e) {
      if (typeof toast !== 'undefined') {
        toast('Deletion failed: ' + e.message, 'error');
      } else {
        alert('Deletion failed: ' + e.message);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  3. ATHLETIC MOVEMENT ASSESSMENT
  // ═══════════════════════════════════════════════════════════════

  function loadSelectedAthleteAssessment() {
    const select = document.getElementById('assess-athlete-select');
    const empty = document.getElementById('assess-empty-athlete');
    const formContainer = document.getElementById('assess-form-container');
    const accessDenied = document.getElementById('assess-access-denied-state');

    if (!select || !empty || !formContainer) return;

    if (accessDenied) accessDenied.style.display = 'none';

    const athleteId = select.value;
    if (!athleteId) {
      empty.style.display = 'block';
      formContainer.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    formContainer.style.display = 'block';
    applyBatteryToAssessment();
  }

  async function applyBatteryToAssessment() {
    const batterySelect = document.getElementById('assess-battery-select');
    if (!batterySelect) return;

    const batteryId = batterySelect.value;
    activeAssessmentTests = [];

    if (!batteryId) {
      renderAssessmentForm();
      return;
    }

    try {
      const { data, error } = await sb.from('assessment_batteries')
        .select('*')
        .eq('id', batteryId)
        .single();

      if (error) throw error;

      if (data && Array.isArray(data.test_order)) {
        activeAssessmentTests = data.test_order.map(t => ({
          category: t.category,
          test_key: t.test_key,
          trials: ['', '', ''],
          unit: 'cm',
          side: 'Bilateral',
          conditions: '',
          coach_note: ''
        }));
      }

      renderAssessmentForm();
    } catch (e) {
      console.error('[AthleticService] Failed to load battery tests:', e.message);
      renderAssessmentForm();
    }
  }

  function renderAssessmentForm() {
    const container = document.getElementById('assess-test-list');
    if (!container) return;
    container.innerHTML = '';

    if (activeAssessmentTests.length === 0) {
      container.innerHTML = `
        <div class="card" style="padding:32px;text-align:center;color:var(--nc-text-secondary);border:1px dashed var(--nc-border)">
          No tests loaded. Please select a template battery or add a test parameter below.
          <div style="margin-top:14px">
            <button class="btn btn-secondary btn-xs" onclick="AthleticService.addFreeFormTest()">+ Add Manual Parameter</button>
          </div>
        </div>`;
      return;
    }

    activeAssessmentTests.forEach((t, idx) => {
      const card = document.createElement('div');
      card.className = 'card glass-card';
      card.style.padding = '20px';
      card.style.border = '1px solid var(--nc-border)';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '16px';

      const titleDiv = document.createElement('div');
      titleDiv.innerHTML = `
        <span class="badge" style="background:rgba(225,29,72,0.12);color:#FB7185;margin-right:8px;font-size:10px">${t.category}</span>
        <strong style="color:var(--nc-text-primary);font-size:14px">${t.test_key || 'Unnamed Parameter'}</strong>
      `;
      header.appendChild(titleDiv);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-ghost btn-xs';
      delBtn.style.color = '#F5426C';
      delBtn.textContent = '✕ Remove';
      delBtn.onclick = () => {
        activeAssessmentTests.splice(idx, 1);
        renderAssessmentForm();
      };
      header.appendChild(delBtn);

      const inputsRow = document.createElement('div');
      inputsRow.style.display = 'grid';
      inputsRow.style.gridTemplateColumns = 'repeat(auto-fit, minmax(110px, 1fr))';
      inputsRow.style.gap = '12px';
      inputsRow.style.marginBottom = '16px';

      t.trials = t.trials || ['', '', ''];

      for (let i = 0; i < 3; i++) {
        const grp = document.createElement('div');
        grp.className = 'form-group';
        grp.innerHTML = `<label class="form-label" style="font-size:10.5px">Trial ${i + 1}</label>`;

        const input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.className = 'form-input';
        input.placeholder = '-';
        input.value = t.trials[i];
        input.oninput = (e) => {
          t.trials[i] = e.target.value;
          updateBestLabel();
        };
        grp.appendChild(input);
        inputsRow.appendChild(grp);
      }

      const sideGrp = document.createElement('div');
      sideGrp.className = 'form-group';
      sideGrp.innerHTML = '<label class="form-label" style="font-size:10.5px">Side</label>';
      const sideSelect = document.createElement('select');
      sideSelect.className = 'form-input';
      ['Bilateral', 'Left', 'Right'].forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        sideSelect.appendChild(opt);
      });
      sideSelect.value = t.side || 'Bilateral';
      sideSelect.onchange = (e) => { t.side = e.target.value; };
      sideGrp.appendChild(sideSelect);
      inputsRow.appendChild(sideGrp);

      const unitGrp = document.createElement('div');
      unitGrp.className = 'form-group';
      unitGrp.innerHTML = '<label class="form-label" style="font-size:10.5px">Unit</label>';
      const unitInput = document.createElement('input');
      unitInput.type = 'text';
      unitInput.className = 'form-input';
      unitInput.placeholder = 'e.g. cm, kg, sec';
      unitInput.value = t.unit || 'cm';
      unitInput.oninput = (e) => {
        t.unit = e.target.value;
        updateBestLabel();
      };
      unitGrp.appendChild(unitInput);
      inputsRow.appendChild(unitGrp);

      const bestDiv = document.createElement('div');
      bestDiv.style.flex = 'none';
      bestDiv.style.display = 'flex';
      bestDiv.style.alignItems = 'center';
      bestDiv.style.justifyContent = 'center';
      bestDiv.style.background = 'rgba(255,255,255,0.01)';
      bestDiv.style.border = '1px dashed var(--nc-border)';
      bestDiv.style.borderRadius = '10px';
      bestDiv.style.padding = '8px';
      bestDiv.style.minWidth = '110px';

      const bestLabel = document.createElement('div');
      bestLabel.style.textAlign = 'center';
      bestLabel.innerHTML = `
        <span style="font-size:9.5px;color:var(--nc-text-muted);display:block;text-transform:uppercase">Best Trial</span>
        <strong class="best-value" style="font-size:16px;color:#FB7185">-</strong>
      `;
      bestDiv.appendChild(bestLabel);
      inputsRow.appendChild(bestDiv);

      const notesRow = document.createElement('div');
      notesRow.style.display = 'grid';
      notesRow.style.gridTemplateColumns = '1fr 1.5fr';
      notesRow.style.gap = '12px';

      const condGrp = document.createElement('div');
      condGrp.className = 'form-group';
      condGrp.innerHTML = '<label class="form-label" style="font-size:10.5px">Specific Conditions</label>';
      const condInput = document.createElement('input');
      condInput.type = 'text';
      condInput.className = 'form-input';
      condInput.placeholder = 'e.g. fatigue state, spikes';
      condInput.value = t.conditions || '';
      condInput.oninput = (e) => { t.conditions = e.target.value; };
      condGrp.appendChild(condInput);
      notesRow.appendChild(condGrp);

      const noteGrp = document.createElement('div');
      noteGrp.className = 'form-group';
      noteGrp.innerHTML = '<label class="form-label" style="font-size:10.5px">Coach note</label>';
      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.className = 'form-input';
      noteInput.placeholder = 'Notes on movement strategy or limitations...';
      noteInput.value = t.coach_note || '';
      noteInput.oninput = (e) => { t.coach_note = e.target.value; };
      noteGrp.appendChild(noteInput);
      notesRow.appendChild(noteGrp);

      card.appendChild(header);
      card.appendChild(inputsRow);
      card.appendChild(notesRow);
      container.appendChild(card);

      function updateBestLabel() {
        const validTrials = t.trials.map(parseFloat).filter(v => !isNaN(v));
        if (validTrials.length === 0) {
          bestLabel.querySelector('.best-value').textContent = '-';
          return;
        }
        const unit = (t.unit || '').toLowerCase();
        const isMinBetter = unit.includes('sec') || unit.includes('s') || unit.includes('min');
        const bestVal = isMinBetter ? Math.min(...validTrials) : Math.max(...validTrials);
        bestLabel.querySelector('.best-value').textContent = bestVal + ' ' + (t.unit || '');
      }

      updateBestLabel();
    });

    // Add extra controls at the bottom of the card list to add manual parameters
    const controls = document.createElement('div');
    controls.style.textAlign = 'center';
    controls.style.marginTop = '16px';
    controls.innerHTML = `<button class="btn btn-secondary btn-xs" onclick="AthleticService.addFreeFormTest()">+ Add Manual Parameter</button>`;
    container.appendChild(controls);
  }

  function addFreeFormTest() {
    activeAssessmentTests.push({
      category: 'Strength',
      test_key: 'Custom Test',
      trials: ['', '', ''],
      unit: 'cm',
      side: 'Bilateral',
      conditions: '',
      coach_note: ''
    });
    renderAssessmentForm();
  }

  async function saveAssessmentSession() {
    const athleteSelect = document.getElementById('assess-athlete-select');
    if (!athleteSelect || !athleteSelect.value) return;

    const athleteId = athleteSelect.value;
    const coachId = Auth.getUser()?.id;

    if (activeAssessmentTests.length === 0) {
      if (typeof toast !== 'undefined') {
        toast('Please add at least one test parameter before submitting.', 'error');
      } else {
        alert('Please add at least one test parameter before submitting.');
      }
      return;
    }

    const sessionPayload = {
      client_id: athleteId,
      coach_id: coachId,
      battery_id: document.getElementById('assess-battery-select').value || null,
      assessed_at: new Date().toISOString(),
      season_phase: document.getElementById('assess-season-phase').value,
      conditions: safeJsonObject(document.getElementById('assess-conditions').value),
      notes: document.getElementById('assess-notes').value,
      status: 'final',
      created_by: coachId
    };

    try {
      const { data: sessionData, error: sessionErr } = await sb.from('athlete_assessments')
        .insert([sessionPayload])
        .select();

      if (sessionErr || !sessionData || sessionData.length === 0) {
        throw new Error(sessionErr?.message || 'Empty response from assessment insert');
      }

      const assessmentId = sessionData[0].id;
      const testRows = [];

      activeAssessmentTests.forEach(t => {
        const trialsNumeric = t.trials.map(parseFloat).filter(v => !isNaN(v));
        if (trialsNumeric.length === 0) return;

        const unit = (t.unit || '').toLowerCase();
        const isMinBetter = unit.includes('sec') || unit.includes('s') || unit.includes('min');
        const bestValue = isMinBetter ? Math.min(...trialsNumeric) : Math.max(...trialsNumeric);

        t.trials.forEach((trialVal, idx) => {
          if (trialVal === '' || trialVal == null) return;
          const trialNum = parseFloat(trialVal);
          const isBest = (trialNum === bestValue);

          testRows.push({
            assessment_id: assessmentId,
            client_id: athleteId,
            coach_id: coachId,
            category: t.category,
            test_key: t.test_key,
            raw_value: trialNum,
            text_value: '',
            unit: t.unit || '',
            side: normalizeSide(t.side),
            trial_n: idx + 1,
            best_of: isBest ? 1 : 0,
            conditions: safeJsonObject(t.conditions),
            protocol_version: 'v1',
            score_confidence: null,
            coach_note: t.coach_note || '',
            assessed_at: sessionPayload.assessed_at,
            created_by: coachId
          });
        });
      });

      if (testRows.length > 0) {
        const { error: testErr } = await sb.from('athlete_test_results')
          .insert(testRows);

        if (testErr) throw testErr;
      }

      if (typeof toast !== 'undefined') {
        toast('Assessment session recorded successfully!', 'success');
      } else {
        alert('Assessment session recorded successfully!');
      }
      applyBatteryToAssessment();
    } catch (e) {
      const errMsg = e.message || e.details || String(e);
      if (typeof toast !== 'undefined') {
        toast('Save failed: ' + errMsg, 'error');
      } else {
        alert('Save failed: ' + errMsg);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  4. ATHLETE PROFILE
  // ═══════════════════════════════════════════════════════════════

  function loadAthleteProfile() {
    loadSelectedAthleteProfile();
  }

  async function loadSelectedAthleteProfile() {
    const select = document.getElementById('profile-athlete-select');
    const loading = document.getElementById('profile-loading-state');
    const empty = document.getElementById('profile-empty-state');
    const container = document.getElementById('profile-content-container');
    const accessDenied = document.getElementById('profile-access-denied-state');

    if (!select || !loading || !empty || !container) return;

    if (accessDenied) accessDenied.style.display = 'none';

    const athleteId = select.value;
    if (!athleteId) {
      empty.style.display = 'block';
      container.style.display = 'none';
      loading.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    container.style.display = 'none';
    loading.style.display = 'block';

    try {
      // 1. Fetch story profile
      const { data: profile, error: errProf } = await sb.from('athlete_profiles')
        .select('*')
        .eq('client_id', athleteId)
        .maybeSingle();

      if (errProf) throw errProf;

      // 2. Fetch assessment sessions
      const { data: assessments, error: errAssess } = await sb.from('athlete_assessments')
        .select('*')
        .eq('client_id', athleteId)
        .order('assessed_at', { ascending: false });

      if (errAssess) throw errAssess;

      // 3. Fetch test results
      const { data: testResults, error: errTests } = await sb.from('athlete_test_results')
        .select('*')
        .eq('client_id', athleteId)
        .order('assessed_at', { ascending: false });

      if (errTests) throw errTests;

      // 4. Fetch movement observations
      const { data: observations, error: errObs } = await sb.from('athletic_movement_observations')
        .select('*')
        .eq('client_id', athleteId)
        .order('assessed_at', { ascending: false });

      if (errObs) throw errObs;

      renderProfileSummary(profile);
      renderProfileStory(profile);
      renderProfileSessions(assessments);
      renderProfileLedgerAndSymmetry(testResults);
      renderProfileObservations(observations);

      loading.style.display = 'none';
      container.style.display = 'block';
    } catch (e) {
      loading.style.display = 'none';
      const isRls = e && (e.code === '42501' || e.status === 403 || (e.message && (e.message.includes('policy') || e.message.toLowerCase().includes('permission') || e.message.toLowerCase().includes('row-level security'))));
      if (isRls && accessDenied) {
        accessDenied.style.display = 'block';
        container.style.display = 'none';
        empty.style.display = 'none';
      } else {
        empty.style.display = 'block';
        if (typeof toast !== 'undefined') {
          toast('Error loading profile: ' + e.message, 'error');
        } else {
          alert('Error loading profile: ' + e.message);
        }
      }
    }
  }

  function renderProfileSummary(p) {
    const summary = document.getElementById('profile-summary-cards');
    if (!summary) return;

    if (!p) {
      summary.innerHTML = `
        <div class="card glass-card" style="padding:16px;text-align:center;grid-column:1/-1;color:var(--nc-text-muted)">
          No story profiling completed yet. Complete the Story Intake wizard.
        </div>`;
      return;
    }

    summary.innerHTML = `
      <div class="nc-kpi nc-kpi--indigo">
        <div class="nc-kpi-top"><span class="nc-kpi-icon">🏃</span></div>
        <div class="nc-kpi-value">${p.sport || '–'}</div>
        <div class="nc-kpi-label">Primary Discipline</div>
        <div class="nc-kpi-sub">Position: ${p.position || '–'}</div>
      </div>
      <div class="nc-kpi nc-kpi--teal">
        <div class="nc-kpi-top"><span class="nc-kpi-icon">◈</span></div>
        <div class="nc-kpi-value">${p.training_age_years || '0'} Yr</div>
        <div class="nc-kpi-label">Training Age</div>
        <div class="nc-kpi-sub">Level: ${p.level || '–'}</div>
      </div>
      <div class="nc-kpi nc-kpi--violet">
        <div class="nc-kpi-top"><span class="nc-kpi-icon">🗓</span></div>
        <div class="nc-kpi-value">${PHASE_LABELS[p.season_phase] || p.season_phase || '–'}</div>
        <div class="nc-kpi-label">Current Phase</div>
        <div class="nc-kpi-sub">${p.available_days_per_week || '0'} days/wk, ${p.session_duration_minutes || '0'} min</div>
      </div>
      <div class="nc-kpi nc-kpi--amber">
        <div class="nc-kpi-top"><span class="nc-kpi-icon">◭</span></div>
        <div class="nc-kpi-value">${SIDE_LABELS[p.dominant_side] || p.dominant_side || 'Right'}</div>
        <div class="nc-kpi-label">Dominant Side</div>
        <div class="nc-kpi-sub">Injury history logged</div>
      </div>
    `;
  }

  function renderProfileStory(p) {
    const el = document.getElementById('profile-story-details');
    if (!el) return;

    if (!p) {
      el.innerHTML = '<div style="text-align:center;padding:12px;color:var(--nc-text-muted)">No story logged.</div>';
      return;
    }

    const flagsHtml = Array.isArray(p.current_flags) && p.current_flags.length > 0
      ? p.current_flags.map(f => `<span class="badge" style="background:rgba(225,29,72,0.12);color:#FB7185;margin-right:4px">${f}</span>`).join('')
      : 'None';

    const compHtml = Array.isArray(p.competition_dates) && p.competition_dates.length > 0
      ? p.competition_dates.map(d => `<span class="badge" style="background:rgba(255,255,255,0.05);color:var(--nc-text-secondary);margin-right:4px">${d}</span>`).join('')
      : 'None';

    el.innerHTML = `
      <div><strong>Discipline Goals:</strong><p style="margin:4px 0 0;line-height:1.4">${(p.goals && typeof p.goals === 'object') ? (p.goals.raw_notes || JSON.stringify(p.goals)) : (p.goals || 'None')}</p></div>
      <hr style="border:none;border-top:1px solid var(--nc-border);margin:8px 0" />
      <div><strong>Training Environment:</strong> ${p.training_environment || '–'}</div>
      <div><strong>Available Tools:</strong> ${Array.isArray(p.equipment) ? p.equipment.join(', ') : '–'}</div>
      <hr style="border:none;border-top:1px solid var(--nc-border);margin:8px 0" />
      <div><strong>Loading History:</strong><p style="margin:4px 0 0;line-height:1.4">${(p.injury_history && typeof p.injury_history === 'object') ? (p.injury_history.raw_notes || JSON.stringify(p.injury_history)) : (p.injury_history || 'None')}</p></div>
      <hr style="border:none;border-top:1px solid var(--nc-border);margin:8px 0" />
      <div style="margin-bottom:6px"><strong>Status Flags:</strong><div style="margin-top:4px">${flagsHtml}</div></div>
      <div><strong>Target Competition Dates:</strong><div style="margin-top:4px">${compHtml}</div></div>
    `;
  }

  function renderProfileSessions(sessions) {
    const el = document.getElementById('profile-sessions-history');
    if (!el) return;

    if (!sessions || sessions.length === 0) {
      el.innerHTML = `
        <div style="text-align:center;padding:20px 12px;color:var(--nc-text-secondary);border:1px dashed var(--nc-border);border-radius:10px;background:rgba(255,255,255,0.01)">
          <span style="font-size:24px;margin-bottom:6px;display:block">⏱</span>
          <strong style="font-size:12px;color:var(--nc-text-primary)">No Assessments Yet</strong>
          <p style="margin:4px 0 0;font-size:10.5px;color:var(--nc-text-muted);line-height:1.4">Use the Telemetry Lab to record this athlete's first session.</p>
        </div>`;
      return;
    }

    el.innerHTML = sessions.map(s => {
      const date = new Date(s.assessed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return `
        <div style="background:rgba(255,255,255,0.01);border:1px solid var(--nc-border);border-radius:10px;padding:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px">
            <strong style="color:var(--nc-text-primary)">${date}</strong>
            <span class="badge" style="background:rgba(20,184,166,0.1);color:#2DD4BF">${PHASE_LABELS[s.season_phase] || s.season_phase}</span>
          </div>
          ${s.notes ? `<div style="font-size:11px;color:var(--nc-text-muted);margin-top:6px;line-height:1.4">${s.notes}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function renderProfileLedgerAndSymmetry(results) {
    const ledger = document.getElementById('profile-categories-container');
    const symmetry = document.getElementById('profile-symmetry-container');

    if (!ledger || !symmetry) return;

    if (!results || results.length === 0) {
      ledger.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:32px;color:var(--nc-text-secondary);border:1px dashed var(--nc-border);border-radius:12px;background:rgba(255,255,255,0.01)">
          <span style="font-size:24px;margin-bottom:8px;display:block">📊</span>
          <strong style="color:var(--nc-text-primary)">No Test Data Found</strong>
          <p style="margin:4px 0 0;font-size:11.5px;color:var(--nc-text-muted);line-height:1.4">Once an assessment is completed, raw results will compile here.</p>
        </div>`;
      symmetry.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--nc-text-secondary);border:1px dashed var(--nc-border);border-radius:10px;background:rgba(255,255,255,0.01)">
          <span style="font-size:24px;margin-bottom:8px;display:block">⚖️</span>
          <strong style="color:var(--nc-text-primary)">No Lateral Testing Data</strong>
          <p style="margin:4px 0 0;font-size:11px;color:var(--nc-text-muted);line-height:1.4">Run unilateral tests (Left vs Right) to screen for bilateral asymmetries.</p>
        </div>`;
      return;
    }

    // Filter to only get the best trial for each test parameter (most recent session)
    // Find the latest assessment_id we have results for
    const latestAssessId = results[0].assessment_id;
    const latestResults = results.filter(r => r.assessment_id === latestAssessId && r.best_of);

    // Group by category
    const catsMap = {};
    latestResults.forEach(r => {
      catsMap[r.category] = catsMap[r.category] || [];
      catsMap[r.category].push(r);
    });

    ledger.innerHTML = Object.keys(catsMap).map(catName => {
      const rows = catsMap[catName].map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px;padding:6px 0">
          <span style="color:var(--nc-text-secondary)">${r.test_key} ${(r.side || '').toLowerCase() !== 'bilateral' ? `(${(r.side || '').charAt(0).toUpperCase()})` : ''}</span>
          <strong style="color:#FB7185">${r.raw_value} ${r.unit}</strong>
        </div>
      `).join('');

      return `
        <div style="background:rgba(255,255,255,0.01);border:1px solid var(--nc-border);border-radius:12px;padding:14px">
          <h4 style="margin:0 0 10px;font-size:12.5px;color:var(--nc-text-primary);border-bottom:1px solid var(--nc-border);padding-bottom:6px">${catName}</h4>
          <div style="display:flex;flex-direction:column">${rows}</div>
        </div>
      `;
    }).join('');

    // Symmetry rendering logic: find test keys that have both Left and Right side scores in the latest assessment
    const testMapBySide = {};
    latestResults.forEach(r => {
      const sideLower = (r.side || '').toLowerCase();
      if (sideLower === 'left' || sideLower === 'right') {
        testMapBySide[r.test_key] = testMapBySide[r.test_key] || {};
        testMapBySide[r.test_key][sideLower] = r;
      }
    });

    const symmetryRows = [];
    Object.keys(testMapBySide).forEach(testKey => {
      const left = testMapBySide[testKey]['left'];
      const right = testMapBySide[testKey]['right'];
      if (left && right) {
        const leftVal = left.raw_value;
        const rightVal = right.raw_value;
        const diff = Math.abs(leftVal - rightVal);
        const maxVal = Math.max(leftVal, rightVal);
        const percentDiff = maxVal > 0 ? ((diff / maxVal) * 100).toFixed(1) : '0';

        // simple visual progress bar comparison
        const leftPct = maxVal > 0 ? (leftVal / maxVal) * 100 : 0;
        const rightPct = maxVal > 0 ? (rightVal / maxVal) * 100 : 0;

        symmetryRows.push(`
          <div style="background:rgba(255,255,255,0.01);border:1px solid var(--nc-border);border-radius:10px;padding:12px">
            <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:8px">
              <strong>${testKey}</strong>
              <span style="font-size:11px;color:#FB7185">${percentDiff}% Variance</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              <!-- Left Bar -->
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:10px;color:var(--nc-text-muted);width:12px">L</span>
                <div style="flex:1;height:8px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden">
                  <div style="width:${leftPct}%;height:100%;background:linear-gradient(90deg, #E11D48, #FB7185)"></div>
                </div>
                <span style="font-size:11px;font-weight:600;width:45px;text-align:right">${leftVal} ${left.unit}</span>
              </div>
              <!-- Right Bar -->
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:10px;color:var(--nc-text-muted);width:12px">R</span>
                <div style="flex:1;height:8px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden">
                  <div style="width:${rightPct}%;height:100%;background:linear-gradient(90deg, #9F1239, #E11D48)"></div>
                </div>
                <span style="font-size:11px;font-weight:600;width:45px;text-align:right">${rightVal} ${right.unit}</span>
              </div>
            </div>
          </div>
        `);
      }
    });

    if (symmetryRows.length === 0) {
      symmetry.innerHTML = '<div style="text-align:center;padding:12px;color:var(--nc-text-muted)">No lateral imbalances detected in latest session.</div>';
    } else {
      symmetry.innerHTML = symmetryRows.join('');
    }
  }

  // Load active stats inside dashboard panel
  async function loadDashboard() {
    try {
      const container = document.querySelector('#section-athletic-dashboard .nc-panel .empty-state');
      if (!container) return;

      // Count assessments and custom batteries to show stats
      const { count: assessmentsCount } = await sb.from('athlete_assessments')
        .select('*', { count: 'exact', head: true });

      const { count: batteriesCount } = await sb.from('assessment_batteries')
        .select('*', { count: 'exact', head: true });

      // Update dashboard welcome panel
      container.innerHTML = `
        <div style="text-align:left;width:100%">
          <h3 style="margin-top:0;font-size:16px;color:#FB7185">High-Performance Roster Stats</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px">
            <div style="background:rgba(255,255,255,0.01);border:1px solid var(--nc-border);border-radius:12px;padding:16px">
              <span style="font-size:24px;font-weight:800;color:#FB7185">${assessmentsCount || 0}</span>
              <div style="font-size:11.5px;color:var(--nc-text-secondary);margin-top:4px">Completed Assessments</div>
            </div>
            <div style="background:rgba(255,255,255,0.01);border:1px solid var(--nc-border);border-radius:12px;padding:16px">
              <span style="font-size:24px;font-weight:800;color:#FB7185">${batteriesCount || 0}</span>
              <div style="font-size:11.5px;color:var(--nc-text-secondary);margin-top:4px">Testing Batteries Available</div>
            </div>
          </div>
          <div style="margin-top:24px;border-top:1px solid var(--nc-border);padding-top:16px">
            <div style="font-size:12px;color:var(--nc-text-secondary);line-height:1.5">
              💡 <strong>Performance Tip:</strong> Load the <strong>Battery Builder</strong> under Movement Assessment to customize your force velocity, power, and sprint tests templates.
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      console.warn('[AthleticService] Dashboard stats load error:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  5. ATHLETIC MOVEMENT OBSERVATIONS
  // ═══════════════════════════════════════════════════════════════

  function loadObservationsTab() {
    const picker = document.getElementById('obs-tags-picker');
    if (picker) {
      picker.innerHTML = FINDING_TAGS.map(tag => `
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;background:rgba(255,255,255,0.03);border:1px solid var(--nc-border);padding:4px 8px;border-radius:12px;cursor:pointer;white-space:nowrap">
          <input type="checkbox" name="obs-tag-checkbox" value="${tag}" style="margin:0" />
          <span>${TAG_LABELS[tag] || tag}</span>
        </label>
      `).join('');
    }

    // Populate athlete select
    const select = document.getElementById('obs-athlete-select');
    if (select) {
      const currentVal = select.value;
      select.innerHTML = '<option value="">— Select Athlete —</option>';
      cachedClients.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.full_name || c.email;
        select.appendChild(opt);
      });
      if (currentVal) select.value = currentVal;
    }

    loadSelectedAthleteObservations();
  }

  async function loadSelectedAthleteObservations() {
    const select = document.getElementById('obs-athlete-select');
    const emptyAthlete = document.getElementById('obs-empty-athlete');
    const emptyAssess = document.getElementById('obs-empty-assessment');
    const mainContainer = document.getElementById('obs-main-container');
    const accessDenied = document.getElementById('obs-access-denied-state');

    if (!select || !emptyAthlete || !emptyAssess || !mainContainer) return;

    if (accessDenied) accessDenied.style.display = 'none';

    const athleteId = select.value;
    if (!athleteId) {
      emptyAthlete.style.display = 'block';
      emptyAssess.style.display = 'none';
      mainContainer.style.display = 'none';
      return;
    }

    emptyAthlete.style.display = 'none';

    try {
      const { data, error } = await sb.from('athlete_assessments')
        .select('*')
        .eq('client_id', athleteId)
        .order('assessed_at', { ascending: false });

      if (error) throw error;

      cachedAssessments = data || [];
      const assessSelect = document.getElementById('obs-assessment-select');
      if (assessSelect) {
        assessSelect.innerHTML = '';
        if (cachedAssessments.length === 0) {
          assessSelect.innerHTML = '<option value="">No sessions found</option>';
          emptyAssess.style.display = 'block';
          mainContainer.style.display = 'none';
          return;
        }

        cachedAssessments.forEach(s => {
          const dateStr = new Date(s.assessed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${dateStr} (${PHASE_LABELS[s.season_phase] || s.season_phase})`;
          assessSelect.appendChild(opt);
        });

        // select first as default
        assessSelect.value = cachedAssessments[0].id;
        loadSelectedAssessmentDetails();
      }
    } catch (e) {
      console.error('[AthleticService] Failed to load assessments:', e.message);
      const isRls = e && (e.code === '42501' || e.status === 403 || (e.message && (e.message.includes('policy') || e.message.toLowerCase().includes('permission') || e.message.toLowerCase().includes('row-level security'))));
      if (isRls && accessDenied) {
        accessDenied.style.display = 'block';
        mainContainer.style.display = 'none';
        emptyAthlete.style.display = 'none';
        emptyAssess.style.display = 'none';
      } else {
        emptyAssess.style.display = 'block';
        mainContainer.style.display = 'none';
      }
    }
  }

  async function loadSelectedAssessmentDetails() {
    const assessSelect = document.getElementById('obs-assessment-select');
    const emptyAssess = document.getElementById('obs-empty-assessment');
    const mainContainer = document.getElementById('obs-main-container');

    if (!assessSelect || !assessSelect.value) {
      if (emptyAssess) emptyAssess.style.display = 'block';
      if (mainContainer) mainContainer.style.display = 'none';
      return;
    }

    if (emptyAssess) emptyAssess.style.display = 'none';
    if (mainContainer) mainContainer.style.display = 'block';

    const assessmentId = assessSelect.value;
    const activeSession = cachedAssessments.find(s => s.id === assessmentId);

    if (activeSession) {
      const badge = document.getElementById('obs-session-phase-badge');
      if (badge) badge.textContent = PHASE_LABELS[activeSession.season_phase] || activeSession.season_phase;

      const condEl = document.getElementById('obs-session-conditions-text');
      if (condEl) {
        const condVal = activeSession.conditions;
        condEl.textContent = condVal && typeof condVal === 'object' ? (condVal.raw_notes || JSON.stringify(condVal)) : (condVal || 'None');
      }

      const notesEl = document.getElementById('obs-session-notes-text');
      if (notesEl) notesEl.textContent = activeSession.notes || 'None';
    }

    // Populate linked test dropdown
    const testSelect = document.getElementById('obs-linked-test-select');
    if (testSelect) {
      testSelect.innerHTML = '<option value="">— Free-form Observation (No link) —</option>';
      try {
        const { data, error } = await sb.from('athlete_test_results')
          .select('*')
          .eq('assessment_id', assessmentId)
          .eq('best_of', 1);

        if (!error && data) {
          data.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `${t.test_key} (${t.side || 'na'}) — ${t.raw_value} ${t.unit}`;
            testSelect.appendChild(opt);
          });
        }
      } catch (e) {
        console.warn('[AthleticService] Failed to load test results for link:', e.message);
      }
    }

    // Load ledger
    await loadObservationsLedger(assessmentId);
  }

  async function loadObservationsLedger(assessmentId) {
    const list = document.getElementById('obs-ledger-list');
    if (!list) return;
    list.innerHTML = '<span class="spinner spinner-sm"></span>';

    try {
      const { data, error } = await sb.from('athletic_movement_observations')
        .select('*')
        .eq('assessment_id', assessmentId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      renderObservationsList(data || []);
    } catch (e) {
      list.innerHTML = `<div style="font-size:11px;color:#F5426C;text-align:center;padding:12px">Load failed: ${e.message}</div>`;
    }
  }

  function renderObservationsList(observations) {
    const list = document.getElementById('obs-ledger-list');
    if (!list) return;
    list.innerHTML = '';

    if (observations.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:32px 12px;color:var(--nc-text-secondary);border:1px dashed var(--nc-border);border-radius:10px;background:rgba(255,255,255,0.01)">
          <span style="font-size:24px;margin-bottom:6px;display:block">👁</span>
          <strong style="font-size:12px;color:var(--nc-text-primary)">No Observations Recorded</strong>
          <p style="margin:4px 0 0;font-size:10.5px;color:var(--nc-text-muted)">Record the first observation for this session using the form on the left.</p>
        </div>`;
      return;
    }

    observations.forEach(o => {
      const card = document.createElement('div');
      card.className = 'card glass-card';
      card.style.padding = '14px';
      card.style.border = '1px solid var(--nc-border)';
      card.style.position = 'relative';

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-ghost btn-xs';
      delBtn.style.position = 'absolute';
      delBtn.style.top = '10px';
      delBtn.style.right = '10px';
      delBtn.style.color = '#F5426C';
      delBtn.style.padding = '2px 6px';
      delBtn.style.fontSize = '12px';
      delBtn.innerHTML = '✕';
      delBtn.onclick = () => deleteMovementObservation(o.id);
      card.appendChild(delBtn);

      const domainText = DOMAIN_LABELS[o.movement_domain] || o.movement_domain;
      const sideText = o.side && o.side !== 'na' ? o.side.toUpperCase() : '';
      const planeText = o.plane && o.plane !== 'na' ? o.plane.charAt(0).toUpperCase() + o.plane.slice(1) : '';
      const sidePlaneInfo = [sideText, planeText].filter(Boolean).join(' · ');

      let rangeLine = '';
      if (o.observed_range_value != null) {
        const refText = o.passive_reference_value != null ? ` (Ref: ${o.passive_reference_value}${o.range_unit || ''})` : '';
        rangeLine = `<div style="font-size:11.5px;margin-top:6px">
          <strong>Range:</strong> <span style="color:#FB7185">${o.observed_range_value}${o.range_unit || ''}</span>${refText}
        </div>`;
      }

      const tagsHtml = Array.isArray(o.finding_tags) && o.finding_tags.length > 0
        ? o.finding_tags.map(t => `<span class="badge" style="background:rgba(225,29,72,0.1);color:#FB7185;margin-right:4px;margin-bottom:4px;font-size:9.5px;padding:2px 6px">${TAG_LABELS[t] || t}</span>`).join('')
        : '';

      const notes = [
        o.control_note ? `<strong>Control:</strong> ${o.control_note}` : '',
        o.symmetry_note ? `<strong>Symmetry:</strong> ${o.symmetry_note}` : '',
        o.coach_note ? `<strong>Note:</strong> ${o.coach_note}` : ''
      ].filter(Boolean).map(n => `<div style="margin-top:4px">${n}</div>`).join('');

      card.insertAdjacentHTML('beforeend', `
        <div style="padding-right:20px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span class="badge" style="background:rgba(225,29,72,0.12);color:#FB7185;font-size:10px">${domainText}</span>
            ${o.quality_rating && o.quality_rating !== 'not_assessed' ? `<span class="badge" style="background:rgba(255,255,255,0.05);color:var(--nc-text-secondary);font-size:10px">${o.quality_rating}</span>` : ''}
            ${o.pain_flag ? `<span class="badge" style="background:#210D11;color:#F5426C;font-size:10px;font-weight:700">⚠️ PAIN</span>` : ''}
          </div>
          <div style="font-size:12.5px;font-weight:600;color:var(--nc-text-primary)">
            ${o.region} ${o.joint ? `(${o.joint})` : ''} ${o.chain ? `[${o.chain} chain]` : ''}
          </div>
          ${sidePlaneInfo ? `<div style="font-size:11px;color:var(--nc-text-muted);margin-top:2px">${sidePlaneInfo}</div>` : ''}
          ${rangeLine}
          ${o.asymmetry_pct != null ? `<div style="font-size:11px;margin-top:4px">Asymmetry: <strong style="color:#FB7185">${o.asymmetry_pct}%</strong></div>` : ''}
          ${tagsHtml ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap">${tagsHtml}</div>` : ''}
          ${notes ? `<div style="font-size:11.5px;color:var(--nc-text-secondary);margin-top:8px;border-top:1px solid rgba(255,255,255,0.03);padding-top:6px">${notes}</div>` : ''}
        </div>
      `);

      list.appendChild(card);
    });
  }

  async function saveMovementObservation() {
    const athleteSelect = document.getElementById('obs-athlete-select');
    const assessSelect = document.getElementById('obs-assessment-select');
    const domainSelect = document.getElementById('obs-domain');
    const regionInput = document.getElementById('obs-region');

    if (!athleteSelect || !athleteSelect.value || !assessSelect || !assessSelect.value) return;

    const domain = domainSelect.value;
    const region = regionInput.value.trim();

    if (!domain) {
      alert('Movement Domain is required.');
      return;
    }
    if (!region) {
      alert('Region is required.');
      return;
    }

    const side = document.getElementById('obs-side').value;
    const plane = document.getElementById('obs-plane').value;
    const quality = document.getElementById('obs-quality').value;
    const confidence = document.getElementById('obs-confidence').value;
    const source = document.getElementById('obs-source').value;

    // Collect checked tags
    const checkedTags = [];
    document.querySelectorAll('input[name="obs-tag-checkbox"]:checked').forEach(cb => {
      checkedTags.push(cb.value);
    });

    // Strictly validate controlled vocabulary before insert!
    const allowedDomains = ['accel', 'maxv', 'jump_takeoff', 'landing', 'decel', 'cod', 'sl_control', 'lateral', 'rotation', 'dyn_mobility'];
    const allowedSides = ['left', 'right', 'bilateral', 'na'];
    const allowedPlanes = ['sagittal', 'frontal', 'transverse', 'multi', 'na'];
    const allowedQualities = ['solid', 'adequate', 'limited', 'poor', 'not_assessed'];
    const allowedConfidences = ['high', 'medium', 'low'];
    const allowedSources = ['coach_visual', 'video', 'wearable', 'other'];

    if (!allowedDomains.includes(domain)) {
      alert(`Invalid controlled vocabulary: Domain '${domain}' is not allowed.`);
      return;
    }
    if (!allowedSides.includes(side)) {
      alert(`Invalid controlled vocabulary: Side '${side}' is not allowed.`);
      return;
    }
    if (!allowedPlanes.includes(plane)) {
      alert(`Invalid controlled vocabulary: Plane '${plane}' is not allowed.`);
      return;
    }
    if (!allowedQualities.includes(quality)) {
      alert(`Invalid controlled vocabulary: Quality '${quality}' is not allowed.`);
      return;
    }
    if (!allowedConfidences.includes(confidence)) {
      alert(`Invalid controlled vocabulary: Confidence '${confidence}' is not allowed.`);
      return;
    }
    if (!allowedSources.includes(source)) {
      alert(`Invalid controlled vocabulary: Source '${source}' is not allowed.`);
      return;
    }
    for (const t of checkedTags) {
      if (!FINDING_TAGS.includes(t)) {
        alert(`Invalid controlled vocabulary: Finding tag '${t}' is not allowed.`);
        return;
      }
    }

    const parseNumeric = (id) => {
      const el = document.getElementById(id);
      if (!el || el.value.trim() === '') return null;
      const v = parseFloat(el.value);
      return isNaN(v) ? null : v;
    };

    const coachId = Auth.getUser()?.id;
    const assessmentId = assessSelect.value;
    const activeSession = cachedAssessments.find(s => s.id === assessmentId);

    const payload = {
      assessment_id: assessmentId,
      client_id: athleteSelect.value,
      coach_id: coachId,
      movement_domain: domain,
      movement_phase: document.getElementById('obs-phase').value.trim() || null,
      region,
      joint: document.getElementById('obs-joint').value.trim() || null,
      chain: document.getElementById('obs-chain').value.trim() || null,
      plane,
      side,
      observed_range_value: parseNumeric('obs-range-value'),
      range_unit: document.getElementById('obs-range-unit').value.trim() || null,
      passive_reference_value: parseNumeric('obs-passive-ref'),
      quality_rating: quality,
      control_note: document.getElementById('obs-control-note').value.trim() || null,
      symmetry_note: document.getElementById('obs-symmetry-note').value.trim() || null,
      asymmetry_pct: parseNumeric('obs-asymmetry-pct'),
      finding_tags: checkedTags,
      pain_flag: document.getElementById('obs-pain-flag').checked,
      confidence,
      source,
      linked_test_result_id: document.getElementById('obs-linked-test-select').value || null,
      coach_note: document.getElementById('obs-coach-note').value.trim() || null,
      assessed_at: activeSession ? activeSession.assessed_at : new Date().toISOString(),
      created_by: coachId
    };

    try {
      const { error } = await sb.from('athletic_movement_observations').insert([payload]);
      if (error) throw error;

      if (typeof toast !== 'undefined') {
        toast('Movement observation recorded successfully!', 'success');
      } else {
        alert('Movement observation recorded successfully!');
      }

      // Reset form fields
      document.getElementById('obs-form').reset();
      // Reload details & ledger
      await loadSelectedAssessmentDetails();
    } catch (e) {
      console.error('[AthleticService] Save observation failed:', e.message);
      if (typeof toast !== 'undefined') {
        toast('Save failed: ' + e.message, 'error');
      } else {
        alert('Save failed: ' + e.message);
      }
    }
  }

  async function deleteMovementObservation(id) {
    if (!confirm('Are you sure you want to delete this movement observation?')) return;

    try {
      const { error } = await sb.from('athletic_movement_observations')
        .delete()
        .eq('id', id);

      if (error) throw error;

      if (typeof toast !== 'undefined') {
        toast('Observation deleted.', 'success');
      } else {
        alert('Observation deleted.');
      }
      const assessSelect = document.getElementById('obs-assessment-select');
      if (assessSelect && assessSelect.value) {
        await loadObservationsLedger(assessSelect.value);
      }
    } catch (e) {
      console.error('[AthleticService] Delete observation failed:', e.message);
      if (typeof toast !== 'undefined') {
        toast('Deletion failed: ' + e.message, 'error');
      } else {
        alert('Deletion failed: ' + e.message);
      }
    }
  }

  function renderProfileObservations(observations) {
    const grid = document.getElementById('profile-observations-grid');
    const container = document.getElementById('profile-observations-container');

    if (!grid || !container) return;

    if (!observations || observations.length === 0) {
      grid.style.display = 'none';
      container.style.display = 'block';
      container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--nc-text-secondary);border:1px dashed var(--nc-border);border-radius:10px;background:rgba(255,255,255,0.01)">
          <span style="font-size:24px;margin-bottom:8px;display:block">⚖️</span>
          <strong style="color:var(--nc-text-primary)">No Movement Observations</strong>
          <p style="margin:4px 0 0;font-size:11px;color:var(--nc-text-muted);line-height:1.4">Once observations are recorded in the Telemetry Lab, summaries will render here.</p>
        </div>`;
      return;
    }

    grid.style.display = 'grid';
    container.style.display = 'none';

    // 1. Movement Notes
    const notesHtml = observations
      .filter(o => o.coach_note || o.control_note || o.symmetry_note)
      .slice(0, 4)
      .map(o => {
        const date = new Date(o.assessed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const domainText = DOMAIN_LABELS[o.movement_domain] || o.movement_domain;
        const notes = [
          o.control_note ? `Control: ${o.control_note}` : '',
          o.symmetry_note ? `Symmetry: ${o.symmetry_note}` : '',
          o.coach_note ? `Note: ${o.coach_note}` : ''
        ].filter(Boolean).join(' | ');
        return `<div><small style="color:var(--nc-text-muted)">${date} (${domainText}):</small> <span style="line-height:1.4">${notes}</span></div>`;
      }).join('') || '<div style="color:var(--nc-text-muted)">No qualitative notes logged.</div>';
    document.getElementById('profile-obs-notes').innerHTML = notesHtml;

    // 2. Dynamic ROM
    const romHtml = observations
      .filter(o => o.observed_range_value != null)
      .slice(0, 4)
      .map(o => {
        const sideText = o.side && o.side !== 'na' ? ` (${o.side.toUpperCase()})` : '';
        const passText = o.passive_reference_value != null ? ` / Ref: ${o.passive_reference_value}${o.range_unit || ''}` : '';
        return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.02)">
          <span>${o.region} ${o.joint ? `(${o.joint})` : ''}${sideText}</span>
          <strong style="color:#FB7185">${o.observed_range_value}${o.range_unit || ''}${passText}</strong>
        </div>`;
      }).join('') || '<div style="color:var(--nc-text-muted)">No dynamic ROM data logged.</div>';
    document.getElementById('profile-obs-rom').innerHTML = romHtml;

    // 3. Control & Symmetry
    const ratingsCount = {};
    let asymmetrySum = 0;
    let asymmetryCount = 0;
    
    observations.forEach(o => {
      if (o.quality_rating && o.quality_rating !== 'not_assessed') {
        ratingsCount[o.quality_rating] = (ratingsCount[o.quality_rating] || 0) + 1;
      }
      if (o.asymmetry_pct != null) {
        asymmetrySum += parseFloat(o.asymmetry_pct);
        asymmetryCount++;
      }
    });

    const ratingLines = Object.keys(ratingsCount).map(r => {
      const label = r.charAt(0).toUpperCase() + r.slice(1);
      return `<span style="background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px;white-space:nowrap">${label}: ${ratingsCount[r]}</span>`;
    }).join(' ') || '<span style="color:var(--nc-text-muted)">No rating distribution.</span>';

    const avgAsymmetry = asymmetryCount > 0 ? (asymmetrySum / asymmetryCount).toFixed(1) : null;
    const asymmetryLine = avgAsymmetry ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05)">
      <span>Avg Side Variance:</span> <strong style="color:#FB7185">${avgAsymmetry}%</strong> <span style="color:var(--nc-text-muted);font-size:10px">(${asymmetryCount} checks)</span>
    </div>` : '<div style="color:var(--nc-text-muted);margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05)">No side asymmetry logged.</div>';

    document.getElementById('profile-obs-control').innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:10.5px">${ratingLines}</div>
      ${asymmetryLine}
    `;

    // 4. Pain & Fatigue Flags
    const painCount = observations.filter(o => o.pain_flag).length;
    const tagsCount = {};
    observations.forEach(o => {
      if (Array.isArray(o.finding_tags)) {
        o.finding_tags.forEach(t => {
          tagsCount[t] = (tagsCount[t] || 0) + 1;
        });
      }
    });

    const topTags = Object.keys(tagsCount)
      .sort((a, b) => tagsCount[b] - tagsCount[a])
      .slice(0, 3)
      .map(t => `<span class="badge" style="background:rgba(225,29,72,0.1);color:#FB7185;margin-right:4px;margin-bottom:4px;font-size:9.5px;padding:2px 5px">${TAG_LABELS[t] || t} (${tagsCount[t]})</span>`)
      .join('');

    document.getElementById('profile-obs-flags').innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span>Pain Flags Raised:</span>
        <strong style="${painCount > 0 ? 'color:#F5426C' : 'color:var(--nc-text-muted)'}">${painCount}</strong>
      </div>
      <div><small style="color:var(--nc-text-muted);display:block;margin-bottom:4px">Key Findings:</small></div>
      <div style="display:flex;flex-wrap:wrap;margin-top:4px">${topTags || '<span style="color:var(--nc-text-muted)">None</span>'}</div>
    `;
  }

  // Exposed Public APIs
  return {
    populateAthleteSelects,
    loadDashboard,
    loadStoryIntake,
    loadSelectedAthleteStory,
    saveAthleteStory,
    switchStoryStep,
    prevStoryStep,
    nextStoryStep,
    loadMovementAssessment,
    switchAssessSubtab,
    loadSelectedAthleteAssessment,
    applyBatteryToAssessment,
    saveAssessmentSession,
    createNewBattery,
    editBattery,
    saveBattery,
    deleteBattery,
    addTestToBattery,
    renderBatteryTests,
    addFreeFormTest,
    loadAthleteProfile,
    loadSelectedAthleteProfile,
    loadObservationsTab,
    loadSelectedAthleteObservations,
    loadSelectedAssessmentDetails,
    saveMovementObservation,
    deleteMovementObservation
  };

})();

// Export globally
window.AthleticService = AthleticService;
