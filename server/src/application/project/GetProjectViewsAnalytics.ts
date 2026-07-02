import { requireProjectAccess, type ProjectAccessDeps } from './projectAccess.js';
import type { ProjectAnalytics } from '../../domain/project/ProjectView.js';
import type { ProjectViewRepository } from './ProjectViewRepository.js';

type Deps = ProjectAccessDeps & { readonly views: ProjectViewRepository };

// Аналитика просмотров проекта (вкладка «Аналитика»). Гейт — участник проекта (read_project).
export class GetProjectViewsAnalytics {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, windowDays: number): Promise<ProjectAnalytics> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    const days = Math.min(365, Math.max(1, Math.round(windowDays) || 28));
    return this.deps.views.getAnalytics(projectId, days);
  }
}
