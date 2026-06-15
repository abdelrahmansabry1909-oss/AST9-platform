// ═══════════════════════════════════════════════════════════════
// supabase/functions/subjective-transcript-assistant/index.ts
// Phase 8 — Subjective Assessment Transcript Assistant V1
//
// Turns a pasted assessment-call transcript into a STRUCTURED DRAFT for
// the NeuCore Subjective Assessment (js/rpm/subjective.js). The coach
// reviews and applies suggestions manually — nothing here is saved.
//
// Behaviour mirrors rpm-ai-suggest (Documentation.md §"move behind an edge
// function … mirroring the rpm-ai-suggest pattern"):
//   • tries Anthropic when ANTHROPIC_API_KEY is set; returns source:"anthropic"
//   • on no-key / error / parse failure → deterministic bilingual heuristic
//     extractor; returns source:"heuristic" (honest — never claims AI quality)
//
// Privacy (Phase 8 spec): the transcript is processed TRANSIENTLY. It is
// never written to any table, never logged, never returned to the client.
// Only the derived draft + summary + caution terms are returned.
//
// AuthZ: requireRole(['coach','admin']); clients are rejected. When a
// client_id is supplied (the UI always sends it) the caller must be that
// client's assigned coach (profiles.assigned_coach = caller) — admins may
// analyse for any existing client.
//
// Required project secrets (Supabase dashboard → Edge Functions → Secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY  — auto (used by requireRole)
//   ANTHROPIC_API_KEY                — optional; when missing, heuristic only
//   ANTHROPIC_MODEL                  — optional; defaults to claude-sonnet-4-6
//
// Deploy:  supabase functions deploy subjective-transcript-assistant
//          (KEEP verify_jwt — requireRole is the real gate)
// Rollback: supabase functions delete subjective-transcript-assistant
//           (no DB objects created → nothing else to undo)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { requireRole, rateLimit, json, corsHeaders, HttpError } from "../_shared/auth.ts";

// ── Limits ──────────────────────────────────────────────────────
const MAX_TRANSCRIPT = 16000;   // chars — keeps prompt + cost bounded
const MIN_TRANSCRIPT = 12;      // below this there's nothing to extract
const LANGS = ["ar", "en", "mixed"] as const;

// Known draft keys — MUST stay in sync with the Subjective columns in
// js/rpm/subjective.js (and the FIELD_MAP in js/transcriptAssistant.js).
// red_flag_screen and the 0-10 sliders are intentionally NOT extracted:
// red flags are screened by the coach manually; scores can't be inferred.
type Treatment = { modality: string; duration: string; outcome: string };
type StressEvent = { year: string; event: string; type: string };
type Draft = {
  external_pain?: string;
  life_impact?: string;
  mechanism_of_injury?: string;
  dream_outcome?: string;
  fast_start_opportunity?: string;
  hidden_objections?: string;
  yellow_flags?: string;
  aggravating_factors?: string[];
  easing_factors?: string[];
  medications?: string[];
  past_treatments?: Treatment[];
  stress_timeline?: StressEvent[];
};

const OUTCOME_VALUES = ["helped", "no_change", "worse"];
const STRESS_TYPES = ["physical", "emotional", "medical"];

