---
name: AST9 / NeuCore
description: Porcelain emerald-and-gold system for a clinical rehabilitation platform
colors:
  primary: "#047857"
  secondary: "#8A6D1F"
  tertiary: "#6D28D9"
  background: "#EEF3F0"
  surface: "#FFFFFF"
  text: "#0B241B"
typography:
  display: "Hanken Grotesk"
  body: "Hanken Grotesk"
  mono: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, Menlo, Consolas, monospace"
---

# Design System: AST9 / NeuCore

> **This document was rebuilt for a light ground on 2026-08-03.** The previous
> version specified a dark ground. That was wrong about the product: `_showApp()`
> in `app.html` applies `body.nc-bright` to **every authenticated user** — coach,
> admin and client — so porcelain is what ships and what users see. The dark
> `:root` palette now governs only the login screen and the dark transition.
> Every value below has been re-measured against a light ground.

## 1. Overview

**Creative North Star: "The porcelain instrument tray"**

A clean white tray, a fine emerald instrument laid on it, one small gold clasp.
The ground is quiet and bright; the tools are precise; nothing gleams that is not
doing work. A coach opens this with a patient in the room and should feel they are
reaching for a calibrated instrument, not launching an app.

Density is professional, not cramped. Real clinical data — bilateral ROM, scores
over time, gait-phase deficiencies — has room to be read at a glance and compared
without scrolling. Type is set for long sessions rather than screenshots. Motion is
functional: things move to show where they went, never to celebrate.

This system rejects two directions explicitly. It is **not a consumer fitness app**
— no streaks, badges, confetti, trophies or triumphant colour; these are patients
in rehabilitation, sometimes in pain, and enthusiasm about their numbers is a
failure of tone. It is **not a hospital EMR** — clinical seriousness must not curdle
into grey, cramped, form-first drudgery.

**Key Characteristics:**
- Porcelain ground with a faint emerald cast, never a neutral or warm grey
- Emerald leads; gold is finite currency
- Every pairing that ships is measured against WCAG 2.2 AA, not assumed
- One shell, three roles — no pattern may fork by role
- Quiet by default; emphasis is earned

## 2. Colors

A porcelain ground with a single living accent, a precious metal used sparingly,
and one royal note held in reserve.

### The rule that shapes everything

On a light ground the ramps **invert**. Emerald `#10B981` is 2.54:1 on white and
gold `#D4AF37` is 2.10:1 — both unusable as text. But both are excellent as
**fills with dark ink on top**. So:

> **The Inverted Ramp Rule.** The *dark* end of a ramp carries text and icons. The
> *bright* end is a fill, and dark ink sits on it. Emerald 500 as text on porcelain
> is a contrast bug, not a style choice; emerald 400 as a fill under
> `--ink-primary` is 8.52:1 and correct.

### Ground

- **Base** (`#EEF3F0`): the page. Porcelain with a faint emerald cast so the brand
  is present even where no accent is painted. 1.12:1 against a card, enough to read
  as a distinct plane.
- **Surface** (`#FFFFFF`): cards, panels, the reading plane.
- **Raised** (`#F6FAF8`): nested chrome, chips, table header rows. A **tint**, not a
  lift — see Elevation.
- **Sunken** (`#E7EEEA`): inputs and recessed wells. 1.18:1 against surface, so a
  field reads as a well rather than a floating box.

### Ink

- **Primary** (`#0B241B`): body and headings. **16.38:1** on surface.
- **Secondary** (`#3D5A4C`): supporting copy, table meta. **7.59:1**.
- **Tertiary** (`#54705F`): timestamps, captions, disabled labels. **5.44:1** on
  surface and **4.85:1** on base — full AA text in both, deliberately. This product
  has users with impaired vision; a "quiet grey" that fails contrast is not quiet,
  it is broken.

### Primary — Emerald

- **Emerald 700** (`#047857`): the brand as text, icons, links, focus rings, active
  navigation. **5.48:1** on surface.
- **Emerald 800** (`#065F46`): the heavier step for dense text and small glyphs.
  **7.68:1**.
- **Emerald 700 as a fill** with white ink: **5.48:1**. The primary button.
- **Emerald 400** (`#34D399`) and **300** (`#6EE7B7`): fills, chart series, chips,
  the axis on a chart — always with `--ink-primary` on top (**8.52:1**), never
  carrying text themselves.

### Secondary — Gold

- **Gold 700** (`#8A6D1F`): the only gold permitted as text. **4.90:1** on surface.
- **Gold 500** (`#D4AF37`) as a **fill** with `--ink-primary` on top: **7.79:1**.
  This is where gold belongs — the premium button, the tier badge — not as type.

### Tertiary — Royal

- **Amethyst 700** (`#6D28D9`): **7.10:1**. Held in reserve for a second data series
  and for the Athletic Performance lane, so that lane can differ from Rehab without
  inventing a palette.

### Status

- **Rose 700** (`#BE123C`): errors, destructive confirmation, expired subscription.
  **6.29:1**.
- **Amber 700** (`#B45309`): warnings, grace period. **5.02:1**. Note this is a
  *dark* amber — the bright `#FBBF24` is a fill only.

