import type { Project } from '../../domain/project/Project.js';
import { ProjectNameEmptyError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

export type CreateProjectCommand = {
  readonly ownerId: string;
  readonly name: string;
};

type Deps = {
  readonly repo: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly idGen: () => string;
};

export class CreateProject {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: CreateProjectCommand): Promise<Project> {
    const name = cmd.name.trim();
    if (name.length === 0) throw new ProjectNameEmptyError();
    const project = await this.deps.repo.create({
      id: this.deps.idGen(),
      ownerId: cmd.ownerId,
      name,
    });
    // Multi-tenancy: создатель сразу становится owner-member'ом проекта. Без этой строки
    // никакие последующие requireProjectAccess не пройдут (доступ исключительно через members).
    await this.deps.members.add({ projectId: project.id, userId: cmd.ownerId, role: 'owner' });
    return project;
  }
}
