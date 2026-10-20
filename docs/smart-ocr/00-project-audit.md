# Smart OCR — Phase 0 Project Audit

- Date: 2026-10-20
- Scope: Smart OCR module only (BI 360, AI Copilot and other ERP modules were inspected only where Smart OCR depends on them)
- Method: read-only inspection of the repository, plus a baseline run of `npm run typecheck` and `npx vitest run`
- No code was changed during this phase.

---

## 1. Current architecture

### 1.1 What exists

```text
React 19 / Vite 8 SPA (src/App.tsx, 3 083 lines, single file)
   │  src/api.ts — fetch client, sends a static bearer token (VITE_DEV_TOKEN)
   ▼
Express 5 API (server/, TypeScript run via tsx, port 3001)
   ├─ auth.ts        dev tokens (non-prod) or OIDC JWT via jose; 4 hardcoded roles; agency scope
   ├─ app.ts         all routes, upload (multer, memory), Zod validation, pino logs, helmet, rate limit
   ├─ ocr.ts         OcrProvider interface: DisabledOcrProvider (default) | HttpOcrProvider (generic)
   ├─ invoice-validation.ts   deterministic supplier-invoice checks (totals, VAT, duplicates)
   ├─ erp.ts         ErpAdapter interface: UnconfiguredErpAdapter | TestErpAdapter (in-memory)
   ├─ store.ts       Store interface: MemoryStore (dev/test) | PostgresStore (DATABASE_URL)
   └─ erp-db.ts / erp-writes.ts / erp-pages.ts / erp-bi.ts
                     local "ERP" database: SQLite via node:sqlite, seeded from synthetic CSVs
```

Two separate databases are in play:

| Database | Engine | Purpose | Migrations |
|---|---|---|---|
| Application store | PostgreSQL 17 (`pg`, raw parameterized SQL, no ORM) or in-memory fallback | documents, extractions, approvals, ERP sync, conversations, audit | `migrations/001_initial.sql`, run by `scripts/migrate.ts` |
| Local ERP simulation | SQLite file `var/ai-negoce.db` | products, suppliers, purchase orders, supplier invoices, stock, sales | `migrations/sqlite/001_erp.sql`, built by `npm run db:seed` from `datasets/synthetic/v1` |

### 1.2 Stack facts (verified)

| Item | Finding |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS v4 + large hand-written CSS in `src/index.css`; no router, no state library, no component library |
| Backend | Express 5, Zod 4, multer 2, pino, helmet, express-rate-limit, jose |
| Language | TypeScript 5.7 strict, ESM, executed with `tsx` (no compile step for the API) |
| Runtime | `engines.node >= 22`; local machine runs Node 24.14; `node:sqlite` requires ≥ 22.5 |
| ORM | None — parameterized SQL through `pg` and `node:sqlite` prepared statements |
| Tests | Vitest (12 files, 274 tests), Supertest, Playwright E2E (desktop + Pixel 7) |
| Python | Used only for QA tooling (`tools/qa`, `tools/dataset`), not at runtime |
| CI | `.github/workflows/ci.yml`: format, typecheck, seed, unit, E2E desktop, build, audit, docker build |
| Deployment | `Dockerfile` (multi-stage, non-root), `docker-compose.yml` (Postgres + API), no reverse proxy config |
| Version control | **The folder is not a git repository.** History and diffs cannot be verified. |

### 1.3 Baseline test run (2026-10-20, this machine)

- `npm run typecheck`: 0 errors.
- `npx vitest run`: 12 files, **274 / 274 passed** (10.3 s).
- E2E and Docker build were not run in this phase.

---

## 2. Smart OCR feature inventory

Status legend: **Functional** (real and tested) · **Partial** · **Mocked/Stub** · **Missing** · **Unsafe**

### 2.1 Backend

