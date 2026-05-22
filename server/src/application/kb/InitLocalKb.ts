import { KbRepoAlreadyConnectedError } from '../../domain/kb/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Завести ЛОКАЛЬНУЮ Базу знаний (без git): просто помечаем проект kbKind='local'.
// Документы появятся в kb_documents по мере создания (креды/заметки).
export class InitLocalKb {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<void> {
    const { project } = await requireProjectAccess(this.deps, projectId, userId, 'manage_kb');
    if (project.kbKind !== 'none') throw new KbRepoAlreadyConnectedError();
    await this.deps.projects.update(projectId, { kbKind: 'local' });
  }
}
