-- 099: бэкфилл истории версий. Для каждой задачи БЕЗ единой версии (созданной до фичи версий
-- db/092) создаём одну начальную версию = снимок ТЕКУЩЕГО состояния задачи. Так у каждой задачи
-- появляется история (как в Notion — у любой страницы есть версии), кнопка-часы в ленте активности
-- становится видимой для всех задач и никогда не открывает пустое окно «Версий пока нет».
-- Идемпотентно: повторный прогон не задваивает (LEFT JOIN … WHERE version IS NULL).
INSERT INTO task_versions (id, task_id, project_id, actor_user_id, snapshot, created_at)
SELECT
  UUID(),
  t.id,
  t.project_id,
  t.created_by,
  JSON_OBJECT(
    'description',      t.description,
    'status',           t.status,
    'statusBeforeDone', t.status_before_done,
    'ralphMode',        t.ralph_mode,
    'deadline',         t.deadline,
    'priority',         t.priority
  ),
  t.created_at
FROM tasks t
LEFT JOIN task_versions v ON v.task_id = t.id
WHERE v.task_id IS NULL;
