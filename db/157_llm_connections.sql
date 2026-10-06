-- 157_llm_connections.sql — подключения к LLM-провайдерам (сейчас: подписка ChatGPT по коду).
--
-- Сервер держит учётные данные провайдера сам: короткие AI-задания выполняет напрямую, а
-- Ralph ходит в модель через шлюз /api/agent/llm/v1 и токенов провайдера не видит.
-- Подключение — сущность с владельцем: сейчас одно на платформу (scope='platform'), позже
-- можно дать личное подключение каждому пользователю (scope='user') без смены схемы.
--
-- owner_key — не-NULL ключ владельца ('platform' или user id): UNIQUE в MariaDB пропускает
-- NULL'ы, поэтому уникальность «одно платформенное подключение на провайдера» держим через него.
-- Токены хранятся зашифрованными (enc:v1:… при заданном LLM_TOKEN_KEY). Потеря ключа не
-- фатальна: подключение уходит в reauth_required и восстанавливается повторным входом по коду.
CREATE TABLE IF NOT EXISTS llm_connections (
  id                  CHAR(36)     NOT NULL,
  scope               ENUM('platform', 'user') NOT NULL,
  owner_user_id       CHAR(36)     NULL,
  owner_key           VARCHAR(64)  NOT NULL,
  provider            VARCHAR(32)  NOT NULL,
  status              ENUM('active', 'reauth_required', 'disabled') NOT NULL DEFAULT 'active',
  account_id          VARCHAR(128) NULL,
  account_email       VARCHAR(255) NULL,
  plan_type           VARCHAR(64)  NULL,
  access_token        TEXT         NOT NULL,
  refresh_token       TEXT         NULL,
  id_token            TEXT         NULL,
  access_expires_at   DATETIME(3)  NULL,
  last_refresh_at     DATETIME(3)  NULL,
  rate_limited_until  DATETIME(3)  NULL,
  last_error          VARCHAR(500) NULL,
  last_used_at        DATETIME(3)  NULL,
  -- Оптимистичная блокировка обновления токенов: refresh-токен одноразовый, два параллельных
  -- обновления выбили бы сессию. UPDATE … WHERE version = ? — проигравший перечитывает строку.
  version             INT UNSIGNED NOT NULL DEFAULT 0,
  created_by          CHAR(36)     NULL,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                      ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_llm_connections_owner_provider (owner_key, provider),
  KEY idx_llm_connections_owner_user (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Незавершённый вход по коду: код показан человеку, сервер ждёт подтверждения на сайте
-- провайдера. Один активный вход на владельца и провайдера; переживает перезапуск сервера.
CREATE TABLE IF NOT EXISTS llm_device_logins (
  id                CHAR(36)     NOT NULL,
  scope             ENUM('platform', 'user') NOT NULL,
  owner_user_id     CHAR(36)     NULL,
  owner_key         VARCHAR(64)  NOT NULL,
  provider          VARCHAR(32)  NOT NULL,
  user_code         VARCHAR(32)  NOT NULL,
  device_auth_id    VARCHAR(255) NOT NULL,
  verification_url  VARCHAR(255) NOT NULL,
  interval_sec      INT UNSIGNED NOT NULL DEFAULT 5,
  expires_at        DATETIME(3)  NOT NULL,
  created_by        CHAR(36)     NOT NULL,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_llm_device_logins_owner_provider (owner_key, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Настройки исполнения (одна строка id='platform'): модели по умолчанию и какие очереди
-- коротких заданий сервер выполняет сам вместо диспетчера. Пустой список = всё как раньше.
CREATE TABLE IF NOT EXISTS llm_settings (
  id             VARCHAR(32)  NOT NULL,
  default_model  VARCHAR(64)  NULL,
  fast_model     VARCHAR(64)  NULL,
  server_queues  JSON         NULL,
  updated_by     CHAR(36)     NULL,
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                 ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Серверный исполнитель AI-чатов (ai_conversation) выбирает run'ы всех диспетчеров по статусу
-- и раз в 1,5 с; существующие индексы начинаются с dispatcher/project/conversation и ему не
-- подходят, а таблица не очищается.
CREATE INDEX IF NOT EXISTS idx_ai_conversation_runs_status_created
  ON ai_conversation_runs (status, created_at);
