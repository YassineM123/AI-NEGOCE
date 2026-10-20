# Smart OCR — Phase 0.5 Baseline Report

- Date: 2026-10-20
- Scope: repository safety, Git baseline, removal of misleading Smart OCR UI, local PostgreSQL, documentation of known weaknesses. No Phase 1 work.
- Status: finalized after the review of 2026-10-20 (conditional approval). Commit: `chore: establish safe Phase 0.5 development baseline`.

---

## 1. Repository inspection before `git init`

| Checked | Result |
|---|---|
| Credentials / tokens / private keys (pattern scan, excluding `node_modules`, `dist`) | None found. Only test placeholders (`qa-secret-key`, `postgres://user:pass@db` inside a negative test) |
| `.env` | Did not exist; only `.env.example` (placeholders) |
| Local databases | `var/ai-negoce.db`, `var/e2e-ai-negoce.db` (+ WAL/SHM): synthetic ERP sandbox |
| Uploaded documents | `var/uploads/`: 3 orphaned files (see §6) |
| Generated outputs | `output/pdf/facture_test_ocr_tunisie.pdf`, `tmp/pdfs/*`: generated test invoice with a realistic company name (`SOCIETE CARTHAGE FOURNITURES SARL`, `.tn` email) and **no** `[FICTIF]` marker |
| Datasets | `datasets/synthetic/` (36 MB, reproducible) and `datasets/exports/`: already ignored |
| QA evidence | `reports/evidence/*.json` contain absolute local paths (Windows username): low sensitivity, kept |

## 2. Git

| Commit | Content |
|---|---|
| `7df777f` `chore: baseline snapshot before Smart OCR Phase 0.5` | Project as found + Phase 0 audit; hardened `.gitignore` |
| `chore: establish safe Phase 0.5 development baseline` | Only the reviewed Phase 0.5 changes listed in §10; excludes every concurrent OCR change (§9) |

`.gitignore` excludes: `.env` and `.env.*` (except `.env.example`), `*.pem/*.key/*.p12/*.pfx`, the whole `var/` directory, `*.db/*.db-*/*.sqlite/*.dump`, `tmp/`, `output/`, Python caches, synthetic datasets and exports, `reports/evidence/tmp/`, and now `reports/evidence/*_adhoc.json`.

### Generated evidence files

The QA tests and Playwright write `reports/evidence/<name>_${QA_PHASE ?? "adhoc"}.json` on every run. `tools/qa/compile_results.py` reads only the named runs (`*_initial`, `*_final`); no tool, test or CI step reads `*_adhoc.json`. The 7 `*_adhoc.json` files were removed from tracking (`git rm --cached`, files kept on disk) and ignored. Their last versioned content remains in commit `7df777f`. Named-phase evidence (`initial`, `postfix`, `final`, `current`) stays versioned.

## 3. Misleading UI removed (Smart OCR only)

| Before | After |
|---|---|
| Unreachable modal declaring "Facture importée avec succès … créé en brouillon dans le journal des achats" after a local state flip, with no API call | Removed with its `showModal` / `approved` state. Approval and ERP integration will be built on real endpoints in later phases |
| History tab counter hardcoded to `8` | Count of documents returned by `GET /api/v1/documents` (agency-scoped); refreshed on mount, after an upload and when the history list reloads. No number is shown while unknown or if the API fails |

Unused CSS classes (`.modal-summary`, `.success-ref`) were left in `src/index.css` because it is shared with other modules.

## 4. Synthetic data vs genuine ERP data

| Surface | Finding | Status |
|---|---|---|
| Top bar | Always shows "Environnement de démonstration" | OK |
| Top bar | "Société active : CARTHAGE MOBILIER SARL" is hardcoded, realistic, unmarked | **Open**, approved for the next controlled cleanup (display "Environnement de démonstration — Données fictives" while the SQLite sandbox is the data source) |
| Settings page | Default company email `contact@carthage-mobilier.tn` (realistic `.tn` domain) and tax ID `9876543/B/A/M/000` hardcoded in form inputs | **Open**, same cleanup (outside Smart OCR) |
| API metadata `source` (dashboard, BI) | `"Base SQLite locale"`: does not say synthetic; not displayed | **Open**, same cleanup |
| Supplier names in the sandbox | Suffixed `[FICTIF]` | OK |
| Product / customer names in the sandbox | Invented, unmarked | Acceptable inside the labelled sandbox only |
| `/readyz` | `erp: false`; the sandbox is never reported as the ERP adapter | OK |
| Generated test invoice (`output/`, `tmp/`) | Realistic, unmarked | Excluded from Git; regenerate with `[FICTIF]` before any reuse as a fixture |

