import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectAction } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { isSystemAdmin, requireProjectAccess } from '../project/projectAccess.js';
import type { Task } from '../../domain/task/Task.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { TaskRepository } from './TaskRepository.js';

export type TaskAccessDeps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
};

// Мутирующие операции ходят по тем же зависимостям, что и чтение: отдельной политики
// приёмки здесь больше нет (см. комментарий ниже).
export type TaskModifyAccessDeps = TaskAccessDeps;

/*
 * Заморозки на время приёмки БОЛЬШЕ НЕТ.
 *
 * Была (db/150): задача в очереди утверждения неприкосновенна для всех, кроме принимающего,
 * — правка, смена колонки, перенос в другой проект, удаление и комментарии отбивались
 * ошибкой. Идея была «руководитель принимает ровно то, что видел».
 *
 * На практике правило мешало больше, чем защищало: очередь приёмки — это обычная рабочая
 * полка, из неё нужно и переносить задачи между проектами, и править текст, и дописывать
 * тред. Массовые действия по такой выборке падали ЦЕЛИКОМ («Перенесено: 0 из 5»), причём
 * без внятного объяснения, почему. По решению владельца продукта задачи на утверждении
 * редактируются наравне с остальными; кто вправе перевести задачу в done — по-прежнему
 * решает TaskApprovalService, и это правило осталось нетронутым.
 */
export type TaskAccessResult = {
  readonly project: Project;
  // true когда caller — текущий ответственный (независимо от creator/owner).
  readonly isAssignee: boolean;
};

// Approvers act on individual tasks in their workspace. This does not grant access
// to the personal inbox project or expose it in the project list.
async function isInboxApprover(deps: TaskAccessDeps, project: Project, userId: string): Promise<boolean> {
  if (await deps.members.isProjectHidden?.(project.id, userId)) return false;
  return (await deps.members.listApproverUserIdsForProject?.(project.id) ?? []).includes(userId);
}

/**
 * Личные задачи приватны. Чужую личную задачу (во «Входящих» коллеги) кроме владельца и
 * ответственного видит и меняет поставивший её коллега и принимающие работу руководители
 * этого пространства. Руководитель получает доступ к конкретной задаче из уведомления,
 * а не к приватному проекту входящих. Остальные коллеги чужие личные задачи не видят.
 *
 * Раньше любой участник общего пространства видел, двигал и удалял ВСЕ личные задачи коллег:
 * после приглашения в пространство чужие «на сегодня» оказывались у всех во «Входящих».
 *
 * Delegating colleagues retain read access. Management is checked independently below.
 */
async function isDelegatingColleague(
  deps: TaskAccessDeps,
  userId: string,
  inboxOwnerId: string,
  workspaceId: string,
  task: Pick<Task, 'createdBy'>,
): Promise<boolean> {
  if (task.createdBy !== userId) return false;
  const colleagues = await deps.members.listSharedUsersInWorkspace(userId, workspaceId);
  return colleagues.some((c) => c.id === inboxOwnerId);
}

// Creating a task for a colleague grants visibility, not management rights.
export async function canManageTask(
  deps: Pick<TaskAccessDeps, 'members'>,
  project: Pick<Project, 'id' | 'ownerId' | 'isInbox'>,
  task: Pick<Task, 'assignee'>,
  userId: string,
): Promise<boolean> {
  if (await deps.members.isProjectHidden?.(project.id, userId)) return false;
  if (await isSystemAdmin(userId)) return true;
  if (project.isInbox) {
    return project.ownerId === userId || task.assignee.userId === userId ||
      (await deps.members.listApproverUserIdsForProject?.(project.id) ?? []).includes(userId);
  }
  const membership = await deps.members.findForProject(project.id, userId);
  if (!project.isInbox && !membership) return false;
  return task.assignee.userId === userId || membership?.role === 'owner' || membership?.role === 'lead';
}

