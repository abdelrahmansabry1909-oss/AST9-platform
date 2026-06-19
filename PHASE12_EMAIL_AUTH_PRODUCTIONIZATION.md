# Phase 12 — Email-Auth Productionization + Edge CORS Resync

Status legend: **[DONE]** applied & verified in production · **[OWNER]** requires a
Supabase-dashboard or DNS action only the project owner can perform (not automatable
from here) · **[N/A]** intentionally not done, with reason.

This phase makes coach signup-verification and password-reset email flows ready for
real public onboarding, and resyncs the edge-function CORS bundle. No application
source files changed — the repo was already correct; the work was (a) redeploying
four edge functions so their *deployed* bundle matches the repo, and (b) the owner
action items below.

---

## Part H — Edge function CORS resync **[DONE]**

`supabase/functions/_shared/auth.ts` in the repo already allow-lists the headers
`supabase-js` attaches to every `functions.invoke()` call
(`x-client-info`, `x-supabase-api-version`). Several functions had been deployed
*before* that fix and still bundled the stale allow-list
(`authorization, content-type, apikey, x-cron-secret`).

**Live impact found:** `generate-program` is the only stale function called via
`sb.functions.invoke()` (coach dashboard → "Generate Program"). Its browser preflight
rejected `x-client-info`, so that AI feature was **broken in the browser**. The others
(`create-user`, `delete-user`, `send-email`) are called via raw `fetch` with minimal
headers, so their stale CORS was latent only.

Redeployed from current repo source (logic byte-unchanged; only the bundled
`_shared/auth.ts` CORS line changed):

| Function | Caller | Before | After | Result |
|---|---|---|---|---|
| `generate-program` | `functions.invoke` | v6 stale | **v7** | real browser bug fixed |
| `create-user` | raw fetch | v4 stale | **v5** | latent drift removed; authz 4/4 intact |
| `delete-user` | raw fetch | v3 stale | **v4** | latent drift removed; boots + admin-only |
| `send-email` | raw fetch | v3 stale | **v4** | latent drift removed; boots + authz |

**Not redeployed (intentional) [N/A]:**
- `rpm-ai-suggest`, `visitor-survey` — use their own inline CORS (not `_shared/auth.ts`);
  raw-fetch callers with matching headers; working.
- `pulse-alerts`, `subscription-checker` — cron-only (no browser preflight, so the stale
  CORS is harmless). Their deployed bundle also carries the older `requireCron`
  (`CRON_SECRET` env) signature; resyncing would switch them to the Vault-RPC variant —
  an out-of-scope auth-mechanism change for zero CORS benefit.
- `claim-coach`, `subjective-transcript-assistant` — already on the fixed shared bundle.

**Verification (all against production):** preflight for the 4 functions now returns
`...x-client-info, x-supabase-api-version...`; `generate-program` coach→400 / anon→401
(boots, no 500); `create-user` admin-creation→403, coach→coach→403, anon→401 (authz
unchanged); `delete-user` coach→403 (admin-only) / anon→401; `send-email` coach→400
(bad type) / anon→401.

---

## Part A — Auth email config audit

Readable via tooling:
- **Leaked-password protection:** DISABLED (security advisor `auth_leaked_password_protection`). See Part G.
- **Transactional email:** the app already uses **Resend** (`send-email` edge function:
  `RESEND_API_KEY`, `FROM_EMAIL`, `https://api.resend.com/emails`) for phase-upgrade /
  subscription-activated notices. This is separate from Supabase **Auth** mail
  (signup-confirm / password-reset), which still uses Supabase's built-in mailer.

Dashboard-only (cannot be read or changed from here) — owner must verify in
**Supabase → Authentication**: Custom SMTP on/off, sender name/address, email
templates, Site URL, Redirect allowlist, auth email rate limits.

Known from prior QA: the built-in mailer returns `over_email_send_rate_limit` (HTTP 429)
after ~1–2 sends — not production-grade for real signup/reset volume.

---

## Part B — Custom SMTP provider **[OWNER]**

