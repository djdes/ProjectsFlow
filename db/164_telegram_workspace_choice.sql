-- Пространство для задач, которые бот кладёт во «Входящие» из Telegram.
--
-- Раньше «Входящие» без проекта брались в пространстве, последним открытом в веб-интерфейсе
-- (users.current_workspace_id) — случайное состояние браузера, а не намерение автора. Теперь
-- бот решает сам (одно пространство, привязка группы, общий с ответственным, прошлый выбор в
-- этом чате), а если не может — спрашивает кнопками.
--
-- workspace_id      — решённое пространство для задач черновика без проекта (NULL — не решено
--                     или черновик создан до этой миграции: тогда прежнее поведение).
-- workspace_pending — бот не смог решить сам и ждёт выбора кнопкой.
-- IF NOT EXISTS: черновик этой миграции жил под номером 163 и мог попасть в общую базу.
ALTER TABLE telegram_task_drafts
  ADD COLUMN IF NOT EXISTS workspace_id CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS workspace_pending TINYINT(1) NOT NULL DEFAULT 0;

-- Последний выбор пространства пользователем в чате: в личке бот помнит его несколько часов,
-- в группе — пока не выберут другое (группа обычно про одну команду).
CREATE TABLE IF NOT EXISTS telegram_chat_workspaces (
  tg_chat_id   BIGINT    NOT NULL,
  user_id      CHAR(36)  NOT NULL,
  workspace_id CHAR(36)  NOT NULL,
  chosen_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