// Assignee-aware authorization для task-modify операций.
// Management belongs to the assignee and owner-equivalent roles, regardless of creator.
//
// 404 (ProjectNotFoundError) когда caller не участник и не текущий ответственный —
// семантика «не палим существование» (как в requireProjectAccess).
export async function requireTaskModifyAccess(
  deps: TaskModifyAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
  action: ProjectAction,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();
  const task = await deps.tasks.getById(taskId);
  if (!task || task.projectId !== projectId) throw new ProjectNotFoundError();

  const managementActions: readonly ProjectAction[] = [
    'update_task', 'move_task', 'assign_task', 'delete_task',
    'delegate_task_to_agent', 'cancel_agent_job',
  ];
  if (managementActions.includes(action)) {
    if (!await canManageTask(deps, project, task, userId)) {
      if (project.isInbox || !await deps.members.findForProject(project.id, userId)) throw new ProjectNotFoundError();
      throw new InsufficientProjectRoleError('viewer', action);
    }
    return { project, isAssignee: task.assignee.userId === userId };
  }

  if (project.isInbox) {
    if (await isInboxApprover(deps, project, userId)) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (project.ownerId === userId) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (task.assignee.userId === userId) {
      return { project, isAssignee: true };
    }
    // Discussion access remains available to the colleague who created the task.
    if (await isDelegatingColleague(deps, userId, project.ownerId, project.workspaceId, task)) {
      return { project, isAssignee: false };
    }
    throw new ProjectNotFoundError();
  }

  if (task.assignee.userId === userId) {
    // Назначение не раскрывает проект постороннему: хотя бы viewer-membership обязателен.
    await requireProjectAccess(deps, projectId, userId, 'read_project');
    return { project, isAssignee: true };
  }
  await requireProjectAccess(deps, projectId, userId, action);
  return { project, isAssignee: false };
}

// Personal task participants may transfer their task without access to the whole
// inbox. Named projects still require the project-level move permission.
export async function requireTaskTransferAccess(
  deps: TaskAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
): Promise<TaskAccessResult> {
  const access = await requireTaskModifyAccess(deps, projectId, taskId, userId, 'move_task');
  if (!access.project.isInbox) await requireProjectAccess(deps, projectId, userId, 'move_task');
  return access;
}

// Read-операции (комментарии, вложения, коммиты) — та же inbox-aware семантика, что и
// modify: для inbox разрешён owner ИЛИ assignee, для именованного проекта —
// обычный requireProjectAccess('read_project'). Ответственный личной задачи не состоит в
// приватном Inbox-проекте владельца, поэтому получает доступ именно через assignee.
export async function requireTaskReadAccess(
  deps: TaskAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();
  const task = await deps.tasks.getById(taskId);
  if (!task || task.projectId !== projectId) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (await isSystemAdmin(userId) && !await deps.members.isProjectHidden?.(project.id, userId)) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (await isInboxApprover(deps, project, userId)) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (project.ownerId === userId) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (task.assignee.userId === userId) return { project, isAssignee: true };
    // Тот же круг, что и для правки: раз задача видна в списке, карточку надо уметь открыть.
    // Иначе получилось бы полуфункциональное состояние — статус меняется, а по клику 404.
    if (await isDelegatingColleague(deps, userId, project.ownerId, project.workspaceId, task)) {
      return { project, isAssignee: false };
    }
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, 'read_project');
  return { project, isAssignee: task.assignee.userId === userId };
}

// Delete, restore and purge use the same assignee-scoped management policy.
export async function requireTaskDeleteAccess(
  deps: TaskAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
  action: ProjectAction,
  options: { readonly includeDeleted?: boolean } = {},
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();

  const task = options.includeDeleted
    ? await deps.tasks.getByIdIncludingDeleted(taskId)
    : await deps.tasks.getById(taskId);
  if (!task || task.projectId !== projectId) {
    await requireProjectAccess(deps, projectId, userId, 'read_project');
    throw new TaskNotFoundError(taskId);
  }
  if (!await canManageTask(deps, project, task, userId)) {
    if (project.isInbox || !await deps.members.findForProject(project.id, userId)) throw new ProjectNotFoundError();
    throw new InsufficientProjectRoleError('viewer', action);
  }
  return { project, isAssignee: task.assignee.userId === userId };
}
