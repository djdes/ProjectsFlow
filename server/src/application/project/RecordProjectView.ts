import { requireProjectAccess, type ProjectAccessDeps } from './projectAccess.js';
import type { ProjectViewRepository } from './ProjectViewRepository.js';

type Deps = ProjectAccessDeps & { readonly views: ProjectViewRepository };

// Записать «юзер открыл проект» (для аналитики). Гейт — участник проекта (read_project),
// чтобы нельзя было накрутить просмотры чужого проекта. Репозиторий троттлит (30 мин).
export class RecordProjectView {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    await this.deps.views.recordView(userId, projectId);
  }
}
