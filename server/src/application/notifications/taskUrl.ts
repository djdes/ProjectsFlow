// Единый билдер ссылки на задачу/комментарий для писем и TG. commentId (опц.) добавляет
// якорь #comment-{id} — письмо ведёт на сам комментарий, клиент скроллит и подсвечивает.
export function buildTaskUrl(
  appUrl: string,
  projectId: string,
  taskId: string,
  commentId?: string,
): string {
  const base = appUrl.replace(/\/$/, '');
  const anchor = commentId ? `#comment-${commentId}` : '';
  return `${base}/projects/${projectId}?task=${taskId}${anchor}`;
}
