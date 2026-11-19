-- Отчёты об ошибках десктопных программ (error-kit: Config, PlanningProduct, FusionBot, FilterMusic…).
-- Дублируют сообщения в Telegram-группу отчётов, чтобы воркер мог искать их через MCP.
CREATE TABLE IF NOT EXISTS app_error_reports (
  id CHAR(36) NOT NULL PRIMARY KEY,
  report_id VARCHAR(64) NOT NULL,
  program VARCHAR(100) NOT NULL,
  version VARCHAR(100) NULL,
  machine VARCHAR(100) NULL,
  user_name VARCHAR(100) NULL,
  level ENUM('critical','error','minor','manual') NOT NULL DEFAULT 'error',
  caption VARCHAR(1000) NOT NULL,
  details MEDIUMTEXT NULL,
  log_tail MEDIUMTEXT NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY app_error_reports_report (report_id),
  INDEX app_error_reports_program (program, occurred_at),
  INDEX app_error_reports_time (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
