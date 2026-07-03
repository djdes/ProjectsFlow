-- 092: версии задач — снимок изменяемых полей задачи на каждое изменение.
-- Основа для окна версий и кнопки «Восстановить» (вся задача к версии, как в Notion).
-- snapshot(JSON) = { description, status, statusBeforeDone, ralphMode, deadline, priority }.
CREATE TABLE IF NOT EXISTS `task_versions` (
  `id` CHAR(36) NOT NULL,
  `task_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `actor_user_id` CHAR(36) NULL,
  `snapshot` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_versions_task_time` (`task_id`, `created_at`),
  KEY `idx_task_versions_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
