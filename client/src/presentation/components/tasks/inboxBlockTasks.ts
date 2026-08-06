import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { Task } from '@/domain/task/Task';
import type { WorkspaceKind, WorkspaceRole } from '@/domain/workspace/Workspace';

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
 * Основная доска (колонки-группы): исключает полку «В работе» ('manual') и полку «На
 * утверждении» ('pending_approval') — иначе карточка висела бы сразу в двух местах.
 *
 * Общий для всех источников (свои задачи / «Другим» / доска сотрудника — BUG D): доска
 * сотрудника смешивает его личные (isInbox=true) и проектные (isInbox=false) задачи в
 * одном списке, а этот фильтр как раз и держит её в синхроне с отдельной полкой приёмки,
 * не показывая одну и ту же задачу дважды.
 */
export function selectBoardTasks(tasks: readonly InboxBlockTask[]): InboxBlockTask[] {
  return tasks.filter((t) => t.status !== 'manual' && t.status !== 'pending_approval');
}

/**
 * Полка «На утверждении» (db/150). Источник зависит от режима — и это не косметика:
 *
 *  - НА ДОСКЕ СОТРУДНИКА (focusedMemberId) — источник ВСЕГДА focusedTasks
 *    (ListMemberTasksForLead: все задачи человека по пространству, включая проекты, где
 *    сам руководитель не участник). toMeTasks/byMeDisplayTasks здесь НЕ годятся — это
 *    membership-скоуплённые /assignees/mine|others, которые такую задачу вообще не видят:
 *    карточка пропала бы отовсюду разом (доска её вырезает как pending_approval, а полка —
 *    единственное другое место, где она могла бы всплыть — не находит источник). BUG D.
 *  - ПРИНИМАЮЩИЙ (isApprover, вне фокус-режима) видит очередь целиком — оба направления.
 *  - ИСПОЛНИТЕЛЬ (не approver, не в фокус-режиме) видит только свои задачи (toMeTasks).
 */
export function selectApprovalTasks(input: {
  readonly toMeTasks: readonly InboxBlockTask[];
  readonly byMeDisplayTasks: readonly InboxBlockTask[];
  readonly focusedTasks: readonly InboxBlockTask[];
  readonly focusedMemberId: string | null;
  readonly isApprover: boolean;
}): InboxBlockTask[] {
  const source = input.focusedMemberId
    ? input.focusedTasks
    : input.isApprover
      ? [...input.toMeTasks, ...input.byMeDisplayTasks]
      : input.toMeTasks;
  const byId = new Map<string, InboxBlockTask>();
  for (const t of source) {
    if (t.status !== 'pending_approval') continue;
    if (input.focusedMemberId && t.assignee.userId !== input.focusedMemberId) continue;
    byId.set(t.id, t);
  }
  return [...byId.values()];
}

/**
 * Доступна ли руководителю доска сотрудника (клик по кубику, BUG D) в его АКТИВНОМ
 * пространстве прямо сейчас. Обязательно `kind === 'team'`: серверный
 * ListMemberTasksForLead скоупит СТРОГО по ws.id одного пространства, а кубики личного
 * дефолт-хаба (`ListSharedMembers` при `kind === 'default'`) сводят коллег из ВСЕХ общих
 * пространств сразу — коллега почти никогда не участник самого хаба (там обычно только
 * его владелец), поэтому клик там либо получил бы 404 от гейта, либо потребовал бы
 * ослабить сам гейт под кросс-пространственный охват. Ни то ни другое не годится — проще
 * не показывать жест там, где он структурно не может работать корректно. В team-пространстве
 * кубики (`ListSharedMembers` при `kind === 'team'`) и гейт (`workspace_id` в
 * `ListMemberTasksForLead`) считают по ОДНОМУ И ТОМУ ЖЕ пространству — 1:1.
 */
export function canOpenMemberBoard(
  workspace: { readonly kind: WorkspaceKind; readonly role: WorkspaceRole } | null,
): boolean {
  if (!workspace) return false;
  return workspace.kind === 'team' && (workspace.role === 'lead' || workspace.role === 'owner');
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
