// src/neucore/supabase/assessments.js
// ES module CRUD for gait_assessments table.

import { supabase } from './client.js';

export async function saveGaitAssessment(clientId, assessmentData, simulationResult) {
  const { data, error } = await supabase
    .from('gait_assessments')
    .insert({
      client_id:              clientId,
      assessment_data:        assessmentData,
      muscle_activation_data: simulationResult?.activation  ?? {},
      client_kinematics:      simulationResult?.kinematics  ?? {},
      simulation_deficits:    simulationResult?.deficits    ?? [],
      created_at:             new Date().toISOString(),
    })
    .select()
    .single();

  if (error) { console.warn('[assessments] save error:', error.message); return null; }
  return data;
}

export async function getLatestGaitAssessment(clientId) {
  const { data, error } = await supabase
    .from('gait_assessments')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.warn('[assessments] load error:', error.message);
    return null;
  }
  return data ?? null;
}

export async function listGaitAssessments(clientId, limit = 20) {
  const { data, error } = await supabase
    .from('gait_assessments')
    .select('id, created_at, simulation_deficits, assessment_data')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) { console.warn('[assessments] list error:', error.message); return []; }
  return data ?? [];
}
