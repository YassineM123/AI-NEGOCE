-- Rollback refuses while rejected documents exist: reopen or delete them first.
ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('queued', 'processing', 'needs_review', 'approved', 'failed', 'submitted'));
