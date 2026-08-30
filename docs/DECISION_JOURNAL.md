# AST9 — Decision Journal

> Every non-trivial action gets its reasoning written down **before** it is taken, and
> corrected **after** it is proven wrong. The point is not ceremony. The point is that
> this project keeps producing a specific failure — a confident, well-measured claim
> that turns out to rest on the wrong evidence — and the only reliable defence found so
> far is writing the reasoning down where it can be checked.
>
> Enforced by the `ast9-decision-journal` skill.

---

## 1. The protocol — before acting

Four questions. Answer them in the response, not silently.

**1. Why this action?**
What problem is it solving, and what made me believe that is the problem? Name the
trigger: an owner instruction, a measurement, a screenshot, an assumption.

**2. What is the evidence, and how strong is it?**
State the *method*, not just the conclusion. Distinguish:

| Strength | Looks like |
|---|---|
| **Measured** | read from the live DOM, a hash, an HTTP response, a file on disk |
| **Derived** | arithmetic over measurements — carries the compounded error of all of them |
| **Read** | inferred from source code without executing it |
| **Assumed** | plausible, unverified — say so plainly |

If a number is derived, state the error bar. A prediction inside its own margin of
error is not a prediction.

**3. Does it help or harm the identity and the platform?**
Identity: does it introduce colour, type, radius or spacing outside the established
system? Platform: what is the blast radius — one component, one screen, or every
screen? Name the selector scope. If the change touches a shared rule, say what else
uses it.

**4. What would prove me wrong, and can I run that check?**
If the answer is "nothing I can run", say so **before** acting, not in the report
afterwards. That sentence is the most valuable output of this protocol.

## 2. The protocol — after being wrong

When a claim fails, add an entry to §3 with:

- **What I claimed** — verbatim, not softened
- **What was actually true**
- **Why the evidence misled me** — the mechanism, not "I made a mistake"
- **The corrected thought** — what I should have concluded from the same evidence
- **The generalisable rule** — what class of future error this catches

Correct the claim wherever it was published: the PR body, `docs/`, memory. A
correction that lives only in chat has not been made.

---

## 3. Case log

### C1 — "Nothing imports `client.js`"

**Claimed:** `src/neucore/supabase/client.js` was dead code imported by nothing, safe to
delete on its own.

**Actually:** three sibling modules imported it via `import { supabase } from './client.js'`.

**Why the evidence misled me:** I grepped for `supabase/client`. That pattern cannot match
a *relative* import. The search returned nothing and I read absence of results as absence
of importers.

**Corrected thought:** the conclusion (the subtree is dead) happened to hold, but for a
different reason — the three siblings were themselves unimported. Deleting only the named
file would have left three dangling imports.

**Rule:** a grep that returns nothing proves nothing until you have confirmed the pattern
*could* have matched. For imports, search the module's own basename, not its path.

### C2 — "Our sidebar is a different pattern from FITXPERT's"

**Claimed:** FITXPERT uses a ~132px icon rail; ours is a 248px labelled sidebar, so
"match their spacing" means rebuilding the navigation, not adjusting numbers.

**Actually:** `--sidebar-w-collapsed: 64px`, expanding to 260px on hover, with
`.nav-item-icon` at 28px. It is a collapsing icon rail — the same pattern, and *tighter*
than theirs per icon.

**Why the evidence misled me:** I read `--sidebar-w: 248px` at the top of the file and
stopped. The effective value lives in a `@media (min-width: 901px)` block 2600 lines
later, and `:root { --sidebar-w: 0px }` overrides the base token anyway.

**Corrected thought:** in a 228KB stylesheet, the first declaration found is evidence of
nothing. Read the *winning* rule.

**Rule:** before quoting a CSS value as fact, either read it from the browser or map every
competing declaration. See C7.

### C3 — "25px of dead slack below the button"

**Claimed:** the workspace cards had 25px of unused space under the CTA, caused by
`flex: 1` failing against `aspect-ratio`.

**Actually:** it was `padding-bottom: 24px` doing exactly its job.

**Why the evidence misled me:** I measured `innerBottom - buttonBottom` and interpreted the
gap as slack without checking whether a padding declaration accounted for it.

**Rule:** before calling a measured gap a defect, subtract the declared padding. Name the
property you expect it to be, and check.

### C4 — The `.ws--dark` type scale

**Claimed:** across three separate passes, that the workspace cards were measured, balanced
and correct.

