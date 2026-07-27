-- 147: роль «руководитель» (тимлид) в пространстве: ENUM('owner','editor','viewer')
-- → ENUM('owner','lead','editor','viewer'). Append-only расширение — существующие
-- значения не переименовываем и не сужаем, поэтому один ALTER без промежуточных шагов
-- (в отличие от db/110, где 'member' переименовывали в 'editor').
--
-- Роль даёт права владельца (кроме смены ролей участников — это остаётся за владельцем
-- пространства) и подписывает на командные уведомления в личный чат бота + почту.
-- См. docs/superpowers/specs/2026-07-27-lead-role-design.md.

ALTER TABLE workspace_members
  MODIFY COLUMN role ENUM('owner','lead','editor','viewer') NOT NULL DEFAULT 'editor';

-- project_members после unified-workspace доступа не даёт (строка — носитель per-member
-- настроек), но её role пишется тем же типом ProjectRole. Расширяем ENUM симметрично,
-- иначе запись legacy-строки с ролью руководителя упала бы на уровне БД.
ALTER TABLE project_members
  MODIFY COLUMN role ENUM('owner','lead','editor','viewer') NOT NULL;

-- Отметка «личная сводка руководителям этого пространства за дату уже отправлена».
-- Без неё планировщик (тик раз в минуту) слал бы сводку каждую минуту после 09:00,
-- а перезапуск процесса приводил бы к повторной отправке.
CREATE TABLE IF NOT EXISTS lead_digest_state (
  workspace_id CHAR(36) NOT NULL,
  last_sent_on DATE     NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
