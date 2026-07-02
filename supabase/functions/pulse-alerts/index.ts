// ═══════════════════════════════════════════════════════════════
//  supabase/functions/pulse-alerts/index.ts
//  S4 — Recovery Pulse proactive alerts (automation layer only).
//
//  Trigger: pg_cron job "pulse-alerts-daily" (0 5 * * *) via
//  net.http_post with x-cron-secret (Vault 'cron_secret'), exactly the
//  subscription-checker pattern: verify_jwt=false + requireCron.
//
//  Pipeline (single source of truth preserved end-to-end):
//    fn_pulse_for_alerts()  → the unmodified v_client_pulse classifier
//    pulse_alert_state      → transition memory + episode dedup
//    notify()               → the only insert path into notifications
//
//  Alert rule v1 (conservative, per S4_AND_REFERRALS_PLANNING.md §1.2):
//    alertable = severity ≥ 3 OR churn_risk.
//    Send when a client ENTERS the alertable band (new episode), or
//    ESCALATES within an open episode (worse severity AND a different
//    status than last alerted — e.g. at_risk → regressing).
//    Never re-alert the same status in the same episode; 7-day cooldown
//    floor per client as belt-and-braces. Episodes close when the
//    client leaves the band; a later relapse is a new episode.
//
//  Targeting: assigned coach; severity 4 also CCs admins.
//  Safety: hard cap 50 sends/run (overflow logged, not sent);
//  ?dry=1 computes the full decision set and returns it with ZERO
//  writes (no notify, no state, no log).
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireCron, json, corsHeaders, HttpError } from '../_shared/auth.ts'

const ALERT_MIN_SEVERITY = 3
const COOLDOWN_MS = 7 * 86400000
const MAX_SENDS_PER_RUN = 50

type PulseRow = {
  client_id: string; pulse_status: string; severity: number;
  reasons: string[] | null; churn_risk: boolean | null;
  effective_status: string | null; days_since_activity: number | null;
  adherence_7d: number | null;
}
type StateRow = {
  client_id: string; last_status: string; last_severity: number;
  episode_active: boolean; episode_started_at: string | null;
  last_alerted_status: string | null; last_alerted_at: string | null;
}

