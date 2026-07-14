import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Task } from '@/domain/task/Task';

export type DelegatedInboxBlockTask = AssignedTask & {
  readonly displaySource: 'delegation';
};

// Виртуальная карточка верхнего личного канбана. Она ссылается на ту же Task, что и
// карточка нижней доски, но намеренно НЕ притворяется делегацией: иначе DnD попытался бы
// вызвать withdraw/reassign с выдуманным delegation.id.
export type PersonalInboxBlockTask = Omit<AssignedTask, 'delegation' | 'isInbox' | 'canModify'> & {
  readonly delegation: null;
  readonly isInbox: true;
  readonly canModify: true;
  readonly displaySource: 'personal';
  readonly personalOwnerUserId: string;
  readonly personalOwnerDisplayName: string;
};

export type InboxBlockTask = DelegatedInboxBlockTask | PersonalInboxBlockTask;

export function isPersonalInboxBlockTask(
  task: InboxBlockTask,
): task is PersonalInboxBlockTask {
  return task.displaySource === 'personal';
}

export function asDelegatedInboxBlockTask(task: AssignedTask): DelegatedInboxBlockTask {
  return { ...task, displaySource: 'delegation' };
}

export function buildToMeInboxBlockTasks(input: {
  delegatedTasks: readonly AssignedTask[];
  boardTasks: readonly Task[];
  inboxProjectId: string;
  owner: { id: string; displayName: string } | null;
}): InboxBlockTask[] {
  const seen = new Set<string>();
  const delegated: DelegatedInboxBlockTask[] = [];
  for (const task of input.delegatedTasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    delegated.push(asDelegatedInboxBlockTask(task));
  }
  if (!input.owner) return delegated;

  const personal: PersonalInboxBlockTask[] = [];

  for (const task of input.boardTasks) {
    // Защитные проверки сохраняют контракт даже если вызывающий передаст полный ответ
    // inbox-endpoint'а вместо уже отфильтрованного массива нижней доски.
    if (task.projectId !== input.inboxProjectId || task.delegation || seen.has(task.id)) continue;
    seen.add(task.id);
    personal.push({
      ...task,
      delegation: null,
      projectName: 'Личные',
      isInbox: true,
      canModify: true,
      displaySource: 'personal',
      personalOwnerUserId: input.owner.id,
      personalOwnerDisplayName: input.owner.displayName,
    });
  }

  // Личная колонка должна быть первой в project-группировке. Реальная делегация всё равно
  // выигрывает дедуп выше, поэтому одинаковый task.id дважды не появится.
  return [...personal, ...delegated];
}
