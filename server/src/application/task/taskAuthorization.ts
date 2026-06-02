import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectAction } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';

export type TaskAccessDeps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly delegations: TaskDelegationRepository;
};

export type TaskAccessResult = {
  readonly project: Project;
  // true когда caller — accepted-delegate inbox-задачи (не creator).
  // Use-case'ы могут использовать для логирования / различной семантики.
  readonly isDelegate: boolean;
};

// Inbox-aware authorization для task-modify операций.
// Для non-inbox проекта — обычная requireProjectAccess.
// Для inbox-проекта — разрешён creator (owner) ИЛИ accepted-delegate.
//
// 404 (ProjectNotFoundError) когда caller не member и не accepted-delegate —
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

  if (project.isInbox) {
    if (project.ownerId === userId) {
      return { project, isDelegate: false };
    }
    const delegation = await deps.delegations.findActiveForTask(taskId);
    if (
      delegation &&
      delegation.status === 'accepted' &&
      delegation.delegateUserId === userId
    ) {
      return { project, isDelegate: true };
    }
    throw new ProjectNotFoundError();
  }

  // Non-inbox: стандартный multi-tenant check.
  await requireProjectAccess(deps, projectId, userId, action);
  return { project, isDelegate: false };
}

// Read-операции (комментарии, вложения, коммиты) — та же inbox-aware семантика, что и
// modify: для inbox разрешён creator ИЛИ accepted-delegate, для именованного проекта —
// обычный requireProjectAccess('read_project'). Чинит баг: inbox-делегат (никогда не member
// inbox-проекта создателя) иначе получал 404 на ListTaskComments/Attachments/Commits, хотя
// блок «Поручено мне» показывает их счётчики. Для именованных проектов делегат — editor+
// member, поэтому requireProjectAccess проходит штатно.
export async function requireTaskReadAccess(
  deps: TaskAccessDeps,
  projectId: string,
  taskId: string,
  userId: string,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (project.ownerId === userId) return { project, isDelegate: false };
    const delegation = await deps.delegations.findActiveForTask(taskId);
    if (
      delegation &&
      delegation.status === 'accepted' &&
      delegation.delegateUserId === userId
    ) {
      return { project, isDelegate: true };
    }
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, 'read_project');
  return { project, isDelegate: false };
}

// Delete-операции для inbox-задач — только creator (не accepted-delegate).
export async function requireTaskDeleteAccess(
  deps: TaskAccessDeps,
  projectId: string,
  userId: string,
  action: ProjectAction,
): Promise<TaskAccessResult> {
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();

  if (project.isInbox) {
    if (project.ownerId === userId) return { project, isDelegate: false };
    throw new ProjectNotFoundError();
  }

  await requireProjectAccess(deps, projectId, userId, action);
  return { project, isDelegate: false };
}
