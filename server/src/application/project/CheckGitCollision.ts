import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { normalizeGitUrl } from './gitUrl.js';

export type GitCollisionResult = {
  readonly exists: boolean;
  // Имя владельца НЕ раскрываем (privacy) — только id/name проекта для запроса на вступление.
  readonly projectId?: string;
  readonly projectName?: string;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Ищет чужой проект с тем же git-репозиторием (где userId ещё не member). Используется
// при подключении репо, чтобы предложить вступление вместо дубля.
export class CheckGitCollision {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, gitRepoUrl: string): Promise<GitCollisionResult> {
    const raw = gitRepoUrl.trim();
    if (!raw) return { exists: false };
    const target = normalizeGitUrl(raw);

    const candidates = await this.deps.projects.listWithGitRepo();
    for (const p of candidates) {
      if (p.isInbox || !p.gitRepoUrl) continue;
      if (normalizeGitUrl(p.gitRepoUrl) !== target) continue;
      const membership = await this.deps.members.findForProject(p.id, userId);
      if (!membership) {
        return { exists: true, projectId: p.id, projectName: p.name };
      }
    }
    return { exists: false };
  }
}
