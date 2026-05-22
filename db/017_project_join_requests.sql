-- db/017_project_join_requests.sql
-- Заявки на вступление в проект по совпадению git-репозитория. Когда юзер подключает
-- git-репо, уже привязанный к чужому проекту, он может попроситься внутрь вместо
-- создания дубля. Владелец подтверждает/отклоняет (см. эпик git-collision).

CREATE TABLE IF NOT EXISTS project_join_requests (
  id                  CHAR(36)     NOT NULL,
  project_id          CHAR(36)     NOT NULL,
  requester_user_id   CHAR(36)     NOT NULL,
  git_repo_url        VARCHAR(500) NOT NULL,
  status              ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at         TIMESTAMP    NULL,
  resolved_by_user_id CHAR(36)     NULL,
  PRIMARY KEY (id),
  -- Один pending-запрос на пару (проект, заявитель) — повторный create апдейтит существующий.
  UNIQUE KEY uq_join_req_project_requester (project_id, requester_user_id),
  KEY idx_join_req_project (project_id),
  KEY idx_join_req_requester (requester_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
