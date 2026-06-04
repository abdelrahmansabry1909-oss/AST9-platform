// ═══════════════════════════════════════════════════════════════
//  supabase/functions/subscription-checker/index.ts
//  Phase 1 · S7 — hardened (Edge Finalization).
//
//  Trigger: pg_cron job "subscription-checker-daily" (0 0 * * *) via
//  net.http_post. The cron sends the secret in the `x-cron-secret`
//  header (value stored in Supabase Vault, not plaintext in cron.job).
//
//  Previously: verify_jwt=true + the cron sent NO auth header → the
//  platform 401'd every night, so the job silently did nothing
//  (confirmed via net._http_response: status 401). Now:
//    • verify_jwt = false (cron carries no JWT)
//    • requireCron(req, sb) — x-cron-secret validated against the Vault
//      secret 'cron_secret' (single source of truth) via the
//      verify_cron_secret() RPC; no CRON_SECRET env. 401 on mismatch.
//    • expiry flip delegated to the canonical check_subscription_expiry()
//      DB function (no duplicated logic)
//    • expiring-soon emails are idempotent via subscriptions.notified_7d
//
//  System/cron context → service role is appropriate here (gated by the
//  cron secret; never browser-reachable).
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireCron, json, corsHeaders, HttpError } from '../_shared/auth.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Gate: x-cron-secret validated against the Vault 'cron_secret'
    // (single source of truth) via verify_cron_secret(). Uses the
    // service-role client because that RPC is revoked from client roles.
    await requireCron(req, sb)

    // 1) Flip past-due subscriptions to 'expired' via the canonical DB
    //    function (single source of truth; deduplicates the old inline logic).
    const { error: expErr } = await sb.rpc('check_subscription_expiry')
    if (expErr) throw new HttpError(500, 'check_subscription_expiry failed: ' + expErr.message)

    // 2) Email clients whose active plan expires within 7 days — once per
    //    window, deduped via subscriptions.notified_7d.
    const today = new Date().toISOString().slice(0, 10)
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

    const { data: due, error: dueErr } = await sb
      .from('subscriptions')
      .select('id, end_date, profiles!subscriptions_client_id_fkey(email, full_name)')
      .eq('status', 'active')
      .gte('end_date', today)
      .lte('end_date', in7)
      .or('notified_7d.is.null,notified_7d.eq.false')
    if (dueErr) throw new HttpError(500, 'expiring query failed: ' + dueErr.message)

    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? Deno.env.get('RESEND_FROM') ?? 'AST9 <onboarding@resend.dev>'
    const notifiedIds: string[] = []

    for (const row of (due ?? []) as Array<{ id: string; end_date: string; profiles?: { email?: string } }>) {
      const email = row.profiles?.email
      if (!email) continue
      const days = Math.max(0, Math.ceil((new Date(row.end_date).getTime() - Date.now()) / 86400000))
      if (resendKey) {
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: fromEmail,
              to: [email],
              subject: 'Subscription Expiring Soon',
              html: `<p>Your subscription expires in ${days} day(s). Contact your coach to renew before access becomes read-only.</p>`,
            }),
          })
        } catch (e) {
          console.warn('[subscription-checker] resend failed:', e)
        }
      }
      notifiedIds.push(row.id)
    }

    if (notifiedIds.length) {
      await sb.from('subscriptions').update({ notified_7d: true }).in('id', notifiedIds)
    }

    return json(req, 200, { ok: true, expiring_notified: notifiedIds.length })
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
