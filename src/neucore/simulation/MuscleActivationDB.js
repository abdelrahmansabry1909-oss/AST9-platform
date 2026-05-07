// src/neucore/simulation/MuscleActivationDB.js
// Source: Neumann — Kinesiology of the Musculoskeletal System 3rd Ed. 2017

export const GAIT_PHASES = [
  'loading_response',
  'mid_stance',
  'terminal_stance',
  'pre_swing',
  'initial_swing',
  'mid_swing',
  'terminal_swing',
];

export const NORMATIVE_ACTIVATION = {
  gluteus_maximus: {
    loading_response: { percent: 28, role: 'Shock absorption, hip extension control' },
    mid_stance:       { percent: 8,  role: 'Minimal — glute med takes over' },
    terminal_stance:  { percent: 12, role: 'Hip extension continuation' },
    pre_swing:        { percent: 6,  role: 'Low activity' },
    initial_swing:    { percent: 4,  role: 'Low activity' },
    mid_swing:        { percent: 6,  role: 'Low activity' },
    terminal_swing:   { percent: 22, role: 'Hip flexion deceleration' },
  },
  gluteus_medius: {
    loading_response: { percent: 60, role: 'Pelvic stabilization onset' },
    mid_stance:       { percent: 72, role: 'Peak — prevents pelvic drop' },
    terminal_stance:  { percent: 48, role: 'Continued pelvic support' },
    pre_swing:        { percent: 18, role: 'Declining activity' },
    initial_swing:    { percent: 12, role: 'Low activity' },
    mid_swing:        { percent: 10, role: 'Low activity' },
    terminal_swing:   { percent: 15, role: 'Preparation for loading' },
  },
  gluteus_minimus: {
    loading_response: { percent: 45, role: 'Pelvic stabilization' },
    mid_stance:       { percent: 58, role: 'Peak — co-activates with glute med' },
    terminal_stance:  { percent: 38, role: 'Pelvic support' },
    pre_swing:        { percent: 14, role: 'Low activity' },
    initial_swing:    { percent: 10, role: 'Low activity' },
    mid_swing:        { percent: 8,  role: 'Low activity' },
    terminal_swing:   { percent: 12, role: 'Preparation' },
  },
  tensor_fascia_latae: {
    loading_response: { percent: 35, role: 'Hip abduction assist' },
    mid_stance:       { percent: 40, role: 'Pelvic stabilization assist' },
    terminal_stance:  { percent: 20, role: 'Low' },
    pre_swing:        { percent: 30, role: 'Hip flexion assist' },
    initial_swing:    { percent: 25, role: 'Hip flexion' },
    mid_swing:        { percent: 15, role: 'Low' },
    terminal_swing:   { percent: 10, role: 'Low' },
  },
  iliopsoas: {
    loading_response: { percent: 8,  role: 'Low — restrains hip extension' },
    mid_stance:       { percent: 10, role: 'Low' },
    terminal_stance:  { percent: 18, role: 'Building toward swing' },
    pre_swing:        { percent: 52, role: 'Peak — hip flexion initiation' },
    initial_swing:    { percent: 38, role: 'Hip flexion acceleration' },
    mid_swing:        { percent: 15, role: 'Deceleration' },
    terminal_swing:   { percent: 8,  role: 'Low' },
  },
  rectus_femoris: {
    loading_response: { percent: 12, role: 'Shock absorption assist' },
    mid_stance:       { percent: 5,  role: 'Low' },
    terminal_stance:  { percent: 6,  role: 'Low' },
    pre_swing:        { percent: 30, role: 'Hip flexion + knee extension' },
    initial_swing:    { percent: 22, role: 'Hip flexion' },
    mid_swing:        { percent: 8,  role: 'Low' },
    terminal_swing:   { percent: 6,  role: 'Low' },
  },
  vastus_lateralis: {
    loading_response: { percent: 55, role: 'Knee extension — shock absorption' },
    mid_stance:       { percent: 12, role: 'Low' },
    terminal_stance:  { percent: 8,  role: 'Low' },
    pre_swing:        { percent: 10, role: 'Low' },
    initial_swing:    { percent: 5,  role: 'Low' },
    mid_swing:        { percent: 5,  role: 'Low' },
    terminal_swing:   { percent: 28, role: 'Knee extension deceleration' },
  },
  vastus_medialis: {
    loading_response: { percent: 58, role: 'Knee extension — shock absorption' },
    mid_stance:       { percent: 10, role: 'Low' },
    terminal_stance:  { percent: 8,  role: 'Low' },
    pre_swing:        { percent: 10, role: 'Low' },
    initial_swing:    { percent: 5,  role: 'Low' },
    mid_swing:        { percent: 5,  role: 'Low' },
    terminal_swing:   { percent: 25, role: 'Knee extension deceleration' },
  },
  hamstrings: {
    loading_response: { percent: 35, role: 'Hip extension + knee flexion at contact' },
    mid_stance:       { percent: 8,  role: 'Low' },
    terminal_stance:  { percent: 6,  role: 'Low' },
    pre_swing:        { percent: 18, role: 'Knee flexion initiation' },
    initial_swing:    { percent: 25, role: 'Knee flexion for clearance' },
    mid_swing:        { percent: 15, role: 'Low' },
    terminal_swing:   { percent: 42, role: 'Peak — hip extension deceleration' },
  },
  gastrocnemius: {
    loading_response: { percent: 5,  role: 'Low — eccentric onset' },
    mid_stance:       { percent: 38, role: 'Eccentric tibial deceleration' },
    terminal_stance:  { percent: 78, role: 'Peak — propulsive ankle PF' },
    pre_swing:        { percent: 60, role: 'Continued propulsion' },
    initial_swing:    { percent: 5,  role: 'Low' },
    mid_swing:        { percent: 3,  role: 'Low' },
    terminal_swing:   { percent: 4,  role: 'Low' },
  },
  soleus: {
    loading_response: { percent: 8,  role: 'Early eccentric — tibial control' },
    mid_stance:       { percent: 42, role: 'Eccentric tibial forward fall control' },
    terminal_stance:  { percent: 80, role: 'Peak — major propulsive force' },
    pre_swing:        { percent: 55, role: 'Continued propulsion' },
    initial_swing:    { percent: 5,  role: 'Low' },
    mid_swing:        { percent: 3,  role: 'Low' },
    terminal_swing:   { percent: 4,  role: 'Low' },
  },
  tibialis_anterior: {
    loading_response: { percent: 45, role: 'Eccentric — controls foot slap' },
    mid_stance:       { percent: 10, role: 'Low' },
    terminal_stance:  { percent: 8,  role: 'Low' },
    pre_swing:        { percent: 12, role: 'Low' },
    initial_swing:    { percent: 55, role: 'DF for foot clearance' },
    mid_swing:        { percent: 60, role: 'Peak — foot clearance' },
    terminal_swing:   { percent: 50, role: 'Foot positioning for landing' },
  },
  tibialis_posterior: {
    loading_response: { percent: 18, role: 'Arch control — resists pronation' },
    mid_stance:       { percent: 35, role: 'Peak stance — arch stabilization' },
    terminal_stance:  { percent: 28, role: 'Continued arch support' },
    pre_swing:        { percent: 12, role: 'Low' },
    initial_swing:    { percent: 5,  role: 'Low' },
    mid_swing:        { percent: 5,  role: 'Low' },
    terminal_swing:   { percent: 8,  role: 'Preparation' },
  },
  peroneus_longus: {
    loading_response: { percent: 20, role: 'Eversion control — anti-supination' },
    mid_stance:       { percent: 30, role: 'Arch control (1st ray)' },
    terminal_stance:  { percent: 25, role: 'Propulsion assist' },
    pre_swing:        { percent: 10, role: 'Low' },
    initial_swing:    { percent: 8,  role: 'Low' },
    mid_swing:        { percent: 6,  role: 'Low' },
    terminal_swing:   { percent: 12, role: 'Preparation' },
  },
  erector_spinae: {
    loading_response: { percent: 30, role: 'Trunk stabilization at contact' },
    mid_stance:       { percent: 22, role: 'Lumbar stabilization' },
    terminal_stance:  { percent: 18, role: 'Continued stabilization' },
    pre_swing:        { percent: 25, role: 'Trunk rotation control' },
    initial_swing:    { percent: 20, role: 'Trunk stabilization' },
    mid_swing:        { percent: 15, role: 'Low' },
    terminal_swing:   { percent: 28, role: 'Preparation for loading' },
  },
  anterior_deltoid: {
    loading_response: { percent: 15, role: 'Arm deceleration' },
    mid_stance:       { percent: 20, role: 'Arm swing' },
    terminal_stance:  { percent: 25, role: 'Arm forward swing' },
    pre_swing:        { percent: 18, role: 'Arm swing' },
    initial_swing:    { percent: 12, role: 'Low' },
    mid_swing:        { percent: 10, role: 'Low' },
    terminal_swing:   { percent: 15, role: 'Arm deceleration' },
  },
};

