-- Журнал доставки уведомлений по комментарию: кто (recipient) каким каналом
-- (email|telegram) и с каким исходом (sent|skipped|failed) был уведомлён о конкретном
-- комментарии. Питает меню ⋮ «Кто уведомлён» у отправленного комментария.
-- Пишется оркестратором DispatchCommentNotifications (единственный писатель).
-- FK не объявляем (конвенция репо — связи на уровне приложения); висячие строки
-- безвредны (читаются только по comment_id существующего коммента).
CREATE TABLE comment_notifications (
  id CHAR(36) NOT NULL,
  comment_id CHAR(36) NOT NULL,
  recipient_user_id CHAR(36) NOT NULL,
  channel VARCHAR(16) NOT NULL,           -- 'email' | 'telegram'
  status VARCHAR(16) NOT NULL,            -- 'sent' | 'skipped' | 'failed'
  reason VARCHAR(64) DEFAULT NULL,        -- pref_off | not_linked | no_email | dedup | rate_limited | forbidden | <error>
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_comment_notif (comment_id, recipient_user_id, channel),
  KEY idx_comment_notif_comment (comment_id)
);

-- Режим адресации, выбранный автором в композере: all (все участники), selected
-- (конкретные), none (никого). Нужен меню ⋮ чтобы отличить «Никто» (0 строк по выбору)
-- от «адресовали, но всех отфильтровало», без пересчёта членства.
ALTER TABLE task_comments
  ADD COLUMN notify_mode VARCHAR(16) NOT NULL DEFAULT 'all' AFTER agent_name;
