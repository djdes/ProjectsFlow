-- 130: project-scoped persisted settings for the application Dashboard.
CREATE TABLE IF NOT EXISTS app_dashboard_settings (
  project_id    CHAR(36)   NOT NULL PRIMARY KEY,
  settings_json MEDIUMTEXT NOT NULL,
  created_at    TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
