# Business & Scalability Systems (Bonus — TIER 7)

> **Note:** This file was extracted from the master rehab-book content but isn't in the workflow's expected file list. It's saved here because the patient-retention math + Head Physio framework directly informs how the RPM module should think about coach KPIs and platform-wide quality metrics.

## Question 7.1 — The Head Physio Framework

### Systemising Assessments

Consistent standards are achieved by having all therapists use the **8-Pillar clinical system**. This provides a "common treatment language" and ensures that the **system is the saviour, not the individual therapist**.

### Quality Control

The Head Physio monitors a **dashboard of metrics** rather than just "gut feelings". Notes and progress are reviewed against the **4 Value Variables**:

1. Dream Outcome
2. Perceived Likelihood of Achievement
3. Time Delay
4. Effort / Sacrifice

### Ensuring Consistent Outcomes

By measuring **IA Rebook %** and **Patient Visit Average (PVA)**, the Head Physio can identify exactly where a therapist is struggling — whether it's:

- Pillar 3 (Explanation / Buy-in)
- Pillar 7 (Bridging the Gap)

### Delegation & Onboarding

Capturing clinical systems allows new hires to be onboarded quickly. This ensures that whether a patient sees the owner or an associate, they receive the same high standard of care, protecting the clinic's reputation.

---

## Question 7.2 — The Patient Retention Math

### 3 Ways to Grow a Practice (Jay Abraham Model)

1. Find more new patients
2. Keep patients progressing and ethically increase the **Patient Visit Average (PVA)**
3. Get past patients to return for new problems or other services

### Increasing PVA

The sources demonstrate that **increasing PVA by just 2 to 3 sessions** (e.g., from 5 sessions to 8 sessions) can increase revenue by **60% or more** without spending a penny on marketing for new patients.

| Scenario | Patients | Sessions | Price | Revenue |
|---|---|---|---|---|
| Low retention | 100 | 5 | £50 | £25,000 |
| High retention | 100 | 8 | £50 | £40,000 |

**Same patients. Same price. +60% revenue.**

### Cost of Drop-off vs. Retention

A clinic built on high volume but low retention (the "McDonald's model") requires constant "firefighting" to find new leads. A sustainable practice is built on the **number of patients you don't lose**.

### Sustainable Scaling

Growth is achieved by solving the "root cause" of business problems — usually a therapist's inability to keep patients progressing past **session 3 or 4** when pain eases. Fixing this "leak" allows the owner to step away from the daily grind and focus on leadership.

---

## Implications for NeuCore RPM

### Coach KPIs to Surface

Based on the Head Physio framework, the platform should expose for each coach:

1. **IA Rebook %** — what % of initial-assessment patients book a follow-up
2. **PVA (Patient Visit Average)** — average sessions per patient before discharge / drop-off
3. **Phase Progression Rate** — how fast patients move up the graded exposure ladder
4. **Drop-off Heat-map** — which session number / which pillar most commonly loses patients

### Platform-wide Quality Signals

- Aggregate dream outcomes across all patients → most common ones inform service design
- Aggregate which pillar a patient was on when they dropped off → product team focuses fixes there

### ML Feedback Loop Tie-in

This is why **Phase 4's ML feedback capture matters** — if 30% of coaches override the AI's "Stage 3 → Stage 4" suggestion, the AI is mis-calibrated for that transition. The data stack literally encodes the Head Physio framework into automation.
