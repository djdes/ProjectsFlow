-- db/058_task_description_mediumtext.sql
-- Снятие ограничения на объём описания задачи. Раньше TEXT (≤64KB), zod-валидация ≤5000
-- символов. Теперь автоматизация может создавать крупные/сложные задачи без лимита по
-- объёму — поднимаем колонку до MEDIUMTEXT (≤16MB), zod-кап поднят до 50000 символов
-- (server/src/presentation/tasks/schemas.ts, agent apiRoutes updateTaskAgentSchema).
-- Append-only, MariaDB-совместимо.

ALTER TABLE tasks MODIFY description MEDIUMTEXT NULL;
