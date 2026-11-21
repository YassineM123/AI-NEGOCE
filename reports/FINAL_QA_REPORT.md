# AI-NEGOCE Intelligence Suite — Final QA Report

Date: 15 October 2026 · Environment: local workstation (Windows 11, Node 24, Chrome) · Verdict: **NOT READY FOR PRODUCTION**

## 1. Executive summary

This QA cycle tested the application with a deterministic synthetic dataset (10,000 sales documents, 30,000 stock movements), independent oracles, real fixture files and a local OIDC issuer. All tests were first executed against the unmodified code. Confirmed bugs were then fixed and everything was re-run.

| | Initial run (original code) | Final run |
|---|---:|---:|
| API / BI / Copilot / OCR / security tests (Vitest) | 96 / 229 passed | **273 / 273 passed** |
| Browser E2E, desktop + mobile (Playwright) | 18 / 30 passed | **30 / 30 passed** |
| BI KPI comparisons vs. independent oracle | 99 of 112 wrong | **0 of 112 wrong** |
| Copilot benchmark (107 questions) | 27 (25 %) | 107 (100 %) |
| Copilot held-out paraphrases (not tuned) | — | **11 / 15 (≈ 73 %)** |
| Invoice anomaly detection (15 cases) | 0 (no validation existed) | 15 / 15, 0 false positives |

**31 bugs were confirmed:** 1 critical, 9 high, 13 medium, 8 low. **28 are fixed and covered by regression tests. 3 remain open:**
- BUG-024 (HIGH): the frontend has no authentication flow
- BUG-023 (MEDIUM): static demo figures still appear in the UI
- BUG-016 (MEDIUM): the keyword Copilot generalises poorly

The most serious defect found: **any correctly signed token without an agency claim received company-wide financial data** (BUG-001, critical, now fixed).

The verdict is **not ready** because the critical integrations could not be verified at all. There is no real ERP, no OCR engine, no LLM, no PostgreSQL and no identity provider in this environment, and there is no frontend login.

## 2. Application overview

A React 19 single-page app on an Express 5 API. Modules:
- **Smart OCR:** upload → extraction → review → approval
- **BI 360:** KPIs by agency and period
- **AI Copilot:** governed Q&A over the BI tools

Supporting pieces: OIDC JWT authentication with role and agency scope; a PostgreSQL or in-memory store; OCR and ERP adapters (disabled or unconfigured by default). Full inventory in `DATA_AUDIT.md`.

## 3. Testing environment

- **Platform:** Windows 11, Node v24.14.0, Python 3.12.10, Chrome through Playwright 1.56.1, Vitest/Supertest.
- **Isolation:** every test ran against local in-process or ephemeral servers. E2E used its own API and Vite ports.
- **Not available:** PostgreSQL (Docker engine stopped), OCR engine, LLM, ERP, real identity provider.
- **Since the 15 Oct run:** the E2E stack now boots against a throwaway copy of the seeded ERP database (`var/ai-negoce.db`) whose `as_of` is pinned to the dataset manifest; the screens therefore display the 10,000-document synthetic dataset instead of the 6-row fixture, and every BI/Copilot assertion in `tests/e2e/app.spec.ts` was re-derived from that dataset. The monetary KPI cards were also switched to millime precision. See §16.
- **Concurrent external activity (15 Oct):** another tool or person modified `server/services.ts`, `src/App.tsx`, `src/index.css`, added `vitest.config.ts` and rebuilt `dist/` between 12:54 and 12:55, then ran the E2E suite (12:56–12:59). Effects are noted where relevant (§9, §16). With your agreement, QA continued, re-reading files before each edit.

## 4. Dataset description

`DATASET_MANIFEST.md` has the counts, data dictionary and scenario assumptions. In summary:
- 5 agencies, 25 representatives, 100 suppliers, 500 customers, 2,000 products
- 1,500 purchase orders, 3,000 supplier invoices
- 10,000 sales documents: 208 cancelled, 300 credit notes, with partial and split payments
- 8,392 payments, 30,000 stock movements
- TND with millime precision; VAT 0/7/13/19 % and a 1.000 TND stamp **as test assumptions only**
- Byte-identical across runs (seed 20261015)
- **Real ERP export: blocked** (no read API or credentials). The export tool refuses instead of faking data.

## 5. Test methodology

1. Inventory the code and data sources.
2. Write probes that assert *correct* behaviour.
3. Execute everything on the original code. Failures are the confirmed bugs.
4. Fix each bug with the smallest reliable change and keep its test as a regression test.
5. Re-run all suites.

