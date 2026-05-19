import type { Project } from '../../domain/project/Project.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository, UpdateProjectInput } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

export type UpdateProjectCommand = {
  readonly id: string;
  readonly ownerId: string;
  readonly patch: UpdateProjectInput;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export class UpdateProject {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: UpdateProjectCommand): Promise<Project> {
    // ownerId — название историческое (сохраняем сигнатуру для presentation); на самом
    // деле это просто userId. Update_project требует editor+ — viewer не пройдёт.
    await requireProjectAccess(this.deps, cmd.id, cmd.ownerId, 'update_project');
    const updated = await this.deps.projects.update(cmd.id, cmd.patch);
    if (!updated) throw new ProjectNotFoundError();
    return updated;
  }
}
