import { CannotFavoriteInboxError } from '../../domain/project/errors.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

export type ToggleProjectFavoriteCommand = {
  readonly userId: string;
  readonly projectId: string;
  readonly favorite: boolean;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Персональная пометка проекта как favorite. Право — быть участником проекта (любая
// роль): favorite — это персональная штука каждого юзера, не привилегия. Inbox-проект
// помечать нельзя (он не отображается в общем списке).
export class ToggleProjectFavorite {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: ToggleProjectFavoriteCommand): Promise<void> {
    const { project } = await requireProjectAccess(
      this.deps,
      cmd.projectId,
      cmd.userId,
      'read_project',
    );
    if (project.isInbox) throw new CannotFavoriteInboxError();
    await this.deps.members.setFavorite(cmd.projectId, cmd.userId, cmd.favorite);
  }
}
