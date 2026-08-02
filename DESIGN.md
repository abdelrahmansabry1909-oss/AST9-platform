---
name: AST9 / NeuCore
description: Emerald-and-gold royal system for a clinical rehabilitation platform
colors:
  primary: "#10B981"
  secondary: "#D4AF37"
  tertiary: "#A78BFA"
  background: "#061A12"
  surface: "#0A241A"
  text: "#F2F7F4"
typography:
  display: "Hanken Grotesk"
  body: "Hanken Grotesk"
  mono: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, Consolas, monospace"
---

# Design System: AST9 / NeuCore

## 1. Overview

**Creative North Star: "The instrument case"**

A precision instrument laid in a dark, lined case. The ground is deep and quiet;
the tools are emerald; the clasps are gold. Nothing glitters that is not load-
bearing. The value comes from what is *not* decorated — a coach opens this with a
patient in the room, and the interface should feel like reaching for a calibrated
tool rather than launching an app.

Density is professional, not cramped. Real data — bilateral ROM, scores over time,
gait phase deficiencies — has room to be read at a glance and compared without
scrolling. Type is set for long sessions rather than screenshots. Motion is
functional: things move to show where they went, never to celebrate.

This system explicitly rejects two directions. It is **not a consumer fitness app**
— no streaks, badges, confetti, trophies, or triumphant colour; these are patients
in rehabilitation, and enthusiasm about their numbers is a failure of tone. It is
**not a hospital EMR** — clinical seriousness must not curdle into grey, cramped
form-filling. It also steps away from the current dark-and-gold-dominant treatment,
in which gold carried the identity and the accent token silently resolved to teal.

**Key Characteristics:**
- Emerald leads; gold is finite currency
- Dark emerald-black ground, not blue-black, not neutral grey
- Every colour pairing that ships is measured against WCAG 2.2 AA, not assumed
- One shell, three roles — no pattern may fork by role
- Quiet by default; emphasis is earned

## 2. Colors

A deep emerald-black ground with a single living accent, a precious metal used
sparingly, and one royal note held in reserve.

### Primary

- **Emerald 500** (`#10B981`): The brand. Primary actions, active navigation, the
  "on track" state, focus rings, data series one. On `--bg-surface` it measures
  **6.47:1** — safe for text and icons.
- **Emerald 400** (`#34D399`): The brighter step, for raised surfaces and hover.
  Required on `--bg-raised`, where Emerald 500 falls to 4.77:1 and loses margin.
- **Emerald 700** (`#047857`) / **Emerald 800** (`#065F46`): The light-theme pair.
  Emerald 500 is **2.54:1 on white and unusable** — on any light surface, emerald
  must be 700 or darker for text.

### Secondary

- **Gold 500** (`#D4AF37`): Precious, earned, premium. Package tier badges,
  subscription state, the owner's business surfaces, the one thing on a screen
  that outranks everything else. **7.8:1** on `--bg-surface`.
- **Gold 700** (`#8A6D1F`): The only gold permitted as text on a light surface
  (**4.9:1**). Gold 500 on white is 2.1:1 — decoration only, never meaning.

### Tertiary

- **Amethyst 400** (`#A78BFA`): Held in reserve for a second data series and for
  the Athletic Performance lane when it lands, so that lane can differ from Rehab
  without inventing a new palette. **6.03:1** on `--bg-surface`.

### Neutral

- **Ink Primary** (`#F2F7F4`): Body and headings. **15.14:1** on `--bg-surface`.
- **Ink Secondary** (`#A8C0B4`): Supporting copy, table meta. **8.49:1**.
- **Ink Tertiary** (`#7C9689`): Timestamps, captions, disabled labels. **5.14:1** —
  still full AA text, deliberately; this product has users with impaired vision and
  a "quiet grey" that fails contrast is not quiet, it is broken.
- **Void** (`#03100B`), **Base** (`#061A12`), **Surface** (`#0A241A`),
  **Raised** (`#153D2D`): The four-plane ground.
- **Hairline** (`#245C46`): Borders and dividers. **2.1:1** against surface —
  visible without drawing attention.

### Status

- **Rose 400** (`#FB7185`) on dark / **Rose 700** (`#BE123C`) on light: errors,
  destructive confirmation, expired subscription.
- **Amber 400** (`#FBBF24`): warnings and grace-period states. **9.83:1** on surface.