export const DEFICIT_ACTIVATION_MODIFIERS = {
  limited_df: {
    gastrocnemius:    { modifier: 1.35, reason: 'Overactive — compensates for ankle stiffness' },
    soleus:           { modifier: 1.40, reason: 'Peak earlier, higher amplitude' },
    tibialis_anterior:{ modifier: 0.55, reason: 'Cannot eccentrically load through full ROM' },
    tibialis_posterior:{ modifier: 1.25, reason: 'Arch stress — increased demand' },
    gluteus_medius:   { modifier: 0.82, reason: 'Reduced base of support disrupts timing' },
  },
  over_pronation: {
    tibialis_posterior:{ modifier: 1.60, reason: 'Overloaded — fighting excessive eversion' },
    peroneus_longus:  { modifier: 0.70, reason: 'Reduced need for eversion' },
    gluteus_medius:   { modifier: 0.75, reason: 'Medial collapse disrupts gluteus medius EMG' },
    vastus_medialis:  { modifier: 0.80, reason: 'Valgus stress reduces VMO effectiveness' },
  },
  stuck_supination: {
    peroneus_longus:  { modifier: 1.50, reason: 'Overworked — attempting eversion' },
    tibialis_posterior:{ modifier: 0.65, reason: 'Reduced anti-pronation demand' },
    gastrocnemius:    { modifier: 0.85, reason: 'Lateral load shift reduces push-off efficiency' },
    gluteus_medius:   { modifier: 0.88, reason: 'Lateral loading affects hip stability' },
  },
  limited_hip_ir: {
    gluteus_medius:   { modifier: 0.65, reason: 'Cannot IR for weight acceptance — inhibited' },
    gluteus_minimus:  { modifier: 0.68, reason: 'Co-inhibited with glute med' },
    tensor_fascia_latae:{ modifier: 1.35, reason: 'Overactive — compensates for glute med deficit' },
    tibialis_posterior:{ modifier: 1.20, reason: 'Foot pronation compensation' },
    vastus_medialis:  { modifier: 0.75, reason: 'Knee valgus reduces VMO activation' },
  },
  hip_ir_asymmetry: {
    erector_spinae:   { modifier: 1.40, reason: 'Asymmetric loading → lumbar rotation → ES overactivity' },
    gluteus_maximus:  { modifier: 0.78, reason: 'Asymmetric hip mechanics' },
    hamstrings:       { modifier: 1.20, reason: 'Ipsilateral compensation' },
  },
  limited_hip_extension: {
    iliopsoas:        { modifier: 1.45, reason: 'Hip flexor overactivity — anterior tilt' },
    rectus_femoris:   { modifier: 1.30, reason: 'Compensatory hip flex increase' },
    gluteus_maximus:  { modifier: 0.60, reason: 'Cannot achieve hip extension range' },
    erector_spinae:   { modifier: 1.35, reason: 'Lumbar extension compensation' },
  },
  trendelenburg: {
    gluteus_medius:   { modifier: 0.45, reason: 'PRIMARY DEFICIT — marked reduction in activation' },
    gluteus_minimus:  { modifier: 0.50, reason: 'Co-inhibited' },
    tensor_fascia_latae:{ modifier: 1.55, reason: 'Overactive compensation for glute med weakness' },
    erector_spinae:   { modifier: 1.30, reason: 'Trunk shift compensation' },
    gluteus_maximus:  { modifier: 0.70, reason: 'Global hip weakness' },
  },
  poor_balance_eo: {
    tibialis_anterior:{ modifier: 1.25, reason: 'Ankle strategy dominance' },
    gastrocnemius:    { modifier: 1.20, reason: 'Ankle strategy — increased co-contraction' },
    gluteus_medius:   { modifier: 0.80, reason: 'Hip strategy limited' },
  },
  oh_squat_forward_lean: {
    erector_spinae:   { modifier: 1.50, reason: 'Trunk flexion compensation' },
    gluteus_maximus:  { modifier: 0.70, reason: 'Insufficient hip extension' },
    gastrocnemius:    { modifier: 1.30, reason: 'Ankle compensation — forward lean' },
    tibialis_anterior:{ modifier: 0.75, reason: 'Reduced eccentric demand' },
  },
  sl_rdl_trunk_rotation: {
    erector_spinae:   { modifier: 1.45, reason: 'Rotational compensation' },
    hamstrings:       { modifier: 0.72, reason: 'Insufficient hip hinge mechanics' },
    gluteus_maximus:  { modifier: 0.68, reason: 'Hip hinge deficit' },
  },
};

export function computeClientActivation(activeDeficits) {
  const result = {};

  Object.entries(NORMATIVE_ACTIVATION).forEach(([muscle, phases]) => {
    result[muscle] = {};
    Object.entries(phases).forEach(([phase, data]) => {
      result[muscle][phase] = {
        normative: data.percent,
        actual:    data.percent,
        role:      data.role,
        modifiers: [],
      };
    });
  });

  activeDeficits.forEach(deficit => {
    const mods = DEFICIT_ACTIVATION_MODIFIERS[deficit.id];
    if (!mods) return;
    Object.entries(mods).forEach(([muscle, mod]) => {
      if (!result[muscle]) return;
      Object.keys(result[muscle]).forEach(phase => {
        result[muscle][phase].actual = Math.min(
          100,
          Math.round(result[muscle][phase].actual * mod.modifier)
        );
        result[muscle][phase].modifiers.push({
          deficit:  deficit.id,
          modifier: mod.modifier,
          reason:   mod.reason,
        });
      });
    });
  });

  return result;
}