| Capability | Status | Evidence |
|---|---|---|
| Upload endpoint `POST /api/v1/documents` | Functional | 15 MiB limit, PDF/PNG/JPEG MIME + magic-byte check, random storage key, SHA-256, role + agency check (`server/app.ts:451`) |
| Hostile-file rejection | Functional | `tests/qa/ocr-pipeline.test.ts` covers forged MIME, EXE renamed to PDF, SVG, DOCX, empty, oversize, two files |
| File-level duplicate detection | Partial | Unique on `(owner_id, sha256)` only: the same file uploaded by a **different user** is not detected |
| Invoice-level duplicate detection (supplier + number) | Partial | Rule exists in `validateInvoice` but `registeredInvoices` is never supplied by the approve route, so it never fires |
| OCR extraction | **Missing (stub)** | Default `DisabledOcrProvider` returns empty fields. `HttpOcrProvider` posts to an unspecified endpoint; no real engine is integrated or configured |
| OCR output contract | Partial / inadequate | `fields: Record<string, unknown>` is untyped; one global `confidence` number; **no per-field confidence, no page numbers, no bounding boxes** — the Phase 8 viewer cannot be built on it |
| Extraction persistence | Partial | Versioned in Postgres (`invoice_extractions`); MemoryStore keeps one version only |
| Field correction by a user | Missing | No endpoint to edit or correct extracted fields |
| Serving the original document to the viewer | Missing | No authorized download/stream endpoint |
| Invoice validation | Partial | Totals, line totals, VAT per line, stamp, currency, duplicate lines; VAT rates **hardcoded** `[0, 7, 13, 19]` and currency `TND` in the route (`server/app.ts:667`); money converted via `Number()` floats then rounded to millimes — not exact decimal arithmetic; quantity is a float |
| Approval `POST /documents/:id/approve` | Partial | Role + agency checks, blocks incomplete extraction and validation issues. Does **not** write `approval_events`, does not record a document/extraction version, has no optimistic concurrency, uses roles not permissions |
| Product catalog access | Partial | Only inside the local SQLite ERP simulation (`products`, `suppliers`); no catalog snapshot in the Smart OCR store |
| Normalization (FR/AR) | Missing | Only an accent-stripping helper inside the Copilot router (`server/services.ts`) |
| Product matching (exact, fuzzy) | **Missing** | No code at all |
| Supplier-product mappings | **Missing** | No table, no API |
| Unit / packaging conversion | Missing | ERP has a free-text `uom` (`unité`, `carton`, `paquet`) and no conversion factors |
| Catalog synchronization | Missing | No connector, no CSV import for the catalog, no versioning |
| ERP integration of supplier invoices | Stub | `ErpAdapter.createSupplierInvoice` exists; production adapter is `UnconfiguredErpAdapter` (throws). `TestErpAdapter` is in-memory, test-only. `erp_sync` table exists but is never written |
| Audit log | Partial | `audit_logs` table + `store.audit()` on upload/approve; in development the MemoryStore loses it on restart |
| Tenant isolation | **Missing** | No tenant/organization concept anywhere; isolation unit is the agency name string |

### 2.2 Frontend (`src/App.tsx:871-1306`)

| Element | Status | Evidence |
|---|---|---|
| Import tab (drag & drop, file picker) | Functional | Calls the real upload endpoint |
| Duplicate-file notice | Functional | Opens the existing document (E2E covered) |
| Review tab | Stub | `UploadedReview` shows filename, id and missing fields only; no fields, lines, viewer or matching |
| History tab | Functional | Real `GET /documents`, agency-scoped |
| History tab counter | **Unsafe (fake)** | Hardcoded `count: 8` (`src/App.tsx:971`) regardless of real data |
| ERP import confirmation modal | **Unsafe (fake, dormant)** | Modal says "Facture importée avec succès … créé en brouillon" after a local `setApproved(true)` with no API call (`src/App.tsx:1064-1125`). It is currently unreachable (`setShowModal(true)` is never called) but must be removed or rewired before any demo |
| Upload agency | Hardcoded | `api.upload` always sends `agency = "Tunis Centre"` (`src/api.ts`) |
| Authentication in the SPA | Missing | Every request sends the static `VITE_DEV_TOKEN`; there is no login / OIDC flow in the frontend |
| Info banner | Honest | States that OCR and ERP are not configured |

### 2.3 Data available for development and evaluation

| Asset | Content | Usefulness for Smart OCR |
|---|---|---|
| `datasets/synthetic/v1` | 2 000 products, 100 suppliers, 3 000 supplier invoices / 7 037 lines, 12 categories | Good volume for sync and performance tests. **Product names are invented** ("Câble Anor S", "Lampe LED Tafa Max"): no technical attributes (section, amperage, length), no supplier references, no GTIN/barcode, 3 units only, 8 duplicated names. **Not usable to measure real matching accuracy.** All supplier names carry `[FICTIF]` |
| `fixtures/adverse/ocr` | 14 invoice images/PDFs (clean, blurry, rotated, low-res, bilingual FR/AR, decimal comma, multipage, scanned, text-layer) + `ground_truth.json` | Valuable for OCR extraction tests. Ground-truth lines have `productId: null` → **no labeled line-to-product pairs** |
| `fixtures/adverse/upload` | Hostile files + expected statuses | Already used |
| Real AI-NÉGOCE data | None | No real catalog, supplier references or invoices in the repository |