### Named Rules

**The Finite Gold Rule.** Gold appears at most **once per screen**. It marks the
single most premium or most earned thing in view. A screen with two golds has no
gold.

**The Ground-Aware Emerald Rule.** Emerald is not one colour, it is a ramp chosen
by ground. 500 on `--bg-surface`, 400 on `--bg-raised` and on hover, 700 or 800 on
anything light. Using 500 on a light surface is a contrast bug, not a style choice.

**The No Colour-Only Rule.** No state — error, warning, active, expired, on-track —
is communicated by colour alone. Every one carries a label, icon, or shape as well.
Rehab clients include users with impaired colour vision.

## 3. Typography

**Display Font:** Hanken Grotesk (fallback `system-ui, sans-serif`)
**Body Font:** Hanken Grotesk (fallback `system-ui, sans-serif`)
**Label/Mono Font:** `ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, monospace`

**Character:** A single humanist grotesque doing all the structural work, with a
true monospace reserved strictly for figures that must align. One family keeps the
interface calm; the mono is the only typographic "voice change" in the system, and
it earns its place by making numeric columns and timestamps readable as data.

> The webfont is now delivered to `app.html`. Before 2026-08-02 it was loaded only
> on the landing page, so the entire platform rendered in the OS fallback. Hanken
> Grotesk is roughly **9% wider** than that fallback, so any component whose spacing
> was tuned before that fix should be re-checked rather than trusted.

### Hierarchy

- **Display** (700, `clamp(28px, 3vw, 40px)`, 1.15): Page-level identity. One per
  screen at most; many screens need none.
- **Headline** (700, 24px, 1.25): Section headers — "Objective Assessment",
  "Program History".
- **Title** (600, 18px, 1.35): Card and panel titles.
- **Body** (400, 15px, 1.6): Default reading size. Prose wraps at **65–75ch**;
  clinical notes must never run the full width of a desktop panel.
- **Label** (600, 12px, 0.06em, uppercase): Field labels, table headers, chips.
- **Numeric** (500, mono, tabular): Every figure that sits in a column, every ID,
  every timestamp, every score compared against another score.

### Named Rules

**The Tabular Rule.** Any number a user will compare against another number is set
in the mono stack with `font-variant-numeric: tabular-nums`. Scores, ROM degrees,
dates, durations, prices. A proportional digit in a column is a defect.

**The Scale Rule.** Font sizes come from the hierarchy above. There is currently
**no type-size token scale in the codebase** and sizes are set ad-hoc across ~510KB
of CSS; introducing `--fs-*` tokens is the first structural task of the reskin.

## 4. Elevation

Depth is **tonal first, shadow second**. The four grounds — Void, Base, Surface,
Raised — do the structural work, because on a dark ground large soft shadows read as
smudges rather than lift. Shadow is used only where an element genuinely floats
above the page and must be dismissible: menus, popovers, modals, toasts.

Layering is never conveyed by fill alone. `--bg-raised` separates from
`--bg-surface` by **1.36:1**, which is perceptible but slight, so every raised plane
also carries a 1px `--hairline` border. Fill and border together; either alone is
fragile.

### Shadow Vocabulary

- **Raised** (`box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 20px rgba(0,0,0,0.4)`):
  Cards that sit above the page but do not float.
- **Floating** (`box-shadow: 0 12px 40px rgba(0,0,0,0.6)`): Menus, popovers,
  dropdowns.
- **Modal** (`box-shadow: 0 24px 80px rgba(0,0,0,0.7)`): Dialogs only, over a scrim.

### Named Rules

**The Two-Plane Rule.** No more than two elevation steps are visible at once. A card
inside a card inside a panel means the information architecture is wrong, not that a
third shadow is needed.

**The Glow Prohibition.** No coloured glows. The codebase currently carries
`--glow-gold`, `--shadow-lime`, and `--rose-glow`; these belong to the treatment
being retired. Emphasis comes from contrast and position, not bloom.

## 5. Components

### Buttons

- **Primary**: Emerald 500 fill, Void ink (**7.65:1**), radius `--r-md` (12px),
  height 44px, label at Label scale. Hover lifts to Emerald 400.
- **Premium**: Gold 500 fill, Void ink (**9.22:1**). Reserved for purchase and
  activation. Subject to the Finite Gold Rule.
