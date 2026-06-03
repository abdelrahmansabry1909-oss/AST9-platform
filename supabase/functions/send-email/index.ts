// ═══════════════════════════════════════════════════════════════
//  supabase/functions/send-email/index.ts
//  Phase 1 · S4 — hardened (Audit H-4).
//
//  Previously: any valid JWT (incl. PUBLIC anon key) could send a
//  templated email to ANY client_id via the service role, and `message`
//  was injected into HTML unescaped.
//
//  Now:
//    • requireRole(['admin','coach'])  — anon/clients rejected
//    • coach may only email their OWN assigned clients
//    • `type` whitelisted; all interpolated values HTML-escaped
//    • NO service role — the caller-scoped client reads the profile
//      under RLS (coach/admin may read profiles); Resend key from env
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireRole, json, corsHeaders, HttpError, escapeHtml } from '../_shared/auth.ts'

const ALLOWED_TYPES = ['phase_upgrade', 'subscription_activated']

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')

    const { user, role, userClient } = await requireRole(req, ['admin', 'coach'])

    let body: Record<string, unknown>
    try { body = await req.json() } catch { throw new HttpError(400, 'Invalid JSON') }

    const type = body.type as string
    const client_id = body.client_id as string
    if (!ALLOWED_TYPES.includes(type)) throw new HttpError(400, 'Unsupported email type')
    if (!client_id) throw new HttpError(400, 'client_id is required')

    // Caller-scoped read (RLS): coach/admin may read profiles. No service role.
    const { data: client } = await userClient
      .from('profiles')
      .select('email, full_name, assigned_coach')
      .eq('id', client_id)
      .maybeSingle()
    if (!client) throw new HttpError(404, 'Client not found')

    // Coaches may only email their own assigned clients.
    if (role === 'coach' && client.assigned_coach !== user.id) {
      throw new HttpError(403, 'You can only email your assigned clients')
    }

    const name = escapeHtml(client.full_name)
    let subject = ''
    let html = ''

    if (type === 'phase_upgrade') {
      const phase = escapeHtml(body.new_phase)
      const msg = body.message ? escapeHtml(body.message) : ''
      subject = `🏆 You've advanced to ${phase}!`
      html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0b0d12;color:#f0f2f7;padding:40px;border-radius:12px">
        <div style="font-family:monospace;font-size:24px;font-weight:800;color:#c8f04a;margin-bottom:8px">⚡ AST9</div>
        <h1 style="color:#c8f04a;font-size:28px;margin-bottom:16px">Phase Complete! 🏆</h1>
        <p style="font-size:16px;line-height:1.6">Hi ${name},</p>
        <p style="font-size:16px;line-height:1.6">${msg || `Congratulations! You've successfully advanced to <strong style="color:#c8f04a">${phase}</strong>.`}</p>
        <p style="color:#7a8399;font-size:13px;margin-top:32px">— AST9 Elite Coaching</p>
      </div>`
    } else { // subscription_activated
      const plan = escapeHtml(body.plan)
      const start = escapeHtml(body.start)
      const end = escapeHtml(body.end)
      subject = '✅ Your AST9 Subscription is Active'
      html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0b0d12;color:#f0f2f7;padding:40px;border-radius:12px">
        <div style="font-family:monospace;font-size:24px;font-weight:800;color:#c8f04a;margin-bottom:8px">⚡ AST9</div>
        <h1 style="color:#3df5c1;font-size:28px;margin-bottom:16px">Subscription Activated ✅</h1>
        <p style="font-size:16px;line-height:1.6">Hi ${name}, your ${plan}-month plan is now active.</p>
        <p style="font-size:14px;color:#7a8399"><strong style="color:#f0f2f7">Start:</strong> ${start}&nbsp;&nbsp;<strong style="color:#f0f2f7">End:</strong> ${end}</p>
        <p style="color:#7a8399;font-size:13px;margin-top:32px">— AST9 Elite Coaching</p>
      </div>`
    }

    const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'AST9 <onboarding@resend.dev>'
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: [client.email], subject, html }),
    })
    const emailData = await emailRes.json()
    return json(req, emailRes.ok ? 200 : 400, { ok: emailRes.ok, ...emailData })
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
