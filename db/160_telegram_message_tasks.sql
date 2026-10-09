-- Какие задачи перечислены в сообщении бота со списком (сводка по людям, «На утверждении»,
-- напоминание перед уходом, сверка коммитов, ответ на «@бот @человек»). Reply на такое
-- сообщение становится комментарием к одной из этих задач: по цитате названия, единственной
-- задаче сообщения или выбору кнопкой. telegram_task_messages (db/049) держит ровно одну
-- задачу на сообщение, поэтому для списков — отдельная таблица.
-- position — порядок задачи в сообщении (кнопки выбора идут в том же порядке).
-- Строки старше 30 дней удаляет сервер: на месячной давности сводку уже не отвечают.
CREATE TABLE IF NOT EXISTS telegram_message_tasks (
  tg_chat_id    BIGINT    NOT NULL,
  tg_message_id BIGINT    NOT NULL,
  task_id       CHAR(36)  NOT NULL,
  project_id    CHAR(36)  NOT NULL,
  position      SMALLINT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, tg_message_id, task_id),
  KEY idx_tmt_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
