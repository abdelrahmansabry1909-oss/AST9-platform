// ═══════════════════════════════════════════════════════════════
//  supabase/functions/delete-user/index.ts
//  Phase 1 · S3 — hardened (Audit C-2).
//
//  Previously: any caller with a valid JWT (incl. the PUBLIC anon key)
//  could delete ANY account via the service role. Now: admin-only, with
//  self-delete and last-admin guards.
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

    // AuthZ: admin only. Anon key / clients / coaches rejected.
    const { user } = await requireRole(req, ['admin'])

    let body: Record<string, unknown>
    try { body = await req.json() } catch { throw new HttpError(400, 'Invalid JSON') }

    const user_id = body.user_id as string
    if (!user_id) throw new HttpError(400, 'user_id is required')
    if (user_id === user.id) throw new HttpError(400, 'You cannot delete your own account')

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Last-admin guard: never delete the final admin account.
    const { data: target } = await admin.from('profiles')
      .select('role').eq('id', user_id).maybeSingle()
    if (target?.role === 'admin') {
      const { count } = await admin.from('profiles')
        .select('id', { count: 'exact', head: true }).eq('role', 'admin')
      if ((count ?? 0) <= 1) throw new HttpError(400, 'Cannot delete the last admin')
    }

    const { error } = await admin.auth.admin.deleteUser(user_id)
    if (error) throw new HttpError(400, error.message)

    return json(req, 200, { ok: true })
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
