-- 003 Smart OCR data model.
-- Every table is tenant-owned (organization_id), references parents through
-- (organization_id, id) so cross-tenant links are impossible, uses exact numeric types for
-- amounts, quantities, rates and conversion factors, and is protected by row-level security.
-- OCR observations are immutable; human corrections are a separate append-only history.
-- Rollback: migrations/down/003_smart_ocr_model.down.sql.

-- Users as seen through the identity provider (role and agencies are copied for history;
-- authorization always uses the verified token).
CREATE TABLE users (
  organization_id text NOT NULL REFERENCES organizations(id),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 200),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'manager', 'accountant', 'commercial')),
  agencies text[] NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id)
);

-- ERP reference data (synchronized in Phase 2; source records where it came from).
CREATE TABLE erp_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  external_id text NOT NULL,
  name text NOT NULL,
  tax_id text,
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('erp_api', 'erp_db', 'csv_import', 'sandbox')),
  catalog_version bigint NOT NULL CHECK (catalog_version >= 1),
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX ix_erp_suppliers_tax ON erp_suppliers (organization_id, tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE erp_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  external_id text NOT NULL,
  sku text,
  designation text NOT NULL,
  normalized_designation text,
  category text,
  brand text,
  stock_unit text NOT NULL,
  gtin text CHECK (gtin ~ '^[0-9]{8,14}$'),
  vat_rate numeric(7,4) CHECK (vat_rate >= 0 AND vat_rate < 100),
  attributes jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('erp_api', 'erp_db', 'csv_import', 'sandbox')),
  catalog_version bigint NOT NULL CHECK (catalog_version >= 1),
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, external_id)
);
CREATE INDEX ix_erp_products_sku ON erp_products (organization_id, sku);
CREATE INDEX ix_erp_products_gtin ON erp_products (organization_id, gtin) WHERE gtin IS NOT NULL;

-- Supplier references published by the ERP catalog (not human approvals). One reference
-- may point at several products: conflicts are detected by matching, not hidden here.
CREATE TABLE supplier_product_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  supplier_id uuid NOT NULL,
  supplier_reference text NOT NULL,
  normalized_reference text NOT NULL,
  erp_product_id uuid NOT NULL,
  purchase_unit text,
  units_per_purchase_unit numeric(20,6) CHECK (units_per_purchase_unit > 0),
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('erp_api', 'erp_db', 'csv_import', 'sandbox')),
  catalog_version bigint NOT NULL CHECK (catalog_version >= 1),
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, supplier_id, normalized_reference, erp_product_id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES erp_suppliers (organization_id, id),
  FOREIGN KEY (organization_id, erp_product_id) REFERENCES erp_products (organization_id, id)
);
CREATE INDEX ix_supplier_refs_lookup ON supplier_product_references (organization_id, supplier_id, normalized_reference);

-- Human-approved reusable supplier mappings. Versioned; never deleted by the application;
-- at most one active mapping per (supplier, normalized reference).
CREATE TABLE product_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  supplier_id uuid NOT NULL,
  supplier_reference text NOT NULL,
  normalized_reference text NOT NULL,
  erp_product_id uuid NOT NULL,
  purchase_unit text NOT NULL,
  stock_unit text NOT NULL,
  conversion_factor numeric(20,6) NOT NULL CHECK (conversion_factor > 0),
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  mapping_version integer NOT NULL CHECK (mapping_version >= 1),
  catalog_version bigint NOT NULL CHECK (catalog_version >= 1),
  status text NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid', 'flagged_product_unavailable', 'flagged_incompatible', 'superseded', 'revoked')),
  active boolean NOT NULL DEFAULT true,
  supersedes uuid,
  CHECK (NOT active OR status = 'valid'),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, supplier_id, normalized_reference, mapping_version),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES erp_suppliers (organization_id, id),
  FOREIGN KEY (organization_id, erp_product_id) REFERENCES erp_products (organization_id, id),
  FOREIGN KEY (organization_id, approved_by) REFERENCES users (organization_id, id),
  FOREIGN KEY (organization_id, supersedes) REFERENCES product_mappings (organization_id, id)
);
CREATE UNIQUE INDEX uq_product_mappings_active
  ON product_mappings (organization_id, supplier_id, normalized_reference) WHERE active;

