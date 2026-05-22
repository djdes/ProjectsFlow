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

// Admin-bypass: резолвер «является ли userId системным админом». Конфигурится один раз
// в composition root (см. index.ts). Дефолт — никто не админ (безопасный fallback,
// чтобы в тестах/без конфигурации bypass был выключен). Сделано через module-level
// инъекцию, чтобы НЕ протаскивать UserRepository через deps всех ~30 use-case'ов —
// сигнатура requireProjectAccess остаётся прежней.
let resolveIsAdmin: (userId: string) => Promise<boolean> = async () => false;

export function configureAdminBypass(resolver: (userId: string) => Promise<boolean>): void {
  resolveIsAdmin = resolver;
}

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
  if (membership && can(membership.role, action)) {
    const project = await deps.projects.getById(projectId);
    if (!project) throw new ProjectNotFoundError();
    return { project, membership };
  }

  // Admin-bypass: системный админ получает синтетическую owner-роль на любой проект —
  // полный доступ к чужим проектам/задачам через те же use-case'ы.
  if (await resolveIsAdmin(userId)) {
    const project = await deps.projects.getById(projectId);
    if (!project) throw new ProjectNotFoundError();
    const synthetic: ProjectMembership = {
      projectId,
      userId,
      role: 'owner',
      joinedAt: new Date(),
    };
    return { project, membership: synthetic };
  }

  // membership не найден → 404 (не палим существование). Найден, но роль мала → 403.
  if (!membership) throw new ProjectNotFoundError();
  throw new InsufficientProjectRoleError(membership.role, action);
}
