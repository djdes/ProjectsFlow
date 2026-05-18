-- 007: убираем title у tasks (теперь у задачи только description) и добавляем
-- attachments (картинки/скриншоты, сохраняем на диске сервера).
--
-- Существующие задачи: переносим title в description если описание пустое,
-- иначе теряем title (но это редкость — пользователи обычно заполняют оба).

UPDATE tasks
SET description = title
WHERE description IS NULL OR description = '';

ALTER TABLE tasks DROP COLUMN title;

CREATE TABLE IF NOT EXISTS task_attachments (
  id            CHAR(36)      NOT NULL,
  task_id       CHAR(36)      NOT NULL,
  filename      VARCHAR(255)  NOT NULL,
  mime_type     VARCHAR(100)  NOT NULL,
  size_bytes    INT UNSIGNED  NOT NULL,
  storage_key   VARCHAR(500)  NOT NULL,
  uploaded_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_attachments_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
