import type { ProjectRepository } from '../project/ProjectRepository.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

export class DisconnectKb {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(projectId: string, ownerUserId: string): Promise<void> {
    const project = await this.projects.getByIdForOwner(projectId, ownerUserId);
    if (!project) throw new ProjectNotFoundError();
    await this.projects.update(projectId, ownerUserId, { kbRepoFullName: null });
  }
}
