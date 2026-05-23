import type { DelegatedGitToken } from '../../domain/project/GitTokenDelegation.js';
import {
  GitTokenDelegationDisabledError,
  NoEligibleGrantorError,
  NotProjectDispatcherError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { GithubTokenRepository } from '../github/GithubTokenRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { GitTokenDelegationRepository } from './GitTokenDelegationRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly delegations: GitTokenDelegationRepository;
  readonly githubTokens: GithubTokenRepository;
  readonly users: UserRepository;
};

export type GetDelegatedGitTokenInput = {
  readonly projectId: string;
  readonly callerUserId: string;
};

// v0.15+: per-member opt-in с детерминированным fallback по алфавиту.
//
// Алгоритм выбора (см. спеку):
//   1. Caller — диспетчер проекта? Нет → not_dispatcher.
//   2. Получить ВСЕ enabled-делегации проекта. Пусто → delegation_disabled.
//   3. Собрать упорядоченный список granter-кандидатов:
//      a) project.ownerId (если у него enabled-делегация есть)
//      b) остальные enabled-granter'ы, сорт. по displayName ASC, email ASC
//      Исключить callerUserId (диспетчер сам себе токен не отдаёт).
//   4. Для каждого по порядку — взять granter, проверить GitHub-коннект.
//      Первый с подключённым GH → 200 + outcome='ok'.
//   5. Никто не подошёл → 403 no_eligible_grantor, candidatesChecked = len.
//
// Audit-log:
//   - outcome='ok': granter_user_id = id выбранного
//   - остальные: granter_user_id = NULL (выбора не было)
//
// Токен берётся LIVE из user_github_tokens на каждом запросе — рефрэш OAuth
// подхватывается автоматически. Никогда не печатаем сам токен в app-логи.
export class GetDelegatedGitToken {
  constructor(private readonly deps: Deps) {}

  async execute(input: GetDelegatedGitTokenInput): Promise<DelegatedGitToken> {
    const { projectId, callerUserId } = input;

    // 1. Проект.
    const project = await this.deps.projects.getById(projectId);
    if (!project) {
      // Не логируем — для несуществующего проекта нет access-log'а.
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

    // 3. Все enabled-делегации.
    const enabledDelegations = await this.deps.delegations.listEnabledForProject(projectId);
    if (enabledDelegations.length === 0) {
      await this.deps.delegations.logAccess({
        projectId,
        accessedByUserId: callerUserId,
        granterUserId: null,
        outcome: 'delegation_disabled',
      });
      throw new GitTokenDelegationDisabledError();
    }

    // 4. Упорядочить кандидатов: owner первый (если у него enabled-делегация),
    //    потом остальные по displayName ASC, email ASC. Caller исключаем.
    const granterIds = enabledDelegations
      .map((d) => d.granterUserId)
      .filter((id) => id !== callerUserId);

    // Резолвим юзеров одним batch-fetch'ем.
    const granterUsers = await this.deps.users.getManyByIds(granterIds);
    const byId = new Map(granterUsers.map((u) => [u.id, u]));

    // Owner идёт первым (если он в кандидатах). Остальных сортируем case-insensitive
    // по displayName, при равенстве — по email.
    const nonOwner = granterIds.filter((id) => id !== project.ownerId);
    nonOwner.sort((a, b) => {
      const ua = byId.get(a);
      const ub = byId.get(b);
      if (!ua || !ub) return 0;
      const ca = ua.displayName.toLowerCase().localeCompare(ub.displayName.toLowerCase(), 'ru');
      if (ca !== 0) return ca;
      return ua.email.localeCompare(ub.email);
    });

    const orderedCandidates: string[] = [];
    if (granterIds.includes(project.ownerId)) {
      orderedCandidates.push(project.ownerId);
    }
    orderedCandidates.push(...nonOwner);

    // 5. Пройти кандидатов по порядку — взять токен первого с подключённым GitHub.
    for (const granterId of orderedCandidates) {
      const granterUser = byId.get(granterId);
      if (!granterUser) continue; // delegation row для удалённого юзера — пропускаем
      const githubConn = await this.deps.githubTokens.getWithTokenByUserId(granterId);
      if (!githubConn) continue;

      // Нашли. Logging + return. context='git_token_fetch' — отличает прямой
      // вызов /agent/.../git-token от внутренних usages (link_commit, kb_write).
      await this.deps.delegations.logAccess({
        projectId,
        accessedByUserId: callerUserId,
        granterUserId: granterId,
        outcome: 'ok',
        context: 'git_token_fetch',
      });
      const delegation = enabledDelegations.find((d) => d.granterUserId === granterId);
      return {
        token: githubConn.accessToken,
        login: githubConn.githubLogin,
        scopes: githubConn.scopes,
        source: granterId === project.ownerId ? 'owner_delegation' : 'member_delegation',
        grantedBy: granterId,
        grantedByDisplayName: granterUser.displayName,
        // grantedAt должен быть не-null (enabled=true ⇒ upsert проставил), но
        // на крайний случай fallback на now.
        grantedAt: delegation?.grantedAt ?? new Date(),
      };
    }

    // 6. Никто не подошёл.
    await this.deps.delegations.logAccess({
      projectId,
      accessedByUserId: callerUserId,
      granterUserId: null,
      outcome: 'no_eligible_grantor',
    });
    throw new NoEligibleGrantorError(orderedCandidates.length);
  }
}
