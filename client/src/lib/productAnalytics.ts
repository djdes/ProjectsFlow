export type ProductAction =
  | 'create_task'
  | 'share_project'
  | 'filter_tasks'
  | 'publish_project'
  | 'archive_project'
  | 'delete_project';

export type ProductActionResult = 'started' | 'success' | 'failure';

// Только технические метаданные: без названий проектов, текста задач, фильтров и email.
// keepalive сохраняет событие при навигации/удалении проекта; ошибка аналитики никогда
// не мешает пользовательскому действию.
export function trackProjectAction(input: {
  readonly projectId: string;
  readonly action: ProductAction;
  readonly result: ProductActionResult;
  readonly startedAt?: number;
}): void {
  const durationMs =
    input.startedAt === undefined
      ? null
      : Math.max(0, Math.round(performance.now() - input.startedAt));
  void fetch('/api/telemetry/actions', {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: input.projectId,
      action: input.action,
      result: input.result,
      durationMs,
    }),
  }).catch(() => undefined);
}
