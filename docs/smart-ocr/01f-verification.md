# Phase 1 · Step 6 — Quality verification

- Date: 2026-10-20 · Code verified: commit `b22dd82` (Steps 1–5 + formatting fix) on `main`.
- Machine: Windows 11, Node 24.14 (project requires ≥ 22), Docker 29.5.3, PostgreSQL 16.14 (container).

## 1. Results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | 0 errors |
| Formatting (CI gate) | `npm run format:check` | Passed after fix `b22dd82` (Phase 0.5 had introduced an over-long line; detected here) |
| Unit and API tests | `npx vitest run` | 15 files passed, 2 skipped; **440 passed**, 22 skipped (the 22 PostgreSQL tests, which need `TEST_DATABASE_URL`) |
| PostgreSQL tests | `TEST_DATABASE_URL=… npx vitest run server/store.pg.test.ts server/model.pg.test.ts` | 2 files, **22 / 22 passed** (PostgreSQL 16.14) |
| Browser E2E, desktop 1440 px | `npx playwright test` | **18 / 18 passed** |
| Browser E2E, mobile Pixel 7 | (same run) | **18 / 18 passed** |
| Production build | `npm run build` | Passed (Vite still warns about `__dirname`/JSON import in the native config loader, unchanged from baseline) |
| Bundle secrets | `npm run check:bundle` | Passed: 16 forbidden patterns absent, including the values of the local `DATABASE_URL` and `POSTGRES_PASSWORD` |
| Dependency audit | `npm audit` and `npm audit --omit=dev` | **0 vulnerabilities** (production and development dependencies) |
| Docker image | `docker build -t ai-negoce:phase1 .` | Built; the build stage re-ran typecheck + tests in the container (440 passed, 22 skipped) and the build; runtime user `app` (uid 10001) |
| Container fail-closed | `docker run` without configuration; with `AUTH_MODE=local-dev` and all production variables | Exit 1 with "Production configuration incomplete: …"; exit 1 with "AUTH_MODE=local-dev is forbidden when NODE_ENV=production" |
| Live unauthorized / cross-tenant smoke | real API process (`local-dev`, PostgreSQL), 14 checks | **14 / 14 passed**: no token, legacy `dev-admin`, forged token → 401; proxied request → 403; commercial cannot list documents or edit rules → 403; organization B gets 404 on A's document, file and approval, does not see it in its list, and is refused the sandbox BI (403); `/me` reports the synthetic sandbox |

## 2. Coverage of the Phase 1 security requirements

| Requirement | Where it is tested |
|---|---|
| Unauthorized requests | `auth-hardening.test.ts` (every route without token, both modes), live smoke |
| Invalid credentials and tampering | `auth-hardening.test.ts`, `security.test.ts` |
| Privilege escalation | `auth-hardening.test.ts` (smuggled claims, role permissions), `financial.test.ts` (rules editing) |
| Accidental network exposure | `auth-hardening.test.ts` (config, proxy headers, real process binding), live LAN check (Step 1), container check |
| Cross-tenant access | `tenancy.test.ts`, `store.pg.test.ts`, `model.pg.test.ts` (row-level security), live smoke |
| Exact financial calculations | `financial.test.ts`, `invoice-validation.test.ts` |
| Misleading labels | `tenancy.test.ts` (`/me`), E2E label tests |

## 3. Not run / blocked

| Item | Reason |
|---|---|
| PostgreSQL 17 | Image now present locally, but migrations and the PostgreSQL suite were not run on 17. Outstanding deployment requirement (`00b` §7) |
| Real identity provider (OIDC) | No provider available; OIDC is exercised with a local RS256 issuer in tests only |
| Real AI-NÉGOCE ERP, OCR engine | Not available / out of Phase 1 scope |
| Docker Compose stack end-to-end (`docker-compose.yml`) | Requires OIDC and ERP endpoints; only the image and its startup refusal were verified |
| CI on GitHub | No remote configured; the workflow file was updated (bundle check) but not executed by GitHub |

## 4. Remaining defects and risks

1. **Frontend has no OIDC sign-in**: with `AUTH_MODE=oidc` the SPA cannot obtain a token. Blocks any pilot.
2. Permissions `invoice.correct`, `mapping.approve`, `erp.integrate` and their role assignment are not validated by the business; `settings.manage` is admin-only.
3. Financial rules: only unverified demonstration values exist; withholding tax, multi-currency and per-product tax treatment are not modelled. Customer approvals stay blocked until an accountant validates the organization's rules.
4. All validation issues, including warnings, still block approval until Phase 7 adds acknowledgement.
5. Organization status is cached 30 s (a suspension takes up to 30 s to apply).
6. `local-dev` trusts every user of the workstation.
7. `readyz` is public; Helmet CSP is disabled (Phase 12).
8. Docker build context includes everything not listed in `.dockerignore` (for instance the untracked `superpowers/` clone and `datasets/`); the runtime image only copies `server`, `scripts`, `migrations`, `dist`, `node_modules`, `package.json`.
9. BI 360 / ERP sandbox keep their own floating-point-to-millimes arithmetic (out of scope).
10. Two documents uploaded through the developer's dev server at 18:26 ("Nawras payment.pdf", "facture_test_ocr_tunisie.pdf") are stored in the demo organization of the local database and in `var/uploads/`; they were not created by tests and were left untouched.
