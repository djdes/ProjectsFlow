-- 186: ИИ-сводка «что сделано» на карточках полки «На утверждении».
-- Одна строка на задачу. input_hash — sha256 от собранного входа для модели (текст задачи,
-- последний LIVE-запуск, коммиты, комментарии исполнителя): сводка пересобирается только
-- когда вход изменился, повторные открытия «Входящих» берут её отсюда без запроса к модели.
CREATE TABLE IF NOT EXISTS approval_summaries (
  task_id      CHAR(36)    NOT NULL,
  input_hash   CHAR(64)    NOT NULL,
  summary      TEXT        NOT NULL,
  generated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id),
  CONSTRAINT fk_aps_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
