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