---

## 3. Functional gaps (against the requested Smart OCR scope)

1. **No OCR engine.** Nothing reads text from the document. Everything downstream depends on this.
2. **No layout data.** No page/bbox coordinates → no source traceability, no clickable highlights.
3. **No structured invoice model.** Header and lines live in an untyped JSON blob; no line-item table, no per-field review status.
4. **No catalog in the Smart OCR store**, no sync, no catalog version.
5. **No normalization, no matching engine, no candidate ranking, no decision policy.**
6. **No supplier-product mapping model** (supplier reference, purchase/stock units, conversion factor, versioning, approver).
7. **No human review workflow:** no correction endpoints, no draft save, no reject/choose-another, no separation of invoice correction vs reusable mapping, no stale-write protection.
8. **No permission model** beyond 4 hardcoded roles; `roles.csv` lists permissions (`documents.approve`, …) but the API checks roles, not permissions. No permission for "create reusable mapping".
9. **No real ERP read or write contract.** The local SQLite ERP is a simulation; the real AI-NÉGOCE API is unknown.
10. **No business configuration store** (VAT rates, stamp duty, rounding, currency).
11. **No asynchronous processing.** OCR runs inside the upload HTTP request with a 30 s timeout.
12. **No labeled evaluation set** for matching (target ≥ 100 labeled lines).

---

## 4. Integration risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| I1 | Real AI-NÉGOCE ERP schema/API unknown | Catalog sync and invoice write cannot be built against the real system; risk of building on the SQLite simulation's shape | Connector interface + CSV import first; treat SQLite ERP as an explicitly labelled sandbox source |
| I2 | OCR engine not chosen | Blocks every downstream phase; quality on Arabic and poor scans is engine-dependent | Decide engine early (see §6.3); benchmark on the 14 fixtures before committing |
| I3 | Sending invoices to a cloud OCR | Supplier fiscal IDs, prices and names leave the client's infrastructure | Requires written data-processing approval; offer a local engine option |
| I4 | No tenant concept | Retro-fitting tenant_id later touches every table and query | Add tenant ownership in Phase 1, before any new table ships |
| I5 | Two databases (Postgres store + SQLite ERP) | Cross-database joins impossible; transaction boundaries unclear | Smart OCR owns its own Postgres tables and a synced catalog snapshot; ERP stays behind an adapter |
| I6 | Development runs on `MemoryStore` | Documents, extractions and audit vanish on API restart while files remain in `var/uploads` (3 orphaned PDFs found) | Run Postgres locally (Compose) for Smart OCR development; keep MemoryStore for unit tests only |
| I7 | Synthetic catalog lacks technical attributes | Matching may look excellent on synthetic data and fail on real catalogs | Obtain a real (anonymized) catalog extract and real invoices; label ≥ 100 lines |
| I8 | Arabic text in PDFs | Text-layer extraction of Arabic often yields reversed or unshaped glyph order | Normalize bidi/presentation forms in Phase 3; test with `bilingual_fr_ar.png` and real samples |
| I9 | No git history | Cannot produce reliable "changed files" lists or roll back | `git init` + initial commit before Phase 1 |

---

## 5. Security risks

| # | Finding | Severity | Location |
|---|---|---|---|
| S1 | Dormant modal declares a successful ERP import without any API call | High (integrity of claims shown to clients) | `src/App.tsx:1064-1125` |
| S2 | SPA always sends a static bearer token; no real login | High for any non-local deployment | `src/api.ts` (`VITE_DEV_TOKEN`) |
| S3 | No tenant isolation | High once more than one company is hosted | whole schema |
| S4 | File duplicate check is per-owner, so cross-user re-uploads are not flagged | Medium | `migrations/001_initial.sql` (`uq_documents_sha_owner`) |
| S5 | Uploaded documents stored unencrypted on local disk, no antivirus scan, no retention policy | Medium | `UPLOAD_DIR` |
| S6 | Upload accepts any well-formed PDF header; PDFs are not sanitized or re-rendered (embedded JS/attachments pass through) | Medium | `server/app.ts:459` |
| S7 | Approval is role-based, not permission-based; no approval event, no version pinning, no concurrency guard | Medium | `server/app.ts:633` |
| S8 | Floating-point money arithmetic (`Number()` then `Math.round`) | Medium (financial correctness) | `server/invoice-validation.ts:33` |
| S9 | `helmet` runs with `contentSecurityPolicy: false` | Low–Medium | `server/app.ts:104` |
| S10 | `/readyz` is public and discloses dependency status | Low | `server/app.ts:136` |
| S11 | Audit logs are not tamper-evident and not written in dev | Low (now) | `server/store.ts` |

