# AST9 Premium Design System
*Clinical Rehabilitation & Peak Performance OS*

This document defines the visual guidelines, design tokens, typography, container systems, and role-based interface rules for the AST9 application.

---

## 1. Visual Principles

1. **Precision & Telemetry:** AST9 is not a generic gym app. Every visual element should look engineered, precise, and clinical.
2. **Clinical Trust:** High-contrast text, clear diagnostic indicators, and clean layout separators rather than saturated gamer shadows.
3. **Data Hierarchy:** Numbers, stats, and angle degrees align clearly (utilizing tabular numerals) to present a clean rehabilitation ledger.

---

## 2. Color Tokens

### Background Primitives
* **Void Background:** `--bg-void: #03060b` (absolute canvas backdrop)
* **Base Background:** `--bg-base: #050b11` (primary content backing)
* **Surface Background:** `--bg-surface: #0c121e` (primary card grid surfaces)
* **Raised Surface:** `--bg-raised: #111a29` (inner elements, controls)
* **Overlay Surface:** `--bg-overlay: #172236` (popups, floating dialogs)

### Brand Accent Colors
* **Primary Teal:** `--lime: #14b8a6` (re-mapped electric lime to clinical biomechanical teal)
* **Teal Dim:** `--lime-dim: #0e9384` (active states, border lines)
* **Cyan Glow:** `--cyan: #67e8f9` (soft cyan for telemetry highlight layers)
* **Longevity Gold:** `--gold: #d4af37` (used selectively for premium performance tiers)

### Border Systems
* **Subtle Borders:** `--border-subtle: rgba(20, 184, 166, 0.05)`
* **Default Borders:** `--border-default: rgba(20, 184, 166, 0.09)`
* **Strong Borders:** `--border-strong: rgba(20, 184, 166, 0.15)`

---

## 3. Typography

* **Display Font:** `--font-display: 'Space Grotesk'` (geometric, clean, technical display headers)
* **Body Font:** `--font-body: 'Inter'` (highly readable sans-serif body copy)
* **Monospace Font:** `--font-mono: 'JetBrains Mono'` (used for telemetry data and system parameters)

---

## 4. Layout & Rhythm

* **Card System:** Rounded containers (`18px`) utilizing clean `1px` borders, subtle gradients, and composer-style ambient dropshadows (`--nc-shadow-card`).
* **Hover Interaction:** composited vertical lifts (`translateY(-2px)`) with smooth transitions (`cubic-bezier(0.16, 1, 0.3, 1)`).

---

## 5. Role & Workspace Security Rules

> [!IMPORTANT]
> **Developer Guardrails:**
> * Never modify the class visibility selectors that govern role separations:
>   * `role-client-only`, `role-coach-admin`, `role-admin-only`
>   * `nc-client`, `nc-coach`, `nc-admin`
> * Do not add overriding `display: ... !important` tags.
> * Maintain Sentry telemetry tracking.

---

## 6. Landing Page Layout & Wording Safeguards

### Copywriting Wording Guardrails
To prevent risky medical claims, always adhere to the following terminology map:
* **PROHIBITED:** *diagnose*, *cure*, *treatment guarantee*, *patient*, *medical-grade*, *clinically proven*, *guaranteed recovery*.
* **APPROVED:** *objective movement tracking*, *coach-led rehab workflows*, *progress visibility*, *program delivery*, *load tolerance*, *movement quality*, *training adherence*, *performance telemetry*, *rehab operating system*.

### Visual Mockups
* All telemetry data (e.g., knee extension deficit, pain rating level, symmetry balance) displayed in public illustrations must be labeled clearly as illustrative demo metrics. Do not display clinical diagnostic claims.

### Onboarding Gateway (CTA)
* Landing page buttons must never offer clinical self-assessments to anonymous guests. Use onboarding calls like *Explore Platform* or *Enter Platform* rather than *Start Assessment*.

---

## 7. Authentication & Access Gate Layouts

### Visual Themes
* **Background:** Royal NeuCore visual direction utilizing midnight (`#050814`) / royal navy (`#0B1430`) bases, overlayed with a heavily reduced/soft coordinate grid and subtle sapphire (`#102A56`) secondary glows.
* **Containers:** Glassmorphic layout primitives utilizing gold border highlights (`rgba(212, 175, 55, 0.22)`) and top highlight borders (`linear-gradient` using gold accent variables).
* **Typography:** Plus Jakarta Sans for wordmarks and headers, Inter for labels and body text, establishing a premium medical-performance identity.

