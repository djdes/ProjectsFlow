-- Keep authorship and project ownership intact while disabling the account.
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL;
