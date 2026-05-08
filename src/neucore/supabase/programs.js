// src/neucore/supabase/programs.js
// ES module CRUD for programs table.

import { supabase } from './client.js';

export async function saveProgram(clientId, assessmentId, programData) {
  const { data, error } = await supabase
    .from('programs')
    .insert({
      client_id:     clientId,
      assessment_id: assessmentId,
      phase:         programData.phase,
      structure:     programData.structure,
      deficits:      programData.deficits ?? [],
      scores:        programData.scores   ?? {},
      warnings:      programData.warnings ?? [],
      created_at:    new Date().toISOString(),
    })
    .select()
    .single();

  if (error) { console.warn('[programs] save error:', error.message); return null; }
  return data;
}

export async function listPrograms(clientId, limit = 20) {
  const { data, error } = await supabase
    .from('programs')
    .select('id, created_at, phase, deficits, scores')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) { console.warn('[programs] list error:', error.message); return []; }
  return data ?? [];
}

export async function getProgram(programId) {
  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('id', programId)
    .single();

  if (error) { console.warn('[programs] get error:', error.message); return null; }
  return data;
}