Independence and anti-self-deception measures:
- BI and data-quality ground truth computed in Python `Decimal` from raw CSVs, with no shared code.
- The data validator was mutation-tested: 13/13 injected defects detected.
- Copilot: a held-out paraphrase set run once.
- Assertions were never weakened. Three test expectations were *corrected*, each explained in §16.

## 6. Test coverage

| Area | Suites (files) | Count |
|---|---|---:|
| Defect probes and regressions | `tests/qa/defects.test.ts` | 18 |
| BI vs. oracle, properties, anomalies | `bi-validation`, `bi-anomalies` | 27 |
| Copilot benchmark and held-out | `copilot-benchmark`, `copilot-holdout` | 143 |
| Smart OCR pipeline and invoice rules | `ocr-pipeline`, `invoice-validation` | 43 |
| Security | `security.test.ts` | 22 |
| Original suites | `server/*.test.ts` | 12 |
| E2E journeys, desktop + mobile | `tests/e2e/app.spec.ts` | 30 |
| Data quality | `tools/qa/data_quality.py` (87 checks, 698,834 evaluations) + mutation test | — |
| Performance | `tools/qa/perf.ts` (5 endpoints × 3 load levels) | — |

## 7. Smart OCR results

See `OCR_TEST_REPORT.md`.
- **OCR accuracy: not measured.** No engine exists, so no accuracy figure is claimed.
- Upload validation, storage and non-fabrication pass on 15 real image/PDF fixtures and 7 hostile files.
- **Fixed:**
  - approval of incomplete or inconsistent extractions (BUG-008)
  - orphan records after OCR failure (BUG-009)
  - duplicate uploads (BUG-010)
  - foreign-agency upload status (BUG-011)
  - repeated approval (BUG-012)
- **Missing:** human correction endpoint, retry queue, ERP submission on approval.

## 8. BI 360 results

See `BI_VALIDATION_REPORT.md`. On 14 scenarios, the original code was wrong in 99 of 112 comparisons:
- cancelled invoices counted (+1,151,370.115 TND)
- date filters ignored
- receivables ignored partial payments and VAT
- multi-agency scope leaked

Final: **all 112 comparisons exact to the millime**. All 9 requested properties hold, and the anomaly fixtures pass 10/10.

Customer and product rankings merged homonyms (BUG-031). This was found late because the oracle shared the same assumption, and is now fixed. Dormant stock and trends are not exposed by the API.

## 9. AI Copilot results

See `COPILOT_EVALUATION.md`. There is **no LLM**, so the deterministic router was evaluated and **LLM evaluation is blocked**.

- **Benchmark:** 27/107 initially, 107/107 finally.
- **Honest generalisation estimate:** 11/15 on a held-out set run once.
- **Authorization was never violated:** 106/106 benchmark and 35/35 held-out answers.
- **The risk fixed:** confidently wrong figures for off-topic or misunderstood questions (BUG-006, BUG-014).
- The four held-out v2 failures were later patched by the external edit, so they no longer measure generalisation. BUG-016 stays open.

## 10. ERP integration results

**Blocked.** No ERP API specification, sandbox or credentials exist.
- `server/erp.ts` declares only `createSupplierInvoice`, and **no code path calls it**.
- No ERP read adapter exists, so BI and Copilot run on a fixture.
- In production mode, BI and Copilot return 503 by design (verified by configuration tests).

No ERP record was read or written.

## 11. Database integrity

- **Synthetic dataset:** 87 checks across primary keys, foreign keys, required values, types, dates, invoice arithmetic, PO linkage, credit notes, payments vs. receivables, stock movements and agency consistency. 0 failures. The validator was proven sensitive by the mutation test (13/13). See `DATA_QUALITY_REPORT.md`.
- **Application PostgreSQL schema:** not executed (no database). Migrations, constraints, backup and restore remain unverified.

## 12. Security findings

See `SECURITY_AUDIT.md`.
- **Critical BUG-001 and high BUG-002** (agency-scope fail-open) are fixed.
- **Verified:** OIDC signature, issuer, audience and expiry; `alg=none` and role checks; RBAC; cross-agency and cross-user isolation; upload validation; path traversal; SQL injection and XSS handling; CORS; headers; error leakage; rate limiting; prompt injection.
- **Open:**
  - no frontend authentication (BUG-024)
  - polyglot PDF accepted (needs antivirus)
  - public `readyz` reveals dependency state

## 13. Performance metrics

See `PERFORMANCE_REPORT.md`. Single process, 17k fact lines, 0 % errors at every level.

| Endpoint | p95 at concurrency 1 | p95 at concurrency 16 | Peak throughput |
|---|---:|---:|---:|
| BI company | 15.7 ms | 109.5 ms | 187 req/s |
| Copilot comparison | 27.2 ms | 294.9 ms | 62 req/s |
| Upload | 7.1 ms | 52.9 ms | 376 req/s |

