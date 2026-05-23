import type { AgentTokenRepository } from '../agent/AgentTokenRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
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
  readonly users: UserRepository;
};

export type DispatcherCandidate = {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  // 'owner' | 'editor' | 'viewer' — если кандидат член проекта;
  // null — если admin не-member (доступен через admin-bypass).
  readonly role: ProjectMemberWithUser['role'] | null;
  readonly activeTokenCount: number;
  // True для кандидатов, которые admin — UI рисует плашку «(admin)».
  readonly isAdmin: boolean;
  // True если кандидат — member проекта. False для admin-не-member'ов.
  readonly isMember: boolean;
};

// Список кандидатов в диспетчеры проекта. viewer+ может смотреть, viewer+ может
// и менять (см. SetProjectDispatcher). Включаем:
//   - участников проекта с ≥1 активным agent-токеном;
//   - админов с ≥1 активным токеном (даже не-member'ов — у них admin-bypass).
// Юзер с одной id'шкой в обоих сетах появится один раз (приоритет — member-info).
export class ListDispatcherCandidates {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, actorUserId: string): Promise<DispatcherCandidate[]> {
    await requireProjectAccess(this.deps, projectId, actorUserId, 'read_project');
    const [members, admins] = await Promise.all([
      this.deps.members.listByProject(projectId),
      this.deps.users.listAdmins(),
    ]);

    const out: DispatcherCandidate[] = [];
    const seen = new Set<string>();

    // 1) Members с активными токенами.
    for (const m of members) {
      const activeTokenCount = await this.deps.agentTokens.countActiveByUser(m.userId);
      if (activeTokenCount === 0) continue;
      seen.add(m.userId);
      out.push({
        userId: m.userId,
        displayName: m.user.displayName,
        email: m.user.email,
        role: m.role,
        activeTokenCount,
        isAdmin: m.user.isAdmin,
        isMember: true,
      });
    }

    // 2) Admins не-member'ы с активными токенами (admin-bypass даёт им access).
    for (const a of admins) {
      if (seen.has(a.id)) continue;
      const activeTokenCount = await this.deps.agentTokens.countActiveByUser(a.id);
      if (activeTokenCount === 0) continue;
      out.push({
        userId: a.id,
        displayName: a.displayName,
        email: a.email,
        role: null,
        activeTokenCount,
        isAdmin: true,
        isMember: false,
      });
    }

    return out;
  }
}