## 5. Authentication: development identities

### 5.1 Exact acceptance conditions (verified in `server/auth.ts`, `server/config.ts`, and by a live request)

A request is authenticated as a development user when **all** of the following hold:

1. The route is under `/api/v1/` and is not `livez` / `readyz`.
2. The header is `Authorization: Bearer <token>` where `<token>` is exactly `dev-admin`, `dev-manager-sfax` or `dev-commercial-tunis`.
3. `config.NODE_ENV !== "production"`.

`NODE_ENV` is parsed from the environment as one of `development | test | production` and **defaults to `development` when unset**. Any other value (e.g. `staging`) aborts startup. Consequences:

| How the API is started | `NODE_ENV` | `dev-admin` accepted? |
|---|---|---|
| `npm run dev:api`, `npm run start:api`, Vite auto-start, `npx tsx server/index.ts` | unset → `development` | **Yes** (verified: upload returned 201 with `dev-admin`) |
| Playwright E2E stack | `development` | Yes (intended) |
| `NODE_ENV=test` | `test` | Yes |
| `Dockerfile` / `docker-compose.yml` | `production` | No (also requires DATABASE_URL, OIDC_*, ERP_*) |

Acceptance does **not** depend on OIDC configuration, `DATABASE_URL`, or the network interface. `server/index.ts` calls `app.listen(port)` without a host, so the API listens on **all interfaces**: any machine that can reach port 3001 can act as `dev-admin` (role `admin`, all agencies) on a non-production start. The production frontend bundle also contains the `dev-admin` fallback token.

### 5.2 Other weaknesses

| # | Weakness | Planned |
|---|---|---|
| A3 | Development user "Sonia Ben Amor" has a realistic personal name | Phase 1 |
| A4 | Authorization checks 4 roles, not permissions; `roles.csv` permissions are never enforced | Phase 1 (4 approved permissions) |
| A5 | No tenant claim/column; isolation by agency **name** | Phase 1 |
| A6 | File-duplicate detection unique on `(owner_id, sha256)` only | Phase 1 |
| A7 | Audit rows store `actor_id` only, not tamper-evident | Phase 1 / 7 |
| A8 | CSP disabled in `helmet`; `/readyz` public | Phase 12 |

### 5.3 Recommended fail-closed configuration for Phase 1

1. Development identities only when an explicit `AUTH_DEV_IDENTITIES=true` is set **and** `NODE_ENV` is `development` or `test`; never inferred from a missing variable.
2. `NODE_ENV` without a default: startup fails if it is unset.
3. When development identities are enabled, the API binds to `127.0.0.1` only and refuses to start on another host.
4. Startup fails if neither OIDC (issuer, audience, JWKS) nor explicit development identities are configured.
5. Remove the `dev-admin` fallback from `src/api.ts`; the production build fails if `VITE_DEV_TOKEN` is set.
6. `/readyz` and a UI banner state "Identités de développement actives" whenever they are enabled.
7. Regression tests: unset `NODE_ENV`, missing flag, non-loopback bind → `dev-admin` refused.

**Blocker:** the application must not be exposed to clients or any network beyond the developer's machine until 1–5 are implemented.

## 6. Orphaned uploads (quarantined, not deleted)

Moved from `var/uploads/` to `var/quarantine/orphan-uploads-2026-10-20/` (gitignored) with an `INVENTORY.md`. They were created on 2026-10-15 while the API ran on the in-memory store.

| File | Size | SHA-256 prefix | Content |
|---|---|---|---|
| `35c18984-ca70-43c0-b4eb-a688721ce3c4.pdf` | 14 B | `4f1949e95440af0e` | stub `%PDF-1.4 %%EOF` |
| `739b4daa-cbde-4cd3-98c9-28e8ee869c07.pdf` | 3 333 B | `6a088ee857036221` | identical to `output/pdf/facture_test_ocr_tunisie.pdf` (generated test invoice) |
| `a107708e-f2e8-4811-a426-d259a7cc951d.pdf` | 3 333 B | `6a088ee857036221` | second identical copy |

References checked, none found: Postgres `documents`, `audit_logs`, `erp_sync` (the only job-like table) in the dev database; both SQLite ERP files; repository files; QA evidence. They are synthetic test documents, not legal records. Deletion awaits explicit approval.

## 7. PostgreSQL for local development

