-- 187: шаблоны задач пространства. «Сохранить как шаблон» в окне задачи (меню «⋯») и выбор
-- «Шаблон» в окне «Новая задача». В отличие от шаблонов проекта (db/108, меню «Создать ▾»
-- на доске), этот список общий для всего пространства: заготовку можно взять в любом его
-- проекте или во «Входящих».
--
-- description — текст задачи (название + описание, markdown) с чеклистом; отметки чеклиста
-- снимаются при сохранении, шаблон всегда начинается с пустого списка. priority / task_type /
-- recurrence — те же значения и формат, что в tasks (db/041, db/153, db/185).
CREATE TABLE IF NOT EXISTS workspace_task_templates (
  id           CHAR(36)         NOT NULL,
  workspace_id CHAR(36)         NOT NULL,
  name         VARCHAR(120)     NOT NULL,
  description  MEDIUMTEXT       NOT NULL,
  priority     TINYINT UNSIGNED     NULL,
  task_type    VARCHAR(16)          NULL,
  recurrence   VARCHAR(64)          NULL,
  created_by   CHAR(36)             NULL,
  created_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wtt_workspace (workspace_id, created_at),
  CONSTRAINT fk_wtt_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
