-- Rollback for 007_copilot_persistence.sql
DROP TABLE IF EXISTS user_memory_preferences;
DROP TABLE IF EXISTS conversation_events;
DROP INDEX IF EXISTS ix_conversations_org_owner_updated;
ALTER TABLE conversations DROP COLUMN IF EXISTS updated_at;
