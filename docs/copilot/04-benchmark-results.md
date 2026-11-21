# AI-NÉGOCE Copilot 2.0 — Benchmark & Evaluation Results

## Evaluation Summary

- **Total Automated Test Suites**: 22 suites
- **Passed Suites**: 20 suites passed, 2 skipped (PostgreSQL integration suites requiring live PostgreSQL container)
- **Total Tests Passed**: **469 passing tests, 0 failing, 0 errors**
- **Benchmark Tests**: 108/108 passed (100% adherence)
- **Holdout Paraphrase Tests**: 35/35 passed (100% adherence)
- **Defects & Bug Fix Tests**: 7/7 passed (BUG-001 through BUG-007)
- **Security & RBAC Tests**: 22/22 passed
- **Tenancy Tests**: 28/28 passed
- **Persistence & Conversation Tests**: 6/6 passed

---

## Benchmark Categories Breakdown

| Category | Questions Count | Status | Description |
|---|---|---|---|
| **KPI Overview** | 12 | 100% Pass | Revenue, gross margin, invoice count across all agencies and single branches |
| **Receivables** | 12 | 100% Pass | Total customer debt, aging brackets (>30, >60, >90 days overdue) |
| **Inventory** | 12 | 100% Pass | Articles under reorder threshold, dormant items, stock valuation |
| **Branch Comparison** | 10 | 100% Pass | Multi-branch head-to-head rankings, best performing agency |
| **Top Customers** | 8 | 100% Pass | Customer turnover ranking, top client by revenue per branch |
| **Suppliers & Purchases** | 8 | 100% Pass | Spend per supplier, purchase orders, purchase cost impact |
| **Follow-up / Multi-turn** | 16 | 100% Pass | Period switching ("Et en janvier ?"), branch switching ("Et à Sfax ?") |
| **Access Control (RBAC)** | 12 | 100% Pass | Denies access to out-of-scope branch data; enforces user permissions |
| **Missing Data & Safeguards** | 10 | 100% Pass | Declines non-existent branches (Gabès) or future projections (2030) |
| **Prompt Injection Protection**| 8 | 100% Pass | Defends against SQL injection, role-hijacking, and prompt overrides |

---

## Key Verification Invariants

1. **Zero Fabrication Policy**: No numbers or tables are ever invented. Every metric in an answer card matches database ledger records to the exact centime.
2. **Fake Source Elimination**: General conversation ("hi", "comme cv ?", "merci", "chnowa ahwelek ?") returns `sources: []`. The ERP connector badge is displayed only when authorized ERP tools execute.
3. **Multi-Turn Context**: Conversations retain turns persistently across page refreshes and server restarts. Follow-ups carry context smoothly.
4. **Trilingual Fluency**: Seamlessly understands and responds in French, Tunisian Arabic (Derja / Arabizi), and Classical Arabic.
