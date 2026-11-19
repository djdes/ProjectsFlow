-- 183: заметки на рабочем столе — приложение «ProjectsFlow Заметки» для Windows.
-- Человек закрепляет задачу кнопкой «На экран», приложение показывает её стикером поверх окон.

-- Закреплённые задачи. Порядок появления стикеров — по created_at.
CREATE TABLE IF NOT EXISTS desktop_note_pins (
  user_id    CHAR(36)  NOT NULL,
  task_id    CHAR(36)  NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, task_id),
  KEY idx_dnp_task (task_id),
  CONSTRAINT fk_dnp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_dnp_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Когда приложение последний раз было на связи: интерфейс подсказывает скачать его,
-- если человек закрепил задачу, а приложения у него нет.
CREATE TABLE IF NOT EXISTS desktop_note_apps (
  user_id      CHAR(36)    NOT NULL,
  last_seen_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  app_version  VARCHAR(32) NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_dna_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
