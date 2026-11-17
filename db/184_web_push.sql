-- 184: Web Push — уведомления на устройстве (PWA на iPhone, браузеры на компьютере и Android).
-- Каждое уведомление колокольчика дублируется push'ем на устройства получателя, где он включил
-- «Уведомления на этом устройстве» в профиле.

-- Подписки устройств. endpoint — адрес push-сервиса браузера (свой у каждого браузера на
-- каждом устройстве), p256dh/auth — ключи шифрования содержимого. Ответ 404/410 от push-сервиса
-- значит, что подписки больше нет: сервер удаляет строку сам.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         CHAR(36)        NOT NULL,
  endpoint        VARCHAR(1000)   CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  p256dh          VARCHAR(255)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  auth            VARCHAR(255)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_agent      VARCHAR(512)    NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_success_at TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_subscriptions_endpoint (endpoint),
  KEY idx_push_subscriptions_user (user_id),
  CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- VAPID-ключи сервера — одна строка (id = 1). Создаются при первом обращении, если в .env нет
-- VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY. Приватный ключ хранится зашифрованным (enc:v1:…), без
-- секрета шифрования в .env — с префиксом plain:.
CREATE TABLE IF NOT EXISTS web_push_vapid_keys (
  id          TINYINT UNSIGNED NOT NULL,
  public_key  VARCHAR(255)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  private_key TEXT             NOT NULL,
  created_at  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_web_push_vapid_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
