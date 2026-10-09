import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { Task } from '../../domain/task/Task.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
import type { WorkspaceAssigneeDigestSettings } from '../../domain/digest/WorkspaceAssigneeDigestSettings.js';

// Задачи исполнителя в одном проекте пространства — единица сводки по ответственным.
export type ProjectTasks = {
  readonly project: { id: string; name: string };
  // Группа «Делегированные»: задачи без проекта, живущие в личных входящих исполнителя.
  // Ссылки у них ведут на /inbox, а не на /projects/<id>.
  readonly isInbox?: boolean;
  readonly tasks: Task[];
};

export type WorkspaceAssigneeTasks = {
  readonly selectedProjects: ReadonlyArray<{ id: string; name: string }>;
  // Все задачи выбранных проектов (включая done и «На утверждении» — для сообщения руководителям).
  readonly projectTasks: ReadonlyArray<{ project: { id: string; name: string }; tasks: Task[] }>;
  // Поручения во входящих участников (см. loadDelegatedInboxTasks), тоже без фильтра статуса.
  readonly delegated: ReadonlyArray<{ inbox: { id: string; ownerId: string }; tasks: Task[] }>;
  // Открытые задачи каждого получателя: сначала проекты, «Делегированные» — хвостом.
  readonly byAssignee: Map<string, ProjectTasks[]>;
};

// Заголовок колонки задач без проекта.
const DELEGATED_GROUP_NAME = 'Делегированные';

// Сданная работа ждёт руководителя: в сводке исполнителя ей не место (делать ему нечего),
// она уходит отдельным сообщением «На утверждении».
export const isAwaitingApproval = (task: Task): boolean => task.status === 'pending_approval';
export const isOpen = (task: Task): boolean => task.status !== 'done' && !isAwaitingApproval(task);

// Общий сбор для групповой таблицы и личной сводки в бота: одни и те же проекты, получатели
// и поручения из входящих, чтобы человек видел в личке ровно то, что команда — в группе.
export async function collectWorkspaceAssigneeTasks(
  deps: {
    readonly projects: Pick<ProjectRepository, 'listByWorkspace' | 'listInboxesByOwners'>;
    readonly tasks: Pick<TaskRepository, 'listByProject'>;
  },
  settings: WorkspaceAssigneeDigestSettings,
  members: readonly WorkspaceMember[],
): Promise<WorkspaceAssigneeTasks> {
  const projects = await deps.projects.listByWorkspace(settings.workspaceId);
  const configuredProjectIds = new Set(settings.projectIds);
  const selectedProjects = projects.filter(
    (project) => settings.projectMode === 'all' || configuredProjectIds.has(project.id),
  );
  const projectTasks = await Promise.all(
    selectedProjects.map(async (project) => ({
      project,
      tasks: await deps.tasks.listByProject(project.id),
    })),
  );

  const allowedRecipients = new Set(
    settings.recipientMode === 'all'
      ? members.map((member) => member.userId)
      : settings.recipientUserIds.filter((id) =>
          members.some((member) => member.userId === id),
        ),
  );
  const byAssignee = new Map<string, ProjectTasks[]>();
  for (const item of projectTasks) {
    for (const task of item.tasks.filter(isOpen)) {
      if (!allowedRecipients.has(task.assignee.userId)) continue;
      const current = byAssignee.get(task.assignee.userId) ?? [];
      let projectBucket = current.find((bucket) => bucket.project.id === item.project.id);
      if (!projectBucket) {
        projectBucket = { project: item.project, tasks: [] };
        current.push(projectBucket);
      }
      projectBucket.tasks.push(task);
      byAssignee.set(task.assignee.userId, current);
    }
  }

  const delegated = await loadDelegatedInboxTasks(deps, members.map((m) => m.userId));
  for (const { inbox, tasks } of delegated) {
    const open = tasks.filter(isOpen);
    if (open.length === 0 || !allowedRecipients.has(inbox.ownerId)) continue;
    const current = byAssignee.get(inbox.ownerId) ?? [];
    // Последней группой: сначала проекты, «Делегированные» — хвостом.
    current.push({
      project: { id: inbox.id, name: DELEGATED_GROUP_NAME },
      isInbox: true,
      tasks: open,
    });
    byAssignee.set(inbox.ownerId, current);
  }

  return { selectedProjects, projectTasks, delegated, byAssignee };
}

// Задачи без проекта: они лежат в личных входящих исполнителя (ChangeTaskAssignee
// переносит личную задачу в inbox нового ответственного), поэтому источник — inbox'ы
// участников, а не проекты пространства: выбор проектов в настройках сводки такие задачи
// не описывает. Берём только созданные КЕМ-ТО ДРУГИМ: собственные заметки человека —
// не поручение и в общий чат не выносятся (личное приватно).
async function loadDelegatedInboxTasks(
  deps: {
    readonly projects: Pick<ProjectRepository, 'listInboxesByOwners'>;
    readonly tasks: Pick<TaskRepository, 'listByProject'>;
  },
  memberIds: readonly string[],
): Promise<Array<{ inbox: { id: string; ownerId: string }; tasks: Task[] }>> {
  if (memberIds.length === 0) return [];
  const inboxes = await deps.projects.listInboxesByOwners(memberIds).catch(() => []);
  return Promise.all(
    inboxes.map(async (inbox) => ({
      inbox,
      tasks: (await deps.tasks.listByProject(inbox.id)).filter(
        (task) =>
          task.status !== 'done' &&
          task.assignee.userId === inbox.ownerId &&
          task.createdBy !== null &&
          task.createdBy !== inbox.ownerId,
      ),
    })),
  );
}
