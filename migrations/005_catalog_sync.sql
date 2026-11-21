-- Catalog synchronization is tenant-owned and retains history. Rollback provided separately.
ALTER TABLE erp_products ADD COLUMN packaging text;
CREATE TABLE catalog_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  source text NOT NULL CHECK (source IN ('sandbox','csv_import','erp_api')),
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  counts jsonb NOT NULL DEFAULT '{}',
  errors jsonb NOT NULL DEFAULT '[]',
  catalog_version bigint NOT NULL CHECK (catalog_version > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, catalog_version)
);
CREATE INDEX ix_catalog_sync_latest ON catalog_sync_jobs (organization_id, started_at DESC);
ALTER TABLE catalog_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_sync_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON catalog_sync_jobs
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
GRANT SELECT, INSERT, UPDATE ON catalog_sync_jobs TO ai_negoce_app;
