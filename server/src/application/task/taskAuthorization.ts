import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectAction } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';

export type TaskAccessDeps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
};

export type TaskAccessResult = {
  readonly project: Project;
  // true когда caller — текущий ответственный (независимо от creator/owner).
  readonly isAssignee: boolean;
};

/**
 * Коллега по общему пространству — тот, кто и так ВИДИТ личные задачи этого владельца.
 *
 * Граница ровно та же, что у видимости (ListPersonalTasksOfColleagues → listSharedUsers):
 * участники общих с caller'ом пространств. Раньше личные задачи коллег было видно, но нельзя
 * было ни перевести в другую колонку, ни удалить — карточка выглядела живой, а действия
 * молча упирались в 404. Теперь право на действие совпадает с правом на просмотр.
 *
 * Шире не открываем: посторонний (нет общего пространства) не увидит задачу и не тронет её —
 * список коллег формирует сервер, клиент не передаёт ни одного id.
 */
async function isInboxColleague(
  deps: TaskAccessDeps,
  userId: string,
  inboxOwnerId: string,
): Promise<boolean> {
  if (userId === inboxOwnerId) return true;
  const colleagues = await deps.members.listSharedUsers(userId);
  return colleagues.some((c) => c.id === inboxOwnerId);
}

// Assignee-aware authorization для task-modify операций.
// Для inbox разрешён owner или текущий ответственный. В именованном проекте editor+
// сохраняет обычные права, а назначенный viewer получает task-scoped update/move.
//
// 404 (ProjectNotFoundError) когда caller не участник и не текущий ответственный —
// семантика «не палим существование» (как в requireProjectAccess).
export async function requireTaskModifyAccess(
  deps: TaskAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
  action: ProjectAction,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();
  const task = await deps.tasks.getById(taskId);
  if (!task || task.projectId !== projectId) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (project.ownerId === userId) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (task.assignee.userId === userId) {
      return { project, isAssignee: true };
    }
    // Коллега по общему пространству: он эту задачу видит во «Входящих», значит может и
    // перевести её в другую колонку.
    if (await isInboxColleague(deps, userId, project.ownerId)) {
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
    if (project.ownerId === userId) {
      return { project, isAssignee: task.assignee.userId === userId };
    }
    if (task.assignee.userId === userId) return { project, isAssignee: true };
    // Тот же круг, что и для правки: раз задача видна в списке, карточку надо уметь открыть.
    // Иначе получилось бы полуфункциональное состояние — статус меняется, а по клику 404.
    if (await isInboxColleague(deps, userId, project.ownerId)) {
      return { project, isAssignee: false };
    }
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, 'read_project');
  return { project, isAssignee: task.assignee.userId === userId };
}

// Delete-операции для inbox-задач: владелец Inbox или коллега по общему пространству.
// Текущий ответственный сам по себе права на удаление НЕ получает — если он не коллега
// владельца, задача ему делегирована извне, и убирать её из чужих «Входящих» он не должен.
// Удаление мягкое (deleted_at, db/134), поэтому ошибочное действие восстановимо.
export async function requireTaskDeleteAccess(
  deps: TaskAccessDeps,
  projectId: string,
  userId: string,
  action: ProjectAction,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (await isInboxColleague(deps, userId, project.ownerId)) {
      return { project, isAssignee: false };
    }
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, action);
  return { project, isAssignee: false };
}
