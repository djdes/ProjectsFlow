import type { Project } from '../../domain/project/Project.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import { requireProjectAccess } from './projectAccess.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Включить / выключить «Мультизадачный воркер» проекта. Когда включён — диспетчер
// может держать до N одновременных воркеров на этом проекте (вместо строгого
// «1 проект = 1 задача»). Менять может любой участник (viewer+, см. permissions
// set_multi_task_worker) — это настройка роутинга автоматизации, не доступ к данным.
// Admin-bypass позволяет админу менять флаг в любом проекте (admin-панель).
export class SetProjectMultiTaskWorker {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    actorUserId: string,
    enabled: boolean,
  ): Promise<Project> {
    await requireProjectAccess(
      this.deps,
      projectId,
      actorUserId,
      'set_multi_task_worker',
    );

    const updated = await this.deps.projects.update(projectId, { multiTaskWorker: enabled });
    if (!updated) throw new ProjectNotFoundError();
    return updated;
  }
}
