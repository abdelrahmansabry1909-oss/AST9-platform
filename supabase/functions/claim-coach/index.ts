// ═══════════════════════════════════════════════════════════════
//  supabase/functions/claim-coach/index.ts
//  Phase 4 — public coach signup promotion.
//
//  Public signup goes through Supabase auth.signUp with
//  user_metadata.role_request='coach'. The handle_new_user trigger forces
//  the new profile to role='client' (anti-spoof). After the user VERIFIES
//  their email and logs in, the client calls this function once; it
//  promotes the verified self-signup from client → coach and assigns the
//  Free package.
//
//  Security (airtight):
//    • Promotes ONLY client → coach. Never admin. The target role is
//      hard-coded 'coach' — role_request is a gate, never the target.
//    • Requires: email verified, user_metadata.role_request='coach',
//      current role='client', AND assigned_coach IS NULL (so a
//      coach-CREATED client can never self-promote).
//    • The role write uses the service role (auth.uid() IS NULL), the same
//      trusted path create-user uses — it satisfies the profiles
//      protected-columns trigger without weakening it.
//
//  Source of truth = this repo. Deploy bundles ../_shared/auth.ts.
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireRole, json, corsHeaders, HttpError } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')

    // Any authenticated user may call; non-clients are a no-op below.
    const { user, role, userClient } = await requireRole(req, ['admin', 'coach', 'client'])

    // Already elevated (or staff) → nothing to do.
    if (role !== 'client') return json(req, 200, { role, promoted: false })

    // Re-read the caller's auth record for verification + intent.
    const { data: { user: full } } = await userClient.auth.getUser()
    const confirmed  = !!full?.email_confirmed_at
    const wantsCoach = (full?.user_metadata as Record<string, unknown> | undefined)?.role_request === 'coach'
    if (!confirmed || !wantsCoach) return json(req, 200, { role: 'client', promoted: false })

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Gate: must be an unassigned self-signup, still a client.
    const { data: prof } = await admin.from('profiles')
      .select('role, assigned_coach').eq('id', user.id).maybeSingle()
    if (!prof || prof.role !== 'client' || prof.assigned_coach !== null) {
      return json(req, 200, { role: prof?.role ?? 'client', promoted: false })
    }

    // Promote (service role → bypasses the protected-columns trigger the
    // same way create-user does). Target role is hard-coded 'coach'.
    const { error: upErr } = await admin.from('profiles')
      .update({ role: 'coach' }).eq('id', user.id)
    if (upErr) throw new HttpError(400, upErr.message)

    // Assign the Free package (1 slot). Idempotent — leave any existing row.
    await admin.from('coach_subscriptions').upsert(
      { coach_id: user.id, package_key: 'free', client_limit: 1, status: 'active' },
      { onConflict: 'coach_id', ignoreDuplicates: true },
    )

    return json(req, 200, { role: 'coach', promoted: true })
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
