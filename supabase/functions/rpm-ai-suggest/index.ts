// ═══════════════════════════════════════════════════════════════
// supabase/functions/rpm-ai-suggest/index.ts
// Phase 3B — RPM AI Suggester
//
// Two suggestion kinds:
//   kind: "phases"     → returns phase[] for the graph (stage_name, milestone_label,
//                        emotional_win, tripwire_test, load_tolerance, cue_mode)
//   kind: "exercises"  → returns exercise[] picked from the platform's exercise
//                        library, filtered by phase load + target joints
//
// Cite: o-sullivan-graded-exposure-ladder.md §1.1 (5 stages),
//       o-sullivan-8-pillars.md (80/20 rule),
//       o-sullivan-fogg-behavior-model.md (B = MAP prescriptions)
//
// Behavior: tries Anthropic first; on no-key / error / parse failure falls back
// to deterministic clinical defaults so the platform never blocks.
//
// Required project secrets (Supabase dashboard → Edge Functions → Secrets):
//   SUPABASE_URL                   — auto
//   SUPABASE_SERVICE_ROLE_KEY      — auto (used to read exercises table)
//   ANTHROPIC_API_KEY              — optional; when missing, fallback only
//   ANTHROPIC_MODEL                — optional; defaults to claude-sonnet-4-5
//
// Deploy:
//   supabase functions deploy rpm-ai-suggest
//   (KEEP the JWT check — only authenticated users can call this)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireRole, rateLimit, HttpError } from "../_shared/auth.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Content-Type":                 "application/json",
};

// ── Types ───────────────────────────────────────────────────────
type Phase = {
  stage_name: string;
  milestone_label: string;
  emotional_win: string;
  tripwire_test: string;
  load_tolerance: "Submaximal" | "Gravity" | "Impact" | "External";
  cue_mode: "top_down" | "bottom_up" | "mixed";
};

type ExercisePick = {
  exercise_id: string;
  prescription: { sets?: string; reps?: string; tempo?: string; rest?: string; cue_type?: string; prompt_trigger?: string };
};

// Clinical fallback — same as js/rpm/graph.js DEFAULT_STAGES (kept in sync)
const DEFAULT_STAGES: Phase[] = [
  { stage_name: "Bed-Based Entry",       milestone_label: "Tolerate submaximal load on the bed without symptom flare", emotional_win: "Sleep through the night without pain spike", tripwire_test: "Midfoot bridge hold (30s, no cramping)",      load_tolerance: "Submaximal", cue_mode: "top_down" },
  { stage_name: "Standing Loading",      milestone_label: "Bear weight in standing with quiet base of support",         emotional_win: "Stand at the kitchen counter for 5 min",       tripwire_test: "Single-leg balance, eyes open (30s)",          load_tolerance: "Gravity",    cue_mode: "top_down" },
  { stage_name: "Bridging the Gap",      milestone_label: "Mix top-down cues with reflexive perturbation drills",       emotional_win: "Walk up a flight of stairs without thinking",  tripwire_test: "Hop and stick (3 reps, no breakdown)",         load_tolerance: "Gravity",    cue_mode: "mixed" },
  { stage_name: "High-Load / Bottom-Up", milestone_label: "Reflexive movement under impact load",                       emotional_win: "Jog 200m with confidence",                     tripwire_test: "Continuous hopping (10s, no breakdown)",       load_tolerance: "Impact",     cue_mode: "bottom_up" },
  { stage_name: "Resilience",            milestone_label: "Sport-/life-specific demand at full intent",                  emotional_win: "Garden for 2 hours / return to sport",         tripwire_test: "Sport-specific drill at full intent (no flare)", load_tolerance: "External",   cue_mode: "bottom_up" },
];

