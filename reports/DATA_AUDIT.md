# Data audit — AI-NEGOCE Intelligence Suite

Date: 15 October 2026 · Scope: the repository at `AI-NEGOCE MVP Prototype Design/` (no Git history present).

## 1. Architecture as found

| Layer | What exists | Evidence |
|---|---|---|
| Frontend | React 19 + Vite 8 + Tailwind 4 single-page app, one 2,850-line component file | `src/App.tsx`, `src/api.ts` |
| Backend | Express 5 modular monolith; Zod validation; Helmet; CORS; rate limit (120 req/min); pino logs | `server/app.ts` |
| Authentication | OIDC JWT verification via remote JWKS (`jose`), plus hardcoded development tokens accepted outside production | `server/auth.ts` |
| Authorisation | Roles `admin`, `manager`, `accountant`, `commercial`; agency scope from the `agencies` claim | `server/auth.ts` |
| Storage | `PostgresStore` (documents, extractions, approvals, ERP sync, conversations, messages, audit log) and an in-memory `MemoryStore` | `server/store.ts`, `migrations/001_initial.sql` |
| Database technology | PostgreSQL 17 (declared in `docker-compose.yml`), used only for application metadata. **Not available in this environment** (no `psql`, Docker engine stopped), so the PostgreSQL store was not executed. | `docker-compose.yml` |
| File storage | Local disk directory (`UPLOAD_DIR`, default `var/uploads`), random file keys | `server/app.ts` |
| OCR pipeline | `OcrProvider` interface: `DisabledOcrProvider` (default, returns no fields) and `HttpOcrProvider` (generic HTTP contract). No OCR engine is configured or installed. | `server/ocr.ts` |
| BI calculations | `overview()` over an in-code fixture | `server/services.ts`, `server/data.ts` |
| Copilot | Deterministic rule-based tool router (`groundedAnswer`). **No LLM provider exists in the code.** | `server/services.ts` |
| ERP integration | `ErpAdapter` with `UnconfiguredErpAdapter` (always fails) and `TestErpAdapter` (in-memory). **No ERP read API.** No code path calls `createSupplierInvoice`. | `server/erp.ts` |
| Background jobs | None (OCR runs synchronously in the upload request; no queue or retry worker) | — |
| Tests (before QA) | 12 Vitest/Supertest tests | `server/app.test.ts`, `server/config.test.ts` |
| Configuration | `.env.example`; production fails closed without `DATABASE_URL`, OIDC and ERP variables | `server/config.ts` |

API endpoints: `GET /livez`, `GET /readyz`, `GET /me`, `GET /bi/overview`, `POST /conversations`, `GET /conversations/:id`, `POST /copilot/query`, `POST /documents`, `GET /documents/:id`, `POST /documents/:id/approve`. All are under `/api/v1`, and every route except `livez` and `readyz` requires a bearer token.

## 2. Inventory of data sources

| Source | Classification | Content | Used by |
|---|---|---|---|
| `server/data.ts` | **Mock / test data** (labelled fictional) | 6 sales invoices, 3 inventory rows and 3 receivables (added during QA) | BI overview, Copilot |
| `src/App.tsx` static content | **Hardcoded frontend data** | Dashboard KPIs, BI chart, alerts, agency table, stock structure, OCR demo invoice, history, Ventes/Achats/Stocks/Finance pages, Settings | UI only |
| Copilot answers | **Deterministic computed text** (not AI-generated) | Template sentences over the fixture | Copilot screen |
| Uploaded documents | **Local application data** | Files in `UPLOAD_DIR` plus metadata in the store; one leftover file in `var/uploads/` | Smart OCR |
| Conversations and audit log | **Local application data** | Memory or PostgreSQL | Copilot, audit |
| Real ERP data | **None available** | — | — |
| Third-party data | Google Fonts stylesheet (`src/index.css`) | Fonts only | UI |
| AI-generated content | **None** (no LLM in the code) | — | — |

## 3. QA datasets added (kept separate from application data)

| Location | Classification | Git |
|---|---|---|
| `datasets/synthetic/v1/` | SYNTHETIC, deterministic (`tools/dataset/generate.ts`, seed 20261015) | ignored, reproducible from the generator |
| `datasets/exports/` | Pseudonymised fixture export (`tools/dataset/export.ts`) | ignored |
| `fixtures/adverse/` | Fictional adverse fixtures (invoices, BI, OCR images and PDFs, hostile uploads) | committed, small |

## 4. Findings relevant to data

- **No authorised real-data source exists.** The ERP export is blocked: there is no read API, schema, sandbox or credentials. `tools/dataset/export.ts --source erp` refuses with exit code 3 and exports nothing.
- **The BI model was too simple for real ERP data.** A single `paid` boolean and no document status meant there was no way to represent credit notes, cancelled invoices, partial payments or unknown costs. This caused BUG-025 to BUG-030 and was fixed.
- **Much of the UI shows hardcoded business figures that look real** (BUG-023, open). Only the BI KPI row, the Copilot answer text and the OCR upload result come from the API.
- `var/uploads/` contained one PDF from a previous session. It is git-ignored and was left untouched.
