-- Admin mailings: a library of email templates, campaigns sent from a template snapshot,
-- the per-recipient queue (one row per letter, at most one letter per user and campaign)
-- and the platform-wide unsubscribe list. References are checked in the application.

CREATE TABLE mailing_templates (
  id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  preheader VARCHAR(200) NOT NULL DEFAULT '',
  body_markdown MEDIUMTEXT NOT NULL,
  cta_label VARCHAR(80) NULL DEFAULT NULL,
  cta_url VARCHAR(500) NULL DEFAULT NULL,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- id is the launch request id from the client: a retried launch finds the same row.
CREATE TABLE mailing_campaigns (
  id CHAR(36) NOT NULL,
  template_id CHAR(36) NULL DEFAULT NULL,
  name VARCHAR(120) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  preheader VARCHAR(200) NOT NULL DEFAULT '',
  body_markdown MEDIUMTEXT NOT NULL,
  cta_label VARCHAR(80) NULL DEFAULT NULL,
  cta_url VARCHAR(500) NULL DEFAULT NULL,
  audience JSON NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status ENUM('sending','completed','cancelled') NOT NULL DEFAULT 'sending',
  total_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP NULL DEFAULT NULL,
  cancelled_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_mailing_campaigns_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The durable queue. Name/email/workspace are snapshots taken at launch.
CREATE TABLE mailing_recipients (
  campaign_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  workspace_name VARCHAR(120) NULL DEFAULT NULL,
  status ENUM('queued','sending','sent','failed','skipped','cancelled') NOT NULL DEFAULT 'queued',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NULL DEFAULT NULL,
  locked_at TIMESTAMP NULL DEFAULT NULL,
  sent_at TIMESTAMP NULL DEFAULT NULL,
  error VARCHAR(255) NULL DEFAULT NULL,
  PRIMARY KEY (campaign_id, user_id),
  KEY idx_mailing_recipients_due (status, next_attempt_at),
  KEY idx_mailing_recipients_sent (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mailing_unsubscribes (
  user_id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
