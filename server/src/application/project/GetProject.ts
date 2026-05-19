import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export class GetProject {
  constructor(private readonly deps: Deps) {}

  // Возвращает null если юзер не member или проект не найден — presentation отдаёт 404,
  // не утекая существование чужого ресурса.
  async execute(id: string, userId: string): Promise<Project | null> {
    try {
      const { project } = await requireProjectAccess(this.deps, id, userId, 'read_project');
      return project;
    } catch (e) {
      if (e instanceof ProjectNotFoundError) return null;
      throw e;
    }
  }
}
