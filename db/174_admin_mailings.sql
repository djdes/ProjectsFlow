-- Platform administrator campaigns; transactional notifications are unchanged.
CREATE TABLE mailing_campaigns (
  id CHAR(36) NOT NULL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  launch_revision INT UNSIGNED NULL,
  content_json JSON NOT NULL,
  channels_json JSON NOT NULL,
  audience_json JSON NOT NULL,
  created_by_id CHAR(36) NULL,
  created_by_name VARCHAR(160) NOT NULL,
  scheduled_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_mailing_campaign_due (status, scheduled_at),
  CONSTRAINT fk_mailing_campaign_creator FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mailing_contacts (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  name VARCHAR(160) NOT NULL DEFAULT '',
  company VARCHAR(200) NOT NULL DEFAULT '',
  source VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_mailing_contact_email (email),
  KEY idx_mailing_contact_source (source, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mailing_suppressions (
  email VARCHAR(254) NOT NULL PRIMARY KEY,
  reason VARCHAR(24) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mailing_deliveries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  campaign_id CHAR(36) NOT NULL,
  recipient_key VARCHAR(254) NOT NULL,
  recipient_kind VARCHAR(8) NOT NULL,
  user_id CHAR(36) NULL,
  contact_id CHAR(36) NULL,
  email VARCHAR(254) NULL,
  name VARCHAR(160) NOT NULL DEFAULT '',
  company VARCHAR(200) NOT NULL DEFAULT '',
  channel VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  public_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  lease_token CHAR(36) NULL,
  locked_at DATETIME(3) NULL,
  attempted_at DATETIME(3) NULL,
  sent_at DATETIME(3) NULL,
  clicked_at DATETIME(3) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error VARCHAR(250) NULL,
  UNIQUE KEY uq_mailing_delivery_recipient (campaign_id, recipient_key, channel),
  UNIQUE KEY uq_mailing_delivery_token (public_token),
  KEY idx_mailing_delivery_queue (status, campaign_id),
  KEY idx_mailing_delivery_rate (attempted_at),
  CONSTRAINT fk_mailing_delivery_campaign FOREIGN KEY (campaign_id) REFERENCES mailing_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_mailing_delivery_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_mailing_delivery_contact FOREIGN KEY (contact_id) REFERENCES mailing_contacts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mailing_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  per_minute INT UNSIGNED NOT NULL DEFAULT 30,
  per_day INT UNSIGNED NOT NULL DEFAULT 1000
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO mailing_settings (id, enabled, per_minute, per_day) VALUES (1, 1, 30, 1000);

-- Every attempt is retained, including manual retries, so rate limits cannot reset on retry.
CREATE TABLE mailing_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  delivery_id CHAR(36) NOT NULL,
  lease_token CHAR(36) NOT NULL,
  attempted_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'sending',
  KEY idx_mailing_attempt_rate (attempted_at),
  KEY idx_mailing_attempt_delivery (delivery_id),
  UNIQUE KEY uq_mailing_attempt_lease (lease_token),
  CONSTRAINT fk_mailing_attempt_delivery FOREIGN KEY (delivery_id) REFERENCES mailing_deliveries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