### Lines

- **Hairline** (`#D6E2DB`): dividers and quiet borders. 1.33:1 — visible without
  drawing attention.
- **Border strong** (`#B9CDC2`): the boundary of an interactive component where the
  edge itself carries meaning. 1.67:1.

### Named Rules

**The Finite Gold Rule.** Gold appears at most **once per screen**, marking the
single most premium or most earned thing in view. A screen with two golds has no
gold.

**The Inverted Ramp Rule.** Stated above. It is the difference between this system
and its dark predecessor, and the single easiest thing to get wrong.

**The No Colour-Only Rule.** No state — error, warning, active, expired, on-track —
is signalled by colour alone. Every one carries a label, icon or shape as well.
Rehab clients include users with impaired colour vision.

## 3. Typography

**Display Font:** Hanken Grotesk (fallback `system-ui, sans-serif`)
**Body Font:** Hanken Grotesk (fallback `system-ui, sans-serif`)
**Label/Mono Font:** `ui-monospace, 'SF Mono', 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, monospace`

**Character:** A single humanist grotesque doing all the structural work, with a
true monospace reserved strictly for figures that must align. One family keeps the
interface calm; the mono is the only typographic voice change in the system, and it
earns its place by making numeric columns and timestamps readable as data.

> The webfont is delivered to `app.html` as of 2026-08-02; before that the whole
> platform rendered in the OS fallback. Hanken Grotesk is roughly **9% wider**, so
> any component whose spacing predates that fix should be re-checked rather than
> trusted.

### Hierarchy

- **Display** (700, `clamp(28px, 3vw, 40px)`, 1.15): page-level identity. One per
  screen at most; many screens need none.
- **Headline** (700, 24px, 1.25): section headers — "Objective Assessment".
- **Title** (600, 18px, 1.35): card and panel titles.
- **Body** (400, 15px, 1.6): default reading size. Prose wraps at **65–75ch**;
  clinical notes must never run the full width of a desktop panel.
- **Label** (600, 12px, 0.06em, uppercase): field labels, table headers, chips.
- **Numeric** (500, mono, tabular): every figure compared against another figure.

### Named Rules

**The Tabular Rule.** Any number a user will compare against another number is set
in the mono stack with `font-variant-numeric: tabular-nums`. Scores, ROM degrees,
dates, durations, prices. A proportional digit in a column is a defect.

**The Scale Rule.** Sizes come from the hierarchy above. There is still **no
`--fs-*` token scale in the codebase**; introducing one remains outstanding work.

## 4. Elevation

On a light ground, **elevation is shadow-led, not fill-led.** `--bg-surface` is
already `#FFFFFF`, so a raised plane cannot be lighter — attempting to signal lift
by fill is what produced the previous system's broken 1:1 layering.

Depth therefore comes from: a hairline border, a soft shadow, and — only where the
element is genuinely *recessed* — a darker fill (`--bg-sunken`).

`--bg-raised` (`#F6FAF8`) is a **tint for nested chrome**: chips, table header
rows, the inside of a segmented control. It is 1.05:1 against surface, which is
deliberately almost nothing. It is not an elevation step.

### Shadow Vocabulary

- **Card** (`box-shadow: 0 1px 2px rgba(11,36,27,0.06), 0 1px 1px rgba(11,36,27,0.04)`):
  cards resting on the page.
- **Floating** (`box-shadow: 0 8px 24px rgba(11,36,27,0.10)`): menus, popovers,
  dropdowns.
- **Modal** (`box-shadow: 0 24px 64px rgba(11,36,27,0.18)`): dialogs only, over a scrim.

Shadows are tinted with the ink hue, never pure black — black shadows on a warm-free
porcelain read as dirt.

### Named Rules

**The Two-Plane Rule.** No more than two elevation steps visible at once. A card
inside a card inside a panel means the information architecture is wrong.

**The Glow Prohibition.** No coloured glows, and no `drop-shadow` used as emphasis.
Emphasis comes from contrast and position. This is not stylistic: a glow on a light
ground reads as a printing error.

## 5. Components

### Buttons

- **Primary**: Emerald 700 fill, white ink (**5.48:1**), radius `--r-md` (12px),
  height 44px, Label scale.
- **Premium**: Gold 500 fill, `--ink-primary` on top (**7.79:1**). Reserved for
  purchase and activation, subject to the Finite Gold Rule.
- **Secondary**: surface fill, `--border-strong`, `--ink-primary` label.
- **Destructive**: Rose 700, always paired with a typed confirmation for anything
  irreversible — deletion genuinely cascades.
- **Minimum target 44×44px**, including icon-only buttons.

### Chips

Radius `--r-full`, Label scale, `--bg-raised` fill with `--hairline` border. State
chips carry an icon as well as colour.

### Cards / Containers

`--bg-surface` fill, 1px `--hairline`, radius `--r-lg` (16px), padding `--sp-6`
(24px), Card shadow. A card never nests inside another card.

### Inputs / Fields

