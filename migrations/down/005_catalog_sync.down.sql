-- Destructive rollback: export catalog sync history before applying.
DROP TABLE catalog_sync_jobs;
ALTER TABLE erp_products DROP COLUMN packaging;
