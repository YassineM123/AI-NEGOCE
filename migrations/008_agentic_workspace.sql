-- 008: Agentic durable workflow state (bounded MVP per organization).
-- One locked JSONB aggregate per organization guarantees atomic mission/approval/notification
-- transitions under concurrent requests. Replace with normalized tables at scale.
CREATE TABLE IF NOT EXISTS agentic_workspaces (
  organization_id text PRIMARY KEY REFERENCES organizations(id),
  payload jsonb NOT NULL DEFAULT '{"missions":[],"approvals":[],"notifications":[],"messages":[]}'::jsonb,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_agentic_workspace_shape CHECK (jsonb_typeof(payload) = 'object')
);
ALTER TABLE agentic_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentic_workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY agentic_workspace_isolation ON agentic_workspaces
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
GRANT SELECT, INSERT, UPDATE ON agentic_workspaces TO ai_negoce_app;
