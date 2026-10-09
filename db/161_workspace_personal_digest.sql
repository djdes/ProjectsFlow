-- Личная сводка в бота на уровне пространства: каждому участнику — его открытые задачи по всем
-- проектам, карточкой на задачу с кнопками «Завершить / Комментировать / Посмотреть». Время,
-- дни, проекты и получатели — общие с «Ежедневной таблицей» группы (та же строка настроек).
ALTER TABLE workspace_assignee_digest_settings
  ADD COLUMN IF NOT EXISTS personal_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER enabled;

-- Пространства, где проектные сводки уходили в личный Telegram, получают личную сводку
-- пространства вместо них.
INSERT INTO workspace_assignee_digest_settings (workspace_id, personal_enabled)
SELECT DISTINCT p.workspace_id, TRUE
FROM project_digest_settings d
JOIN projects p ON p.id = d.project_id
WHERE d.daily_enabled = 1
  AND p.workspace_id IS NOT NULL
  AND JSON_CONTAINS(d.daily_channels, '"telegram"')
  AND JSON_CONTAINS(d.daily_tg_targets, '"personal"')
ON DUPLICATE KEY UPDATE personal_enabled = TRUE;

-- «Личный Telegram» проектных сводок выключаем: иначе в личке придут и сводки по проектам,
-- и сводка пространства. Группа, почта и уведомления на сайте проектных сводок остаются.
UPDATE project_digest_settings
SET daily_tg_targets = JSON_REMOVE(
  daily_tg_targets,
  JSON_UNQUOTE(JSON_SEARCH(daily_tg_targets, 'one', 'personal'))
)
WHERE JSON_CONTAINS(daily_tg_targets, '"personal"');
