import type { Project } from '../../domain/project/Project.js';
import type {
  GitTokenAccessContext,
  GitTokenDelegationRepository,
} from '../project/GitTokenDelegationRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { GithubTokenRepository } from './GithubTokenRepository.js';

export type EffectiveGithubToken = {
  readonly accessToken: string;
  readonly githubLogin: string;
  // 'caller_own' — у caller'а есть свой OAuth-токен, используем его.
  // 'delegated' — caller — диспетчер проекта, owner или другой member включил
  //   делегацию; используем токен этого member'а (выбор по v0.15-алгоритму:
  //   owner-first → displayName ASC, caller excluded).
  readonly source: 'caller_own' | 'delegated';
  // userId владельца токена. Для 'caller_own' == callerId; для 'delegated' — id
  // выбранного granter'а. Используется в audit-log + UI.
  readonly grantedBy: string;
};

// Минимальный набор зависимостей. Caller'ы передают свои deps — TS structural
// typing проверяет наличие нужных полей. Имена полей подобраны под convention
// существующих use-case'ов (`tokens` для GitHub OAuth, `projects`, `delegations`,
// `users`).
type Deps = {
  readonly tokens: GithubTokenRepository;
  readonly projects: ProjectRepository;
  readonly delegations: GitTokenDelegationRepository;
  readonly users: UserRepository;
};

// v0.16+: универсальный резолвер «какой GitHub-токен использовать для server-side
// операций от имени caller'а в контексте этого проекта».
//
// Приоритет:
//   1. Собственный токен caller'а (если у него подключён GitHub) → 'caller_own'.
//   2. Делегированный токен любого члена с включённой делегацией → 'delegated',
//      выбор по v0.15-алгоритму:
//        a) project.ownerId если у него enabled+github
//        b) остальные enabled-grantеры по displayName ASC, email ASC
//      caller (= диспетчер) исключается из кандидатов.
//      Делегация работает ТОЛЬКО для диспетчера проекта; не-диспетчер с
//      собственным токеном получит свой, без своего — null (никакой fallback).
//   3. null — ни своего, ни делегированного.
//
// Если использовался 'delegated' — caller-код должен вызвать `delegations.logAccess`
// с outcome='ok' + соответствующий `context` (link_commit / sync_commits / kb_write).
// Эту запись helper НЕ пишет сам — потому что не всегда дочитает успешно (вызов
// может упасть на GitHub API позже), и каждый caller хочет свой context.
export async function resolveEffectiveGithubToken(
  deps: Deps,
  callerUserId: string,
  projectId: string,
): Promise<EffectiveGithubToken | null> {
  // 1. Caller's own.
  const own = await deps.tokens.getWithTokenByUserId(callerUserId);
  if (own) {
    return {
      accessToken: own.accessToken,
      githubLogin: own.githubLogin,
      source: 'caller_own',
      grantedBy: callerUserId,
    };
  }

  // 2. Delegated — только если caller диспетчер этого проекта.
  const project = await deps.projects.getById(projectId);
  if (!project || project.dispatcherUserId !== callerUserId) return null;

  return pickDelegatedToken(deps, project, callerUserId);
}

// Повтор логики GetDelegatedGitToken (но без audit-log'а — caller сам решит когда
// и с каким context'ом писать). Возвращает первого подходящего grantor'а.
async function pickDelegatedToken(
  deps: Deps,
  project: Project,
  callerUserId: string,
): Promise<EffectiveGithubToken | null> {
  const enabled = await deps.delegations.listEnabledForProject(project.id);
  if (enabled.length === 0) return null;

  const granterIds = enabled.map((d) => d.granterUserId).filter((id) => id !== callerUserId);
  if (granterIds.length === 0) return null;

  const granterUsers = await deps.users.getManyByIds(granterIds);
  const byId = new Map(granterUsers.map((u) => [u.id, u]));

  // Owner-first → displayName ASC → email ASC.
  const nonOwner = granterIds.filter((id) => id !== project.ownerId);
  nonOwner.sort((a, b) => {
    const ua = byId.get(a);
    const ub = byId.get(b);
    if (!ua || !ub) return 0;
    const c = ua.displayName.toLowerCase().localeCompare(ub.displayName.toLowerCase(), 'ru');
    if (c !== 0) return c;
    return ua.email.localeCompare(ub.email);
  });

  const ordered: string[] = [];
  if (granterIds.includes(project.ownerId)) ordered.push(project.ownerId);
  ordered.push(...nonOwner);

  for (const granterId of ordered) {
    const conn = await deps.tokens.getWithTokenByUserId(granterId);
    if (!conn) continue;
    return {
      accessToken: conn.accessToken,
      githubLogin: conn.githubLogin,
      source: 'delegated',
      grantedBy: granterId,
    };
  }

  return null;
}

// Удобный хелпер для caller'а: писать в audit-log что использовали делегированный
// токен. Caller-кодом не обязателен (помогает только UI «owner видит для чего
// брали»), поэтому fire-and-forget совместим. Если eff.source === 'caller_own' —
// ничего не пишем (это не делегация).
export async function logDelegatedUsage(
  delegations: GitTokenDelegationRepository,
  projectId: string,
  callerUserId: string,
  eff: EffectiveGithubToken,
  context: GitTokenAccessContext,
): Promise<void> {
  if (eff.source !== 'delegated') return;
  await delegations.logAccess({
    projectId,
    accessedByUserId: callerUserId,
    granterUserId: eff.grantedBy,
    outcome: 'ok',
    context,
  });
}