function fallbackPhases(n: number, dream?: string): Phase[] {
  const base: Phase[] = (() => {
    if (n === 5) return DEFAULT_STAGES.slice();
    if (n <= 3) return [DEFAULT_STAGES[0], DEFAULT_STAGES[2], DEFAULT_STAGES[4]];
    if (n === 4) return [DEFAULT_STAGES[0], DEFAULT_STAGES[1], DEFAULT_STAGES[3], DEFAULT_STAGES[4]];
    // n > 5: duplicate Bridging
    const out = DEFAULT_STAGES.slice();
    for (let i = 0; i < n - 5; i++) out.splice(3 + i, 0, { ...DEFAULT_STAGES[2], stage_name: `${DEFAULT_STAGES[2].stage_name} ${i + 2}` });
    return out.slice(0, n);
  })();
  // Personalise the final stage with the patient's dream outcome if provided
  if (dream && base.length) {
    const last = base[base.length - 1];
    base[base.length - 1] = { ...last, emotional_win: dream };
  }
  return base;
}

// ── Anthropic call (graceful) ───────────────────────────────────
async function anthropicCallPhases(opts: {
  apiKey: string;
  model: string;
  phaseCount: number;
  pointA: string;
  pointB: string;
  subjective: any;
  objective: any;
}): Promise<Phase[] | null> {
  const sys = [
    "You are a senior musculoskeletal rehabilitation clinician trained on the NeuCore 'Go-To Therapist' method.",
    "You build a Graded Exposure Ladder of N phases that takes a patient from Point A (current state) to Point B (dream outcome).",
    "Rules:",
    "  - Stages progress UPWARD: phase 1 = closest to Point A; phase N = closest to Point B.",
    "  - Apply the 80/20 rule (80% on root cause / driver, 20% on symptoms).",
    "  - Use the Inversion Principle: each milestone is something the patient must achieve before the dream outcome is realistic.",
    "  - Tripwires: include a measurable test per phase that gates progression (e.g. midfoot bridge 30s, hop-and-stick).",
    "  - Cue mode progression: top_down → mixed → bottom_up across the ladder.",
    "  - Load tolerance progression: Submaximal → Gravity → Impact → External.",
    "Output STRICTLY a JSON object: { \"phases\": [ { stage_name, milestone_label, emotional_win, tripwire_test, load_tolerance, cue_mode } ] }",
    "Use only these load_tolerance values: 'Submaximal' | 'Gravity' | 'Impact' | 'External'.",
    "Use only these cue_mode values: 'top_down' | 'bottom_up' | 'mixed'.",
    "Do not include markdown, prose, or any text outside the JSON object.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    phase_count: opts.phaseCount,
    point_a:     opts.pointA || "Patient current state — see subjective.",
    point_b:     opts.pointB || "Patient dream outcome — see subjective.dream_outcome.",
    subjective:  opts.subjective || null,
    objective:   opts.objective  || null,
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type":      "application/json",
        "x-api-key":         opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      opts.model,
        max_tokens: 2048,
        system:     sys,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.warn("Anthropic non-200:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "";
    // Strip markdown fences just in case
    const cleaned = text.trim().replace(/^```json\s*|```$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.phases || !Array.isArray(parsed.phases)) return null;
    // Sanity-validate each phase
    return parsed.phases.slice(0, opts.phaseCount).map((p: any): Phase => ({
      stage_name:      String(p.stage_name      || "Unnamed"),
      milestone_label: String(p.milestone_label || ""),
      emotional_win:   String(p.emotional_win   || ""),
      tripwire_test:   String(p.tripwire_test   || ""),
      load_tolerance:  ["Submaximal","Gravity","Impact","External"].includes(p.load_tolerance) ? p.load_tolerance : "Gravity",
      cue_mode:        ["top_down","bottom_up","mixed"].includes(p.cue_mode) ? p.cue_mode : "top_down",
    }));
  } catch (e) {
    console.warn("Anthropic call failed:", e);
    return null;
  }
}

// ── Exercise pick (DB-only — no AI required) ───────────────────
async function pickExercises(opts: {
  sb: ReturnType<typeof createClient>;
  phaseLoad?: string | null;
  perPhaseCount: number;
  targetJoints?: string[];
}): Promise<ExercisePick[]> {
  const { sb, phaseLoad, perPhaseCount, targetJoints } = opts;

  // Map load_tolerance → existing exercises.phase column
  const phaseTag =
    phaseLoad === "Submaximal" ? "Phase 1" :
    phaseLoad === "Gravity"    ? "Phase 2" :
    phaseLoad === "Impact"     ? "Phase 2" :
    phaseLoad === "External"   ? "Phase 3" : null;

  let q = sb.from("exercises").select("id, name, target_joints, phase").limit(50);
  if (phaseTag) q = q.eq("phase", phaseTag);
  if (targetJoints?.length) q = q.overlaps("target_joints", targetJoints);

  const { data: rows, error } = await q;
  if (error) {
    console.warn("exercise pick query failed:", error);
    return [];
  }
  if (!rows || !rows.length) return [];

  // Score by joint overlap; pick top N
  const scored = rows.map((r: any) => {
    const overlap = (r.target_joints || []).filter((j: string) => targetJoints?.includes(j)).length;
    return { row: r, score: overlap };
  }).sort((a: any, b: any) => b.score - a.score);

  return scored.slice(0, perPhaseCount).map(({ row }: any, i: number): ExercisePick => ({
    exercise_id: row.id,
    prescription: {
      sets:   phaseTag === "Phase 1" ? "2-3" : phaseTag === "Phase 2" ? "3-4" : "3-5",
      reps:   phaseTag === "Phase 1" ? "30-60s holds" : phaseTag === "Phase 2" ? "8-12" : "3-8",
      tempo:  phaseTag === "Phase 1" ? "4-2-4" : phaseTag === "Phase 2" ? "3-1-3" : "1-0-X",
      rest:   phaseTag === "Phase 1" ? "60s" : phaseTag === "Phase 2" ? "90s" : "120s",
      cue_type:       phaseLoad === "Impact" || phaseLoad === "External" ? "bottom_up" : "top_down",
      prompt_trigger: i === 0 ? "After morning coffee" : i === 1 ? "Before lunch" : "Evening wind-down",
    },
  }));
}

// ── Handler ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  // AuthZ (S8): staff only — anon key / clients rejected. The exercises
  // read uses the CALLER-SCOPED client (RLS), so no service role is held.
  // deno-lint-ignore no-explicit-any
  let sbAdmin: any;
  try {
    const { user, userClient } = await requireRole(req, ["coach", "admin"]);
    if (rateLimit(`rpmai:${user.id}`, 30, 5 * 60_000)) {
      return new Response(JSON.stringify({ error: "Rate limit — please wait" }), { status: 429, headers: CORS });
    }
    sbAdmin = userClient;
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 401;
    const message = e instanceof HttpError ? e.message : "Unauthorized";
    return new Response(JSON.stringify({ error: message }), { status, headers: CORS });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

  const kind = body?.kind as string;
  if (!["phases", "exercises"].includes(kind)) {
    return new Response(JSON.stringify({ error: "kind must be 'phases' or 'exercises'" }), { status: 400, headers: CORS });
  }

  if (kind === "phases") {
    const phaseCount = Math.max(3, Math.min(7, parseInt(body.phase_count ?? 5, 10) || 5));
    const pointA = String(body.point_a ?? "");
    const pointB = String(body.point_b ?? "");
    const subjective = body.subjective ?? null;
    const objective  = body.objective  ?? null;

    let phases: Phase[] | null = null;
    let source: "anthropic" | "fallback" = "fallback";
    let reason = "no_api_key";

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (apiKey) {
      const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5";
      phases = await anthropicCallPhases({ apiKey, model, phaseCount, pointA, pointB, subjective, objective });
      if (phases?.length) { source = "anthropic"; reason = "ok"; }
      else { reason = "anthropic_failed_or_unparseable"; }
    }

    if (!phases?.length) phases = fallbackPhases(phaseCount, pointB || undefined);

    return new Response(JSON.stringify({ source, reason, phases }), { status: 200, headers: CORS });
  }

  // kind === "exercises"
  const phaseLoad     = body.phase_load ?? null;
  const targetJoints  = Array.isArray(body.target_joints) ? body.target_joints : [];
  const perPhaseCount = Math.max(1, Math.min(12, parseInt(body.count ?? 4, 10) || 4));

  const picks = await pickExercises({ sb: sbAdmin, phaseLoad, perPhaseCount, targetJoints });
  return new Response(JSON.stringify({ source: "library", exercises: picks }), { status: 200, headers: CORS });
});
