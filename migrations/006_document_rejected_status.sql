-- The reject endpoint moves a document to 'rejected', but the original status CHECK
-- (001_initial) never allowed it, so every rejection failed with a constraint violation.
ALTER TABLE documents DROP CONSTRAINT documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('queued', 'processing', 'needs_review', 'approved', 'rejected', 'failed', 'submitted'));
