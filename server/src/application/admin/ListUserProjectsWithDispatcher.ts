import type { ProjectStatus } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { GitTokenDelegationRepository } from '../project/GitTokenDelegationRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly delegations: GitTokenDelegationRepository;
  readonly users: UserRepository;
};

export type AdminProjectDispatcherView = {
  readonly projectId: string;
  readonly projectName: string;
  readonly status: ProjectStatus;
  readonly isInbox: boolean;
  // Текущий диспетчер: null = ручной режим. displayName/email только если назначен.
  readonly dispatcherUserId: string | null;
  readonly dispatcherDisplayName: string | null;
  readonly dispatcherEmail: string | null;
  // GitHub-делегация: включена ли владельцем (или admin'ом за владельца).
  readonly gitTokenDelegationEnabled: boolean;
};

// Admin-only: список проектов конкретного юзера (где он owner) + их текущие
// диспетчеры с резолвом displayName/email. Используется на admin-странице для
// колонки «Проекты / Диспетчеры» — admin видит и может менять диспетчеров
// в чужих проектах через `PUT /api/projects/:id/dispatcher` (admin-bypass).
//
// Access-check (isAdmin) — на уровне presentation (route уже под admin-middleware).
export class ListUserProjectsWithDispatcher {
  constructor(private readonly deps: Deps) {}

  async execute(targetUserId: string): Promise<AdminProjectDispatcherView[]> {
    // listProjectsForUser возвращает все проекты юзера со ВСЕМИ ролями. Фильтруем
    // на owner — для admin-обзора важно «проекты этого юзера», т.е. где он хозяин.
    const all = await this.deps.members.listProjectsForUser(targetUserId);
    const owned = all.filter((p) => p.role === 'owner');

    // Один batch-fetch displayName'ов для уникальных диспетчеров.
    const dispatcherIds = [...new Set(owned.map((p) => p.dispatcherUserId).filter((v): v is string => v !== null))];
    const dispatchers = await this.deps.users.getManyByIds(dispatcherIds);
    const byId = new Map(dispatchers.map((u) => [u.id, u]));

    // Per-project делегации. Простая итерация — обычно ≤10 проектов на юзера,
    // N+1 не страшен. Если станет узким местом — добавим `getMany(ids)` в repo.
    const delegations = await Promise.all(
      owned.map(async (p) => ({
        projectId: p.id,
        enabled: (await this.deps.delegations.get(p.id))?.enabled ?? false,
      })),
    );
    const delegationByProject = new Map(delegations.map((d) => [d.projectId, d.enabled]));

    return owned.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      status: p.status,
      isInbox: p.isInbox,
      dispatcherUserId: p.dispatcherUserId,
      dispatcherDisplayName: p.dispatcherUserId
        ? (byId.get(p.dispatcherUserId)?.displayName ?? null)
        : null,
      dispatcherEmail: p.dispatcherUserId
        ? (byId.get(p.dispatcherUserId)?.email ?? null)
        : null,
      gitTokenDelegationEnabled: delegationByProject.get(p.id) ?? false,
    }));
  }
}
