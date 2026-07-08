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

