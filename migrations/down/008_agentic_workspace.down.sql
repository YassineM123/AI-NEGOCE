-- Rollback of Agentic workspace persistence. WARNING: deletes all Agentic missions,
-- chat messages, notification history and approval records for every organization.
DROP TABLE IF EXISTS agentic_workspaces;
