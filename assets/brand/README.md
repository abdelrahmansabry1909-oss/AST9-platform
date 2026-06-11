# AST9 Brand Mark — Direction Artifact (v0.1)

**Status:** design direction only — NOT wired into the app. Approval + refinement required before any shell/landing/favicon swap.

## The mark (`ast9-mark.svg`)
One continuous stroke, two readings: a **stylized spine** (three vertebral curves, the anatomical anchor) grounding into a **recovery pulse** (one calm ECG beat — the product's heartbeat metric). No dumbbells, no crosses, no generic gym cues.

## Rules
- **Color:** single-color only — ink `#0E1726`, white, or clinical teal `#14B8A6` (`currentColor`). Never gradients inside the mark.
- **Motion:** draw-on via `stroke-dasharray/dashoffset` (loading states, assessment intro); the pulse segment may "beat" subtly (scale 1→1.04 on the spike) as a live-status indicator. Calm easing only (`--nc-ease`); honors `prefers-reduced-motion`.
- **Hologram compatibility:** the stroke language matches the skeleton's edge rendering — the mark can materialize from/into the hologram in the assessment intro (E-phase moment).
- **Scaling:** geometry sits on a 4px grid; test at 16 / 32 / 1024 before ratifying. App-icon tile = white mark knocked out of accent teal, no text.
- **Clearspace:** ≥ 1 stroke-width on all sides; wordmark (Space Grotesk, 600) sits right of the mark at cap-height alignment.

## Next steps (approval-gated)
1. Ratify or iterate the geometry (the spike angle + vertebral rhythm are the expressive variables).
2. Cut favicon (16/32) + app icon (1024 tile) + social avatar.
3. Phase G: swap into landing + app shell + login in one cutover commit.
