import type { AssignedTask } from '@/domain/task/AssignedTask';

// «Все входящие»: компактный блок другого пространства показывает несколько моих открытых
// задач, остальное — числом «ещё N».
export const WORKSPACE_INBOX_PREVIEW_LIMIT = 5;

export type WorkspaceInboxPreview = {
  readonly items: readonly AssignedTask[];
  // Open tasks in total, including the ones beyond the limit.
  readonly total: number;
};

// Open tasks only. Urgent first: nearest deadline (overdue on top), then undated tasks,
// newest first. Deadlines are 'YYYY-MM-DD', so string order is date order.
export function workspaceInboxPreview(
  tasks: readonly AssignedTask[],
  limit = WORKSPACE_INBOX_PREVIEW_LIMIT,
): WorkspaceInboxPreview {
  const open = tasks.filter((task) => task.status !== 'done');
  const sorted = [...open].sort((a, b) => {
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
    if (a.deadline && !b.deadline) return -1;
    if (!a.deadline && b.deadline) return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return { items: sorted.slice(0, limit), total: open.length };
}