`--bg-sunken` fill so the field reads as a well, `--border-strong`, radius
`--r-md`, height 44px, Body scale. Focus is a 2px Emerald 700 ring with 2px offset —
never a removed outline. Error pairs Rose 700 with a text message; the border alone
is not the error.

### Navigation

One shell, three roles. Active item is Emerald 700 with a 3px leading bar **plus** a
weight change, so state survives colour-blindness and the `.hidden` toggling the
shell relies on.

> **Never** use `display: … !important` on anything the shell toggles. Four
> production regressions came from exactly that, the worst pinning a login overlay
> visible and locking out the owner and every client. The convention is
> `.hidden { display: none !important }` and nothing competes with it.

### Charts and canvases

A chart, graph or canvas is **not** an excuse for a dark panel. Embedding a dark
surface in a porcelain app is what made the Reactive Graph read as broken: a
hardcoded dark canvas whose children used the app's light tokens, producing white
cards floating on near-black. Canvases use `--bg-surface` or `--bg-base` like
everything else, with emerald as the data colour.

**Stroke widths in a scaled `viewBox` are not pixels.** An SVG with
`viewBox="0 0 100 100"` and `preserveAspectRatio="none"` scales x and y by
different factors — measured at 12.4× and 8.27× on the Reactive Graph canvas — so a
declared `stroke-width: 3.5` painted **18.6px** and `9` painted **47.5px**. Use
`vector-effect="non-scaling-stroke"`, or draw the line in screen space.

## 6. Motion

Purposeful and short. **150ms** for state changes, **220ms** for entrances,
ease-out on entry and ease-in on exit. Nothing bounces, overshoots or celebrates.

Panels that open in place expand from their trigger so the eye keeps its anchor.
Loading is a quiet skeleton at `--bg-raised`, never a spinner over content that is
already readable.

`prefers-reduced-motion: reduce` removes all transforms and transitions and keeps
only opacity. This is a rehabilitation product; vestibular sensitivity is a real
clinical presentation among its users.

## 7. Accessibility

**Target: WCAG 2.2 AA.** Every pairing below was computed, not asserted. 24
pairings measured, 0 unexpected failures.

| Pairing | Ratio | Bar |
|---|---|---|
| Ink primary on surface | 16.38:1 | AA text |
| Ink secondary on surface | 7.59:1 | AA text |
| Ink tertiary on surface | 5.44:1 | AA text |
| Ink tertiary on base | 4.85:1 | AA text |
| Emerald 700 on surface | 5.48:1 | AA text |
| Emerald 800 on surface | 7.68:1 | AA text |
| White ink on Emerald 700 fill | 5.48:1 | AA text |
| Ink primary on Emerald 400 fill | 8.52:1 | AA text |
| Ink primary on Gold 500 fill | 7.79:1 | AA text |
| Gold 700 on surface | 4.90:1 | AA text |
| Amethyst 700 on surface | 7.10:1 | AA text |
| Rose 700 on surface | 6.29:1 | AA text |
| Amber 700 on surface | 5.02:1 | AA text |
| Emerald 700 focus ring on surface | 5.48:1 | AA non-text |
| Border strong on surface | 1.67:1 | visible boundary |
| Hairline on surface | 1.33:1 | quiet divider |
| Base vs surface | 1.12:1 | distinct plane |
| Sunken vs surface | 1.18:1 | input well |
| **Emerald 500 on surface** | **2.54:1** | **fails — fill only** |
| **Emerald 600 on surface** | **3.77:1** | **fails as text — large/UI only** |
| **Gold 500 on surface** | **2.10:1** | **fails — fill only** |

Also required: visible focus on every interactive element, 44×44px minimum targets,
usable at 200% zoom, no state signalled by colour alone, and `prefers-reduced-motion`
honoured.

## 8. Known conflicts to resolve during implementation

Properties of the current codebase, not of this system. Each will block clean
adoption:

1. **The shipped light ramp is not this ramp.** `body.nc-bright` currently resolves
   `--text-tertiary` to `#7E8299` (**3.79:1 on white — fails AA**), `--text-primary`
   to a slate `#181C32`, and `--bg-raised` to `#FFFFFF`, identical to
   `--bg-surface` (**1:1, layers invisible**). These are pre-existing, verified
   against `main`. Applying this document's light ramp fixes all three.
2. **The dark `:root` is now login-only.** The consolidated dark tokens are correct
   and should stay — they govern the login screen and the dark transition — but they
   are not the product surface. Do not assume a change to `:root` affects the app.
3. **`--gold-400` is `#FBBF24`**, identical to `--amber-400`. Two names, one colour,
   and the value was invented. It should be `#E4C563` or removed.
4. **The Reactive Graph canvas hardcodes a dark gradient**
   (`linear-gradient(160deg, #04141A, #061A12)`) while its children use app tokens.
   See §5 Charts and canvases.
5. **No type-size scale.** Sizes are ad-hoc across ~510KB of CSS in 6 files.
6. **Unverified layouts.** Authenticated screens were spaced against the OS fallback
   font and a different ground. Overflow findings from a signed-in pass are the real
   input to the next implementation stage.
