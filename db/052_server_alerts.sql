-- db/052_server_alerts.sql
-- Алерты мониторинга. Правила по умолчанию заданы в коде (domain/monitoring/alertRules.ts);
-- server_alert_rules используется для per-project оверрайдов (активно с v3).
-- server_alerts — журнал с state-machine firing/resolved и дедупом (анти-спам).

-- Per-project оверрайды порогов правил (один ряд на (project, rule_kind)).
CREATE TABLE IF NOT EXISTS server_alert_rules (
  project_id   CHAR(36)      NOT NULL,
  rule_kind    VARCHAR(32)   NOT NULL,  -- disk_usage | process_down | restart_spike | snapshot_stale
  enabled      BOOLEAN       NOT NULL DEFAULT TRUE,
  -- Числовой порог (для disk_usage — проценты; для snapshot_stale — минуты; и т.п.).
  threshold    DOUBLE        NULL,
  severity     VARCHAR(16)   NOT NULL DEFAULT 'warning',  -- info | warning | critical
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, rule_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Журнал алертов. UNIQUE(server, rule, dedup_key, status) → один активный firing на ключ.
CREATE TABLE IF NOT EXISTS server_alerts (
  id               CHAR(36)                   NOT NULL,
  server_id        CHAR(36)                   NOT NULL,
  project_id       CHAR(36)                   NOT NULL,
  rule_kind        VARCHAR(32)                NOT NULL,
  -- Ключ дедупа в рамках правила (напр. имя pm2-процесса или 'disk:/').
  dedup_key        VARCHAR(191)               NOT NULL DEFAULT '',
  -- Трюк частичного UNIQUE: = dedup_key пока алерт firing, NULL после resolve.
  -- MySQL допускает много NULL → resolved-история не конфликтует, а активный firing
  -- по ключу — ровно один. (Партиальных индексов в MariaDB нет.)
  active_dedup     VARCHAR(191)               NULL,
  severity         VARCHAR(16)                NOT NULL DEFAULT 'warning',
  status           ENUM('firing','resolved')  NOT NULL DEFAULT 'firing',
  message          TEXT                       NOT NULL,  -- RU, человекочитаемое
  details          JSON                       NULL,
  first_seen_at    TIMESTAMP                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     TIMESTAMP                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at      TIMESTAMP                  NULL,
  last_notified_at TIMESTAMP                  NULL,
  created_at       TIMESTAMP                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert_active (server_id, rule_kind, active_dedup),
  KEY idx_alert_project_status (project_id, status),
  KEY idx_alert_server (server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