- **Secondary**: Transparent fill, `--hairline` border, Ink Primary label.
- **Destructive**: Rose, and always paired with a typed confirmation for anything
  irreversible — deletion now genuinely cascades.
- **Minimum target 44×44px** including icon-only buttons.

### Chips

Radius `--r-full`, Label scale, `--bg-raised` fill with `--hairline` border.
State chips carry an icon as well as colour (No Colour-Only Rule).

### Cards / Containers

`--bg-surface` fill, 1px `--hairline` border, radius `--r-lg` (16px), padding
`--sp-6` (24px). Card titles at Title scale. A card never nests inside another card.

### Inputs / Fields

`--bg-base` fill (recessed, darker than the surface it sits on), `--hairline`
border, radius `--r-md`, height 44px, Body scale. Focus is a 2px Emerald 500 ring
with a 2px offset — never a removed outline. Error state pairs Rose with a text
message; the border alone is not the error.

### Navigation

One shell, three roles. Active item is Emerald 500 with a 3px leading bar plus a
weight change — position and weight carry the state so it survives colour-blindness
and the `.hidden` toggling the shell relies on.

> **Never** use `display: … !important` on anything the shell toggles. Four
> production regressions in this repository came from exactly that, most severely
> a login overlay pinned visible that locked out the owner and every client. The
> convention is `.hidden { display: none !important }` and nothing competes with it.

## 6. Motion

Purposeful and short. **150ms** for state changes (hover, focus, chip toggle),
**220ms** for entrances (panels, modals, popovers), ease-out on entry and ease-in on
exit. Nothing bounces, overshoots, or celebrates.

Panels that open in place expand from their trigger so the eye keeps its anchor.
Loading is a quiet skeleton at `--bg-raised`, never a spinner over content that is
already readable.

`prefers-reduced-motion: reduce` removes all transforms and transitions and keeps
only opacity — this is a rehabilitation product and vestibular sensitivity is a real
clinical presentation among its users.

## 7. Accessibility

**Target: WCAG 2.2 AA**, and every pairing in this document is measured rather than
asserted. Full results are in the tables above; the constraints that shape the
system:

| Pairing | Ratio | Bar |
|---|---|---|
| Ink Primary on Surface | 15.14:1 | AA text |
| Ink Tertiary on Surface | 5.14:1 | AA text |
| Emerald 500 on Surface | 6.47:1 | AA text |
| Emerald 500 on Raised | 4.77:1 | AA text, thin margin — prefer Emerald 400 |
| Gold 500 on Surface | 7.80:1 | AA text |
| Void ink on Emerald 500 fill | 7.65:1 | AA text |
| Void ink on Gold 500 fill | 9.22:1 | AA text |
| Surface vs Raised | 1.36:1 | perceptible layer, border still required |
| Hairline on Surface | 2.10:1 | visible boundary |
| **Emerald 500 on white** | **2.54:1** | **fails — use Emerald 700+** |
| **Gold 500 on white** | **2.10:1** | **fails — decoration only** |

Also required: visible focus on every interactive element, 44×44px minimum targets,
usable at 200% zoom, no state signalled by colour alone, and `prefers-reduced-motion`
honoured.

## 8. Known conflicts to resolve during implementation

These are properties of the current codebase, not of this system, and each one will
block clean adoption:

1. **Duplicate token definitions.** `--bg-base` is defined as both `#050b11` and
   `#f9f9fc`, and `--bg-surface` as both `#0c121e` and `#FFFFFF`, in different
   stylesheets. "The background colour" currently has no single answer. The dark and
   light themes must be separated by scope, not by load order.
2. **The accent is teal.** `--nc-accent` resolves to `--nc-teal`, so emerald is not
   actually the accent today despite appearing in the login trust badge.
3. **No type scale.** Font sizes are ad-hoc across ~510KB of CSS in 7 files, with
   `styles.css` (216KB) and `neucore-premium.css` (198KB) almost certainly
   overlapping. Introducing `--fs-*` tokens comes before any component work.
4. **Retired treatment still present.** `--glow-gold`, `--shadow-lime`,
   `--rose-glow` and the near-black blue ground belong to the previous direction.
5. **Unverified layouts.** Every authenticated screen was spaced against the OS
   fallback font rather than Hanken Grotesk. Overflow findings from a signed-in pass
   are the real input to the first implementation stage.
