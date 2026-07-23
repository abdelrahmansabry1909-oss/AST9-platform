---
name: ast9-frontend-launch-guard
description: "AST9/NeuCore guard for the landing page, mobile nav, Sign-In reachability, and public/auth entry visibility. Use when working on index.html landing, the responsive nav, the mobile hamburger, the Sign-In button, app entry from landing, or any 'can a user reach login on mobile' question. Triggers: 'no Sign In on mobile', 'hamburger', 'mobile nav', 'landing page', 'responsive', 'Sign In button', 'app.html?login=1 reachability'. Encodes the real launch-blocker where the mobile landing hid Sign In at <=900px behind a dead hamburger. Classifies CSS-reachability (Antigravity) vs post-login bounce (Codex/auth). DO NOT USE for the login bounce itself after Sign In is visible (use ast9-auth-routing-guard)."
---

# AST9 — Frontend Launch / Mobile Sign-In Reachability Guard

Apply when touching the landing page or mobile navigation, or when asked "why can't I sign in on mobile." Parent: `AI_WORKFLOW_GUARDRAILS.md` §4 (browser smoke).

## The regression this prevents

A launch blocker reached a near-onboarded client: on the landing page at **≤900px**, `css/landing.css` hid the `.nc-nav-cta .nc-btn` Sign-In button and showed a hamburger `.nc-nav-toggle` that had **no JS handler and no menu** — so a phone user had no path to login. The Sign-In link itself was correct (`app.html?login=1`); only its *reachability* was broken. (CSS-reachability fix shipped as PR #52.)

## Classification first (critical)

- **Sign-In not visible / not tappable on mobile = CSS reachability → Antigravity** (`css/landing.css`, nav media queries). Claude may diagnose and review; Antigravity implements.
- **Sign-In visible and tapped, but the app bounces back to landing = auth routing → Codex** (`ast9-auth-routing-guard`). These are different bugs with different owners — never conflate them.

## Core invariants

1. Sign-In is always reachable on mobile (visible and tappable in the nav).
2. Sign-In navigates to `app.html?login=1`.
3. No dead/non-functional controls are shown (a hamburger must have a working handler + menu, or not be shown at all).
4. CSS-only reachability fixes belong to Antigravity.
5. A login bounce **after** a visible Sign-In is auth routing (Codex), not CSS.
6. Mobile is checked at **375px, 390px, 414px, 768px**, and desktop.
7. Console errors are reported, not ignored.
8. `npm run build` passes.
9. No JS/HTML/backend changes unless explicitly approved (this is normally a CSS-scope task).

## Anti-patterns — BLOCK these

- Shipping a hamburger / control with no click handler and no menu.
- Hiding Sign-In on mobile without an equivalent reachable login entry.
- "Fixing" a post-login landing bounce by editing CSS (wrong owner, wrong layer).
- Claiming mobile works after checking only desktop width.
- Introducing horizontal overflow at small widths.

## Required tests

```
mobile landing 375px
mobile landing 390px
mobile landing 414px
tablet 768px
desktop landing
tap Sign In
confirm navigation to app.html?login=1
confirm the login card renders
confirm no dead hamburger / no no-op control
confirm no horizontal overflow
console: zero errors
npm run build passes
```

## Ownership classification

- CSS / layout / responsive visibility → **Antigravity**.
- The login/auth behavior the button leads to → **Codex** (`ast9-auth-routing-guard`).
- When unsure which layer a "can't log in on mobile" report is, diagnose read-only first, then route to the correct owner.

## Required honesty

- If verification was code/markup reading only (no real device or width-emulated browser run), say so. Do not claim "works on mobile" from a desktop check.
- If the live fix needs deployment to reach the user, state that it must merge to `main` and finish the GitHub Pages deploy first.
