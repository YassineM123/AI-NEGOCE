# Phase 1 · Step 3 — Smart OCR data architecture

- Date: 2026-10-20 · Migrations `001_initial`, `002_tenancy`, `003_smart_ocr_model` (PostgreSQL 16.14 tested; 17 outstanding, see `00b` §7).
- Stack: PostgreSQL through `pg` with parameterized SQL (no ORM, as before).

## 1. Entity map

```text
organizations ─┬─ users (organization_id, id = identity-provider subject)
               ├─ documents ── invoice_extractions (versioned OCR payloads)
               │      ├─ processing_jobs (OCR / matching / validation work, tenant carried)
               │      └─ invoice_headers ─┬─ invoice_lines ─┬─ matching_decisions
               │                          │                 └─ (mapping_id) → product_mappings
               │                          ├─ invoice_field_observations  (OCR originals, immutable)
               │                          ├─ invoice_field_corrections   (human, append-only)
               │                          ├─ validation_issues
               │                          ├─ approval_events (review / approval history, reused)
               │                          └─ erp_sync (ERP integration jobs, reused)
               ├─ erp_suppliers ─┬─ supplier_product_references (from the ERP catalog)
               ├─ erp_products  ─┴─ product_mappings (human-approved, versioned)
               ├─ conversations ── messages
               └─ audit_logs
```

| Required entity | Table | Notes |
|---|---|---|
| Organizations | `organizations` | Step 2 |
| Users and roles | `users` | Upserted from the verified token (refresh ≤ 10 min); role/agencies kept for history. Authorization always uses the token |
| Documents | `documents` | Reused |
| Processing jobs | `processing_jobs` | Queue index on `run_after` for `queued`; `attempts ≤ max_attempts` |
| Invoice headers | `invoice_headers` | Effective (reviewed) values; `version` for optimistic concurrency |
| Invoice line items | `invoice_lines` | Quantity, unit price, discount, VAT rate, amounts, conversion factor, stock quantity |
| ERP products | `erp_products` | `external_id` unique per organization; `catalog_version`; `active` |
| Suppliers | `erp_suppliers` | `external_id` unique per organization; tax id indexed |
| Supplier-specific product references | `supplier_product_references` | From the ERP catalog; one reference may legitimately point at several products (conflict detection belongs to matching) |
| Product mappings | `product_mappings` | Human-approved, see §3 |
| Matching decisions | `matching_decisions` | One `current` decision per line; history kept |
| Validation issues | `validation_issues` | Severity, invoice version, resolution by a known user |
| Review / approval history | `approval_events` | Reused, extended with `invoice_id`, `invoice_version`, more decisions |
| ERP integration jobs | `erp_sync` | Reused, extended with invoice version, payload hash, scheduling |
| Audit events | `audit_logs` | Append-only for the application |

## 2. Cross-cutting rules

- **Tenancy.** Every table has `organization_id NOT NULL`; every parent link is a composite `(organization_id, id)` foreign key; `FORCE ROW LEVEL SECURITY` on every tenant table (Step 2).
- **Exact numbers.** Amounts and quantities `numeric(20,6)`; rates `numeric(7,4)` (percent, `0 ≤ rate < 100`); confidences `numeric(5,4)` in `[0,1]`, nullable (never invented); ranking scores `numeric(6,5)`. Business precision and rounding (3 decimals for TND) are applied by the financial rules (Step 4), not by the column type.
- **Originals vs corrections.** `invoice_field_observations` stores what the OCR read (raw and normalized value, nullable confidence, page, bounding box, provider, extraction). `invoice_field_corrections` stores each human change (previous value, corrected value, reason, user, invoice version) linked to the observation. The application role can only `INSERT`/`SELECT` both tables. `invoice_headers`/`invoice_lines` hold the effective values.
- **Least privilege.** `ai_negoce_app` has no `DELETE` anywhere except `invoice_lines` (draft lines may be replaced before approval).

## 3. Product mappings

| Requirement | Enforcement |
|---|---|
| Supplier, reference, ERP product | `supplier_id`, `supplier_reference`, `normalized_reference`, `erp_product_id` (composite FKs, same organization) |
| Purchase unit, stock unit, conversion factor | `NOT NULL`; `conversion_factor > 0` |
| Approving user and timestamp | `approved_by` → `users (organization_id, id)`; `approved_at` |
| Mapping version, catalog version | `mapping_version ≥ 1` unique per (supplier, reference); `catalog_version` |
| Active status | `active` only when `status = 'valid'`; statuses `valid`, `flagged_product_unavailable`, `flagged_incompatible`, `superseded`, `revoked` |
| No conflicting active mappings | partial unique index on (organization, supplier, normalized reference) `WHERE active` |
| Never silently deleted | no `DELETE` privilege; replaced by a new version (`supersedes`) |

## 4. Invoices

- One invoice per document (`UNIQUE (organization_id, document_id)`).
- `approved`, `integrated`, `integration_failed` require `approved_by`, `approved_at`, `approved_version`.
- A supplier invoice number can be approved only once per organization (`uq_invoice_headers_approved_number`, case-insensitive); drafts may share it so duplicates can be reviewed.
- `matching_decisions`: `verified_mapping` requires a product and a mapping; `manually_confirmed` requires a product and a deciding user.

## 5. Application code in this step

- `TenantStore.recordUser` (called by the tenant middleware) and `TenantStore.recordApprovalEvent` (the approve route now writes `approval_events`; it previously wrote none).
- Repositories for invoices, lines, observations, mappings and decisions are added with the features that use them (Phases 2–7), so no untested code path exists ahead of its feature.

## 6. Migrations and rollback procedure

| Action | Command |
|---|---|
| Apply pending | `npm run migrate` (each file in a transaction; checksum recorded in `schema_migrations`) |
| Status | `SELECT * FROM schema_migrations ORDER BY version` |
| Roll back latest (development) | `npm run migrate -- --down 003`, then `--down 002` (one version at a time, newest first; refused when `NODE_ENV=production`) |
| Roll back in production | Restore the pre-deployment `pg_dump` (see `DEPLOYMENT_GUIDE.md`); never run down scripts on production data |

Rollback consequences:
- `003` down drops every Smart OCR table and its data, and fails atomically if `approval_events` holds decisions introduced by 003.
- `002` down removes tenant ownership; it fails atomically when post-tenancy data violates pre-tenancy rules (tested).
- `001` has no down script (initial schema).

All down scripts are exercised by `server/store.pg.test.ts` (full down/up round-trip on a fresh schema).

## 7. Tests

`server/model.pg.test.ts` (14, as the application role with RLS): single active mapping and versioning; positive conversion factor; approver must exist in the same organization; active ⇒ valid; no deletion of mappings; cross-tenant supplier/product references refused; immutable observations and append-only corrections (OCR value and human value both retrievable); confidence range and field-name format; evidence required for verified/manual decisions; one current decision per line; approval requires approver/version; supplier invoice number approved once per organization, case-insensitive, other organizations unaffected; exact numeric storage (`0.1 × 3 = 0.300000`); RLS on the new tables; bounded job attempts. Plus `tenancy.test.ts`: approval event and user record written by the API.
