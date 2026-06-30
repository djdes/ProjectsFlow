-- 082_ai_usage_ledger.sql — append-only журнал расхода ИИ в USD.
-- user_id = dispatcher_user_id прогона (профиль, чей диспетчер выполнял работу) —
-- один юзер = один бюджет на все источники. Источник правды по стоимости — cost_usd,
-- который раннер репортит в completion-эндпоинтах (live/monitoring/commit_sync; ai_prompt — db/083).
-- Скользящие окна (5ч / 7д) считаются на лету:
--   SUM(cost_usd) WHERE user_id=? AND occurred_at >= NOW() - INTERVAL ...
-- Шедулер для сброса НЕ нужен. См. план gleaming-munching-locket (M1).
CREATE TABLE IF NOT EXISTS ai_usage_ledger (
  id          CHAR(36)        NOT NULL,
  user_id     CHAR(36)        NOT NULL,
  source      ENUM('live','ai_prompt','monitoring','commit_sync') NOT NULL,
  ref_id      CHAR(36)        NOT NULL,
  project_id  CHAR(36)        NULL,
  model       VARCHAR(64)     NULL,
  tokens_in   BIGINT          NULL,
  tokens_out  BIGINT          NULL,
  cost_usd    DECIMAL(10,4)   NOT NULL DEFAULT 0.0000,
  occurred_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Идемпотентность RecordUsage: один прогон (source+ref_id) = одна строка.
  UNIQUE KEY uq_usage_source_ref (source, ref_id),
  -- Главный индекс окон: «расход юзера с момента T».
  KEY idx_usage_user_occurred (user_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
