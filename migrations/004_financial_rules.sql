-- 004 Financial rules per organization (currency, precision, rounding, VAT rates, stamp duty,
-- tolerance, discount threshold). The rules document is validated by the API
-- (server/financial-rules.ts); verification is recorded with the verifying user.
-- Rollback: migrations/down/004_financial_rules.down.sql.
CREATE TABLE organization_financial_rules (
  organization_id text PRIMARY KEY REFERENCES organizations(id),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  verified boolean NOT NULL DEFAULT false,
  verified_by text,
  verified_at timestamptz,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (NOT verified OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  FOREIGN KEY (organization_id, verified_by) REFERENCES users (organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES users (organization_id, id)
);
ALTER TABLE organization_financial_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_financial_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_financial_rules
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
GRANT SELECT, INSERT, UPDATE ON organization_financial_rules TO ai_negoce_app;
