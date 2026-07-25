import type { RecentTaskView } from '../../domain/task/RecentTaskView.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { RecentTaskViewRepository } from './RecentTaskViewRepository.js';

type Deps = {
  readonly repo: RecentTaskViewRepository;
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
};

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 50;

export class ListRecentTaskViews {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, limit?: number): Promise<RecentTaskView[]> {
    const clamped = Math.max(1, Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT));
    // Изоляция по активному пространству, как ListProjects: дефолт-хаб → все мои недавние;
    // team → только этого пространства; нет пространства → пусто.
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    const workspaceId = ws.kind === 'team' ? ws.id : undefined;
    return this.deps.repo.listRecent(userId, clamped, workspaceId);
  }
}
