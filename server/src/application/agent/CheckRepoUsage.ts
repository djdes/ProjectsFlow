import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { normalizeGitUrl } from '../project/gitUrl.js';
import { makeRequestTarget } from './repoAccessToken.js';

export type RepoOwnership = 'none' | 'self' | 'other';

export type RepoUsageResult = {
  readonly ownership: RepoOwnership;
  // Непрозрачный токен — только при ownership === 'other'. Иначе null.
  readonly requestTarget: string | null;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tokenSecret: string;
};

// Приватная проверка занятости git-репо. Ничего о чужих проектах не раскрывает.
export class CheckRepoUsage {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, gitRepoUrl: string): Promise<RepoUsageResult> {
    const raw = gitRepoUrl.trim();
    if (!raw) return { ownership: 'none', requestTarget: null };
    const target = normalizeGitUrl(raw);

    const matched = (await this.deps.projects.listWithGitRepo()).filter(
      (p) => !p.isInbox && p.gitRepoUrl && normalizeGitUrl(p.gitRepoUrl) === target,
    );
    if (matched.length === 0) return { ownership: 'none', requestTarget: null };

    // Если хоть один matched-проект мой (я member) — self (приоритет: запрашивать не нужно).
    for (const p of matched) {
      const membership = await this.deps.members.findForProject(p.id, userId);
      if (membership) return { ownership: 'self', requestTarget: null };
    }

    // Все matched — чужие.
    return {
      ownership: 'other',
      requestTarget: makeRequestTarget(raw, this.deps.tokenSecret),
    };
  }
}
