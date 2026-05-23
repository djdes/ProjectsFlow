import type { DelegatedGitToken } from '../../domain/project/GitTokenDelegation.js';
import {
  GitTokenDelegationDisabledError,
  GranterGithubDisconnectedError,
  GranterNotOwnerAnymoreError,
  NotProjectDispatcherError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { GitTokenDelegationRepository } from './GitTokenDelegationRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly delegations: GitTokenDelegationRepository;
  readonly githubTokens: GithubTokenRepository;
};

export type GetDelegatedGitTokenInput = {
  readonly projectId: string;
  readonly callerUserId: string;
};

// Сердце фичи. Вызывается из agent-endpoint'а; возвращает либо токен либо доменную
// ошибку. ВАЖНО: для КАЖДОГО outcome (включая ошибки) пишем audit-log — owner потом
// видит «кто и когда пробовал взять мой токен через этот проект».
//
// Токен берётся LIVE из user_github_tokens каждый раз (не snapshot). Если owner
// перевыдал OAuth — диспетчер автоматически получит свежий на следующем вызове.
//
// Никогда не печатаем сам токен в app-логи; ошибки/issue выпускают наружу только
// outcome-строку и понятное сообщение для пользователя.
export class GetDelegatedGitToken {
  constructor(private readonly deps: Deps) {}

  async execute(input: GetDelegatedGitTokenInput): Promise<DelegatedGitToken> {
    const { projectId, callerUserId } = input;

    // 1. Проект.
    const project = await this.deps.projects.getById(projectId);
    if (!project) {
      // Не логируем — для несуществующего проекта вообще нет access-log'а.
      throw new ProjectNotFoundError();
    }

    // 2. Caller — текущий диспетчер.
    if (project.dispatcherUserId !== callerUserId) {
      await this.deps.delegations.logAccess({
        projectId,
        accessedByUserId: callerUserId,
        granterUserId: null,
        outcome: 'not_dispatcher',
      });
      throw new NotProjectDispatcherError();
    }

    // 3. Делегация существует и включена.
    const delegation = await this.deps.delegations.get(projectId);
    if (!delegation || !delegation.enabled) {
      await this.deps.delegations.logAccess({
        projectId,
        accessedByUserId: callerUserId,
        granterUserId: delegation?.granterUserId ?? null,
        outcome: 'delegation_disabled',
      });
      throw new GitTokenDelegationDisabledError();
    }

    // 4. Granter всё ещё owner проекта (если ownership передали — старая делегация
    //    невалидна, нужна новая от нового owner'а).
    if (delegation.granterUserId !== project.ownerId) {
      await this.deps.delegations.logAccess({
        projectId,
        accessedByUserId: callerUserId,
        granterUserId: delegation.granterUserId,
        outcome: 'granter_not_owner_anymore',
      });
      throw new GranterNotOwnerAnymoreError();
    }

    // 5. У granter'а ВСЁ ЕЩЁ подключён GitHub (мог отключить после включения делегации).
    const githubConn = await this.deps.githubTokens.getWithTokenByUserId(delegation.granterUserId);
    if (!githubConn) {
      await this.deps.delegations.logAccess({
        projectId,
        accessedByUserId: callerUserId,
        granterUserId: delegation.granterUserId,
        outcome: 'granter_github_disconnected',
      });
      throw new GranterGithubDisconnectedError();
    }

    // 6. Happy path.
    await this.deps.delegations.logAccess({
      projectId,
      accessedByUserId: callerUserId,
      granterUserId: delegation.granterUserId,
      outcome: 'ok',
    });
    return {
      token: githubConn.accessToken,
      login: githubConn.githubLogin,
      scopes: githubConn.scopes,
      source: 'owner_delegation',
      grantedBy: delegation.granterUserId,
      // grantedAt у delegation проставляется при включении; на момент успешного
      // вызова он точно not-null (delegation.enabled === true → шли через ветку
      // INSERT/UPDATE которая ставит grantedAt). На всякий — fallback на now.
      grantedAt: delegation.grantedAt ?? new Date(),
    };
  }
}
