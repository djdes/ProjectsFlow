-- db/062_server_health_url.sql
-- URL для синтетической HTTP/uptime-проверки сервера (опционально). Если https — из него
-- же проверяется срок SSL-сертификата. NULL = проверка выключена.
ALTER TABLE project_servers
  ADD COLUMN IF NOT EXISTS health_url VARCHAR(500) NULL AFTER deploy_path;
