import type { AgentTokenRepository } from '../agent/AgentTokenRepository.js';
import { requireProjectAccess } from './projectAccess.js';
import type {
  ProjectMemberRepository,
  ProjectMemberWithUser,
} from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly agentTokens: AgentTokenRepository;
};

export type DispatcherCandidate = {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: ProjectMemberWithUser['role'];
  readonly activeTokenCount: number;
};

// Список кандидатов в диспетчеры проекта: участники, у которых ≥1 активный
// agent-токен. Используется UI dropdown'ом «Выбрать диспетчера».
// viewer+ может смотреть (как listMembers); назначать может только owner —
// этот use-case только READ, owner-check в SetProjectDispatcher.
export class ListDispatcherCandidates {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, actorUserId: string): Promise<DispatcherCandidate[]> {
    await requireProjectAccess(this.deps, projectId, actorUserId, 'read_project');
    const members = await this.deps.members.listByProject(projectId);
    // Для каждого участника спрашиваем число активных токенов. Простая итерация —
    // на проекте обычно ≤10 участников, N+1 не страшен. Если когда-то понадобится
    // оптимизировать — заменить на один JOIN с group-by на agent_tokens.
    const out: DispatcherCandidate[] = [];
    for (const m of members) {
      const activeTokenCount = await this.deps.agentTokens.countActiveByUser(m.userId);
      if (activeTokenCount === 0) continue; // отфильтровываем — назначить нельзя
      out.push({
        userId: m.userId,
        displayName: m.user.displayName,
        email: m.user.email,
        role: m.role,
        activeTokenCount,
      });
    }
    return out;
  }
}