**Recommendation: Resend SMTP** — the project already sends transactional mail through
Resend, so reusing it keeps one verified domain and one provider.

- **Cost:** Resend has a free tier that comfortably covers low Auth volume (signup +
  reset), with paid tiers for higher volume. Confirm current limits/prices at
  <https://resend.com/pricing> before committing — pricing changes over time.
- **Setup (owner) — exact values:**
  1. Resend → **Domains** → add the sending domain **`mail.ast9.com`** (use your real
     domain if `ast9.com` isn't yours; adapt the sender below accordingly) → add the
     **exact** DNS records Resend's domain page lists, in your DNS provider:
     - **SPF** (TXT) and **DKIM** records — copy them verbatim from Resend (do not
       hand-write them; the values are account/domain-specific).
     - **DMARC** (recommended): a `_dmarc` TXT record, e.g. `v=DMARC1; p=none; rua=mailto:you@ast9.com`.
     - Wait for Resend to show the domain **Verified**.
  2. Resend → **API Keys** → create a key scoped to sending (or reuse the existing one).
  3. Supabase → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:
     - Host: `smtp.resend.com`
     - Port: `587`
     - Username: `resend`
     - Password: your **Resend API key** (paste the key string — not stored in this repo)
     - Sender name: `AST9`
     - Sender email: `no-reply@mail.ast9.com` (must be an address on the verified domain)
  4. Also set the edge `FROM_EMAIL` secret to `no-reply@mail.ast9.com` so the app's
     Resend emails and Supabase Auth emails share one verified identity.
- **Do NOT** put SMTP credentials or the Resend API key in repo/front-end code — they
  live only in the Supabase dashboard / edge secrets.

Alternatives if preferred: **Postmark** or **Amazon SES** (both have strong
deliverability; compare current pricing on their sites). Any of these works; Resend is
the lowest-friction given the existing integration.

---

## Part C — Auth redirect URLs **[OWNER]**

From `js/auth.js`:
- Signup confirm: `emailRedirectTo = ${origin}${pathname}?login=1`
  → `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/app.html?login=1`
- Password reset: `redirectTo = window.location.href` (the page the user requested the
  reset from — normally `…/AST9_HUB/app.html`).

Set in **Supabase → Authentication → URL Configuration**:
- **Site URL:** `https://abdelrahmansabry1909-oss.github.io/AST9_HUB`
- **Redirect allowlist** (add all):
  - `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/app.html`
  - `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/app.html?login=1`
  - `https://abdelrahmansabry1909-oss.github.io/AST9_HUB/**` (wildcard covers both + future routes)

No app redirect behavior is changed in this phase — the dashboard must match the
code above for email links to resolve.

---

## Part D — Email templates (AST9-branded) **[OWNER to paste]**

Paste into **Supabase → Authentication → Emails**. The **Subject** is a separate field
above the HTML body — set it to the value given per template. Palette matches the existing
`send-email` brand (dark `#0b0d12`, lime `#c8f04a`, teal `#3df5c1`). `{{ .ConfirmationURL }}`
is Supabase's link variable — keep it verbatim, never hardcode a URL. The body uses a
centered max-width container so it reads cleanly on mobile.

### "Confirm signup" (coach verification)

**Subject:** `Confirm your AST9 coach account`

```html
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0b0d12;color:#f0f2f7;padding:40px;border-radius:12px">
  <div style="font-family:monospace;font-size:24px;font-weight:800;color:#c8f04a;margin-bottom:8px">⚡ AST9</div>
  <h1 style="color:#c8f04a;font-size:26px;margin:8px 0 16px">Confirm your email</h1>
  <p style="font-size:16px;line-height:1.6">Welcome to AST9 Elite Coaching. Confirm this address to activate your coach account.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#c8f04a;color:#0b0d12;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;display:inline-block">Confirm email</a>
  </p>
  <p style="font-size:13px;color:#7a8399;line-height:1.6">This link expires in 24 hours and can be used once. If you didn’t create an AST9 account, you can ignore this email.</p>
  <p style="font-size:12px;color:#7a8399;word-break:break-all">Or paste this link into your browser:<br>{{ .ConfirmationURL }}</p>
  <p style="color:#7a8399;font-size:13px;margin-top:28px">— AST9 · NeuCore</p>
</div>
```

### "Reset password"

**Subject:** `Reset your AST9 password`

```html
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0b0d12;color:#f0f2f7;padding:40px;border-radius:12px">
  <div style="font-family:monospace;font-size:24px;font-weight:800;color:#c8f04a;margin-bottom:8px">⚡ AST9</div>
  <h1 style="color:#3df5c1;font-size:26px;margin:8px 0 16px">Reset your password</h1>
  <p style="font-size:16px;line-height:1.6">We received a request to reset your AST9 password. Click below to choose a new one.</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="background:#3df5c1;color:#0b0d12;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px;display:inline-block">Reset password</a>
  </p>
  <p style="font-size:13px;color:#7a8399;line-height:1.6">This link expires in 1 hour and can be used once. If you didn’t request a reset, ignore this email — your password stays unchanged.</p>
  <p style="font-size:12px;color:#7a8399;word-break:break-all">Or paste this link into your browser:<br>{{ .ConfirmationURL }}</p>
  <p style="color:#7a8399;font-size:13px;margin-top:28px">— AST9 · NeuCore</p>
</div>
```

---

## Part G — Leaked-password protection **[OWNER]**

**Supabase → Authentication → Policies (Passwords)** → enable **"Leaked password
protection"** (checks new passwords against HaveIBeenPwned). After enabling, confirm a
normal login still works and a password reset still completes. Optionally raise minimum
password length / required character classes to match the app's own 8-char upper/lower/
number/symbol rule.

---

## Parts E & F — Reset + signup verification end-to-end **[OWNER — needs a real inbox]**

These cannot be completed from here: the built-in mailer rate-limits, GoTrue rejects the
disposable `@ast9.test` domain for public `signUp`, and there is no access to a real
inbox. After Parts B–D are applied, the owner should run, with a **real** address they
control:

**Signup verification (Part F):**
1. App → Sign up as coach (real email) → expect the verify-email screen.
2. Verification email arrives (check spam) → unverified login is blocked beforehand.
3. Click link → app opens → coach is promoted (claim-coach) → Free package, 1 client slot,
   phone + country persisted. (The DB/state half of this was already verified in Phase E
   via a SQL-seeded account; only the real email delivery remains.)
4. Delete the test coach afterward unless keeping it.

**Password reset (Part E):**
1. App → "Forgot password" with the real coach address → reset email arrives.
2. Link opens the app on the recovery session → set a new strong password.
3. New password logs in; old password fails. Role/package unchanged.

Do **not** reset the owner's password unless the owner explicitly approves.

---

## Security verification (re-checked this phase)

- Owner-only admin intact: `admin_count = 1`.
- `create-user`: admin-creation **403**, coach→coach **403**, anon **401** (post-redeploy, unchanged).
- `delete-user`: admin-only (coach **403**), last-admin + self-delete guards intact.
- `send-email`: admin/coach only; coach limited to own clients.
- No secrets committed; no SMTP credentials in repo; no front-end secret exposure.
- CORS allow-list is explicit (no `*` wildcard on headers); origin echo unchanged.

---

## Remaining risks / open owner items

1. **Custom SMTP (Part B)** — until configured, signup/reset email throttles at the
   built-in mailer rate limit. Highest priority before public onboarding.
2. **Real-inbox E2E (Parts E/F)** — signup-verify + reset link flows unproven end-to-end.
3. **Leaked-password protection (Part G)** — currently off.
4. **Redirect/Site URL allowlist (Part C)** — confirm in dashboard or email links break.

## Recommended next phase

**Phase 13 — Public-onboarding hardening:** after the owner applies Parts B–D + G,
re-run the real-inbox signup/reset E2E, then add resend-cooldown UX + clearer
"check your spam" guidance on the verify screen.
