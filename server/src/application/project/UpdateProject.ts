import type { Project } from '../../domain/project/Project.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { ProjectRepository, UpdateProjectInput } from './ProjectRepository.js';

export type UpdateProjectCommand = {
  readonly id: string;
  readonly ownerId: string;
  readonly patch: UpdateProjectInput;
};

export class UpdateProject {
  constructor(private readonly repo: ProjectRepository) {}

  async execute(cmd: UpdateProjectCommand): Promise<Project> {
    const updated = await this.repo.update(cmd.id, cmd.ownerId, cmd.patch);
    if (!updated) throw new ProjectNotFoundError();
    return updated;
  }
}
