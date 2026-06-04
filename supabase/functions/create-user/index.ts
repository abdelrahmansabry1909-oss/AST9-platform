// ═══════════════════════════════════════════════════════════════
//  supabase/functions/create-user/index.ts
//  Phase 1 · S1 — hardened (Audit C-1).
//
//  Previously: any caller with a valid JWT (incl. the PUBLIC anon key)
//  could create an account with ANY role via the service role — i.e.
//  mint an admin. Now authorization is enforced from the caller's DB
//  role, and the requested grant is validated against that authority.
//
//  Allowed:
//    • admin  → create role 'client' or 'coach'
//    • coach  → create role 'client' ONLY; assigned_coach pinned to self
//    • role 'admin' is NEVER grantable here (provisioned out-of-band)
//
//  Source of truth = this repo. Deploy via supabase functions deploy
//  (bundles ../_shared/auth.ts).
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireRole, json, corsHeaders, HttpError } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')

    // AuthZ: only staff. Anon key / clients are rejected inside requireRole.
    const { user, role: callerRole } = await requireRole(req, ['admin', 'coach'])

    let body: Record<string, unknown>
    try { body = await req.json() } catch { throw new HttpError(400, 'Invalid JSON') }

    const email = body.email as string
    const password = body.password as string
    const full_name = body.full_name as string
    let role = body.role as string
    let assigned_coach = (body.assigned_coach as string | null) ?? null

    if (!email || !password || !full_name || !role) {
      throw new HttpError(400, 'email, password, full_name, and role are required')
    }

    // ── Validate the requested grant against caller authority ──
    if (role === 'admin') {
      throw new HttpError(403, 'Creating admin accounts is not permitted via this endpoint')
    }
    if (callerRole === 'coach') {
      if (role !== 'client') throw new HttpError(403, 'Coaches may only create client accounts')
      assigned_coach = user.id                 // pin to creating coach; ignore client-supplied value
    } else {
      // admin
      if (role !== 'client' && role !== 'coach') {
        throw new HttpError(400, 'role must be "client" or "coach"')
      }
    }

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    // Service-role client built ONLY after authorization passed.
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // If assigning a coach to a new client, that coach must exist + be staff.
    if (role === 'client' && assigned_coach) {
      const { data: coachRow } = await admin.from('profiles')
        .select('id, role').eq('id', assigned_coach).maybeSingle()
      if (!coachRow || (coachRow.role !== 'coach' && coachRow.role !== 'admin')) {
        throw new HttpError(400, 'assigned_coach must reference an existing coach')
      }
    }

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    })
    if (authError) throw new HttpError(400, authError.message)

    const { error: profileError } = await admin.from('profiles').upsert({
      id: authData.user.id,
      email,
      full_name,
      role,
      age: body.age ? parseInt(String(body.age)) : null,
      current_phase: (body.current_phase as string) || 'Phase 1',
      phone: (body.phone as string) || null,
      assigned_coach: assigned_coach || null,
      goal: (body.goal as string) || null,
    })
    if (profileError) throw new HttpError(400, profileError.message)

    return json(req, 200, { user: authData.user })
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