// Calm, strategic copy — no clinical or doom language.
function compose(r: PulseRow, name: string) {
  const who = name || 'A client'
  const reasonsLine = (r.reasons ?? []).slice(0, 3).join(' · ')
  const tail = reasonsLine ? ` ${reasonsLine}.` : ''
  if (r.pulse_status === 'regressing') {
    return {
      title: `${who} — recovery momentum has declined`,
      body: `AST9 detected a meaningful change in ${who}'s recovery trend over recent sessions.${tail} A check-in may help re-establish rhythm.`,
    }
  }
  if (r.severity < ALERT_MIN_SEVERITY && r.churn_risk) {
    return {
      title: `${who} — engagement ahead of renewal`,
      body: `${who}'s engagement has dipped while their plan is ${r.effective_status ?? 'near renewal'}.${tail} A short conversation now may make the difference.`,
    }
  }
  return {
    title: `${who} may benefit from a check-in`,
    body: `${who}'s engagement trend has softened this week.${tail}`,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')

    const url = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

    await requireCron(req, sb)
    const dry = new URL(req.url).searchParams.get('dry') === '1'

    // 1) The classifier feed (single source of truth, unmodified).
    const { data: pulse, error: pulseErr } = await sb.rpc('fn_pulse_for_alerts')
    if (pulseErr) throw new HttpError(500, 'fn_pulse_for_alerts failed: ' + pulseErr.message)
    const rows = (pulse ?? []) as PulseRow[]

    // 2) Memory + targeting context.
    const ids = rows.map((r) => r.client_id)
    const [{ data: states, error: stErr }, { data: profs, error: prErr }, { data: admins, error: adErr }] =
      await Promise.all([
        sb.from('pulse_alert_state').select('*'),
        ids.length ? sb.from('profiles').select('id, full_name, email, assigned_coach').in('id', ids)
                   : Promise.resolve({ data: [], error: null }),
        sb.from('profiles').select('id').eq('role', 'admin'),
      ])
    if (stErr) throw new HttpError(500, 'state read failed: ' + stErr.message)
    if (prErr) throw new HttpError(500, 'profiles read failed: ' + prErr.message)
    if (adErr) throw new HttpError(500, 'admins read failed: ' + adErr.message)

    const stateMap = new Map<string, StateRow>((states ?? []).map((s: StateRow) => [s.client_id, s]))
    const profMap = new Map<string, { full_name?: string; email?: string; assigned_coach?: string }>(
      (profs ?? []).map((p: { id: string }) => [p.id, p as never]))
    const adminIds = (admins ?? []).map((a: { id: string }) => a.id)
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    // 3) Transition decisions.
    const candidates: PulseRow[] = []
    for (const r of rows) {
      const alertable = r.severity >= ALERT_MIN_SEVERITY || r.churn_risk === true
      if (!alertable) continue
      const prev = stateMap.get(r.client_id)
      let fire = false
      if (!prev || !prev.episode_active) {
        fire = true                                       // entering the band → new episode
      } else if (r.pulse_status !== prev.last_alerted_status && r.severity > prev.last_severity) {
        fire = true                                       // escalation within the episode
      }
      if (fire && prev?.last_alerted_at && now - new Date(prev.last_alerted_at).getTime() < COOLDOWN_MS) {
        fire = false                                      // cooldown floor
      }
      if (fire) candidates.push(r)
    }

    // 4) Cap (worst first; overflow is reported, never silently sent).
    candidates.sort((a, b) => b.severity - a.severity)
    const toSend = candidates.slice(0, MAX_SENDS_PER_RUN)
    const overflow = candidates.length - toSend.length
    const sentIds = new Set(toSend.map((r) => r.client_id))

    const describe = (r: PulseRow) => {
      const prof = profMap.get(r.client_id)
      const coach = prof?.assigned_coach ?? null
      const recipients = coach ? [coach] : []
      if (r.severity >= 4) for (const a of adminIds) if (!recipients.includes(a)) recipients.push(a)
      const msg = compose(r, prof?.full_name ?? prof?.email ?? '')
      return { client_id: r.client_id, pulse_status: r.pulse_status, severity: r.severity, churn_risk: r.churn_risk, recipients, ...msg }
    }

    if (dry) {
      return json(req, 200, {
        ok: true, dry: true,
        total_clients: rows.length,
        would_send: toSend.map(describe),
        overflow,
      })
    }

    // 5) Send via notify() + audit log.
    let sent = 0
    for (const r of toSend) {
      const d = describe(r)
      if (!d.recipients.length) { console.warn('[pulse-alerts] skipping 1 client: no recipient resolved'); continue }
      for (const rcpt of d.recipients) {
        const { error: nErr } = await sb.rpc('notify', {
          p_recipient_id: rcpt,
          p_type: 'pulse_alert',
          p_title: d.title,
          p_body: d.body,
          p_link_section: 'clients',
          p_link_params: {},
          p_severity: 'warning',
          p_data: { client_id: r.client_id, pulse_status: r.pulse_status, severity: r.severity, reasons: r.reasons ?? [] },
        })
        if (nErr) { console.error('[pulse-alerts] notify failed:', nErr.message); continue }
        sent++
      }
      await sb.from('pulse_alert_log').insert({
        client_id: r.client_id, pulse_status: r.pulse_status, severity: r.severity,
        recipients: d.recipients, reasons: r.reasons ?? [],
      })
    }

    // 6) Persist transition memory for EVERY classified client (alerted or
    //    not) so the next run sees true transitions. last_alerted_* only
    //    advances for alerts actually sent (cap-aware).
    const upserts = rows.map((r) => {
      const alertable = r.severity >= ALERT_MIN_SEVERITY || r.churn_risk === true
      const prev = stateMap.get(r.client_id)
      const alertedNow = sentIds.has(r.client_id)
      return {
        client_id: r.client_id,
        last_status: r.pulse_status,
        last_severity: r.severity,
        episode_active: alertable,
        episode_started_at: alertable ? (prev?.episode_active ? prev.episode_started_at : nowIso) : null,
        last_alerted_status: alertedNow ? r.pulse_status : prev?.last_alerted_status ?? null,
        last_alerted_at: alertedNow ? nowIso : prev?.last_alerted_at ?? null,
        updated_at: nowIso,
      }
    })
    if (upserts.length) {
      const { error: upErr } = await sb.from('pulse_alert_state').upsert(upserts)
      if (upErr) throw new HttpError(500, 'state upsert failed: ' + upErr.message)
    }

    return json(req, 200, { ok: true, dry: false, total_clients: rows.length, alerts_sent: sent, clients_alerted: toSend.length, overflow })
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
