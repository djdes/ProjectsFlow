-- db/045_project_automation.sql
-- Автоматизация проектов: если у проекта нет открытых задач, диспетчер (ralph)
-- сам генерирует новые задачи по выбранным критериям и выполняет их в тихом режиме.
-- Сайт хранит конфиг + редактируемые системные промпты, считает лимит (кол-во/время)
-- и round-robin критериев; ralph читает это через /agent/* и крутит цикл.
-- См. план virtual-exploring-pascal.md.

-- Конфиг автоматизации: одна строка на проект.
CREATE TABLE IF NOT EXISTS project_automation (
  project_id         CHAR(36)                                          NOT NULL,
  enabled            BOOLEAN                                           NOT NULL DEFAULT FALSE,
  -- Лимит цикла: по числу задач ('count') или по времени ('time', от первой задачи).
  limit_kind         ENUM('count','time')                             NOT NULL DEFAULT 'count',
  limit_count        INT                                               NULL,
  limit_minutes      INT                                               NULL,
  -- Пауза между задачами (эмуляция человека). Диапазон в секундах, ralph берёт random.
  pause_min_seconds  INT                                               NOT NULL DEFAULT 60,
  pause_max_seconds  INT                                               NOT NULL DEFAULT 300,
  -- Режим выполнения сгенерированных задач (по умолчанию тихий).
  ralph_mode         VARCHAR(16)                                       NOT NULL DEFAULT 'silent',
  -- Состояние прогона. idle — не запускался; running — идёт; completed — лимит достигнут;
  -- stopped — выключен юзером.
  run_status         ENUM('idle','running','completed','stopped')     NOT NULL DEFAULT 'idle',
  -- Ставится при создании ПЕРВОЙ задачи (отсчёт времени «начиная от первой задачи»).
  run_started_at     TIMESTAMP                                         NULL,
  tasks_created      INT                                               NOT NULL DEFAULT 0,
  last_task_at       TIMESTAMP                                         NULL,
  -- Round-robin указатель по включённым критериям (продвигается на каждой задаче).
  next_criterion_idx INT                                               NOT NULL DEFAULT 0,
  created_at         TIMESTAMP                                         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP                                         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Критерии: до 5 строк на проект (фиксированный набор ключей), с редактируемым
-- системным промптом и «произвольным уточнением» юзера.
CREATE TABLE IF NOT EXISTS project_automation_criteria (
  project_id    CHAR(36)     NOT NULL,
  -- new_features | design | refactor | security | performance
  criterion_key VARCHAR(40)  NOT NULL,
  enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Редактируемый системный промпт (сидируется из дефолта в коде).
  system_prompt TEXT         NOT NULL,
  -- «Произвольное уточнение» — что именно хочет юзер (напр. фичи лендинга: чат, фильтры).
  user_hint     TEXT         NULL,
  PRIMARY KEY (project_id, criterion_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