-- Asynchronous work (OCR, matching, validation); the tenant travels with the job.
CREATE TABLE processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  document_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ocr_extraction', 'matching', 'validation')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempts <= max_attempts),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id)
);
CREATE INDEX ix_processing_jobs_queue ON processing_jobs (run_after) WHERE status = 'queued';

-- Extractions become referencable per tenant.
ALTER TABLE invoice_extractions ADD CONSTRAINT uq_extractions_org_id UNIQUE (organization_id, id);

-- Invoice header: effective (reviewed) values. Amounts numeric(20,6): exact; the business
-- precision and rounding (3 decimals for TND) are applied by the financial rules (Step 4).
CREATE TABLE invoice_headers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  document_id uuid NOT NULL,
  extraction_id uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'review_required', 'approved', 'rejected', 'integrated', 'integration_failed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supplier_id uuid,
  supplier_name text,
  supplier_tax_id text,
  invoice_number text,
  invoice_date date,
  due_date date,
  currency char(3) CHECK (currency ~ '^[A-Z]{3}$'),
  purchase_order_ref text,
  total_ht numeric(20,6),
  total_vat numeric(20,6),
  total_stamp numeric(20,6),
  total_ttc numeric(20,6),
  approved_by text,
  approved_at timestamptz,
  approved_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('approved', 'integrated', 'integration_failed')
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_version IS NOT NULL)),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, document_id),
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id),
  FOREIGN KEY (organization_id, extraction_id) REFERENCES invoice_extractions (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id) REFERENCES erp_suppliers (organization_id, id),
  FOREIGN KEY (organization_id, approved_by) REFERENCES users (organization_id, id)
);
-- A supplier invoice number can be approved only once per organization.
CREATE UNIQUE INDEX uq_invoice_headers_approved_number
  ON invoice_headers (organization_id, supplier_id, upper(invoice_number))
  WHERE status IN ('approved', 'integrated', 'integration_failed') AND supplier_id IS NOT NULL AND invoice_number IS NOT NULL;

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  invoice_id uuid NOT NULL,
  line_no integer NOT NULL CHECK (line_no >= 1),
  description text,
  supplier_reference text,
  normalized_reference text,
  quantity numeric(20,6),
  purchase_unit text,
  unit_price numeric(20,6),
  discount_pct numeric(7,4) CHECK (discount_pct >= 0 AND discount_pct <= 100),
  vat_rate numeric(7,4) CHECK (vat_rate >= 0 AND vat_rate < 100),
  line_ht numeric(20,6),
  line_vat numeric(20,6),
  erp_product_id uuid,
  mapping_id uuid,
  conversion_factor numeric(20,6) CHECK (conversion_factor > 0),
  stock_quantity numeric(20,6),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, invoice_id, line_no),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice_headers (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, erp_product_id) REFERENCES erp_products (organization_id, id),
  FOREIGN KEY (organization_id, mapping_id) REFERENCES product_mappings (organization_id, id)
);

-- Original OCR values, immutable (the application may only insert and read).
CREATE TABLE invoice_field_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  invoice_id uuid NOT NULL,
  line_id uuid,
  extraction_id uuid,
  field text NOT NULL CHECK (field ~ '^[a-zA-Z][a-zA-Z0-9_.]{0,63}$'),
  raw_value text,
  normalized_value text,
  confidence numeric(5,4) CHECK (confidence >= 0 AND confidence <= 1),
  page integer CHECK (page >= 1),
  bbox jsonb,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice_headers (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, line_id) REFERENCES invoice_lines (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, extraction_id) REFERENCES invoice_extractions (organization_id, id)
);
CREATE INDEX ix_observations_invoice ON invoice_field_observations (organization_id, invoice_id);

-- Human corrections, append-only, linked to the observation they override.
CREATE TABLE invoice_field_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  invoice_id uuid NOT NULL,
  line_id uuid,
  observation_id uuid,
  field text NOT NULL CHECK (field ~ '^[a-zA-Z][a-zA-Z0-9_.]{0,63}$'),
  previous_value text,
  corrected_value text,
  reason text,
  corrected_by text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  invoice_version integer NOT NULL CHECK (invoice_version >= 1),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice_headers (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, line_id) REFERENCES invoice_lines (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, observation_id) REFERENCES invoice_field_observations (organization_id, id),
  FOREIGN KEY (organization_id, corrected_by) REFERENCES users (organization_id, id)
);
CREATE INDEX ix_corrections_invoice ON invoice_field_corrections (organization_id, invoice_id, corrected_at);

