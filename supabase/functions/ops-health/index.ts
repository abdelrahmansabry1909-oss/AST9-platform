// ═══════════════════════════════════════════════════════════════
//  supabase/functions/ops-health/index.ts
//  Phase P1C — secret-gated ops health endpoint for automated monitoring.
//
//  Purpose: give a future scheduled GitHub Action (P1D) a safe way to check
//  cron/edge health WITHOUT holding the Supabase service_role key or an admin
//  JWT. The Action sends a bespoke header secret; this function validates it
//  against the Vault secret 'ops_health_secret' (in-DB, never plaintext here),
//  then returns a COMPACT, SAFE health summary.
//
//  Deploy with: verify_jwt = false  (server-to-server; no user JWT — same as
//  the cron functions). The x-ops-health-secret header is the gate, not a JWT.
//
//  Data path (service role, but gated by the secret above):
//    • verify_ops_health_secret(text)  — service-role-only Vault check → 401 gate
//    • ops_health_snapshot_system()    — service-role-only safe snapshot
//  The admin-gated public.ops_health_snapshot() is NEVER called here (its
//  is_admin() gate would reject a service-role, no-JWT call anyway).
//
//  SECURITY / PRIVACY:
//    • Never logs request headers or the provided secret.
//    • Never returns the secret, the service_role key, Vault values, response
//      headers/bodies, cron commands, or any user/client/health data.
//    • Response is limited to: ok, overall_healthy, generated_at, hard_fails
//      (jobname + safe reason), warnings (safe strings).
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireOpsHealth, json, corsHeaders, HttpError } from '../_shared/auth.ts'

interface JobHealth {
  jobname?: string
  healthy?: boolean
  reason?: string
}
interface EdgeHttp {
  available?: boolean
  non_2xx_last_24h?: number
  timed_out_last_24h?: number
}
interface Snapshot {
  generated_at?: string
  overall_healthy?: boolean
  jobs?: JobHealth[]
  edge_http?: EdgeHttp
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed')
    }

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Gate: x-ops-health-secret validated in-DB against Vault 'ops_health_secret'.
    // 401 on missing/wrong; 500 on verifier error. Secret never logged/echoed.
    await requireOpsHealth(req, sb)

    // Safe, service-role-only snapshot. NOT the admin ops_health_snapshot().
    const { data, error } = await sb.rpc('ops_health_snapshot_system')
    if (error) {
      console.error('[ops-health] ops_health_snapshot_system failed:', error.message)
      throw new HttpError(500, 'health snapshot failed')
    }

    const snap = (data ?? {}) as Snapshot
    const jobs: JobHealth[] = Array.isArray(snap.jobs) ? snap.jobs : []
    const edge: EdgeHttp = snap.edge_http ?? {}

    // Hard fails = anything that should make the scheduled run fail.
    const hard_fails: Array<{ jobname: string; reason: string }> = []
    for (const j of jobs) {
      if (j?.healthy !== true) {
        hard_fails.push({
          jobname: String(j?.jobname ?? 'unknown'),
          reason: String(j?.reason ?? 'unhealthy'),
        })
      }
    }
    if (snap.overall_healthy !== true && hard_fails.length === 0) {
      hard_fails.push({ jobname: 'overall', reason: 'overall_healthy is false' })
    }

    // Warnings = best-effort global signals; do NOT fail the run on their own.
    const warnings: string[] = []
    if (typeof edge.non_2xx_last_24h === 'number' && edge.non_2xx_last_24h > 0) {
      warnings.push(`edge_http: ${edge.non_2xx_last_24h} non-2xx response(s) in last 24h (global, best-effort)`)
    }
    if (typeof edge.timed_out_last_24h === 'number' && edge.timed_out_last_24h > 0) {
      warnings.push(`edge_http: ${edge.timed_out_last_24h} timed-out response(s) in last 24h (global, best-effort)`)
    }
    if (edge.available === false) {
      warnings.push('edge_http: pg_net response history unavailable')
    }

    const ok = hard_fails.length === 0
    return json(req, 200, {
      ok,
      overall_healthy: snap.overall_healthy === true,
      generated_at: snap.generated_at ?? new Date().toISOString(),
      hard_fails,
      warnings,
    })
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
