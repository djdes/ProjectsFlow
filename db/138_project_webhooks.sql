-- 138: outgoing webhooks per project (dashboard → Integrations, срез 6).
--
-- Наша логика вместо каталога 50 SaaS-коннекторов Base44: исходящие вебхуки по событиям
-- проекта. Один вебхук = подписка на набор событий (task.created, task.status_changed, …).
-- При событии сервер шлёт подписанный POST на пользовательский URL. Через Make/n8n это
-- покрывает произвольную интеграцию без 50 отдельных коннекторов.
--
-- БЕЗОПАСНОСТЬ (раздел 4 плана):
--   * secret_hash — SHA-256 (hex, 64) от секрета подписи. Сам секрет НИКОГДА не хранится:
--     показывается пользователю ОДИН раз при создании. Это HMAC-ключ доставки; получатель,
--     знающий секрет, выводит тот же ключ как sha256(secret) и проверяет подпись. Иначе
--     раздел Integrations стал бы хранилищем открытых секретов (см. раздел 4, срез 6).
--   * URL пользовательский → SSRF-риск. Приватные диапазоны и редиректы отсекаются в
--     application-слое (DispatchWebhook.assertPublicWebhookTarget) при КАЖДОЙ доставке, а не
--     только при создании (DNS может перепривязаться). Здесь храним только строку.
--
-- events_json — JSON-массив имён событий (или ["*"] на все). Валидируется доменом
-- (WEBHOOK_EVENTS). last_status/last_at — результат последней доставки для журнала в UI
-- ('ok:<code>' | 'error:<reason>'; NULL — ещё не доставляли). created_at — ISO-8601 ms.
CREATE TABLE IF NOT EXISTS project_webhooks (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  project_id   CHAR(36)      NOT NULL,
  url          VARCHAR(2048) NOT NULL,
  -- SHA-256 hex секрета подписи. Открытый секрет не хранится (показан один раз при создании).
  secret_hash  CHAR(64)      NOT NULL,
  -- JSON-массив подписанных событий (или ["*"]). См. domain/integrations WEBHOOK_EVENTS.
  events_json  TEXT          NOT NULL,
  enabled      TINYINT(1)    NOT NULL DEFAULT 1,
  -- Итог последней доставки для журнала: 'ok:<code>' | 'error:<reason>'. NULL — не доставляли.
  last_status  VARCHAR(64)   DEFAULT NULL,
  last_at      VARCHAR(32)   DEFAULT NULL,
  created_at   VARCHAR(32)   NOT NULL,
  KEY idx_project_webhooks_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
