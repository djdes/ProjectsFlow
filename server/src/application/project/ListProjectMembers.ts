import type {
  ProjectMemberRepository,
  ProjectMemberWithUser,
} from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export class ListProjectMembers {
  constructor(private readonly deps: Deps) {}

  // viewer+ может смотреть состав команды.
  async execute(projectId: string, userId: string): Promise<ProjectMemberWithUser[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    return this.deps.members.listByProject(projectId);
  }
}
