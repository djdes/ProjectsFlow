import { CannotFavoriteInboxError, ProjectNotFoundError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Admin-only: пометить/снять favorite проекта за ДРУГОГО юзера (targetUserId). Зеркало
// ToggleProjectFavorite, но актор-проверка — admin-middleware на route, а не requireProjectAccess.
// Валидируем: проект существует, не inbox, и target — его участник (иначе favorite бессмыслен).
// Access-check (isAdmin) — на уровне presentation (route уже под admin-middleware).
export class SetUserProjectFavorite {
  constructor(private readonly deps: Deps) {}

  async execute(targetUserId: string, projectId: string, favorite: boolean): Promise<void> {
    const project = await this.deps.projects.getById(projectId);
    if (!project) throw new ProjectNotFoundError();
    if (project.isInbox) throw new CannotFavoriteInboxError();
    const membership = await this.deps.members.findForProject(projectId, targetUserId);
    if (!membership) throw new ProjectNotFoundError();
    await this.deps.members.setFavorite(projectId, targetUserId, favorite);
  }
}
