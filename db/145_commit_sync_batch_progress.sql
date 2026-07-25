-- 145_commit_sync_batch_progress.sql
-- Живой прогресс сверки коммитов в Telegram-группе пространства.
--
-- Когда планировщик сформировал МНОГОПРОЕКТНЫЙ плановый батч (несколько проектов с одинаковыми
-- группой, датой и временем сверки — общий batch_key), в группу уходит ОДНО «прогресс-сообщение»:
-- заголовок «🔍 Сверяю коммиты…» + список проектов, у каждого статус-эмодзи ⏳/✅/⚠️. По мере
-- завершения заданий сообщение редактируется (editMessageText) из актуального состояния БД, а когда
-- весь батч терминален — прогресс-сообщение удаляется и вместо него шлётся свёрнутый итог (дайджест).
--
-- Одна строка на батч (batch_key — PK), чтобы гарантировать «ровно один прогресс на батч»:
-- отправитель атомарно вставляет строку (конфликт по PK ⇒ прогресс уже кто-то начал → молчок).
--
-- batch_key    — тот же ключ, что и в commit_sync_jobs.batch_key: '<groupChatId>:<YYYY-MM-DD>:<HH>:<MM>'.
-- chat_id      — Telegram-группа пространства (снимок; тот же chatId зашит в первом сегменте ключа).
-- message_id   — id отправленного прогресс-сообщения (NULL между claim и первой успешной отправкой).
CREATE TABLE commit_sync_batch_progress (
  batch_key  VARCHAR(120) NOT NULL,
  chat_id    BIGINT       NOT NULL,
  message_id BIGINT       NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
