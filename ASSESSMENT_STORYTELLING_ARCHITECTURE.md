# Assessment Storytelling — Definitive Architecture (Phase E / Track B)

**Status:** B0 FINAL — definitive architecture for E2–E4. Approval gate before E2 implementation.
**Version:** 2.0 (2026-06-11) · supersedes v1 (2026-06-10) · companion to `UI_UX_IDENTITY_AND_STABILIZATION_PLAN.md` §7.
**Already shipped:** E1 un-boxing (commit `25a62a9`, deployed): borderless canvas, CSS radial void, scan-lines removed, teal floor shadow.

## 0 · Core principle

The hologram is the centerpiece. The coach explores the client's body; the form is the instrument, not the experience. Every decision below serves one feeling: *"I am examining a body in space, not filling fields in a monitor."*

## 0.1 · Ground truth this architecture binds to (verified in code 2026-06-11)

- The objective-tab hologram is **`BodyCanvas` + `GLBSkeleton` + `FXLayer` + `AssessmentPanel` + `ObjectiveSync`** (`src/neucore/*`), initialized lazily on first Objective-tab click (`src/main.js _initObjectiveSidebar`). `js/bodyMap3D.v2.js` is the *dashboard* hologram — E2–E4 do not touch it.
- The 3D vocabulary is **jointKeys** — `LeftHip RightHip LeftKnee RightKnee LeftAnkle RightAnkle LeftShoulder RightShoulder LumbarSpine ThoracicSpine` — exposed as `GLBSkeleton.jointMeshes` hotspots with `highlightJoint / dimAllExcept / resetAllOpacity / getJointWorldPos / setJointPain`. **(v1 said `target_regions`; that is the RPM-graph vocabulary, a different system — corrected.)**
- `ObjectiveSync.BINDINGS` already maps ~36 form field ids ↔ jointKeys with deficit→color logic. The zone system reuses this table's field ids — one source of truth, no new field registry.
- `BodyCanvas` is **opaque** (`alpha:false`, bg `#040A14`, FogExp2 `#07111A`) with an UnrealBloom post-pipeline; E1's CSS void is deliberately color-matched to it. **Constraint: zones must not require canvas transparency** (bloom + alpha is a rewrite). The opaque-matched approach is the contract through E4.
- Camera: PerspectiveCamera fov 38, OrbitControls (no pan, zoom 1–8, polar clamped 0.1π–0.9π, autoRotate 0.4).
- Cervical / elbow / wrist fields have **no** 3D bindings today — zones may exist without hotspots; the camera still frames the region (no fake bindings invented).

## 1 · Anatomy Zone System

One ordered config drives camera, highlights, rail, and (E3) card grouping:

```js
// src/neucore/story/zones.js — config only, no logic
export const ZONES = [
  { key:'foundation',  label:'Feet & Ankles',     ordinal:1, joints:['LeftAnkle','RightAnkle'],
    fields:['ns-ankle-df-l','ns-ankle-df-r','ns-pronation-l','ns-pronation-r','ns-supination-l','ns-supination-r'] },
  { key:'knees',       label:'Knees & Tibia',     ordinal:2, joints:['LeftKnee','RightKnee'],
    fields:['ns-tib-ir-l','ns-tib-ir-r'] },
  { key:'hips',        label:'Hips & Pelvis',     ordinal:3, joints:['LeftHip','RightHip'],
    fields:['ns-hip-ir-l','ns-hip-ir-r','ns-hip-er-l','ns-hip-er-r','ns-hip-flex-l','ns-hip-flex-r',
            'ns-hip-ext-l','ns-hip-ext-r','ns-hip-abd-l','ns-hip-abd-r','ns-si-pain'] },
  { key:'spine',       label:'Spine',             ordinal:4, joints:['LumbarSpine','ThoracicSpine'],
    fields:['ns-toetouch-score','ns-lumb-flex','ns-lumb-ext','ns-sp-flex-pain','ns-sp-ext-pain',
            'ns-sp-lfl-pain','ns-sp-lfr-pain','ns-sp-rotl-pain','ns-sp-rotr-pain','ns-sp-notes'] },
  { key:'shoulders',   label:'Shoulders',         ordinal:5, joints:['LeftShoulder','RightShoulder'],
    fields:['ns-sh-flex-l','ns-sh-flex-r','ns-sh-ext-l','ns-sh-ext-r','ns-sh-ir-l','ns-sh-ir-r','ns-sh-er-l','ns-sh-er-r'] },
  { key:'neck-arms',   label:'Neck & Arms',       ordinal:6, joints:[],   // no hotspots today — camera-only zone
    fields:['ns-cerv-flex','ns-cerv-ext','ns-cerv-rot-l','ns-cerv-rot-r',
            'ns-elbow-flex-l','ns-elbow-flex-r','ns-elbow-ext-l','ns-elbow-ext-r',
            'ns-wrist-flex-l','ns-wrist-flex-r','ns-wrist-ext-l','ns-wrist-ext-r'] },
  { key:'integration', label:'Whole-Body',        ordinal:7, joints:[],   // overview — full figure
    fields:['ns-sl-squat-l','ns-sl-squat-r','ns-sl-squat-notes','ns-sl-rdl-l','ns-sl-rdl-r','ns-sl-rdl-notes',
            'ns-oh-squat','ns-oh-squat-notes','ns-bal-eo-l','ns-bal-eo-r','ns-bal-ec-l','ns-bal-ec-r',
            'ns-reach-l','ns-reach-r'] },
];
```

