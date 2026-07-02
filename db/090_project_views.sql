-- Просмотры проекта (аналитика проекта: график Views за N дней + список Viewers с последним
-- временем). Append-only: каждый заход в проект пишет строку (клиент троттлит, репозиторий
-- дедупит в пределах ~30 мин на (user, project)). Доступ к аналитике — участнику проекта
-- (проверяется на уровне use-case). См. docs/superpowers/specs/2026-07-02-ui-batch-s3.md.
CREATE TABLE IF NOT EXISTS project_views (
  id         CHAR(36)  NOT NULL,
  user_id    CHAR(36)  NOT NULL,
  project_id CHAR(36)  NOT NULL,
  viewed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_views_project_time (project_id, viewed_at),
  KEY idx_project_views_user_project_time (user_id, project_id, viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
