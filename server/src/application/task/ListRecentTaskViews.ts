import type { RecentTaskView } from '../../domain/task/RecentTaskView.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { RecentTaskViewRepository } from './RecentTaskViewRepository.js';

type Deps = {
  readonly repo: RecentTaskViewRepository;
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  // Общий проект (db/182): задачи, скрытые от человека правилами, в «Недавнем» не показываем.
  readonly hiddenTaskIds?: (
    userId: string,
    refs: ReadonlyArray<{ readonly projectId: string; readonly taskId: string }>,
  ) => Promise<ReadonlySet<string>>;
};

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 50;

export class ListRecentTaskViews {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, limit?: number): Promise<RecentTaskView[]> {
    const clamped = Math.max(1, Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT));
    // team → только этого пространства; нет пространства → пусто.
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    const workspaceId = ws.id;
    if (!this.deps.hiddenTaskIds) return this.deps.repo.listRecent(userId, clamped, workspaceId);
    // С запасом: часть записей может оказаться скрытой правилами общего проекта.
    const list = await this.deps.repo.listRecent(userId, Math.min(clamped + 10, MAX_LIMIT), workspaceId);
    const hidden = await this.deps.hiddenTaskIds(userId, list);
    return list.filter((view) => !hidden.has(view.taskId)).slice(0, clamped);
  }
}
