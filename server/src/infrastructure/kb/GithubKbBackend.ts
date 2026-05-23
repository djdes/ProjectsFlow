import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { KbNotConnectedError } from '../../domain/kb/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';
import type { GithubTokenRepository } from '../../application/github/GithubTokenRepository.js';
import {
  logDelegatedUsage,
  resolveEffectiveGithubToken,
} from '../../application/github/resolveEffectiveGithubToken.js';
import type { KbRepository } from '../../application/kb/KbRepository.js';
import type {
  KbDeleteInput,
  KbWriteInput,
  ProjectKbStore,
} from '../../application/kb/ProjectKbStore.js';
import type { GitTokenDelegationRepository } from '../../application/project/GitTokenDelegationRepository.js';
import type { ProjectRepository } from '../../application/project/ProjectRepository.js';
import type { UserRepository } from '../../application/user/UserRepository.js';

// github-бэкенд KB: достаёт effective GitHub-токен (свой → делегированный) и
// делегирует в GithubKbRepository.
//
// v0.16+: вместо «всегда токен owner'а» — приоритет actor's own → fallback на
// делегированный (owner → other members ASC). Это разблокирует:
//   - admin-диспетчера без собственного GitHub (получит токен owner'а через делегацию)
//   - сценарий «owner отключил GitHub, но другой member делегирует»
// Если у actor'а нет токена И нет подходящих делегаций — GithubNotConnectedError.
//
// list/read — read-only, в access-log НЕ пишем (избежать спама — list дёргается
// часто); только write/delete отображаются у owner'а в «лог обращений».
export class GithubKbBackend implements ProjectKbStore {
  constructor(
    private readonly deps: {
      kb: KbRepository;
      tokens: GithubTokenRepository;
      projects: ProjectRepository;
      delegations: GitTokenDelegationRepository;
      users: UserRepository;
    },
  ) {}

  private async ctx(
    project: Project,
    actorUserId: string,
  ): Promise<{ accessToken: string; fullName: string; logUsage: () => void }> {
    if (!project.kbRepoFullName) throw new KbNotConnectedError();
    const eff = await resolveEffectiveGithubToken(this.deps, actorUserId, project.id);
    if (!eff) throw new GithubNotConnectedError();
    return {
      accessToken: eff.accessToken,
      fullName: project.kbRepoFullName,
      logUsage: () => {
        void logDelegatedUsage(this.deps.delegations, project.id, actorUserId, eff, 'kb_write')
          .catch(() => {});
      },
    };
  }

  async list(project: Project, actorUserId: string): Promise<KbDocumentSummary[]> {
    const { accessToken, fullName } = await this.ctx(project, actorUserId);
    return this.deps.kb.listAll({ accessToken, fullName });
  }

  async read(project: Project, path: string, actorUserId: string): Promise<KbDocument | null> {
    const { accessToken, fullName } = await this.ctx(project, actorUserId);
    return this.deps.kb.readOne({ accessToken, fullName, path });
  }

  async write(project: Project, input: KbWriteInput, actorUserId: string): Promise<{ sha: string }> {
    const { accessToken, fullName, logUsage } = await this.ctx(project, actorUserId);
    const result = await this.deps.kb.write({
      accessToken,
      fullName,
      path: input.path,
      content: input.content,
      message: input.message,
      sha: input.sha,
    });
    logUsage();
    return result;
  }

  async delete(project: Project, input: KbDeleteInput, actorUserId: string): Promise<void> {
    const { accessToken, fullName, logUsage } = await this.ctx(project, actorUserId);
    await this.deps.kb.delete({
      accessToken,
      fullName,
      path: input.path,
      sha: input.sha,
      message: input.message,
    });
    logUsage();
  }
}
