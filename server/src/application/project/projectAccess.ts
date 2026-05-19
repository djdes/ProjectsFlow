import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can, type ProjectAction } from '../../domain/project/permissions.js';
import type { ProjectMembership } from '../../domain/project/ProjectMembership.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

export type ProjectAccess = {
  readonly project: Project;
  readonly membership: ProjectMembership;
};

export type ProjectAccessDeps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Единая точка входа для multi-tenant access-check'а. Use-case'ы НЕ должны проверять
// права через ProjectRepository напрямую — только через эту функцию.
//
// Контракт:
//  - membership не найден → ProjectNotFoundError (404). Не палим существование проекта.
//  - role не дотягивает до action → InsufficientProjectRoleError (403).
//  - проект не найден (хотя membership был) → ProjectNotFoundError. Маловероятно, но
//    стоит чистоты ради (race с DELETE FROM projects).
export async function requireProjectAccess(
  deps: ProjectAccessDeps,
  projectId: string,
  userId: string,
  action: ProjectAction,
): Promise<ProjectAccess> {
  const membership = await deps.members.findForProject(projectId, userId);
  if (!membership) throw new ProjectNotFoundError();
  if (!can(membership.role, action)) {
    throw new InsufficientProjectRoleError(membership.role, action);
  }
  const project = await deps.projects.getById(projectId);
  if (!project) throw new ProjectNotFoundError();
  return { project, membership };
}