### Preservation Selector Guardrails
To prevent breaking public automated tests, developers must never delete or rename the following selectors:
* `#screen-login` (takes over screen for auth gateway)
* `#login-form-signin` (login form container)
* `#login-email` & `#login-password` (credential input tags)
* `#login-btn` (form submit trigger)
* `#nc-login-tab-signin` (login tab toggle selector)
* `#loading-overlay` (app workspace loader takeover overlay)
* `#screen-legal-required` (legal agreements consent gateway)
* `#screen-subscription-inactive` (subscription gating takeover panel)

### Layout Scoping & Visibility Rules
* **Strict Scoping:** All custom `.nc-login`, `.nc-login-card`, `.nc-login-input`, `.nc-login-tab`, and `.nc-login-submit` visual overrides must be scoped strictly to `#screen-login` (e.g., `#screen-login.nc-login:not(.hidden)` or `#screen-login .nc-login-card`).
* **Split Layout:** Desktop viewports use a 1.15fr / 0.85fr grid container (`.nc-login-split-container`) containing a left hero panel (`.nc-login-hero-side`) and right form card panel (`.nc-login-form-side`). On viewports `< 900px`, the left hero collapses to ensure a mobile-first focused form layout.
* **Hidden State Safety:** Generic styling must never override the `.hidden` class. When `#screen-login` has class `.hidden`, its computed display must evaluate to `none` to prevent it from overlaying the active app dashboard after user sign-in.

### Mock Telemetry & Clinical Safety Rules
* **Illustrative Wording:** Hero telemetry visuals must be clearly labeled as `DEMO TELEMETRY` and feature a footer disclaimer stating `Illustrative metrics only`.
* **No Diagnostic Claims:** No diagnostic assertions, treatment claims, or real-time patient assessment indicators should be displayed on marketing or login gates. All metrics are illustrative telemetry only.

---

## 8. Logged-in Dashboard & Shell Layouts

### Porcelain Emerald Theme (FitExpert-inspired)
* **Visual Direction:** A clean, flat, premium SaaS dashboard visual aesthetic with high-contrast typography, minimal glows, and crisp white surfaces.
* **Canvas Backdrop:** Bright porcelain `#F8F9F9` mapped to `body.nc-bright`.
* **Sidebar & Header:** Clean white `#FFFFFF` layout components with very subtle dark borders (`rgba(24, 28, 50, 0.07)`) and minimal shadows, creating a compact and professional density.
* **Card Backings:** Flat white `#FFFFFF` surfaces with very subtle borders (`rgba(24, 28, 50, 0.07)`) and flat minimal shadows (`--nc-shadow-card`), avoiding heavy/glowy dropshadows.
* **Typography:** Deep Slate/Navy-black `#181C32` for primary headings and text, dark graphite `#333639` for secondary text, and slate gray `#5E6278` for muted labels, establishing very high readability and contrast.
* **Brand Accent Colors**: Luxurious Emerald `#047857` (active indicators, primary CTAs), with Bright Emerald `#10B981` and Soft Emerald Glow `rgba(4, 120, 87, 0.08)`. Restrained royal gold `#D4AF37` is used lightly for premium highlights.

### Scoped Overrides Guardrails
* To prevent regression on other modules (Athletic mode, subscription forms, program builder, etc.), all dashboard visual changes are scoped under parent layout classes (e.g. `body.nc-bright`, `.sidebar`, `.topbar`, `.card`, and `.nc-dash-grid`).
* All semantic warning/danger colors (rose/red for errors, amber for warnings, green/emerald for positive success logs) must remain untouched. Primary brand emerald is reserved strictly for main brand accents/CTAs.

### Objective Assessment Readability & Inputs
* **High Contrast Values:** Numerical result inputs (`.form-input` or `input[type="number"]`) must be fully readable with text color `#181C32` on a pure white `#FFFFFF` background.
* **Readable Secondary Text:** Placeholders must have a high contrast muted slate color `#5E6278` for clear readability.
* **Vertical Display Safeguards:** Inputs must have a fixed height of `42px` with `box-sizing: border-box` to prevent vertical text clipping. Active input fields must never have opacity below `1`.
* **Focus States:** Focused inputs must present an emerald outline `#047857` with an emerald ring glow `rgba(16, 185, 129, 0.18)`.
* **Visual Polish:** Cards inside the Objective Assessment workspace utilize white backings, deep navy headers, and spacious padding to maintain a clean clinical ledger layout.
