import type { Project } from '../../domain/project/Project.js';
import { ProjectNameEmptyError } from '../../domain/project/errors.js';
import type { ProjectRepository } from './ProjectRepository.js';

export type CreateProjectCommand = {
  readonly ownerId: string;
  readonly name: string;
};

type Deps = {
  readonly repo: ProjectRepository;
  readonly idGen: () => string;
};

export class CreateProject {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: CreateProjectCommand): Promise<Project> {
    const name = cmd.name.trim();
    if (name.length === 0) throw new ProjectNameEmptyError();
    return this.deps.repo.create({
      id: this.deps.idGen(),
      ownerId: cmd.ownerId,
      name,
    });
  }
}
