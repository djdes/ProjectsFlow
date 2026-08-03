import { WorkerDisabledError } from '../../domain/workspace/errors.js';

// Узкие структурные порты: политике нужны ровно две вещи — в каком пространстве живёт
// проект и включён ли там воркер.
type ProjectsPort = {
  getWorkspaceId(projectId: string): Promise<string | null>;
};
type WorkspacesPort = {
  getById(id: string): Promise<{ workerEnabled: boolean } | null>;
};

type Deps = {
  readonly projects: ProjectsPort;
  readonly workspaces: WorkspacesPort;
};

// Одна точка правды «доступен ли воркер для этого проекта» (db/152). Пространство хранит
// флаг, задачи живут в проектах — политика связывает одно с другим, чтобы каждый use-case
// не таскал за собой два репозитория и не трактовал правило по-своему.
//
// Пространство не найдено (или проект без пространства) — считаем, что воркер доступен:
// это состояние «данных нет», и запрещать по нему значит ломать работу на пустом месте.
export class WorkerPolicy {
  constructor(private readonly deps: Deps) {}

  async isEnabledForProject(projectId: string): Promise<boolean> {
    const workspaceId = await this.deps.projects.getWorkspaceId(projectId);
    if (!workspaceId) return true;
    const workspace = await this.deps.workspaces.getById(workspaceId);
    return workspace ? workspace.workerEnabled : true;
  }

  async requireEnabledForProject(projectId: string): Promise<void> {
    if (!(await this.isEnabledForProject(projectId))) throw new WorkerDisabledError();
  }
}