// ── Coercion helpers (validate the model/heuristic output shape) ─
function str(x: unknown, max = 4000): string {
  return typeof x === "string" ? x.trim().slice(0, max) : "";
}
function strArr(x: unknown, maxItems = 12, maxLen = 120): string[] {
  if (!Array.isArray(x)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of x) {
    const s = str(it, maxLen);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
function enumOr(x: unknown, allowed: string[]): string {
  const s = typeof x === "string" ? x.trim().toLowerCase() : "";
  return allowed.includes(s) ? s : "";
}

// Build a draft from a loose object, keeping ONLY non-empty known keys.
function coerceDraft(raw: Record<string, unknown>): Draft {
  const d: Draft = {};
  const texts: (keyof Draft)[] = [
    "external_pain", "life_impact", "mechanism_of_injury", "dream_outcome",
    "fast_start_opportunity", "hidden_objections", "yellow_flags",
  ];
  for (const k of texts) {
    const v = str(raw[k]);
    if (v) (d as Record<string, unknown>)[k] = v;
  }
  const agg = strArr(raw.aggravating_factors);
  if (agg.length) d.aggravating_factors = agg;
  const ease = strArr(raw.easing_factors);
  if (ease.length) d.easing_factors = ease;
  const meds = strArr(raw.medications);
  if (meds.length) d.medications = meds;

  if (Array.isArray(raw.past_treatments)) {
    const rows = raw.past_treatments
      .map((r): Treatment => ({
        modality: str((r as Record<string, unknown>)?.modality, 120),
        duration: str((r as Record<string, unknown>)?.duration, 80),
        outcome: enumOr((r as Record<string, unknown>)?.outcome, OUTCOME_VALUES),
      }))
      .filter((r) => r.modality)
      .slice(0, 12);
    if (rows.length) d.past_treatments = rows;
  }
  if (Array.isArray(raw.stress_timeline)) {
    const rows = raw.stress_timeline
      .map((r): StressEvent => ({
        year: str((r as Record<string, unknown>)?.year, 20),
        event: str((r as Record<string, unknown>)?.event, 160),
        type: enumOr((r as Record<string, unknown>)?.type, STRESS_TYPES),
      }))
      .filter((r) => r.event)
      .slice(0, 12);
    if (rows.length) d.stress_timeline = rows;
  }
  return d;
}

// ── Red-flag CAUTION scan (never auto-applied — coach screens manually) ──
const RED_FLAG_TERMS: [RegExp, string][] = [
  [/\bnight pain\b|\bpain at night\b/i, "night pain"],
  [/\bweight loss\b|\blost weight\b/i, "unexplained weight loss"],
  [/\bnumbness\b|\btingling\b|\bpins and needles\b/i, "numbness / tingling"],
  [/\bbladder\b|\bbowel\b|\bincontinen/i, "bladder / bowel changes"],
  [/\bsaddle\b|\bcauda\b/i, "saddle anaesthesia"],
  [/\bfever\b|\bchills\b/i, "fever / chills"],
  [/\bcancer\b|\btumou?r\b/i, "cancer history"],
  [/\bunrelenting\b|\bconstant pain\b/i, "constant unrelenting pain"],
  [/ألم ليلي|ألم في الليل|وجع بالليل/, "ألم ليلي (night pain)"],
  [/فقدان (في )?الوزن|نزول الوزن|نقص الوزن/, "فقدان الوزن (weight loss)"],
  [/تنميل|خدر|تخدير/, "تنميل / خدر (numbness)"],
  [/سلس|تبول لا إرادي|البول|الأمعاء/, "سلس بولي/معوي (bladder/bowel)"],
  [/حمى|سخونة|قشعريرة/, "حمى (fever)"],
  [/سرطان|ورم/, "سرطان (cancer)"],
];
function scanCautions(transcript: string): string[] {
  const out: string[] = [];
  for (const [re, label] of RED_FLAG_TERMS) {
    if (re.test(transcript) && !out.includes(label)) out.push(label);
  }
  return out.slice(0, 10);
}

// ── Anthropic path (graceful — returns null on any failure) ─────
async function anthropicExtract(opts: {
  apiKey: string; model: string; language: string; transcript: string;
}): Promise<{ draft: Draft; summary: string } | null> {
  const sys = [
    "You are a clinical documentation assistant for a musculoskeletal rehabilitation coach.",
    "From an assessment-call transcript, extract ONLY information explicitly stated by the patient or coach.",
    "Never infer, diagnose, or invent. If something is not clearly stated, omit that field entirely.",
    "The transcript may be in Arabic, English, or mixed. Write each extracted value in the SAME language it was said in.",
    "Do NOT make red-flag determinations and do NOT assign pain scores — the coach screens those manually.",
    "Output STRICTLY one JSON object with these optional keys (omit any you cannot fill from the transcript):",
    '{ "summary": string (1-3 neutral sentences recapping the call),',
    '  "external_pain": string, "life_impact": string, "mechanism_of_injury": string,',
    '  "dream_outcome": string, "fast_start_opportunity": string, "hidden_objections": string,',
    '  "yellow_flags": string, "aggravating_factors": string[], "easing_factors": string[],',
    '  "medications": string[],',
    '  "past_treatments": [{ "modality": string, "duration": string, "outcome": "helped"|"no_change"|"worse" }],',
    '  "stress_timeline": [{ "year": string, "event": string, "type": "physical"|"emotional"|"medical" }] }',
    "No markdown, no code fences, no prose outside the JSON object.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    language: opts.language,
    transcript: opts.transcript,
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 2048,
        temperature: 0,
        system: sys,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      // Status only — never echo transcript or response body into logs.
      console.warn("anthropic non-200:", res.status);
      return null;
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "";
    const cleaned = String(text).trim().replace(/^```json\s*|```$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object") return null;
    return { draft: coerceDraft(parsed), summary: str(parsed.summary, 600) };
  } catch (e) {
    console.warn("anthropic extract failed:", (e as Error)?.name || "error");
    return null;
  }
}

// ── Heuristic path (deterministic, bilingual; no AI) ────────────
type Bucket = { col: keyof Draft; kind: "text" | "chips"; en: RegExp; ar: RegExp };
const BUCKETS: Bucket[] = [
  { col: "mechanism_of_injury", kind: "text",
    en: /\b(started|began|injur|happened|fell|fall|accident|lifting|twist|years? ago|months? ago|since)\b/i,
    ar: /(بدأ|بدأت|إصاب|حدث|سقط|وقع|حادث|رفع|التواء|منذ|من سنة|من شهر)/ },
  { col: "life_impact", kind: "text",
    en: /\b(can'?t|cannot|can not|unable to|stops? me|prevents? me|struggle to|hard to|difficult to)\b/i,
    ar: /(لا أستطيع|ما أقدر|ما اقدر|يمنعني|أعاني|صعب علي|يصعب|ما عاد أقدر)/ },
  { col: "dream_outcome", kind: "text",
    en: /\b(want to|hope to|goal|wish to|dream|like to be able|return to|get back to)\b/i,
    ar: /(أريد|اريد|أتمنى|اتمنى|هدفي|أرجو|أحب أن|العودة|طموح|نفسي)/ },
  { col: "external_pain", kind: "text",
    en: /\b(pain|hurts?|ache|aching|sharp|dull|stiff|sore|burning)\b/i,
    ar: /(ألم|الم|وجع|يؤلم|تيبس|تنميل|حرقان|يوجع)/ },
  { col: "aggravating_factors", kind: "chips",
    en: /\b(worse|aggravat|hurts? when|painful when|flare|increase[sd]?\b.*pain)\b/i,
    ar: /(أسوأ|اسوأ|يزيد|يزداد|يسوء|عند الجلوس|عند الوقوف|يؤلم عند)/ },
  { col: "easing_factors", kind: "chips",
    en: /\b(better|reliev|eases?|helps?|feels? good|less pain when)\b/i,
    ar: /(أفضل|افضل|يخف|يريح|راحة|يقل|أحسن|احسن)/ },
  { col: "medications", kind: "chips",
    en: /\b(medication|tablets?|pills?|taking|prescribed|ibuprofen|paracetamol|naproxen|painkiller)\b/i,
    ar: /(دواء|أدوية|ادوية|حبوب|مسكن|أتناول|اتناول|موصوف)/ },
  { col: "yellow_flags", kind: "text",
    en: /\b(sleep|stress|anxiety|depress|tired|fatigue|work pressure|smok)\b/i,
    ar: /(نوم|قلق|توتر|اكتئاب|تعب|إرهاق|ضغط العمل|تدخين)/ },
];

function splitSentences(t: string): string[] {
  return t.split(/[.!?؟\n]+/).map((s) => s.trim()).filter((s) => s.length > 2);
}

function heuristicExtract(transcript: string, language: string): { draft: Draft; summary: string } {
  const sentences = splitSentences(transcript);
  const textHits: Record<string, string[]> = {};
  const chipHits: Record<string, string[]> = {};

  for (const s of sentences) {
    for (const b of BUCKETS) {
      const isEn = language !== "ar";
      const isAr = language !== "en";
      const matched = (isEn && b.en.test(s)) || (isAr && b.ar.test(s));
      if (!matched) continue;
      if (b.kind === "text") (textHits[b.col] ??= []).push(s);
      else (chipHits[b.col] ??= []).push(s.slice(0, 120));
    }
  }

  const draft: Draft = {};
  for (const [col, hits] of Object.entries(textHits)) {
    const v = hits.slice(0, 3).join(". ").slice(0, 1500);
    if (v) (draft as Record<string, unknown>)[col] = v;
  }
  for (const [col, hits] of Object.entries(chipHits)) {
    const arr = strArr(hits, 8, 120);
    if (arr.length) (draft as Record<string, unknown>)[col] = arr;
  }

  const summary = `Heuristic draft from ${sentences.length} sentence(s) — no AI provider configured. Review and edit every field before applying.`;
  return { draft, summary };
}

// ── Handler ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Method not allowed" });

  try {
    const { user, role, userClient } = await requireRole(req, ["coach", "admin"]);
    if (rateLimit(`transcript:${user.id}`, 20, 5 * 60_000)) {
      return json(req, 429, { error: "Rate limit — please wait a moment and try again." });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); }
    catch { return json(req, 400, { error: "Invalid JSON" }); }

    const transcript = typeof body.transcript === "string" ? body.transcript : "";
    const language = LANGS.includes(body.language as typeof LANGS[number]) ? String(body.language) : "mixed";
    const clientId = typeof body.client_id === "string" ? body.client_id.trim() : "";

    if (transcript.trim().length < MIN_TRANSCRIPT) {
      return json(req, 400, { error: "Transcript is too short to analyse." });
    }
    if (transcript.length > MAX_TRANSCRIPT) {
      return json(req, 413, { error: `Transcript exceeds the ${MAX_TRANSCRIPT.toLocaleString()}-character limit for V1.` });
    }

    // Assignment boundary — coach may only analyse for their own clients;
    // admin may analyse for any existing client. client_id is required so
    // this check always runs (the UI always supplies it).
    if (!clientId) return json(req, 400, { error: "client_id is required." });
    if (role === "coach") {
      const { data, error } = await userClient
        .from("profiles").select("id")
        .eq("id", clientId).eq("assigned_coach", user.id).maybeSingle();
      if (error || !data) return json(req, 403, { error: "You can only analyse transcripts for your assigned clients." });
    } else {
      const { data } = await userClient
        .from("profiles").select("id").eq("id", clientId).maybeSingle();
      if (!data) return json(req, 404, { error: "Client not found." });
    }

    const cautions = scanCautions(transcript);

    // Try Anthropic, then fall back to the deterministic heuristic.
    let source: "anthropic" | "heuristic" = "heuristic";
    let result: { draft: Draft; summary: string } | null = null;

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (apiKey) {
      const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";
      result = await anthropicExtract({ apiKey, model, language, transcript });
      if (result) source = "anthropic";
    }
    if (!result) result = heuristicExtract(transcript, language);

    return json(req, 200, {
      source,
      language,
      summary: result.summary,
      draft: result.draft,
      cautions,
    });
  } catch (e) {
    return HttpError.toResponse(req, e);
  }
});
