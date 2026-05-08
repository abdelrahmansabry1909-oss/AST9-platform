// src/neucore/supabase/bodyMapState.js
// ES module CRUD for body_map_states table.

import { supabase } from './client.js';

export async function saveBodyMapState(clientId, assessmentId, jointData, animationState = 'idle') {
  const { data, error } = await supabase
    .from('body_map_states')
    .upsert({
      client_id:       clientId,
      assessment_id:   assessmentId,
      joint_data:      jointData ?? {},
      animation_state: animationState,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'client_id,assessment_id' })
    .select()
    .single();

  if (error) { console.warn('[bodyMapState] save error:', error.message); return null; }
  return data;
}

export async function getBodyMapState(clientId) {
  const { data, error } = await supabase
    .from('body_map_states')
    .select('*')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  // PGRST116 = not found — not an error for new clients
  if (error && error.code !== 'PGRST116') {
    console.warn('[bodyMapState] load error:', error.message);
    return null;
  }
  return data ?? null;
}

export async function listBodyMapStates(clientId, limit = 10) {
  const { data, error } = await supabase
    .from('body_map_states')
    .select('*')
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) { console.warn('[bodyMapState] list error:', error.message); return []; }
  return data ?? [];
}
