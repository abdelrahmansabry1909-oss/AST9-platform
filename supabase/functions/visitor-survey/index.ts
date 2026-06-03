// ═══════════════════════════════════════════════════════════════
// supabase/functions/visitor-survey/index.ts
// Phase 1 — Visitor Entry Flow (workflow §1C)
//
// Accepts an unauthenticated POST from the landing page survey.
// Writes to public.visitor_inquiries and emails the destination
// inbox via Resend.
//
// Required project secrets (set in Supabase dashboard → Edge Functions → Secrets):
//   SUPABASE_URL          — auto-populated
//   SUPABASE_SERVICE_ROLE_KEY — auto-populated (used for the insert)
//   RESEND_API_KEY        — your Resend API key
//   RESEND_FROM           — verified sender, e.g. "NeuCore <hello@neucore.io>"
//   NOTIFY_EMAIL          — destination inbox; defaults to abdelrahman.sabry.1909@gmail.com
//
// Deploy:
//   supabase functions deploy visitor-survey --no-verify-jwt
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ────────────────────────────────────────────────────────
const CORS = {
  "Access-Control-Allow-Origin":  "*", // tighten to your domain in production
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Content-Type":                 "application/json",
};

// ── Validation ──────────────────────────────────────────────────
type Payload = {
  full_name: string;
  email:     string;
  phone?:    string;
  symptoms?: string;
  source?:   "survey" | "calendly_redirect";
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(p: any): { ok: true; data: Payload } | { ok: false; error: string } {
  if (!p || typeof p !== "object") return { ok: false, error: "Invalid body" };
  const full_name = String(p.full_name ?? "").trim();
  const email     = String(p.email ?? "").trim().toLowerCase();
  const phone     = p.phone     ? String(p.phone).trim()     : undefined;
  const symptoms  = p.symptoms  ? String(p.symptoms).trim()  : undefined;
  const source    = p.source === "calendly_redirect" ? "calendly_redirect" : "survey";

  if (full_name.length < 2 || full_name.length > 120) return { ok: false, error: "Name must be 2–120 chars" };
  if (!EMAIL_RE.test(email))                          return { ok: false, error: "Invalid email" };
  if (phone    && phone.length    > 40)               return { ok: false, error: "Phone too long" };
  if (symptoms && symptoms.length > 4000)             return { ok: false, error: "Symptoms too long" };

  return { ok: true, data: { full_name, email, phone, symptoms, source } };
}

// ── Light-touch in-memory rate limit (per-edge instance) ────────
const RATE: Map<string, number[]> = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WIN = 3;

function rateLimited(ipHash: string): boolean {
  const now = Date.now();
  const hits = (RATE.get(ipHash) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  RATE.set(ipHash, hits);
  return hits.length > MAX_PER_WIN;
}

async function hashIp(ip: string): Promise<string> {
  const buf = new TextEncoder().encode(ip + (Deno.env.get("SUPABASE_URL") ?? ""));
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Resend email ────────────────────────────────────────────────
async function sendEmail(payload: Payload): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from   = Deno.env.get("RESEND_FROM") ?? "NeuCore <onboarding@resend.dev>";
  const to     = Deno.env.get("NOTIFY_EMAIL") ?? "abdelrahman.sabry.1909@gmail.com";
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — skipping email");
    return false;
  }

  const subject = `[NeuCore] New ${payload.source === "calendly_redirect" ? "Calendly redirect" : "survey"} from ${payload.full_name}`;
  const html = `
    <h2 style="font-family:system-ui;color:#0E1A24">New visitor inquiry</h2>
    <table style="font-family:system-ui;border-collapse:collapse">
      <tr><td><b>Name</b></td><td>${escapeHtml(payload.full_name)}</td></tr>
      <tr><td><b>Email</b></td><td>${escapeHtml(payload.email)}</td></tr>
      ${payload.phone ? `<tr><td><b>Phone</b></td><td>${escapeHtml(payload.phone)}</td></tr>` : ""}
      ${payload.symptoms ? `<tr><td valign="top"><b>Symptoms</b></td><td><pre style="white-space:pre-wrap;font-family:system-ui;margin:0">${escapeHtml(payload.symptoms)}</pre></td></tr>` : ""}
      <tr><td><b>Source</b></td><td>${payload.source}</td></tr>
    </table>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error("Resend error:", res.status, txt);
      return false;
    }
    return true;
  } catch (e) {
    console.error("Resend request failed:", e);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// ── Handler ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  let body: unknown;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

  const v = validate(body);
  if (!v.ok) return new Response(JSON.stringify({ error: v.error }), { status: 400, headers: CORS });

  // Rate limit by client IP (best-effort)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
          ?? req.headers.get("cf-connecting-ip")
          ?? "unknown";
  const ipHash = await hashIp(ip);
  if (rateLimited(ipHash)) {
    return new Response(JSON.stringify({ error: "Rate limit — please wait a moment" }), { status: 429, headers: CORS });
  }

  // Insert with the ANON key — public-safe functions hold NO service role
  // (Edge Finalization S9). visitor_inquiries permits anon INSERT, so RLS
  // is satisfied without elevated privilege.
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const supaKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const emailSent = await sendEmail(v.data);

  const { error } = await sb.from("visitor_inquiries").insert({
    full_name:  v.data.full_name,
    email:      v.data.email,
    phone:      v.data.phone ?? null,
    symptoms:   v.data.symptoms ?? null,
    source:     v.data.source ?? "survey",
    email_sent: emailSent,
    ip_hash:    ipHash,
  });

  if (error) {
    console.error("Insert failed:", error);
    return new Response(JSON.stringify({ error: "Could not save inquiry" }), { status: 500, headers: CORS });
  }

  return new Response(JSON.stringify({ ok: true, email_sent: emailSent }), { status: 200, headers: CORS });
});