Positive findings: parameterized SQL everywhere inspected; Zod input validation; authorization header redacted from logs; random storage keys (path traversal tested); bounded upload size; CORS restricted; rate limiting; OCR provider responses are schema-validated and never invent fields; ERP adapter fails closed.

---

## 6. Recommended implementation architecture

### 6.1 Principles

- Stay inside the existing stack: **TypeScript + Express + PostgreSQL + Zod + Vitest**. No new framework, no Python microservice unless the chosen OCR engine requires one.
- Keep the current modular-monolith style; add a `server/smart-ocr/` folder instead of growing `app.ts`.
- Deterministic logic first (normalization, exact matching, rule-based decisions). No LLM in the matching or decision path.
- All money and conversion factors as `numeric` in Postgres and exact decimal arithmetic in TypeScript (integer millimes via `BigInt`, or a small decimal library — to be decided in Phase 1).

### 6.2 Target module layout

```text
server/smart-ocr/
  routes.ts            Express router mounted at /api/v1/smart-ocr (documents, lines, matches, mappings, sync)
  repository.ts        Postgres access for Smart OCR tables (tenant-scoped queries only)
  ocr/                 provider interface v2 (pages, words, bboxes, per-field confidence) + engine adapter(s)
  extraction/          invoice header/line parsing from OCR layout into typed records
  normalize/           FR/AR text normalization + attribute extraction (Phase 3)
  match/               exact matcher (Phase 4), candidate retrieval + ranking (Phase 5)
  decision/            configurable decision policy (Phase 6)
  catalog/             connector interface, CSV import, SQLite-sandbox connector, sync jobs (Phase 2)
  validation/          Tunisian business checks with exact decimals (Phase 9)
  erp/                 invoice integration adapter, idempotency, outbox (Phase 10)
migrations/            new numbered Postgres migrations (002_…)
```

Frontend: new Smart OCR components extracted from `App.tsx` into `src/smart-ocr/*.tsx`, reusing existing `Button`, `Badge`, `TabBar`, `Icon` and CSS tokens. Other modules untouched.

### 6.3 OCR engine options (decision needed)

| Option | Runs where | FR | AR | Layout / bbox | Notes |
|---|---|---|---|---|---|
| A. PDF text layer (`pdfjs-dist` in Node) | Local | Yes | Partial (glyph order issues) | Yes (word positions) | Free, exact for digital PDFs; useless for scans. Should be used **first** whenever a text layer exists |
| B. Tesseract 5 (`tesseract.js` WASM or native binary) | Local | Good | Fair | Yes (words + boxes + confidence) | No data leaves the server; weaker on poor scans and tables |
| C. Managed document AI (e.g. Azure Document Intelligence, Google Document AI, AWS Textract) | Cloud | Very good | Varies by provider — must be verified | Yes, plus table/invoice models | Best accuracy; requires contract, keys, data-processing approval, cost per page |
| D. Self-hosted PaddleOCR / docTR | Local (Python service) | Good | Good (Paddle Arabic models) | Yes | Adds a Python service and GPU/CPU sizing |

**Recommendation:** A + B as the default, privacy-preserving pipeline (text layer when present, Tesseract fra+ara otherwise), behind the existing `OcrProvider` interface extended with layout data; keep C as a pluggable adapter if the client approves cloud processing. The final choice should follow a benchmark on the 14 fixtures plus real samples.

### 6.4 Matching approach

- Candidate retrieval: Postgres `pg_trgm` GIN index on normalized designations + exact indexes on references.
- Scoring in TypeScript: token-set similarity, Jaro-Winkler / Levenshtein (a small, audited npm library such as `fastest-levenshtein`, or a local implementation with tests — RapidFuzz is Python-only and would require a separate service).
- Hard constraints (attribute conflicts, unit incompatibility, inactive product) evaluated **before** ranking and reported as `blocking_conflicts`.

### 6.5 Processing model

Upload → store file → enqueue job → worker: OCR → extraction → normalization → matching → validation → `review_required`. For the MVP, a Postgres-backed job table polled by an in-process worker is sufficient (no Redis/queue product needed).

---

## 7. Required external access and documentation