Every request rescans the full dataset, which won't scale to real ERP volumes. OCR, LLM and database latency could not be measured.

## 14. Complete bug register

Full details, with reproduction, root cause, fix and regression test, are in `BUG_REGISTER.csv`.

| ID | Sev. | Title | Status |
|---|---|---|---|
| BUG-001 | CRITICAL | Token without agencies claim gets company-wide data | Fixed |
| BUG-002 | HIGH | Multi-agency user sees all agencies | Fixed |
| BUG-003 | HIGH | BI date filters ignored | Fixed |
| BUG-004 | MEDIUM | Malformed or oversized JSON → 500 | Fixed |
| BUG-005 | MEDIUM | Payment questions refused as HR | Fixed |
| BUG-006 | HIGH | Off-topic questions answered with the margin figure | Fixed |
| BUG-007 | MEDIUM | Agency named in the question ignored | Fixed |
| BUG-008 | HIGH | Approval of incomplete or inconsistent extractions | Fixed |
| BUG-009 | MEDIUM | OCR failure leaves an orphan record | Fixed |
| BUG-010 | MEDIUM | Duplicate upload not detected | Fixed |
| BUG-011 | LOW | Foreign-agency upload → 400 instead of 403 | Fixed |
| BUG-012 | LOW | Repeated approval | Fixed |
| BUG-013 | LOW | HTML 404 on the API | Fixed |
| BUG-014 | HIGH | Unresolved entity answered company-wide | Fixed |
| BUG-015 | MEDIUM | Receivables paraphrases misrouted | Fixed |
| BUG-016 | MEDIUM | Router generalisation (held-out 11/15) | **Open** |
| BUG-017 | HIGH | Hardcoded figures under every Copilot answer | Fixed (external edit, verified by QA) |
| BUG-018 | MEDIUM | BI period selector not wired | Fixed |
| BUG-019 | LOW | Duplicate React keys | Fixed |
| BUG-020 | MEDIUM | Hardcoded dormant KPI and deltas | Fixed |
| BUG-021 | LOW | Export button inert | Fixed |
| BUG-022 | MEDIUM | No mobile layout | Fixed |
| BUG-023 | MEDIUM | Static demo panels with business figures | **Open** |
| BUG-024 | HIGH | No frontend authentication | **Open (blocked)** |
| BUG-025 | HIGH | Cancelled invoices counted | Fixed |
| BUG-026 | HIGH | Receivables ignore partial payments, credit notes and VAT | Fixed |
| BUG-027 | MEDIUM | Missing cost forced to 0 | Fixed |
| BUG-028 | LOW | Margin % 0 on zero revenue | Fixed |
| BUG-029 | LOW | Floating-point money | Fixed |
| BUG-030 | LOW | Record count = lines | Fixed |
| BUG-031 | MEDIUM | Homonymous customers and products merged | Fixed |
| BUG-032 | LOW | BI money rounded to whole dinars | Fixed |
| BUG-033 | MEDIUM | E2E suite not reproducible outside one day/checkout | Fixed |
| BUG-034 | MEDIUM | Smart OCR history was a static placeholder; approve modal showed fabricated ERP values | Fixed |

## 15. Fixes applied

| File | Changes |
|---|---|
| `server/auth.ts` | `scopedAgencies()`: fail-closed, explicit agency list |
| `server/services.ts` | Integer-millime aggregation; status and credit notes; nullable cost; receivables and overdue; date filters; grouping by ID; Copilot router (accent-safe HR guard, out-of-domain refusals, agency resolution with denial, entity guard, receivables / inventory-value / comparison tools, follow-up context, scope statement in answers) |
| `server/app.ts` | Validated filters; Copilot conversation context; duplicate detection; OCR failure handling; approval gate (state + complete extraction + invoice rules); UUID validation; HTTP error mapping; JSON 404; configurable rate limit |
| `server/invoice-validation.ts` | New: invoice rules |
| `server/store.ts` | Extraction persistence; hash lookup (memory and PostgreSQL) |
| `server/data.ts` | Fact and receivable model |
| `src/App.tsx`, `src/api.ts` | BI period wiring; CSV export; no fabricated KPIs or deltas; key fix |
| `src/index.css` | Responsive layout ≤ 900 px; the desktop design is unchanged |
| `playwright.config.ts`, `tests/e2e/support/erp-db.ts`, `tests/e2e/app.spec.ts` | 19 Oct: E2E runs on a pinned copy of the seeded ERP database; BI/Copilot expectations recomputed from the oracle |

## 16. Regression testing

