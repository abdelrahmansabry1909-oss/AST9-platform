// ═══════════════════════════════════════════════════════════════
//  supabase/functions/generate-program/index.ts
//  Phase 1 · S5 — hardened (Audit H-5).
//
//  Previously: any valid JWT (incl. PUBLIC anon key) could invoke Gemini
//  on the project's GEMINI_API_KEY with an arbitrary prompt — an open,
//  project-billed LLM proxy. Now: staff-only, rate-limited, size-capped.
//
//  No service role (no DB access). Returns the raw Gemini envelope so the
//  existing client parser (dashboard.js) is unchanged.
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { requireRole, json, corsHeaders, HttpError, rateLimit } from '../_shared/auth.ts'

const MAX_PROMPT = 8000          // chars
const RATE_MAX = 20              // calls
const RATE_WINDOW = 5 * 60_000   // per 5 min, per user

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')

    const { user } = await requireRole(req, ['coach', 'admin'])
    if (rateLimit(`genprog:${user.id}`, RATE_MAX, RATE_WINDOW)) {
      throw new HttpError(429, 'Rate limit — please wait before generating again')
    }

    let body: Record<string, unknown>
    try { body = await req.json() } catch { throw new HttpError(400, 'Invalid JSON') }

    const prompt = body.prompt
    if (!prompt || typeof prompt !== 'string') throw new HttpError(400, 'Missing prompt')
    if (prompt.length > MAX_PROMPT) throw new HttpError(400, 'Prompt too long')

    const apiKey = Deno.env.get('GEMINI_API_KEY') ?? ''
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, temperature: 0.4 },
        }),
      },
    )
    const data = await res.json()
    return json(req, res.status, data)
  } catch (e) {
    return HttpError.toResponse(req, e)
  }
})
