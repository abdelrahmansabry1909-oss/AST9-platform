---
name: ast9-decision-journal
description: "AST9/NeuCore guard that forces the reasoning behind an action to be stated BEFORE the action, and corrected in docs/DECISION_JOURNAL.md after it is proven wrong. Use before any non-trivial change — CSS/layout/spacing passes, deletions, dependency or CDN changes, schema or contract edits — and whenever a claim you published turns out to be false. Triggers: 'why did you do that', 'what is the evidence', 'i cannot see any diff', 'that is wrong', proposing a second or third fix for the same symptom, quoting a CSS value as fact, or reporting a measurement as proof. Encodes eight real misfires: a grep for `supabase/client` that could never match `./client.js` and understated a deletion 1 file to 4; a sidebar quoted as 248px that was really a 64px collapsing rail; padding-bottom reported as dead slack; a card on UA-default margins that survived three clean measurement passes; a 16-character label left wrapping four lines inside a 55px ring; three consecutive fixes that each relocated the same void; a 24px prediction sitting inside its own +/-50px error bar; and `vite preview` returning 200 for files that did not exist. DO NOT USE as a substitute for the domain guards — it governs reasoning, not git mechanics (ast9-agent-boundary-git-guard), deletion safety (ast9-cleanup-archive-guard) or deploy claims (ast9-production-verification-guard)."
---

# AST9 — Decision Journal & Reasoning Guard

Apply **before** any non-trivial action, and **again** whenever a published claim is shown to
be wrong. Parent: [`docs/DECISION_JOURNAL.md`](../../../DECISION_JOURNAL.md), which holds the
protocol and the case log this skill enforces.

This guard governs *reasoning*. The domain guards govern *mechanics*. Both run.

## Why this exists

Eight documented misfires on this project share one shape: **a confident, well-measured claim
resting on the wrong evidence**. Not sloppiness — every one passed the checks that were
actually run. The defect was always in the check nobody thought to run.

Three of them were caught only because the owner sent a screenshot. That is not a
sustainable control.

## Before acting — answer four questions in the response

**1. Why this action?**
Name the trigger: an owner instruction, a measurement, a screenshot, an assumption. If the
trigger is "the owner said the spacing is wrong", say what you think *specifically* is wrong
and how you concluded it.

**2. What is the evidence, and how strong?**
State the method, not the conclusion:

| Strength | Means |
|---|---|
| **Measured** | live DOM, hash, HTTP response, file on disk |
| **Derived** | arithmetic over measurements — carries their compounded error |
| **Read** | inferred from source without executing it |
| **Assumed** | plausible, unverified — say so |

Derived numbers inherit every input's error. State the bar. **Never quote a difference
smaller than your own margin of error.**

**3. Help or harm — identity and platform?**
- *Identity*: new colour, type scale, radius or spacing outside the system? The reskin is
  locked; changes add data and behaviour, not style.
- *Platform*: name the selector scope and the blast radius. If the rule is shared, list what
  else uses it. A dashboard fix must not silently restyle five other screens.

**4. What would prove me wrong, and can I run it?**
If nothing available can falsify the claim, **say so before acting**. That sentence is the
most valuable output of this protocol, and it is the one most often omitted.

## Core invariants

1. **A search returning nothing proves nothing** until you confirm the pattern could have
   matched. For imports, search the basename, not the path.
2. **The first CSS declaration found is not the effective one.** In `css/styles.css` (228KB)
   and `css/neucore-premium.css`, read the *winning* rule — from the browser, or by mapping
   every competing declaration.
3. **Subtract declared padding before calling a gap a defect.**
4. **An outlier over ~20% is a symptom to explain, not a fact to design around.** Check that
   every element in a set matches the selectors styling that set.
5. **After shrinking a container, measure its contents** — line count, and an 11px floor.
   "It fits" and "it is readable" are different claims.
6. **A fix that relocates a symptom is a wrong diagnosis.** Two relocations in a row: stop,
   re-scope, say so.
7. **Probe content-type and body, never status alone.** `vite preview` returns 200 with
   `index.html` for missing paths.
8. **Measurement confirms; it does not discover.** Say which checks you did *not* think to
   run, especially where you cannot see the result.

## Anti-patterns — BLOCK these

- Quoting a CSS value as fact from a single grep hit.
- A derived figure with no error bar, or a difference smaller than that bar.
- "Verified" where the method cannot distinguish success from a fallback.
- Presenting the third fix for one symptom as if it were the first.
- Changing a shared rule to fix one screen without naming the other consumers.
- Reporting a visual change as correct when it was never rendered — say
  **"NOT verified visually"** and what specifically is unchecked.
- Burying a correction in chat instead of fixing the PR body, `docs/` and memory.

## After being wrong — write the entry

Add to `docs/DECISION_JOURNAL.md` §3:

```
### Cn — <the claim, short>

**Claimed:**            verbatim, not softened
**Actually:**           what was true
**Why it misled me:**   the mechanism, not "I made a mistake"
**Corrected thought:**  what the same evidence should have yielded
**Rule:**               the class of future error this catches
```

Then correct the claim **everywhere it was published** — PR body, `docs/`, memory. A
correction that lives only in chat has not been made.

## Required honesty

- Distinguish "I read the code and it looks right" from "I ran it and observed X".
- When you cannot verify, say so **before** acting. Afterwards it is an excuse.
- Name the checks you did not think to run.
- If the owner's premise does not survive measurement, say so plainly and show the numbers —
  do not implement a request you have evidence is wrong without flagging it.

## What this skill does not do

- Replace the domain guards. Git mechanics, deletion safety, auth routing and deploy
  verification each have their own.
- Slow down trivial work. A one-line copy edit does not need four questions.
- Substitute for seeing the result. It makes blindness explicit; it does not cure it.
