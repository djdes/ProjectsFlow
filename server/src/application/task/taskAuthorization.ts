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
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, 'read_project');
  return { project, isAssignee: task.assignee.userId === userId };
}

// Delete-операции для inbox-задач — только владелец Inbox, не текущий ответственный.
export async function requireTaskDeleteAccess(
  deps: TaskAccessDeps,
  projectId: string,
  userId: string,
  action: ProjectAction,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (project.ownerId === userId) return { project, isAssignee: false };
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, action);
  return { project, isAssignee: false };
}
