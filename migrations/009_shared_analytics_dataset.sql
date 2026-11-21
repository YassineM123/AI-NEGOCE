-- 009: Shared read-only analytics snapshot for BI, Data Science and Agentic.
-- Imported explicitly by an offline demo seed; no ERP write-back.
-- One atomic payload per tenant keeps one revision across all three applications.
CREATE TABLE analytics_datasets (
  organization_id text PRIMARY KEY REFERENCES organizations(id),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_kind text NOT NULL CHECK (source_kind IN ('synthetic', 'extractions')),
  source_hash text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_analytics_dataset_shape CHECK (
    jsonb_typeof(payload)='object'
    AND jsonb_typeof(payload->'sales')='array'
    AND jsonb_typeof(payload->'receivables')='array'
    AND jsonb_typeof(payload->'inventory')='array'
    AND jsonb_typeof(payload->'metadata')='object'
  )
);
ALTER TABLE analytics_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_datasets FORCE ROW LEVEL SECURITY;
CREATE POLICY analytics_dataset_tenant ON analytics_datasets
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
GRANT SELECT, INSERT, UPDATE ON analytics_datasets TO ai_negoce_app;
