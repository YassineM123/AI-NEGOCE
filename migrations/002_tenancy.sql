-- 002 Tenant isolation.
-- Organizations; tenant ownership on every tenant record; tenant-consistent foreign keys
-- (organization_id, id); row-level security as defence in depth (application queries are
-- also scoped explicitly). Rollback: migrations/down/002_tenancy.down.sql.

CREATE TABLE organizations (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'quarantine')),
  is_synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Rows created before tenancy existed have no verified owner. They go to a holding
-- organization in quarantine: no identity can belong to it, so they are unreachable
-- until an administrator reassigns them with verified ownership.
INSERT INTO organizations (id, name, status)
VALUES ('legacy-unassigned', 'Données antérieures non attribuées (accès bloqué)', 'quarantine');

-- documents
ALTER TABLE documents ADD COLUMN organization_id text REFERENCES organizations(id);
UPDATE documents SET organization_id = 'legacy-unassigned';
ALTER TABLE documents ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE documents ADD CONSTRAINT uq_documents_org_id UNIQUE (organization_id, id);
DROP INDEX IF EXISTS uq_documents_sha_owner;
-- Same file twice in one organization = duplicate, whoever uploads it. Legacy rows keep
-- their old per-owner semantics and are excluded.
CREATE UNIQUE INDEX uq_documents_org_sha ON documents (organization_id, sha256)
  WHERE organization_id <> 'legacy-unassigned';
CREATE INDEX ix_documents_org_created ON documents (organization_id, created_at DESC);

-- invoice_extractions
ALTER TABLE invoice_extractions ADD COLUMN organization_id text;
UPDATE invoice_extractions e SET organization_id = d.organization_id FROM documents d WHERE d.id = e.document_id;
ALTER TABLE invoice_extractions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE invoice_extractions DROP CONSTRAINT invoice_extractions_document_id_fkey;
ALTER TABLE invoice_extractions ADD CONSTRAINT fk_extractions_document
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX uq_extractions_document_version ON invoice_extractions (document_id, version);

-- approval_events
ALTER TABLE approval_events ADD COLUMN organization_id text;
UPDATE approval_events a SET organization_id = d.organization_id FROM documents d WHERE d.id = a.document_id;
ALTER TABLE approval_events ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE approval_events DROP CONSTRAINT approval_events_document_id_fkey;
ALTER TABLE approval_events ADD CONSTRAINT fk_approval_events_document
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id);

-- erp_sync
ALTER TABLE erp_sync ADD COLUMN organization_id text;
UPDATE erp_sync s SET organization_id = d.organization_id FROM documents d WHERE d.id = s.document_id;
ALTER TABLE erp_sync ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE erp_sync DROP CONSTRAINT erp_sync_document_id_fkey;
ALTER TABLE erp_sync ADD CONSTRAINT fk_erp_sync_document
  FOREIGN KEY (organization_id, document_id) REFERENCES documents (organization_id, id);

-- conversations / messages
ALTER TABLE conversations ADD COLUMN organization_id text REFERENCES organizations(id);
UPDATE conversations SET organization_id = 'legacy-unassigned';
ALTER TABLE conversations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE conversations ADD CONSTRAINT uq_conversations_org_id UNIQUE (organization_id, id);
ALTER TABLE messages ADD COLUMN organization_id text;
UPDATE messages m SET organization_id = c.organization_id FROM conversations c WHERE c.id = m.conversation_id;
ALTER TABLE messages ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_conversation_id_fkey;
ALTER TABLE messages ADD CONSTRAINT fk_messages_conversation
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id) ON DELETE CASCADE;

-- audit_logs
ALTER TABLE audit_logs ADD COLUMN organization_id text REFERENCES organizations(id);
UPDATE audit_logs SET organization_id = 'legacy-unassigned';
ALTER TABLE audit_logs ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX ix_audit_org_resource ON audit_logs (organization_id, resource_type, resource_id, created_at DESC);

-- Row-level security. The API switches to ai_negoce_app (SET LOCAL ROLE) and sets
-- app.organization_id for every tenant transaction; without that setting no row matches.
-- Superusers and the table owner bypass RLS unless they switch role, which is why the
-- application never queries tenant tables as the login role.
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_negoce_app') THEN
    CREATE ROLE ai_negoce_app NOLOGIN;
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO ai_negoce_app', current_schema());
  FOREACH t IN ARRAY ARRAY['documents', 'invoice_extractions', 'approval_events', 'erp_sync', 'conversations', 'messages', 'audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = current_setting(''app.organization_id'', true)) WITH CHECK (organization_id = current_setting(''app.organization_id'', true))',
      t);
  END LOOP;
  GRANT SELECT ON organizations TO ai_negoce_app;
  GRANT SELECT, INSERT, UPDATE ON documents, invoice_extractions, approval_events, erp_sync, conversations, messages TO ai_negoce_app;
  -- Audit trail is append-only for the application.
  GRANT SELECT, INSERT ON audit_logs TO ai_negoce_app;
  EXECUTE format('GRANT USAGE ON ALL SEQUENCES IN SCHEMA %I TO ai_negoce_app', current_schema());
END $$;
