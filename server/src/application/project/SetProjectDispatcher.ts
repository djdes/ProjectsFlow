import type { Project } from '../../domain/project/Project.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';
import type { AgentTokenRepository } from '../agent/AgentTokenRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import { requireProjectAccess } from './projectAccess.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly agentTokens: AgentTokenRepository;
  readonly users: UserRepository;
};

// Reuse insufficient-role error для невалидного кандидата (не член / без токенов /
// не существует) — в presentation мапится в 400 с понятным сообщением.
export class DispatcherCandidateInvalidError extends Error {
  constructor(
    public readonly reason: 'not_member' | 'no_active_tokens' | 'user_not_found',
  ) {
    super(`Dispatcher candidate invalid: ${reason}`);
    this.name = 'DispatcherCandidateInvalidError';
  }
}

// Назначить (или снять) Ralph-диспетчера проекта. viewer+ (любой member может менять —
// это routing automation, не data access). Admin'у admin-bypass позволяет менять
// диспетчера в любом проекте (используется в admin-панели управления юзерами).
//
// `dispatcherUserId === null` — снять диспетчера, проект уходит в ручной режим.
// Иначе валидируем целевого юзера:
//   1) существует;
//   2) либо member проекта, либо admin (admin-bypass даёт ему доступ к любому проекту);
//   3) имеет хотя бы один активный agent-токен — иначе MCP-Ralph физически не сможет работать.
export class SetProjectDispatcher {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    actorUserId: string,
    dispatcherUserId: string | null,
  ): Promise<Project> {
    await requireProjectAccess(
      this.deps,
      projectId,
      actorUserId,
      'set_project_dispatcher',
    );

    if (dispatcherUserId !== null) {
      const targetUser = await this.deps.users.getById(dispatcherUserId);
      if (!targetUser) {
        throw new DispatcherCandidateInvalidError('user_not_found');
      }
      // Admin — валидный кандидат вне зависимости от членства (у него admin-bypass).
      // Иначе требуем membership.
      if (!targetUser.isAdmin) {
        const targetMembership = await this.deps.members.findForProject(projectId, dispatcherUserId);
        if (!targetMembership) {
          throw new DispatcherCandidateInvalidError('not_member');
        }
      }
      // ≥1 активный agent-токен — иначе ralph не запустится.
      const activeCount = await this.deps.agentTokens.countActiveByUser(dispatcherUserId);
      if (activeCount === 0) {
        throw new DispatcherCandidateInvalidError('no_active_tokens');
      }
    }

    const updated = await this.deps.projects.update(projectId, { dispatcherUserId });
    if (!updated) throw new ProjectNotFoundError();
    return updated;
  }
}
