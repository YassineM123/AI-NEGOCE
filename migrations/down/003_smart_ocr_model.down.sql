-- Rollback of 003_smart_ocr_model (development only). Drops the Smart OCR model and all
-- data it holds (mappings, invoices, corrections, decisions). Take a backup first.
ALTER TABLE erp_sync DROP CONSTRAINT IF EXISTS erp_sync_attempts_check;
ALTER TABLE erp_sync DROP CONSTRAINT IF EXISTS erp_sync_status_check;
ALTER TABLE erp_sync DROP CONSTRAINT IF EXISTS fk_erp_sync_invoice;
ALTER TABLE erp_sync DROP COLUMN created_at;
ALTER TABLE erp_sync DROP COLUMN next_attempt_at;
ALTER TABLE erp_sync DROP COLUMN payload_sha256;
ALTER TABLE erp_sync DROP COLUMN invoice_version;
ALTER TABLE erp_sync DROP COLUMN invoice_id;

-- Fails (and rolls back) if events use decisions unknown before 003.
ALTER TABLE approval_events DROP CONSTRAINT approval_events_decision_check;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_decision_check
  CHECK (decision IN ('approved', 'rejected', 'corrected'));
ALTER TABLE approval_events DROP CONSTRAINT IF EXISTS fk_approval_events_invoice;
ALTER TABLE approval_events DROP COLUMN invoice_version;
ALTER TABLE approval_events DROP COLUMN invoice_id;

DROP TABLE validation_issues;
DROP TABLE matching_decisions;
DROP TABLE invoice_field_corrections;
DROP TABLE invoice_field_observations;
DROP TABLE invoice_lines;
DROP TABLE invoice_headers;
ALTER TABLE invoice_extractions DROP CONSTRAINT uq_extractions_org_id;
DROP TABLE processing_jobs;
DROP TABLE product_mappings;
DROP TABLE supplier_product_references;
DROP TABLE erp_products;
DROP TABLE erp_suppliers;
DROP TABLE users;
