-- db/034_task_comments_actor_kind.sql
-- Различение комментариев человека и агента в карточке задачи. Сейчас всё подписано
-- именем юзера-владельца agent-токена (типично Denis) — путает участников. Вводим
-- actor_kind, бэк автоматически проставляет 'agent' при создании через /agent/*.
-- agent_name — опциональный идентификатор конкретного агента (ralph-dispatcher /
-- ralph-worker / ralph-grillme / ralph-verify) для UI-title.
-- Spec: prompts/comment-actor-kind.md.

ALTER TABLE task_comments
  ADD COLUMN actor_kind VARCHAR(16) NOT NULL DEFAULT 'user',
  ADD COLUMN agent_name VARCHAR(64) NULL;
