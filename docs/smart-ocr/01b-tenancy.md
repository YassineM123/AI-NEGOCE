# Phase 1 · Step 2 — Tenant isolation

- Date: 2026-10-20 · Builds on Step 1 (`690ee5e`).

## 1. Model

| Element | Implementation |
|---|---|
| Tenant | `organizations(id text PK, name, status active/suspended/quarantine, is_synthetic)`. The id is a slug `^[a-z0-9][a-z0-9-]{1,62}$` equal to the identity provider's organization claim |
| Tenant ownership | `organization_id NOT NULL` on `documents`, `invoice_extractions`, `approval_events`, `erp_sync`, `conversations`, `messages`, `audit_logs` (migration `002_tenancy.sql`) |
| Referential integrity | Child rows reference `(organization_id, id)` of their parent (composite foreign keys): a row can never point at another tenant's document or conversation |
| Uniqueness | Duplicate file = same `sha256` in the **same organization** (`uq_documents_org_sha`), whoever uploads it (previously per user) |
| Provisioning | `npm run org -- create <id> "<name>"`, `suspend`, `activate`, `list`. Logins never create organizations |

## 2. Where the tenant comes from

- `oidc`: the claim named by `OIDC_ORGANIZATION_CLAIM` (default `org_id`). Missing or malformed → 401. Unknown, suspended or quarantined organization → 403 `ORGANIZATION_INACTIVE`.
- `local-dev`: the server-side identity catalogue. Two synthetic organizations exist: `demo-fictive` (identities `admin`, `manager-sfax`, `commercial-tunis`) and `demo-fictive-b` (identity `admin-org-b`, to test isolation by hand). They are created on first use, flagged `is_synthetic`.
- No request parameter, header or body field can choose or widen the tenant (tested with `X-Organization-Id`, `X-Tenant`, `?organizationId=`). `/me` returns the organization resolved on the server.

## 3. Enforcement layers

1. **Application.** Routes only use `store.forTenant(req.principal.organizationId)`; every tenant query carries `organization_id = $1` explicitly. Cross-tenant lookups answer **404** (no existence leak).
2. **Database row-level security.** `ENABLE` + `FORCE ROW LEVEL SECURITY` with policy `organization_id = current_setting('app.organization_id', true)` on all tenant tables. Each store transaction runs `SET LOCAL ROLE ai_negoce_app` and sets `app.organization_id`; without it no row is visible and no row can be written. RLS is defence in depth, not a substitute for (1).
3. **Privileges.** `ai_negoce_app` has `SELECT/INSERT/UPDATE` on tenant tables, only `SELECT/INSERT` on `audit_logs` (append-only), `SELECT` on `organizations`.
4. **Files.** Stored under `UPLOAD_DIR/<organization_id>/<uuid>.<ext>`. `GET /api/v1/documents/:id/file` applies permission `documents.read`, the tenant-scoped lookup and the agency scope, checks the resolved path stays inside `UPLOAD_DIR`, and answers inline with `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store`; each read is audited (`document.file_read`).
5. **Synthetic ERP sandbox.** The SQLite ERP sandbox (dashboard, BI 360, management pages, lookups, ERP writes) and the Copilot data hold one fictitious company. Only `ERP_SANDBOX_ORGANIZATION` (default `demo-fictive`) may use them; every other organization gets 403 `ERP_SOURCE_UNAVAILABLE`. These modules' logic is unchanged; only the access guard was added.

## 4. Database role requirement (deployment)

The API's login role must be allowed to `SET ROLE ai_negoce_app` (`GRANT ai_negoce_app TO <login role>`). In production the login role should be a dedicated non-superuser that does not own the tables; migrations run with a separate owner role. Superusers and table owners bypass RLS unless they switch role, which the store always does.

## 5. Background jobs (design rule for Step 3 onward)

No background worker exists yet. Every job table carries `organization_id NOT NULL`; a worker must load the job, then perform all work through `store.forTenant(job.organization_id)`; the tenant is never inferred from document ids or file paths. Implemented with `processing_jobs` in Step 3.

## 6. Legacy records

Rows created before this migration have no verified owner. They are assigned to `legacy-unassigned` (status `quarantine`): no identity can belong to it, so they are unreachable. Reassigning them to a customer requires verified ownership and a manual, audited operation; nothing does it automatically. The local development database held no documents at migration time.

## 7. Migrations and rollback

- `npm run migrate` applies pending `migrations/NNN_name.sql` in order, each in a transaction, recorded in `schema_migrations` with a SHA-256 checksum (an edited applied file stops the run).
- `npm run migrate -- --down 002` applies `migrations/down/002_tenancy.down.sql` for the latest version only, refused when `NODE_ENV=production` (restore from backup there).
- Rollback limitation (tested): data created after tenancy can be invalid under the old rules (e.g. the same owner uploading one file in two organizations). The rollback then **fails atomically** on `uq_documents_sha_owner` and leaves the schema unchanged; such data must be resolved first.

## 8. Behaviour changes

- Duplicate detection is now organization-wide (was per user).
- Copilot conversations are scoped by organization in the store; the Copilot route logic is unchanged.
- Fixed a latent bug: `messages.sources` (jsonb) was written as a PostgreSQL array literal; it is now JSON.
- The API exits with an error when its port is unavailable (it previously could print "listening on null").
- Organization status is cached 30 s: a suspension takes effect within 30 s.

## 9. Tests

- `tests/qa/tenancy.test.ts` (25): claim validation (missing, empty, traversal, uppercase, too long), unknown/suspended/quarantined organizations, server-resolved `/me`, cross-tenant 404 on metadata, file and approval, list exclusion, ignored tenant hints, same user id in two organizations, per-organization duplicates, per-organization directories, audit organization, file download bytes/headers/audit, file permission and agency scope, sandbox access per organization, the two development organizations.
- `server/store.pg.test.ts` (7, PostgreSQL): persistence, per-organization duplicates, cross-tenant invisibility and immutability through the store, composite key refusal, raw-SQL RLS as the application role (no tenant → 0 rows; foreign tenant → 0 rows, 0 updates, insert refused), append-only audit, quarantined holding organization, full down/up round-trip, atomic refusal of an unsafe rollback.
- Live check against PostgreSQL 16.14 with two development organizations: isolation of read/file/list, per-organization duplicates, sandbox refusal, per-organization directories.
