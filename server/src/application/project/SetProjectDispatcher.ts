import type { Project } from '../../domain/project/Project.js';
import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import type { AgentTokenRepository } from '../agent/AgentTokenRepository.js';
import { requireProjectAccess } from './projectAccess.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly agentTokens: AgentTokenRepository;
};

// Reuse insufficient-role error для невалидного кандидата (не член / без токенов) —
// в presentation мапится в 400 с понятным сообщением.
export class DispatcherCandidateInvalidError extends Error {
  constructor(public readonly reason: 'not_member' | 'no_active_tokens') {
    super(`Dispatcher candidate invalid: ${reason}`);
    this.name = 'DispatcherCandidateInvalidError';
  }
}

// Назначить (или снять) Ralph-диспетчера проекта. Owner-only.
// `dispatcherUserId === null` — снять диспетчера, проект уходит в ручной режим.
// Иначе — валидируем: целевой юзер должен быть участником проекта И иметь хотя бы
// один активный (не revoked) agent-токен, иначе MCP-диспетчер не сможет работать.
export class SetProjectDispatcher {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    actorUserId: string,
    dispatcherUserId: string | null,
  ): Promise<Project> {
    await requireProjectAccess(this.deps, projectId, actorUserId, 'update_project');
    // update_project — editor+; проверим что actor — owner отдельно, чтобы не путать
    // с editor'ом, который может править проект, но не его автоматизацию.
    const membership = await this.deps.members.findForProject(projectId, actorUserId);
    if (!membership || membership.role !== 'owner') {
      throw new InsufficientProjectRoleError(
        membership?.role ?? 'viewer',
        'set_project_dispatcher',
      );
    }

    if (dispatcherUserId !== null) {
      // 1) Целевой юзер — участник этого проекта.
      const targetMembership = await this.deps.members.findForProject(projectId, dispatcherUserId);
      if (!targetMembership) {
        throw new DispatcherCandidateInvalidError('not_member');
      }
      // 2) У него хотя бы один активный agent-токен — иначе ralph не запустится.
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
