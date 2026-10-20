-- Rollback of 002_tenancy (development only). Drops tenant ownership: rows of every
-- organization become indistinguishable again. Take a backup first.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents', 'invoice_extractions', 'approval_events', 'erp_sync', 'conversations', 'messages', 'audit_logs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM ai_negoce_app', current_schema());
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM ai_negoce_app', current_schema());
  EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM ai_negoce_app', current_schema());
END $$;

DROP INDEX IF EXISTS ix_audit_org_resource;
ALTER TABLE audit_logs DROP COLUMN organization_id;

ALTER TABLE messages DROP CONSTRAINT fk_messages_conversation;
ALTER TABLE messages DROP COLUMN organization_id;
ALTER TABLE messages ADD CONSTRAINT messages_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE conversations DROP CONSTRAINT uq_conversations_org_id;
ALTER TABLE conversations DROP COLUMN organization_id;

ALTER TABLE erp_sync DROP CONSTRAINT fk_erp_sync_document;
ALTER TABLE erp_sync DROP COLUMN organization_id;
ALTER TABLE approval_events DROP CONSTRAINT fk_approval_events_document;
ALTER TABLE approval_events DROP COLUMN organization_id;
DROP INDEX IF EXISTS uq_extractions_document_version;
ALTER TABLE invoice_extractions DROP CONSTRAINT fk_extractions_document;
ALTER TABLE invoice_extractions DROP COLUMN organization_id;

DROP INDEX IF EXISTS ix_documents_org_created;
DROP INDEX IF EXISTS uq_documents_org_sha;
ALTER TABLE documents DROP CONSTRAINT uq_documents_org_id;
ALTER TABLE documents DROP COLUMN organization_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_sha_owner ON documents(owner_id, sha256);

ALTER TABLE invoice_extractions ADD CONSTRAINT invoice_extractions_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;
ALTER TABLE approval_events ADD CONSTRAINT approval_events_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES documents(id);
ALTER TABLE erp_sync ADD CONSTRAINT erp_sync_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES documents(id);

DROP TABLE organizations;
