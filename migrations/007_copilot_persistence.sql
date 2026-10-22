-- 007 Copilot 2.0: Conversation persistence, event streaming audit, and user preferences.
-- Rollback: migrations/down/007_copilot_persistence.down.sql.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS ix_conversations_org_owner_updated ON conversations (organization_id, owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  conversation_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_conversation_events_conv FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_conversation_events_org_conv ON conversation_events (organization_id, conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS user_memory_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id),
  user_id text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_memory_pref UNIQUE (organization_id, user_id, key)
);
CREATE INDEX IF NOT EXISTS ix_user_memory_prefs_user ON user_memory_preferences (organization_id, user_id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversation_events', 'user_memory_preferences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)) WITH CHECK (organization_id = current_setting(''app.organization_id'', true))',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO ai_negoce_app', t);
  END LOOP;
  -- Enable DELETE and UPDATE on conversations and messages for ai_negoce_app
  GRANT UPDATE, DELETE ON conversations TO ai_negoce_app;
  GRANT DELETE ON messages TO ai_negoce_app;
END $$;
