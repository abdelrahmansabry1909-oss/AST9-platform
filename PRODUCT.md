# Product

## Register

product

## Users

Three roles share one application shell, differentiated by a role class rather than
separate apps. Designing for one must not break the other two.

**The owner (admin).** Exactly one, permanently — this is enforced in the database,
not a configuration choice. Runs the business: approves coach package payments,
sets prices, manages client subscriptions, reviews the coach business overview.
Uses the platform in short administrative bursts rather than all day.

**Coaches — the primary user.** Rehabilitation professionals in Egypt managing a
roster of clients under a package slot limit. Their working day is: run a subjective
assessment, run an objective assessment (bilateral ROM, scores, gait phase
deficiencies), read the findings, publish a program version, then review what the
client actually did. They are in this interface for hours at a stretch, often with
a client physically in the room. They are domain experts, not casual users, and they
are paying for the tool.

**Clients — rehab patients.** They follow a prescribed program, log workouts and a
daily routine, and watch their own progress over time. Many are recovering from
injury; some have impairments affecting vision or motor control. They are mostly on
phones. Their write access depends on subscription state — but **read access never
does**, by explicit product rule: a lapsed client keeps their full history.

## Product Purpose

AST9 / NeuCore turns rehabilitation assessment into a prescribed, versioned program
and then tracks whether it worked.

The chain the product exists to serve is: **assessment → findings → program →
adherence → reassessment.** Everything else — the exercise library, the community,
appointments, payments — is supporting structure around that loop. The engine is
findings-driven rather than condition-locked, so the interface must present findings
as the thing that drives a program, not as a form that was filled in.

Success is a coach who can complete that loop faster and more precisely than with
paper and video links, and a client who knows exactly what to do today and can see
that they are getting better.

Commercial context: coaches buy capacity packages in EGP via manual InstaPay
transfer, which the owner approves. That flow is a real, load-bearing part of the
product, not an afterthought bolted onto a clinical tool.

## Brand Personality

**Precise. Premium. Assured.**

This should feel like a professional instrument a clinician chose, not an app they
were assigned. Confidence comes from restraint and accuracy — tight alignment, real
data density, type that holds up in a long session — not from ornament.

**Colour direction: emerald-led, with gold as the precious accent, in a royal
register.** Emerald is the primary brand colour; gold marks what is premium or
earned; deeper jewel tones carry the "royal" character. This is a deliberate
correction away from the current dark-and-gold-dominant treatment, in which gold
does most of the identity work and the accent token actually resolves to teal.

Motion is purposeful and quiet. Nothing bounces, celebrates, or congratulates.

## Anti-references

**Not a consumer fitness app.** No gamification, streaks, confetti, badges, trophy
states, or loud gradients. These are real patients in rehabilitation, sometimes in
pain. Cheerfulness about their numbers is a failure of tone.

**Not a hospital EMR.** Not grey, cramped, bureaucratic, or form-first. Clinical
seriousness must not become clinical dreariness — the product should never feel like
paperwork the coach has to survive.

**Not dark-and-gold-dominant.** The current treatment leans on near-black grounds
with gold as the hero. Gold becomes an accent; emerald leads.

## Design Principles

**1. The instrument, not the app.**
The primary user is here for hours with a patient waiting. Legibility, scan speed,
and predictable placement beat novelty every time. If a choice is interesting but
slower to read, it loses.

**2. Findings are the spine.**
The interface should make assessment → finding → program legible as a single causal
chain. A program that appears without visible reasoning behind it undermines the
whole premise of the product.

**3. Read is never punished.**
A client whose subscription lapsed keeps full access to their own history. View-only
must be designed as a legitimate, dignified state — clearly explained, never
presented as breakage, an error, or a locked-out screen.

**4. One shell, three roles.**
Admin, coach, and client share one application shell. Any pattern introduced must
survive all three roles without forking the design, and must not rely on hiding
things in ways that can silently fail.

**5. Premium is earned by restraint.**
Emerald and gold are finite currency. Spend them on what is genuinely primary or
genuinely earned. When everything is precious, nothing is.

## Accessibility & Inclusion

**Target: WCAG 2.2 AA.** 4.5:1 for body text, 3:1 for large text and meaningful UI
boundaries, visible focus on every interactive element, 44px minimum touch targets,
usable at 200% zoom.

Known user needs: rehab patients with impairments affecting vision or fine motor
control; heavy mobile use on the client side; coaches reading dense numeric data for
long periods.

**A measured constraint on the emerald + gold direction.** Contrast computed against
the grounds that already exist in this codebase:

| Colour | on dark `#050b11` | on white `#FFFFFF` |
|---|---|---|
| emerald `#10B981` | 7.79:1 — passes AA text | 2.54:1 — fails everything |
| gold `#D4AF37` | 9.40:1 — passes AA text | 2.10:1 — fails everything |

Both accents work as text on a dark royal ground and neither works on a light one.
Wherever a light surface is used, emerald must darken to **`#047857` (5.48:1)** or
beyond for text; gold must be treated as decoration only and never carry meaning
alone. This is the single biggest constraint on the palette and should be settled in
DESIGN.md before any component work begins.

Two structural issues already in the codebase that affect accessibility work:

- The same token names are defined with conflicting values across stylesheets
  (`--bg-base` is both `#050b11` and `#f9f9fc`), so "the background colour" is not
  currently a single answer.
- The platform does not load its own webfont, so every screen behind the login
  renders in the OS fallback rather than the intended typeface.

Not currently supported, and out of scope unless it changes: Arabic or any RTL
locale. The product is English-only today despite an Egyptian user base.
