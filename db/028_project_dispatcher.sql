-- Ralph-диспетчер проекта: какой ЮЗЕР отвечает за автономное выполнение задач
-- этого проекта (через MCP /loop). NULL = ручной режим (никто не дежурит).
-- Юзер обязан быть участником проекта И иметь активный agent-токен — иначе
-- назначить нельзя. При revoke последнего активного токена юзера сервер сам
-- очищает dispatcher_user_id во всех его проектах (см. RevokeAgentToken use-case).

ALTER TABLE projects
  ADD COLUMN dispatcher_user_id CHAR(36) NULL DEFAULT NULL AFTER finance_visibility,
  ADD INDEX idx_projects_dispatcher_user (dispatcher_user_id);
