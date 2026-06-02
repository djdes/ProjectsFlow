-- db/059_server_muted_until.sql
-- «Тихий час»/maintenance: до этого времени алерты по серверу записываются, но
-- уведомления (in-app/TG/email) не шлются. NULL = не заглушён.
ALTER TABLE project_servers
  ADD COLUMN IF NOT EXISTS muted_until TIMESTAMP NULL AFTER last_status;
