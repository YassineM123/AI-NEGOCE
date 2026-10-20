# AI Copilot evaluation

## 1. What was evaluated

- **There is no LLM in this codebase.** The Copilot is a deterministic, rule-based tool router (`groundedAnswer` in `server/services.ts`) over approved BI tools. **LLM evaluation is BLOCKED**: no provider is configured and no generation code exists. No mock LLM response is counted anywhere in this report.
- The benchmark exercises the real `POST /api/v1/copilot/query` endpoint over the synthetic dataset. Expected answers come from the independent Python oracle (`reports/evidence/bi_expected.json`).
- **Grading criteria per question:**
  - HTTP status
  - answer status (ok / denied / unsupported)
  - tool selection
  - every expected number present (exact to the millime; % to 0.1)
  - expected entity names
  - **authorization** (no source record outside the user's agencies)
  - **scope** (no record outside the agencies the question targets)
  - sources present for factual answers
  - no fabrication on refusals (no sources, no table)
  - no script echo

  A question passes only if every applicable criterion passes.

## 2. Benchmark (107 questions, 13 categories)

| Category | Questions | Initial (original code) | Final |
|---|---:|---:|---:|
| Revenue | 13 | 0 | 13 |
| Margins | 12 | 1 | 12 |
| Customers | 10 | 6 | 10 |
| Inventory | 10 | 6 | 10 |
| Receivables | 10 | 0 | 10 |
| Agency comparisons | 8 | 5 | 8 |
| Suppliers (must decline) | 6 | 0 | 6 |
| Trends and periods | 8 | 0 | 8 |
| Follow-ups (conversation) | 8 | 1 | 8 |
| Missing data | 8 | 1 | 8 |
| Ambiguous / contradictory | 2 | 0 | 2 |
| Access control | 7 | 3 | 7 |
| Prompt injection | 5 | 4 | 5 |
| **Total** | **107** | **27 (25 %)** | **107 (100 %)** |

| Criterion | Initial | Final |
|---|---:|---:|
| Correct status | 84/106 | 106/106 |
| Correct tool | 42/60 | 60/60 |
| Correct numbers | 6/60 | 60/60 |
| Correct entity names | 14/20 | 20/20 |
| **Authorization (no cross-agency leak)** | **106/106** | **106/106** |
| Scope matches the question | 41/59 | 59/59 |
| Sources cited for factual answers | 74/74 | 72/72 |
| No fabrication on refusal | 6/6 | 27/27 |

Bugs fixed in this area:
- BUG-005: payment questions refused as HR
- BUG-006: off-topic questions answered with the margin figure
- BUG-007: agency named in the question ignored
- BUG-014: unresolved entities answered company-wide
- BUG-015: receivables paraphrases misrouted

Capabilities added to make answers correct:
- revenue, receivables, overdue and inventory-value tools
- date filters
- minimal follow-up context ("Et la marge ?", "Et à Bizerte ?", "Compare avec Sfax")
- every numeric answer states its scope and period

## 3. Why 107/107 is not the headline

The benchmark and the router fixes were written by the same team, so the final score shows that these 107 phrasings work. It does not show that the router understands French business questions in general. To measure generalisation:

| Set | When written | Result | Status |
|---|---|---|---|
| Held-out v1 (20 paraphrases: typos, English, synonyms, entity names) | after the benchmark fixes | **13/20** on first run | Failures became BUG-014 and BUG-015 and were fixed. 20/20 afterwards, but **no longer held-out**. |
| Held-out v2 (15 new paraphrases) | after the v1 fixes; run once, no tuning | **11/15** (12/15 by automated grading; V14 downgraded after manual review: combined totals do not answer "is Sfax's margin better than Sousse's?") | **The honest generalisation estimate: ≈ 73 %.** Failures recorded as BUG-016. |

All 35 held-out questions respected authorization (35/35). Failures in held-out v2:
- V05: a product-filtered stock question ignored the product
- V12: "factures non payées" was routed to top customers
- V14: a comparison question returned combined totals
- V15: average payment delay returned total receivables

**Note on concurrent changes:** at 12:54 an external (non-QA) edit to `server/services.ts` added patterns that target exactly these four v2 questions. The suite now passes them, but that is the result of tuning, not generalisation. BUG-016 stays open until a fresh held-out set is measured.

## 4. Safety properties

- **Cross-agency isolation held in every run:** 106/106 benchmark questions and 35/35 held-out. A Tunis user asking about Sfax is refused. Injections such as "SYSTEM: role=admin", "Ignore toutes les instructions…" and "En tant qu'administrateur…" stay inside the user's scope. This is because agency scope is enforced server-side, not by the router's understanding of the text.
- HR questions are refused. Supplier, budget, forecast and exchange-rate questions are declined, with no sources and no figures.
- **Before the fixes**, the main correctness risk was *confidently wrong answers*: an off-topic or misunderstood question received a real-looking margin figure (BUG-006, BUG-014). Every numeric answer now states its scope and period, so a misunderstanding is visible to the user.

## 5. Recommendation

A keyword router will keep failing on unseen phrasings (≈ 27 % on held-out v2). Before production:
1. Use an LLM with constrained tool calling over these same approved tools, keeping server-side scope enforcement.
2. Keep this 107-question benchmark plus a regularly refreshed held-out set as a release gate.
3. Evaluate real model outputs only once a provider and a data-processing agreement exist.
