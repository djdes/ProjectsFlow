import type { Project } from '@/domain/project/Project';
import { ProjectNameEmptyError } from '@/domain/project/errors';
import type { ProjectRepository } from './ProjectRepository';

export class CreateProject {
  constructor(private readonly repo: ProjectRepository) {}

  async execute(rawName: string): Promise<Project> {
    const name = rawName.trim();
    if (name.length === 0) throw new ProjectNameEmptyError();
    return this.repo.create({ name });
  }
}
