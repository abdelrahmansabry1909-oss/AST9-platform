# Assessment Storytelling & Free-Floating Hologram — Architecture (Phase E)

**Status:** Architecture + groundwork plan. No assessment code changed. Approval gate before E1 implementation.
**Date:** 2026-06-10 · Companion to `UI_UX_IDENTITY_AND_STABILIZATION_PLAN.md` §7.

## 1 · Goal

Transform the coach assessment from "a tabbed form with a 3D widget in a box" into a guided body journey: the skeleton floats free in space, the coach moves through anatomy zones, each zone is a glass card cluster, and progress is felt — without replacing the assessment system, its data writes, or the RPM/Generate pipeline.

## 2 · Hard invariants (what E must NOT change)

- **Data shape:** writes stay on `assessments`, `rehab_objective_assessments`, `gait_assessments`, `body_map_states` — identical columns, identical timing (per-tab save behavior preserved).
- **The 13-aim structured subjective wizard** fields and scoring (`ScoringEngine.readForm()` contract).
- **`BodyMap3D` asset pipeline** (ADR-004/011): one glTF, loaded once, cached, retried. The instance is *re-homed*, never re-instantiated per zone.
- **Generate step / RPM graph builder** — untouched; remains the final act.
- **Role gating:** assessment stays coach/admin-only.

## 3 · The architecture

### 3.1 Layering model (from the CSS-reference hero pattern)
```
z0  radial-gradient void (replaces the canvas card chrome — no visible container)
z1  BodyMap3D canvas — fixed/sticky layer, full viewport height behind content
z2  glass section cards (.nc-glass--hairline, Phase B) — scroll over the hologram
z3  zone rail (vertical writing-mode labels) + progress chips
```
The hologram is "free" because the canvas has no border/background card — the void gradient and the glass cards floating over it create spatial depth.

### 3.2 Zone model
One ordered config drives everything (additive new module `js/assessmentStory.js`):
```js
const ZONES = [ { key:'spine',   label:'Spine',    camera:{...}, regions:['LumbarSpine','ThoracicSpine','CervicalSpine'], fields:[...ids] },
                { key:'hips',    label:'Hips & Pelvis', ... },
                { key:'ankles',  ... }, { key:'shoulders', ... }, { key:'neuro', ... } ];
```
- `camera` = target orbit/zoom for the existing Three.js controls (tweened, `--nc-dur-slow`, ease).
- `regions` = body-map highlight keys (the `target_regions` vocabulary, now live in the DB).
- `fields` = the existing input ids that mount inside that zone's glass card (the inputs are **moved in the DOM, not recreated**, so all existing listeners/sync keep working).

### 3.3 Interaction loop
Advance (button or scroll-snap) → camera tween to zone + region highlight → zone card animates in (`neu-anim-fade-up`) → completing required fields flips the zone chip to done → completed zones collect into a horizontal rail (CSS-reference feed pattern). Reverse navigation always available. `prefers-reduced-motion` → instant cuts (Phase B token collapse already handles this).

### 3.4 Client-side replay (later slice, E5)
The same ZONES config renders a read-only "your body story" on the client Progress tab from the saved assessment — zero new queries beyond the existing AssessmentSnapshot loader.

## 4 · Slices (each independently shippable + revertible)

| Slice | Scope | Risk |
|---|---|---|
| **E1 — Un-boxing** | Remove the canvas card chrome; void gradient backdrop; hologram sized to viewport layer. CSS + container swap only. | Low |
| **E2 — Zone navigation** | ZONES config + camera tweens + region highlights; tabs remain as fallback nav. | Med |
| **E3 — Glass restage** | Existing form clusters move into per-zone `.nc-glass` cards over the hologram (DOM move, not rebuild). | Med-High (largest DOM change) |
| **E4 — Progress rail + polish** | Completed-zone rail, stroke-numeral zone numbers, vertical labels, motion polish. | Low |
| **E5 — Client replay** | Read-only story on client Progress. | Low |

**Rollback:** each slice is one commit; E1–E4 are presentation-only — revert restores the tabbed wizard exactly.

## 5 · Groundwork already in place (this session)

- Phase B shipped the glass utilities (`.nc-glass`, `.nc-glass--hairline`), the motion tokens (`--nc-ease-bounce`, durations), and the reduced-motion guard — E consumes these as-is.
- `rpm_phases.target_regions` now exists live (A3 repair) — the zone→region vocabulary is real end-to-end.

## 6 · Verification plan (per slice)

Full assessment walkthrough as coach: every field of all 13 aims + objective grid persists identically (DB row diff before/after on a test client); Generate produces the same program for the same inputs; 3D fps sanity on a mid-range machine; reduced-motion walkthrough; 0 console errors; build + `node --check`.

## 7 · Open decisions for approval before E1

1. Scroll-driven vs. button-driven zone advance (recommendation: **button-driven first**, scroll-snap as enhancement — less motion risk).
2. Does the objective ROM grid become per-zone clusters (E3) or stay one grid in a single glass card initially (recommendation: single card first, split later).
3. Desktop-only or also tablet (recommendation: desktop-first; assessment is a coach desktop workflow).

*No implementation until approved. The current assessment continues working unchanged.*