- `docker-compose.dev.yml`: Postgres only, port bound to `127.0.0.1`, named volume `pg_dev_data`, password from `.env` (required). Image `postgres:${POSTGRES_IMAGE_TAG:-17-alpine}`. Production `docker-compose.yml` unchanged (`postgres:17-alpine`).
- Scripts `db:dev:up` / `db:dev:down`. `dev:api`, `migrate` and the Vite auto-started API read `.env` via `--env-file-if-exists` (shell variables take precedence). `start:api` unchanged. The Playwright stack does not read `.env`.
- `server/index.ts` warns at startup when `DATABASE_URL` is absent (in-memory store).
- Local `.env` (gitignored, checked with `git check-ignore`) holds a random password and `POSTGRES_IMAGE_TAG=16-alpine`.

### Versions

| | Version | Status |
|---|---|---|
| Intended deployment (`docker-compose.yml`) | PostgreSQL 17 (`17-alpine`) | Not tested in this phase (see §11) |
| Local development (temporary) | PostgreSQL **16.14** (`16-alpine`, already present locally) | Tested: migration, idempotent re-run, persistence tests, restart test |

`migrations/001_initial.sql` uses `gen_random_uuid()` (core since PG 13), `pgcrypto`, `jsonb`, `timestamptz`, `bigserial`, `numeric(5,4)` and `IF NOT EXISTS`: no feature differs between 16 and 17. Rule for Phase 1: new migrations must stay compatible with PostgreSQL 16 and 17 and be run against both before release; 17 stays the deployment default only once it has been tested.

## 8. Test results

See the final report in the conversation for the run executed on the committed state.

## 9. Concurrent changes left untouched (not committed)

Another session (`ai-negoce-mvp-prototype-design-b0`, now stopped per the owner) modified files between 13:45 and 14:06 on 2026-10-20. They remain **uncommitted in the working tree**, unmodified:

| File | Change |
|---|---|
| `server/ocr.ts` | `LocalTextOcrProvider`: regex parsing of PDF content streams |
| `server/config.ts` | `OCR_PROVIDER` gains `local` and **defaults to `local`** |
| `server/app.ts` | wires `LocalTextOcrProvider` |
| `tests/qa/ocr-pipeline.test.ts` | 2 tests for the local provider |
| `.env.example`, `API_DOCUMENTATION.md` | document the `local` mode |
| `src/App.tsx` (2 hunks in `UploadedReview`) | displays extracted fields as raw JSON and a field-group count |

Because the committed `server/config.ts` still defaults to `disabled`, the committed baseline does not enable this recognition by default.

### OCR issues to resolve in Phase 1b

1. Hardcoded confidences `0.9` / `0.7`: must become nullable and only reflect values an engine actually returns.
2. Default `OCR_PROVIDER=local` must not be the production default.
3. No coordinates, page numbers or per-field confidence; the extraction contract stays an untyped `Record<string, unknown>`.
4. The parser only handles text inside `(...)` string operators and the `a | b | c | TVA x | y` layout of one fixture. Hex strings (`<...>`), font encodings / CMaps (needed for Arabic and most real PDFs), text positioning and tables are not handled.
5. Line VAT (`lineVat`) is not extracted, so the approve route's validation can never pass on its output.
6. Native PDF text and image OCR are not distinguished in the result; image files return empty fields without an explicit "unsupported" state.
7. The UI shows raw JSON; the Smart OCR banner ("OCR … non configurés") becomes inaccurate when this provider is active.
8. Candidate approach for 1b: a multi-provider interface with declared capabilities (native text, image OCR, coordinates, languages), nullable confidences, real error states and processing events; benchmark a maintained PDF text library (e.g. `pdfjs-dist`) and local OCR engines on real French, Arabic and mixed invoices before choosing.

## 10. Files in the Phase 0.5 commit

| File | Change |
|---|---|
| `.gitignore` | ignore `reports/evidence/*_adhoc.json` |
| `reports/evidence/*_adhoc.json` (7) | removed from tracking (kept on disk) |
| `src/App.tsx` | only the Phase 0.5 hunks: fake modal removed, real history count |
| `docker-compose.dev.yml` | new, dev-only Postgres |
| `package.json` | `db:dev:up`, `db:dev:down`; `.env` loading for `dev:api` and `migrate` |
| `vite.config.ts` | auto-started API reads `.env` |
| `server/index.ts` | in-memory store warning |
| `server/store.pg.test.ts` | new, opt-in Postgres persistence test |
| `docs/smart-ocr/00b-phase-0.5-baseline.md` | this report |

## 11. Remaining decisions

1. Delete the quarantined orphan files (§6)?
2. PostgreSQL 17 compatibility test: when the image can be pulled.
3. Scope and timing of the label cleanup (§4) and fail-closed authentication (§5.3) inside Phase 1.
4. How the concurrent OCR work (§9) will be reworked in Phase 1b: keep as a starting point, or replace with a library-based text extractor after benchmarking.