**Actually:** the Athletic card carried `class="ws--dark"` with **no `.ws` class**, so
`.ws h3` and `.ws .sub` never matched it. It was rendering at UA defaults — 18.72px type
with 18.72px margins top *and* bottom — roughly 69px of stray margin no sibling had. It was
the row-height driver the entire time.

**Why the evidence misled me:** every measurement was internally consistent. A card 169px
taller than its siblings reads as "`align-items: stretch` is working", not "this card is on
browser defaults". Geometry checks confirm what you thought to ask; they cannot flag a value
you never questioned.

**Corrected thought:** an outlier that large is a *symptom to explain*, not a fact to design
around. I should have asked why one card needed 169px more before compensating for it.

**Rule:** when one element in a set differs by more than ~20%, find the cause before
adjusting anything. Check that every element in a set actually matches the selectors
styling that set.

### C5 — The Client Portal dial

**Claimed:** shrinking the progress ring 130px → 66px was a clean density win.

**Actually:** "Session Progress" — 16 characters — stayed inside a 54.8px hole at 8.5px and
wrapped onto roughly four lines. "78%" had 3.5px of clearance.

**Why the evidence misled me:** I measured that the ring shrank. I never measured whether
its *contents* still fit. Nothing in the numbers said "unreadable", because I did not ask
for line counts or a legibility floor.

**Rule:** when shrinking a container, measure the contents afterwards — line count, and a
minimum font size (11px). "It fits" and "it is readable" are different assertions.

### C6 — The dashboard void, three times

**Claimed:** three separate fixes, each presented as *the* fix.

**Actually:** #222 moved the void from inside the welcome card to below it. #223 capped the
client list. Moving Recent Activity into the rail inverted the imbalance from right to left.
Each relocated the surplus.

**Why the evidence misled me:** each change was locally correct. None addressed the actual
condition — the content does not fill a 1.7fr/1fr grid evenly, and shuffling panels between
columns cannot change that.

**Corrected thought:** the third iteration of the same symptom is the signal. Stop fixing
and re-derive the problem.

**Rule:** if a fix relocates a symptom rather than removing it, the diagnosis is wrong. Two
relocations in a row means stop and re-scope.

### C7 — "976 vs 952 — a 24px difference"

**Claimed:** swapping two panels would balance the columns to within 24px.

**Actually:** every input was a y-coordinate read off a screenshot by eye at 125% display
scaling — ±4–8 CSS px each. Six of them compounded gives ±25–50px. **The prediction sat
inside its own error bar.**

**Rule:** derived numbers inherit the error of every input. State the error bar, and never
quote a difference smaller than it. "Roughly level" was defensible; "24px" was not.

### C8 — `vite preview` reported 200 for files that did not exist

**Claimed:** the legal-page CSS fix was verified — all paths returned 200.

**Actually:** `vite preview` has SPA fallback and serves `index.html` for any missing path.
`/css/landing.css` returned `200` with `content-type: text/html`.

**Why the evidence misled me:** I probed `%{http_code}` alone. A status code cannot
distinguish a served file from a fallback page.

**Rule:** probe content-type and the first bytes of the body, never status alone. For build
output use a dumb static server with no fallback.

---

## 4. Patterns

Reading §3 together, the failures are not random:

**Measurement confirms; it does not discover.** C4, C5 and C7 all passed every check that
was run. The defect was in the check that was never thought of. Owner screenshots caught
all three.

**Absence of evidence gets read as evidence of absence.** C1 and C2 are the same error: a
search or a read returned nothing, and "nothing" was treated as an answer rather than as a
failed instrument.

**The cascade is the hazard, not the value.** C2, C4 and the boot splash all turned on
*which* of several competing declarations won. In `css/styles.css` (228KB) and
`css/neucore-premium.css`, the first rule found is close to meaningless.

**Blind visual work has a ceiling.** The dashboard renders only for a signed-in user. Every
measurement of it returns `0`. No amount of care substitutes for seeing it — and that must
be said before acting, not after.

---

## 5. Related

- `AI_WORKFLOW_GUARDRAILS.md` — the parent contract
- `docs/claude-skills/ast9-skill-pack/` — the enforcing guards
- `docs/ISSUE_LOG.md` — defects with root cause; this file is about *reasoning*, not defects
- `docs/KNOWN_LIMITATIONS.md` — L1 / L14 / L23, the authenticated-smoke gap behind §4
