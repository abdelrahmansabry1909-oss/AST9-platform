// ═══════════════════════════════════════════════════════════════
//  supabase/functions/_shared/auth.ts
//  Unified authorization guard for ALL NeuCore edge functions.
//
//  Phase 1 — Edge Function Finalization, step S0.
//
//  CORE PRINCIPLE
//  ──────────────
//  `verify_jwt: true` only proves a VALID token is present — and the
//  project's PUBLIC anon key is a valid token. It is NOT authorization.
//  Authorization is decided here, from the CALLER'S DB ROLE, resolved
//  via auth.getUser() + the get_my_role() SECURITY DEFINER RPC — never
//  from token presence and never from client-supplied user_metadata.
//
//  Usage (user-bearing function):
//      import { requireRole, json, corsHeaders, HttpError } from '../_shared/auth.ts'
//      serve(async (req) => {
//        if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
//        try {
//          const { user, role, userClient } = await requireRole(req, ['admin'])
//          // ... authorized work; build service-role client ONLY now if needed ...
//          return json(req, 200, { ok: true })
//        } catch (e) {
//          return HttpError.toResponse(req, e)
//        }
//      })
//
//  Usage (cron/system function):
//      requireCron(req)   // throws 401 unless x-cron-secret matches CRON_SECRET
// ═══════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type Role = 'admin' | 'coach' | 'client' | 'system'

// ── Error type that carries an HTTP status ──────────────────────
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'HttpError'
  }
  // Convert any thrown value into a CORS-aware JSON Response.
  static toResponse(req: Request, e: unknown): Response {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message })
    console.error('[edge] unhandled error:', e)
    return json(req, 500, { error: 'Internal error' })
  }
}

// ── CORS ────────────────────────────────────────────────────────
// Allow-list driven by the ALLOWED_ORIGINS env (comma-separated).
// If the request Origin is on the list, it is echoed. If ALLOWED_ORIGINS
// is unset (not yet configured), we echo the caller's Origin so the app
// keeps working — CORS is browser-policy hardening, not the auth gate
// (requireRole is). Step S10 sets ALLOWED_ORIGINS to lock this down.
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  let allowOrigin: string
  if (allowed.length === 0) {
    allowOrigin = origin || '*'          // not yet configured — non-breaking default
  } else if (allowed.includes(origin)) {
    allowOrigin = origin
  } else {
    allowOrigin = allowed[0]             // disallowed origin → browser will block
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // supabase-js attaches x-client-info (and, in recent versions,
    // x-supabase-api-version) to every functions.invoke() call; both must be
    // allow-listed or the browser preflight fails for ALL browser callers.
    // x-cron-secret / x-ops-health-secret gate the system/ops endpoints.
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-supabase-api-version, x-cron-secret, x-ops-health-secret',
    'Vary': 'Origin',
  }
}

// ── JSON response helper (always CORS-aware) ────────────────────
export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

// ── Bearer extraction ───────────────────────────────────────────
function bearer(req: Request): string {
  const h = req.headers.get('Authorization') ?? ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

// ── requireRole — the gate every privileged user-function uses ──
//
//  Returns the authenticated caller, their DB role, and a CALLER-SCOPED
//  Supabase client (RLS applies as that user) so functions can do
//  RLS-permitted reads WITHOUT touching the service role.
//
//  Throws HttpError(401) for anon/missing/invalid tokens (the public
//  anon key resolves to NO user here), HttpError(403) for wrong role.
export async function requireRole(
  req: Request,
  allowed: Role[],
): Promise<{ user: { id: string; email?: string }; role: Role; userClient: SupabaseClient }> {
  const token = bearer(req)
  if (!token) throw new HttpError(401, 'Missing authorization')

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Identity from the token. The anon key has no user → null → reject.
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) throw new HttpError(401, 'Not authenticated')

  // Role from the DB (SECURITY DEFINER RPC), never from token metadata.
  const { data: roleData, error: roleErr } = await userClient.rpc('get_my_role')
  if (roleErr) {
    console.error('[edge] get_my_role failed:', roleErr.message)
    throw new HttpError(403, 'Could not resolve role')
  }
  const role = (roleData ?? 'client') as Role

  if (!allowed.includes(role)) throw new HttpError(403, 'Forbidden')
  return { user: { id: user.id, email: user.email ?? undefined }, role, userClient }
}

// ── requireCron — gate for system/scheduled functions (no user) ──
//  'system' is NOT a profiles.role; it is proven by the x-cron-secret
//  header, validated against the SINGLE source of truth — the Supabase
//  Vault secret 'cron_secret' — via the verify_cron_secret() RPC. No
//  CRON_SECRET env var (eliminates dual-store drift). The caller passes
//  a service-role client because the RPC is revoked from client roles.
export async function requireCron(req: Request, sb: SupabaseClient): Promise<void> {
  const got = req.headers.get('x-cron-secret') ?? ''
  if (!got) throw new HttpError(401, 'Forbidden')
  const { data: ok, error } = await sb.rpc('verify_cron_secret', { p_secret: got })
  if (error) {
    console.error('[edge] verify_cron_secret failed:', error.message)
    throw new HttpError(500, 'cron secret verification failed')
  }
  if (ok !== true) throw new HttpError(401, 'Forbidden')
}

// ── requireOpsHealth — gate for the ops-health monitoring endpoint ──
//  Same shape as requireCron but for the ops-health check: the caller
//  (a scheduled GitHub Action) proves itself with the x-ops-health-secret
//  header, validated against the SINGLE source of truth — the Supabase
//  Vault secret 'ops_health_secret' — via the verify_ops_health_secret()
//  RPC (revoked from client roles, so a service-role client is required).
//  The provided secret is NEVER logged, echoed, or returned; only a boolean
//  leaves the DB. Distinct from cron_secret so the two blast radii stay
//  isolated.
export async function requireOpsHealth(req: Request, sb: SupabaseClient): Promise<void> {
  const got = req.headers.get('x-ops-health-secret') ?? ''
  if (!got) throw new HttpError(401, 'Forbidden')
  const { data: ok, error } = await sb.rpc('verify_ops_health_secret', { p_secret: got })
  if (error) {
    // Log only the RPC error message — never the provided secret.
    console.error('[edge] verify_ops_health_secret failed:', error.message)
    throw new HttpError(500, 'ops-health secret verification failed')
  }
  if (ok !== true) throw new HttpError(401, 'Forbidden')
}

// ── HTML escaping for any caller-supplied string echoed into email/HTML
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// ── Best-effort in-memory rate limit (per edge instance) ────────
//  Not a hard global limiter (instances are ephemeral/multiple) but
//  blunts abuse of paid AI endpoints. key = userId or ipHash.
const _rate = new Map<string, number[]>()
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const hits = (_rate.get(key) ?? []).filter((t) => now - t < windowMs)
  hits.push(now)
  _rate.set(key, hits)
  return hits.length > max     // true ⇒ limited (caller returns 429)
}
