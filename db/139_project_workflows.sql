-- 139: правила «событие → действие» проекта (dashboard → Workflows, срез 8).
--
-- Наша логика вместо закрытого тарифом workflow-раздела Base44: конструктор правил над
-- УЖЕ существующими сущностями (задачи, статусы, дедлайны, участники, вебхуки среза 6).
-- Одно правило = один триггер + одно действие. Это НЕ общий workflow-движок: и триггеры,
-- и действия — замкнутые наборы, проверяемые статически в domain/automation/WorkflowRule.ts
-- (раздел 4 плана: никаких пользовательских выражений над данными).
--
-- БЕЗОПАСНОСТЬ (раздел 4 плана, риск зацикливания):
--   * Правило может породить событие, запускающее себя же (task→status ⇒ delegate ⇒ …).
--     Защита живёт в application (RunWorkflow): счётчик глубины каскада (MAX_CASCADE_DEPTH)
--     и отключение правила после MAX_CONSECUTIVE_FIRES срабатываний подряд из одного корня —
--     тогда enabled сбрасывается в 0 прямо здесь, в этой таблице.
--   * trigger_json/action_json хранят ТОЛЬКО значения из замкнутых списков; парсинг и
--     валидация — в домене. В БД это просто сериализованный discriminated-union.
--
-- trigger_json  — {type, …} из WORKFLOW_TRIGGER_TYPES (task_created / task_status_changed /
--                 task_deadline_approaching / webhook_received) + фиксированные параметры.
-- action_json   — {type, …} из WORKFLOW_ACTION_TYPES (delegate / set_priority /
--                 send_telegram / trigger_webhook) + фиксированные параметры.
-- last_status   — итог последнего запуска для журнала ('ok' | 'skipped:max_depth' |
--                 'disabled:cascade' | 'error:<reason>'). NULL — ещё не запускалось.
-- last_run_at / created_at — ISO-8601 (мс).
CREATE TABLE IF NOT EXISTS project_workflows (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  project_id    CHAR(36)      NOT NULL,
  name          VARCHAR(120)  NOT NULL,
  trigger_json  TEXT          NOT NULL,
  action_json   TEXT          NOT NULL,
  enabled       TINYINT(1)    NOT NULL DEFAULT 1,
  last_status   VARCHAR(64)   DEFAULT NULL,
  last_run_at   VARCHAR(32)   DEFAULT NULL,
  created_at    VARCHAR(32)   NOT NULL,
  KEY idx_project_workflows_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
