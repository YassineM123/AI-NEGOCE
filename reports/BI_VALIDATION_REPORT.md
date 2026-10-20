# BI 360 validation report

## 1. Method

- **Ground truth:** `tools/qa/bi_oracle.py`, an independent Python `Decimal` calculation from the raw synthetic CSV files (10,000 documents, 17,127 lines). It shares no code with `server/services.ts`.
- **System under test:** the real `GET /api/v1/bi/overview` endpoint, called over HTTP (Supertest) with the synthetic dataset loaded through the application's data module (`tests/qa/bi-validation.test.ts`). Multi-agency scopes use a real signed OIDC token from a local JWKS issuer.
- **Comparison:** monetary values must match **exactly to the millime**. Margin % must be within 0.001 point, and must be `null` when undefined. Every discrepancy is logged to `reports/evidence/bi_validation_<phase>.json`.
- **KPI definitions:** these are QA assumptions pending business validation.
  - Revenue = HT of posted invoices − HT of posted credit notes; cancelled documents excluded.
  - Cost = standard line cost, reversed for credit-note lines.
  - Margin % = margin / revenue, `null` when revenue is 0.
  - Receivables = TTC outstanding of posted invoices dated within the period, at the as-of date 2026-06-30.
  - Overdue = the part of receivables whose due date has passed.
  - Inventory value = Σ quantity × standard cost.
  - Record count = number of documents.

## 2. Results

| Run | Scenarios | Metric comparisons | Discrepancies |
|---|---:|---:|---:|
| Initial (original code) | 14 | 112 | **99** |
| Final | 14 | 112 | **0** |

Plus 3 API-only property tests (final: all pass):
- the sum of agency revenues equals company revenue, exact to the millime: 52,752,842.587 TND
- the customer drill-down total equals dashboard revenue (Sfax)
- an unknown agency returns a well-formed zero result, not `NaN`

### Final values (API = oracle)

| Scenario | Revenue HT (TND) | Margin % | Receivables (TND) | Documents |
|---|---:|---:|---:|---:|
| Company | 52,752,842.587 | 19.09 | 15,068,624.752 | 9,792 |
| Tunis Centre | 18,423,252.704 | 19.17 | 5,038,467.716 | 3,438 |
| Sfax | 13,189,479.802 | 19.23 | 3,776,006.442 | 2,456 |
| Sousse | 9,300,860.299 | 19.43 | 2,782,087.619 | 1,739 |
| Bizerte | 6,525,899.888 | 18.52 | 1,916,042.310 | 1,164 |
| Nabeul | 5,313,349.894 | 18.53 | 1,556,020.665 | 995 |
| Year 2025 | 35,558,802.454 | 19.08 | 7,031,146.653 | 6,533 |
| H1 2026 | 17,194,040.133 | 19.11 | 8,037,478.099 | 3,259 |
| February 2025 | 2,817,444.711 | 19.02 | 567,780.820 | 504 |
| Single day 2025-03-15 | 107,621.648 | 20.42 | 35,304.591 | 17 |
| Empty period (2024) | 0.000 | `null` | 0.000 | 0 |
| Sfax, Q4 2025 | 2,119,252.817 | 19.38 | 460,266.257 | 412 |
| Tunis Centre, March 2026 | 1,060,160.176 | 19.15 | 567,374.983 | 190 |
| OIDC scope Tunis Centre + Sfax | 31,612,732.506 | 19.20 | 8,814,474.158 | 5,894 |

### Initial discrepancies and root causes

| Observation (original code) | Example | Root cause | Bug |
|---|---|---|---|
| Revenue overstated in every scenario | Company: 53,904,212.702 vs 52,752,842.587 (+1,151,370.115) | Cancelled invoices counted | BUG-025 |
| Date filters had no effect | Tunis Centre, March 2026: 18,847,210.963 vs 1,060,160.176 | `from`/`to` ignored by the route | BUG-003 |
| Two-agency OIDC user received all five agencies | 53,904,212.702 vs 31,612,732.506 | Scope fell back to "all" | BUG-002 |
| Receivables wrong | Company: 15,181,433.423 vs 15,068,624.752 | HT amount of not-fully-paid invoices; partial payments, credit notes and VAT ignored | BUG-026 |
| Overdue not exposed | — | Not in the model | BUG-026 |
| Record count = lines | 17,127 vs 9,792 | Row count | BUG-030 |
| Margin % 0 for empty period | 0 vs `null` | Default value | BUG-028 |

### BI anomaly fixtures (`fixtures/adverse/bi`, through the API)

| Case | Initial | Final |
|---|---|---|
| Negative margin | PASS | PASS |
| Zero revenue (margin % must be `null`) | FAIL | PASS |
| Missing cost (must not count as 0) | FAIL | PASS (row excluded; `missingCostRecords`=1, coverage "partial") |
| Cancelled invoice | FAIL | PASS |
| Credit note | PASS | PASS |
| Partial payment | FAIL | PASS |
| Out-of-period rows | FAIL | PASS |
| 0.100 × 10 = 1.000 | FAIL (0.9999999999999999) | PASS (integer millimes) |
| Duplicate transaction | Double counted (documented: detection is a data-quality responsibility) | same, caught by `data_quality.py` |
| Inconsistent agency labels | Excluded from the agency filter by exact match | same, surfaced by data-quality checks |

Vitest: initial 4/10 tests passed, final 10/10.

## 3. Requested properties

| Property | Status |
|---|---|
| Agency totals reconcile with company totals | PASS (exact) |
| Invoice details reconcile with dashboard totals | PASS (customer drill-down) |
| Date filters exclude out-of-period transactions | PASS after BUG-003 fix |
| Cancelled invoices handled | PASS after BUG-025 fix |
| Credit notes reduce amounts | PASS |
| Partial payments affect receivables | PASS after BUG-026 fix |
| Missing costs not read as zero | PASS after BUG-027 fix |
| Zero denominators | PASS (`null`) |
| Decimal-safe arithmetic | PASS (integer millimes; BUG-029) |

## 4. Not covered or open

- **Dormant stock, sales trends, product and customer profitability screens:** these are not exposed by the BI API. The UI panels for them are static (BUG-023, open). The dormant KPI now says "Non calculé" instead of showing a fabricated value. The oracle computes dormant stock (4,281 rows), so it can be validated once the API exposes it.
- **Customer/product grouping used display names** (BUG-031): 5 shared customer names covering 10 customers. This was fixed by grouping on IDs. The bug was masked in the first validation pass because the oracle made the same assumption, which is a reminder that an oracle can share a blind spot with the code it checks.
- All figures come from synthetic data under assumed KPI definitions. **Business sign-off on the definitions and a reconciliation against real ERP ledgers are still required.**