**After the fixes, every suite was re-run:** 273/273 Vitest, 30/30 E2E, typecheck 0 errors, build OK, `npm audit` 0 vulnerabilities. One regression *introduced by a fix* was caught and corrected: "valeur **du** stock" was misrouted by a new receivables pattern.

**Later hardening pass (19 Oct, realigned to the seeded dataset):**
- The E2E journeys now run against the seeded ERP database copied to `var/e2e-ai-negoce.db` with `as_of` pinned to `2026-06-30` (`tests/e2e/support/erp-db.ts`, wired as the first `webServer` in `playwright.config.ts`). The copy is taken from the developer's database after a WAL checkpoint, so `var/ai-negoce.db` is never mutated and no stale WAL is carried over.
- The three BI E2E expectations and the Copilot KPI assertion were recomputed from the oracle for the seeded dataset: June 2026 **2 910 303.283** (568 documents), French-quarter Q2 **8 592 388.531** (1 636 documents), all dates **52 752 842.587** (9 792 documents), Sfax all dates **13 189 479.802**; Copilot answer "Chiffre d'affaires HT : 52 752 842.587 TND".
- **Fix:** the BI KPI cards rounded money to whole dinars (`fmtInt`), so the €-level millime contract was invisible on screen and the exported CSV did not match the displayed value. `dt()` now formats the full 3-decimal amount; the period selector and export now agree with the API.
- **Fix (BUG-034):** the Smart OCR history tab returned a static placeholder and the approve modal always named a fabricated supplier, amount and ERP reference (`FA-2502-0196`). A new agency-scoped `GET /api/v1/documents` (backed by the store, in both memory and PostgreSQL implementations) lists real imports; the tab renders them and can reopen any document, and the modal now states the uploaded file instead of invented figures. Covered by a server scope test and a browser journey.

Test expectations that were **corrected** (never weakened):
- **`server/app.test.ts`:** an original test re-uploaded identical bytes. Duplicates are now rejected by design, so the test uses distinct bytes.
- **E2E BI:** the earlier fixture-level "01 jan. — 28 fév. 2025" expectation (46,121.512 TND) has been superseded: the journeys were re-derived from the seeded dataset (§ above). A "Mois en cours" *and* a "Toutes les dates" assertion are now both present, so a silently unwired period selector still fails the suite.
- **Copilot grader:**
  - empty results are no longer required to cite sources
  - authorization and scope were split into two criteria
  - V14 was made *stricter* after manual review

**Evidence integrity:** one initial evidence file was accidentally overwritten during post-fix work. The initial phase was re-executed on a reconstruction of the original sources. All 229 per-test outcomes matched the first run exactly (`reports/evidence/11_initial_rerun_note.log`).

**Tests that could not run:**
- ERP read/write, OCR accuracy, LLM
- PostgreSQL store and migrations, backup and restore
- login and session-expiry journeys
- real identity provider

## 17. Remaining risks

1. **Real ERP data has never touched this code.** KPI definitions are QA assumptions awaiting business sign-off.
2. **No authentication in the frontend** (BUG-024); the API cannot be used by real users yet.
3. **No OCR engine:** extraction quality is unknown. There is no correction UI, no retry queue and no ERP submission.
4. **The keyword Copilot misunderstands about 1 in 4 unseen phrasings.** Each answer now states its scope, but answers can still be wrong.
5. **Static demo figures** remain in the dashboard, parts of BI 360 and the management modules (BUG-023).
6. **PostgreSQL path unexecuted.** Uploads have no antivirus check (polyglot files accepted).
7. **Performance:** full scans per request will not scale to real ERP volumes.
8. **Another tool edits this repository concurrently.** Its changes were not reviewed as part of a formal change process.

## 18. Production readiness assessment

| Requirement | State |
|---|---|
| Real ERP integration (read + write) | Not implemented / blocked |
| Authentication end-to-end | Backend verified with a test issuer; frontend missing |
| OCR extraction | Not available |
| Generative Copilot | Not available (deterministic router only) |
| Database, backups, migrations | Not verified |
| BI correctness (on synthetic data) | Verified, exact |
| Access control (API) | Verified after critical fix |
| Data quality tooling and datasets | Delivered, reproducible |

## 19. Final verdict

**NOT READY FOR PRODUCTION.**

The API's security boundary and BI arithmetic are now verified on synthetic data, and the critical access-control hole is closed. But every production-critical integration (ERP, identity provider and frontend login, OCR, database) is unverified or absent, and a HIGH-severity defect remains open. Re-assess after:
1. ERP and identity-provider staging access
2. an OCR provider with an accuracy run on the provided fixtures
3. PostgreSQL verification
4. closure of BUG-023 and BUG-024
