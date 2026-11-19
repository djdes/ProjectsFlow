-- Админка «Пользователи»: последний вход и активность пользователя, журнал действий администратора.

-- last_login_at — вход по паролю или регистрация. last_seen_at — любой запрос с сессией
-- (не чаще раза в 5 минут на пользователя), вход «от имени» администратора не считается.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP NULL DEFAULT NULL;

-- Начальные значения из уже накопленных данных: живые сессии, просмотры проектов,
-- созданные задачи и комментарии.
UPDATE users u
  SET u.updated_at = u.updated_at, u.last_login_at = (
    SELECT MAX(s.created_at) FROM sessions s
    WHERE s.user_id = u.id AND s.impersonator_session_id IS NULL)
  WHERE u.last_login_at IS NULL;

UPDATE users u
  SET u.updated_at = u.updated_at, u.last_seen_at = NULLIF(GREATEST(
    COALESCE(u.last_login_at, '1970-01-02'),
    COALESCE((SELECT MAX(v.viewed_at) FROM project_views v WHERE v.user_id = u.id), '1970-01-02'),
    COALESCE((SELECT MAX(t.created_at) FROM tasks t WHERE t.created_by = u.id), '1970-01-02'),
    COALESCE((SELECT MAX(c.created_at) FROM task_comments c
      WHERE c.owner_user_id = u.id AND c.actor_kind = 'user'), '1970-01-02')
  ), '1970-01-02')
  WHERE u.last_seen_at IS NULL;

-- Append-only: что администратор сделал с учётной записью. before/after — JSON изменённых
-- полей; batch_id объединяет записи одной массовой операции.
CREATE TABLE IF NOT EXISTS platform_admin_audit_log (
  seq            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id             CHAR(36)     NOT NULL,
  actor_user_id  CHAR(36)     NOT NULL,
  target_user_id CHAR(36)     NULL,
  action         VARCHAR(40)  NOT NULL,
  batch_id       CHAR(36)     NULL,
  before_json    MEDIUMTEXT   NULL,
  after_json     MEDIUMTEXT   NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_platform_admin_audit_id (id),
  KEY idx_platform_admin_audit_target (target_user_id, seq),
  KEY idx_platform_admin_audit_actor (actor_user_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