| Needed | Why | Blocks |
|---|---|---|
| AI-NÉGOCE product/supplier schema or API spec (fields, IDs, units, packaging, status, timestamps) | Catalog sync and mapping model | Phase 1 (partially), Phase 2 |
| AI-NÉGOCE sandbox credentials (read) | Real catalog sync | Phase 2 real mode |
| AI-NÉGOCE supplier-invoice creation contract (API or import file format) + sandbox (write) | Controlled integration | Phase 10 |
| Identity provider details (OIDC issuer, audience, JWKS, claim names for role/agency/tenant) | Real auth in SPA and API | Phase 7 permissions, pilot |
| Decision on OCR engine and data-processing approval (cloud allowed or not) | Extraction | Phase 1 contract, Phase 8 |
| Anonymized real catalog extract (≥ a few hundred products incl. technical items) | Realistic normalization and matching | Phases 3–5 evaluation |
| ≥ 20 real supplier invoices (FR, AR, mixed; scans and digital) and ≥ 100 manually labeled invoice-line → ERP product pairs | Benchmarks (precision@1, recall@5, false auto-match rate) | Phases 5, 6, 11 |
| VAT rates, stamp duty, rounding rules, withholding rules confirmed by the client's accountant | Tunisian validation | Phase 9 |
| Hosting target for staging (cloud/on-prem, object storage, backup policy) | Deployment | Phase 12 |

---

## 8. Prioritized roadmap

| Order | Phase | Can start now? | Main dependency |
|---|---|---|---|
| 0 | Housekeeping: `git init`, remove/neutralize fake modal and hardcoded counter, local Postgres via Compose | Yes (needs approval) | — |
| 1 | Data contracts + Postgres migrations (tenant, catalog snapshot, documents v2, lines, candidates, decisions, mappings, sync jobs, issues, audit, integration jobs) | Yes | Tenant model answer (Q1) |
| 1b | OCR provider v2 + chosen engine adapter (not listed as a separate phase in the brief, but every later phase depends on it) | After Q4 | OCR decision |
| 2 | Catalog sync: connector interface, CSV/Excel import, SQLite-sandbox connector | Yes (CSV + sandbox) | Real ERP API for real mode |
| 3 | Normalization FR/AR + attribute extraction | Yes | Real samples improve rules |
| 4 | Exact matching | Yes | — |
| 5 | Fuzzy matching + benchmark | Engine yes; benchmark needs labeled data | Labeled set |
| 6 | Decision policy | Yes | Thresholds need benchmark |
| 7 | Human validation workflow | Yes | Permission model (Q3) |
| 8 | Two-panel review UI | After 1b | OCR coordinates |
| 9 | Tunisian business validation | Partially | Accountant-validated config |
| 10 | ERP integration | Export-only until contract | ERP write contract |
| 11 | QA & evaluation | Continuous | Labeled set |
| 12 | Staging & demo | Last | Hosting |

---

## 9. Open questions (must be answered before coding)

1. **Tenancy:** will one deployment serve several companies (true multi-tenant), or one deployment per client company? What identifies a tenant in the identity token?
2. **ERP of record:** for the demo, is the local SQLite database (`var/ai-negoce.db`) acceptable as the explicitly labelled "ERP sandbox", or is a real AI-NÉGOCE sandbox reachable? Can you share the real product/supplier schema?
3. **Permissions:** who may (a) correct an invoice, (b) approve an invoice, (c) create/approve a reusable supplier mapping, (d) trigger ERP integration? Can we move from 4 hardcoded roles to named permissions?
4. **OCR engine:** is sending invoices to a cloud OCR service acceptable for your clients? If not, is local Tesseract (with lower quality on bad scans) acceptable for the MVP?
5. **Database:** can Smart OCR development use PostgreSQL locally (Docker Desktop is installed but was not running during earlier QA)? Postgres is required for `pg_trgm` candidate retrieval.
6. **Real data:** can you provide anonymized real invoices and a catalog extract, and who will label the ≥ 100 line-to-product pairs?
7. **Units:** where do purchase unit, stock unit and packaging (e.g. "carton de 12", "rouleau 100 m") live in the real ERP?
8. **Fiscal rules:** confirm VAT rates, stamp duty amount, rounding rule (line vs total), and whether withholding tax (retenue à la source) must be checked on supplier invoices.
9. **Version control:** may I run `git init` and create an initial commit of the current state before Phase 1, so every later stage has a verifiable diff?
10. **Fake UI residue:** may I remove the dormant success modal and the hardcoded history counter as part of Phase 1 (smallest possible UI change)?

---

## 10. Phase 0 status

- Delivered: this audit document only.
- Code changes: none.
- Tests run: typecheck (0 errors), Vitest 274 / 274 passed. E2E and Docker not run.
- Waiting for approval and answers to §9 before starting Phase 1.