**Traversal order: ground-up kinetic chain** (feet → knees → hips → spine → shoulders → neck/arms → whole-body). Why this order and no other:
1. **Clinical logic** — load enters the body at the foot; deficits propagate up the chain. Screening ground-up is how the assessment data itself is interpreted (and how the existing form is already roughly ordered, so E3's DOM moves are minimal and never reorder fields within a group).
2. **Narrative arc** — the camera starts low and intimate, climbs the body zone by zone as understanding accumulates, then pulls back to the full figure for the functional screens: the literal "whole picture" moment that hands off to Generate.
3. **Stable field listeners** — keeping per-group field order identical to today means `ObjectiveSync`'s listeners and `ScoringEngine.readForm()` see an unchanged DOM contract.

The zone config is **navigation metadata only** — it never becomes a data schema. Writes stay on the existing tables/columns, byte-identical.

## 2 · Camera System

- **Per-zone framing is derived at runtime, not hardcoded:** target = centroid of `getJointWorldPos()` over the zone's joints (camera-only zones use named anchors: `neck-arms` → head/sternum height; `integration` → the existing overview position `0.4, 1.0, 3.4`). Survives any future model scale change.
- **Per-zone parameters:** `{ distance, polarBias, azimuthBias }` — e.g. foundation: low polar (camera drops toward the floor, distance ≈ 1.6); spine: rear-quarter azimuth (the spine's natural reading angle); shoulders: slight high polar; integration: full overview distance ≈ 3.4.
- **Transition:** tween `controls.target` and camera position on the spherical-coordinate path (no gimbal flips), 600 ms `easeInOutCubic`, driven inside the existing `BodyCanvas._animate` rAF (no second loop, no per-frame allocations). `autoRotate` off while a zone is focused; restored only on `integration`/idle.
- **User sovereignty:** a pointer-down on the canvas cancels any in-flight tween instantly — the coach's hand always wins; the next zone change re-tweens from wherever they left the camera. Zoom/orbit limits unchanged.
- **Focus behavior:** arriving at a zone composes the existing primitives — `dimAllExcept(joints[0])` (dims the bone shader + zeroes all hotspots; its signature is strictly single-key) then `highlightJoint(j, 1)` for each remaining zone joint. Leaving restores via `resetAllOpacity()`; pain colors persist because they live in separate shader uniforms (`painScale`/`hotspotColor`), with `ObjectiveSync.syncAll()` as the re-sync backstop. No `GLBSkeleton` API change needed.
- **Mobile/tablet adaptation:** assessment remains a coach desktop workflow (role-gated). Below 1024 px the same zones apply with `distance × 1.25` (fields occupy more height; the body must stay fully framed) and the zone rail renders as horizontal chips above the canvas instead of a vertical rail. No separate mobile camera system.
- **Reduced motion:** no tween — set target/position directly (single frame), `autoRotate` permanently off.

## 3 · Zone Interaction Model

| Input | Behavior |
|---|---|
| **Hover** (rail chip) | Chip highlight + soft glow on the zone's joints (`highlightJoint`); no camera movement on hover — hover never moves the world. |
| **Hover** (3D hotspot) | Existing raycast hover label (BodyCanvas raycast → JointBus `joint:hover` → main.js label) unchanged. |
| **Click** (rail chip) | Primary navigation: camera tween + focus + (E3) card swap. |
| **Click** (3D hotspot) | Existing joint pop-out panel unchanged; additionally resolves joint→zone (reverse lookup from `ZONES.joints`) and aligns the rail/active zone to where the coach is looking. |
| **Touch** | Tap = click; orbit/pinch via existing OrbitControls touch handling. Chip hit-targets ≥ 44 px. |
| **Keyboard** | The rail is a `tablist`: roving tabindex, `←/→` (or `↑/↓` vertical) moves zones, `Enter/Space` activates, `Home/End` jump. The canvas is never required: every zone and every field is reachable and operable without a pointer. Tab order: rail → active zone's fields → nav buttons. |

## 4 · Assessment Flow

- **Question groups = zones** (§1). The Info → Subjective → **Objective** → Graph → Generate macro-flow is untouched; zones live *inside* Objective.
- **Story progression:** enter Objective → camera at overview → "Begin at the ground" affordance → foundation → … → integration → the existing "Next: Reactive Graph →" button. Free navigation always allowed (zones are nav, not locks — a coach may jump anywhere; clinical reality demands it).
- **Progressive disclosure:** E2 discloses nothing (full grid stays visible; zones add camera + highlight + rail). E3 introduces disclosure: only the active zone's glass card is prominent; other zones' cards collapse to their chip. Nothing is ever *removed* — collapsed ≠ hidden from keyboard/screen readers (`aria-expanded`, content reachable on activation).
- **Button-driven, not scroll-driven** (v1 open decision №1 — resolved): scroll hijacking is the fastest way to make a premium experience feel broken; scroll-snap may be revisited as an E4 enhancement only if E3's layout makes it natural.

## 5 · Motion Language

- **Tokens only** (Phase B): `--nc-dur-fast` (chip/highlight states), `--nc-dur-med` (card enter/exit `neu-anim-fade-up`), 600 ms camera tween (slowest thing on screen — the world moves with weight), `--nc-ease` everywhere; `--nc-ease-bounce` reserved for exactly one moment: a zone chip flipping to its completed state (E4).
- **Hierarchy:** camera (600) > cards (~240) > chips/glows (~150). Nothing animates while the coach is typing — motion fires only on explicit navigation.
- **Focus transitions:** highlight fade-in ~200 ms, dim-others ~200 ms, simultaneous with camera tween start (not after — the destination announces itself while traveling).
- **Reduced motion:** Phase B's global duration collapse covers CSS; the ZoneDirector additionally checks `matchMedia('(prefers-reduced-motion: reduce)')` → camera cuts (no tween), autoRotate off, chip pop replaced by an instant state change. Verified as a first-class walkthrough, not an afterthought.

## 6 · Information Architecture

| Layer | E2 | E3+ |
|---|---|---|
| **Persistent** | hologram, zone rail + active state, tab row (fallback nav), client chip, Back/Next, save behavior | same + progress rail (E4) |
| **Per-zone** | camera frame + joint highlights | + the zone's glass field card (`.nc-glass--hairline`), zone label + stroke ordinal |
| **Hidden/collapsed** | nothing | other zones' cards (collapsed to chips, ARIA-reachable) |
| **Never shown** | raw jointKey/config internals, any new "score" not already in the form | same |

The existing tab row stays functional through E2 **and** E3 as the escape hatch — if the story layer ever misbehaves, the classic grid is one click away (this is also the rollback story).

## 7 · Emotional Journey

1. **Curiosity** (enter Objective): the unboxed hologram (E1) slowly auto-rotating in the void, one quiet affordance: *"Begin at the ground."*
2. **Discovery** (zones 1–3): the camera dives low and climbs; each ROM value entered recolors a joint live (existing `ObjectiveSync` behavior — now you watch it happen up close where the camera is pointed).
3. **Understanding** (zones 4–6): the body accumulates its color story; asymmetries become visible objects, not numbers.
4. **Confidence** (zone 7): pull-back to the full figure wearing everything the coach has learned — the assessment literally *shows its work* — then Generate converts understanding into a plan. The payoff is earned, not decorative.

## 8 · Performance Constraints

- **FPS:** 60 target / 30 floor on a mid-range laptop with bloom on; zone tweens may not drop below the floor (tween math is trivial; the budget guard is *no new render work*).
- **No new 3D assets:** same single glb (3.3 MB, loaded once, cached — ADR-004/011), same materials, same bloom pipeline. Asset budget delta for E2–E4: **0 bytes of 3D**.
- **JS budget:** `zones.js` + `ZoneDirector.js` ≤ ~10 KB combined, no per-frame allocations (preallocated Vector3 scratch), tween updates inside the existing rAF.
- **Lazy as today:** nothing initializes until the Objective tab is first opened (existing `_initObjectiveSidebar` contract).
- **Mobile:** existing `pixelRatio ≤ 2` clamp stays; optional E4 polish may clamp to 1.5 under 768 px — measured first, not assumed.

## 9 · Accessibility Constraints

- Zone rail = ARIA `tablist` with full keyboard operation (§3); visible `:focus-visible` rings (D1 tokens).
- The canvas is `aria-hidden` decorative reinforcement — **every datum lives in a labeled form field**; nothing is enterable only via 3D.
- Color is never the sole signal: deficit colors mirror numeric values that remain visible in fields and the joint panel.
- Collapsed zone cards (E3) stay in the accessibility tree via standard disclosure semantics (`aria-expanded` + activation).
- Full `prefers-reduced-motion` support (§5). Contrast: zone labels/chips meet 4.5:1 against the void.

## 10 · E2 Scope — Zone Navigation

**In:** `src/neucore/story/zones.js` (config) + `src/neucore/story/ZoneDirector.js` (camera tween, focus/dim, rail rendering, joint→zone alignment, keyboard, reduced-motion), wired from `main.js _initObjectiveSidebar` after skeleton load; zone rail UI (chips, active state) using existing tokens/utilities; tab row untouched and functional.
**Out:** any DOM move of form fields, per-zone cards, disclosure, completion tracking, progress rail, client replay, `bodyMap3D.v2.js`, any data write change, any migration.
**Failure isolation:** ZoneDirector self-guards — if the skeleton failed to load (existing catch path) or the rail root is absent, the Objective tab behaves exactly as today.

## 11 · E3 Scope — Glass Restage

**In:** move existing field clusters (the `fields` lists in §1, as whole DOM subtrees) into per-zone `.nc-glass--hairline` cards positioned beside/over the canvas; active-zone prominence + collapsed-chip disclosure; `ObjectiveSync`/`ScoringEngine` keep working because **nodes are moved, never recreated** (listeners and ids survive `appendChild`).
**Out:** any field rename/reorder within a group, any new inputs, any save-timing change, mobile-specific layout beyond §2's adaptation.
**Risk note:** largest DOM change of the track — ships only after E2 has soaked in production.

## 12 · E4 Scope — Progress Rail & Polish

**In:** completion state per zone (zone done = its `fields` all non-empty / answered — read-only derivation, no new storage), completed-chip collection rail, stroke-numeral ordinals, vertical writing-mode labels, the single `--nc-ease-bounce` completion pop, motion polish pass, optional measured DPR clamp.
**Out (explicitly):** canvas transparency/alpha experiments (bloom rewrite — not worth it; the opaque-matched void is indistinguishable), scroll-snap unless E3's layout proves it natural, client replay (E5, separate approval).

## 13 · Verification Plan (every slice)

1. **Data integrity (the non-negotiable):** full assessment walkthrough as coach with a fixture client — every aim + objective field → save → DB row diff (`assessments`, `rehab_objective_assessments`, `body_map_states`) **byte-identical** to the same walkthrough on the previous commit; Generate produces the same program for the same inputs.
2. **Behavior:** joint panel two-way sync still works in/out of zone focus; tab-row fallback fully functional; joint-click zone alignment correct; user-drag cancels tweens.
3. **Keyboard-only walkthrough** (no pointer) completes the whole objective assessment.
4. **Reduced-motion walkthrough** — cuts, no tweens, no autoRotate.
5. **Performance:** DevTools FPS trace during 3 consecutive zone tweens ≥ 30 fps floor; no per-frame GC churn.
6. **Hygiene:** 0 console errors, `npm run build` green, `node --check` n/a for ESM side — Vite build is the syntax gate; headless screenshot gates (with the known software-GL glb caveat) + one human eyeball per slice.

## 14 · Rollback Plan

- One commit per slice; E2–E4 are presentation/navigation only — **no migrations, no data-shape changes, ever** — so `git revert <slice>` restores the previous experience exactly.
- Runtime kill-switch by construction: ZoneDirector mounts only if its rail root exists in `app.html`; reverting the markup disables the system even if the JS ships.
- The tab row is the permanent in-product fallback (§6) — a coach is never stranded mid-assessment by a story-layer defect.

## 15 · Resolved v1 open decisions

1. Button-driven zones; scroll-snap deferred to E4-optional. 2. ROM grid stays whole in E2; splits into zone cards in E3. 3. Desktop-first; §2 mobile adaptation, no separate system.

*No implementation until E2 is explicitly approved. The current assessment continues working unchanged.*