-- Matching decisions: one current decision per line; history kept (current = false).
CREATE TABLE matching_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  invoice_line_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('verified_mapping', 'recommended', 'ambiguous', 'unmatched', 'blocked', 'manually_confirmed')),
  erp_product_id uuid,
  mapping_id uuid,
  ranking_score numeric(6,5) CHECK (ranking_score >= 0 AND ranking_score <= 1),
  candidates jsonb NOT NULL DEFAULT '[]',
  blocking_conflicts jsonb NOT NULL DEFAULT '[]',
  decided_by text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  engine_version text,
  catalog_version bigint,
  current boolean NOT NULL DEFAULT true,
  CHECK (status NOT IN ('verified_mapping', 'manually_confirmed') OR erp_product_id IS NOT NULL),
  CHECK (status <> 'verified_mapping' OR mapping_id IS NOT NULL),
  CHECK (status <> 'manually_confirmed' OR decided_by IS NOT NULL),
  FOREIGN KEY (organization_id, invoice_line_id) REFERENCES invoice_lines (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, erp_product_id) REFERENCES erp_products (organization_id, id),
  FOREIGN KEY (organization_id, mapping_id) REFERENCES product_mappings (organization_id, id),
  FOREIGN KEY (organization_id, decided_by) REFERENCES users (organization_id, id)
);
CREATE UNIQUE INDEX uq_matching_decisions_current ON matching_decisions (organization_id, invoice_line_id) WHERE current;

CREATE TABLE validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  invoice_id uuid NOT NULL,
  line_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  severity text NOT NULL CHECK (severity IN ('blocking', 'warning', 'info')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  invoice_version integer NOT NULL CHECK (invoice_version >= 1),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL)),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice_headers (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, line_id) REFERENCES invoice_lines (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, resolved_by) REFERENCES users (organization_id, id)
);
CREATE INDEX ix_validation_open ON validation_issues (organization_id, invoice_id) WHERE resolved_at IS NULL;

-- Review / approval history: reuse approval_events.
ALTER TABLE approval_events ADD COLUMN invoice_id uuid;
ALTER TABLE approval_events ADD COLUMN invoice_version integer CHECK (invoice_version >= 1);
ALTER TABLE approval_events ADD CONSTRAINT fk_approval_events_invoice
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice_headers (organization_id, id);
ALTER TABLE approval_events DROP CONSTRAINT approval_events_decision_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_decision_check
  CHECK (decision IN ('approved', 'rejected', 'corrected', 'reopened', 'mapping_approved', 'mapping_revoked'));

-- ERP integration jobs: reuse erp_sync (one integration per document, idempotency key).
ALTER TABLE erp_sync ADD COLUMN invoice_id uuid;
ALTER TABLE erp_sync ADD COLUMN invoice_version integer CHECK (invoice_version >= 1);
ALTER TABLE erp_sync ADD COLUMN payload_sha256 text CHECK (payload_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE erp_sync ADD COLUMN next_attempt_at timestamptz;
ALTER TABLE erp_sync ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE erp_sync ADD CONSTRAINT fk_erp_sync_invoice
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoice_headers (organization_id, id);
-- Enforced for new rows; NOT VALID leaves any pre-existing free-text status untouched.
ALTER TABLE erp_sync ADD CONSTRAINT erp_sync_status_check
  CHECK (status IN ('pending', 'sending', 'confirmed', 'failed', 'blocked')) NOT VALID;
ALTER TABLE erp_sync ADD CONSTRAINT erp_sync_attempts_check CHECK (attempts >= 0) NOT VALID;

-- Row-level security and least privilege for the new tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'erp_suppliers', 'erp_products', 'supplier_product_references', 'product_mappings',
    'processing_jobs', 'invoice_headers', 'invoice_lines', 'invoice_field_observations', 'invoice_field_corrections',
    'matching_decisions', 'validation_issues'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)) WITH CHECK (organization_id = current_setting(''app.organization_id'', true))',
      t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON users, erp_suppliers, erp_products, supplier_product_references, product_mappings,
  processing_jobs, invoice_headers, invoice_lines, matching_decisions, validation_issues TO ai_negoce_app;
-- Original OCR values and correction history are append-only for the application.
GRANT SELECT, INSERT ON invoice_field_observations, invoice_field_corrections TO ai_negoce_app;
-- Draft invoice lines may be replaced before approval.
GRANT DELETE ON invoice_lines TO ai_negoce_app;
