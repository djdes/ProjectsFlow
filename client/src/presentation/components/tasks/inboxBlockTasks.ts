import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Task } from '@/domain/task/Task';

export type AssignedInboxBlockTask = AssignedTask & {
  readonly displaySource: 'assigned';
};

// Локальное зеркало нижней Inbox-доски используется только до следующего
// refetch `/assignees/mine`. Оно содержит ту же обязательную assignee-модель.
export type PersonalInboxBlockTask = AssignedTask & {
  readonly isInbox: true;
  readonly canModify: true;
  readonly displaySource: 'personal';
  readonly personalOwnerUserId: string;
  readonly personalOwnerDisplayName: string;
};

export type InboxBlockTask = AssignedInboxBlockTask | PersonalInboxBlockTask;

export function isPersonalInboxBlockTask(
  task: InboxBlockTask,
): task is PersonalInboxBlockTask {
  return task.displaySource === 'personal';
}

export function asAssignedInboxBlockTask(task: AssignedTask): AssignedInboxBlockTask {
  return { ...task, displaySource: 'assigned' };
}

export function buildToMeInboxBlockTasks(input: {
  assignedTasks: readonly AssignedTask[];
  boardTasks: readonly Task[];
  inboxProjectId: string;
  owner: { id: string; displayName: string } | null;
}): InboxBlockTask[] {
  const seen = new Set<string>();
  const assigned: AssignedInboxBlockTask[] = [];
  for (const task of input.assignedTasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    assigned.push(asAssignedInboxBlockTask(task));
  }
  if (!input.owner) return assigned;

  const personal: PersonalInboxBlockTask[] = [];
  for (const task of input.boardTasks) {
    if (
      task.projectId !== input.inboxProjectId ||
      task.assignee.userId !== input.owner.id ||
      seen.has(task.id)
    ) {
      continue;
    }
    seen.add(task.id);
    personal.push({
      ...task,
      projectName: 'Личные',
      isInbox: true,
      canModify: true,
      displaySource: 'personal',
      personalOwnerUserId: input.owner.id,
      personalOwnerDisplayName: input.owner.displayName,
    });
  }

  return [...personal, ...assigned];
}

/**
 * Можно ли отправить задачу на приёмку жестом (дроп в полку «На утверждении»).
 *
 * Только СВОЮ задачу: «сдать работу за другого» — не то действие, которое стоит отдавать
 * перетаскиванию. Повторная сдача уже сданной задачи смысла не имеет.
 *
 * Личные inbox-задачи исключены отдельно: сервер (TaskApprovalService.requiresApproval)
 * намеренно не требует приёмки для project.isInbox — «свою задачу утверждать не у кого».
 * Явный запрос статуса 'pending_approval' (в отличие от 'done') этот гейт не проходит —
 * без проверки здесь жест обошёл бы серверное правило и завёл личную задачу в
 * approval-freeze с уведомлением руководителям, которым не над чем принимать решение.
 *
 * Гейта «приёмка включена в пространстве» здесь нет намеренно: полка рендерится только
 * когда приёмка включена (или уже что-то в очереди), поэтому там, где её нет, нет и цели дропа.
 */
export function canSendToApproval(
  task: InboxBlockTask,
  currentUserId: string | null,
): boolean {
  if (!currentUserId) return false;
  if (task.assignee.userId !== currentUserId) return false;
  if (task.isInbox) return false;
  return task.status !== 'pending_approval';
}
