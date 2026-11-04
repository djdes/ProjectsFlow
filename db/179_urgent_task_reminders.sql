-- Напоминания о срочных задачах (приоритет «Срочно»/«Высокий» или слово «срочно» в тексте):
-- по будням в 8:00 и 16:00 МСК исполнителю в личку и по задаче в рабочий чат пространства.

-- Включатель в настройках сводки пространства. По умолчанию включено: пространство без
-- строки настроек тоже получает напоминания (см. defaultWorkspaceAssigneeDigestSettings).
ALTER TABLE workspace_assignee_digest_settings
  ADD COLUMN IF NOT EXISTS urgent_reminders_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER eod_reminder_last_sent_on;

-- Учёт отправок: одна строка на задачу и слот ('YYYY-MM-DD@08' / '@16'). Строка ставится ДО
-- отправки (INSERT IGNORE), поэтому рестарт PM2 или второй процесс не шлют повтор.
CREATE TABLE IF NOT EXISTS urgent_task_reminders (
  task_id CHAR(36) NOT NULL,
  slot_key VARCHAR(16) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, slot_key),
  KEY idx_utr_created (created_at),
  CONSTRAINT fk_utr_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
