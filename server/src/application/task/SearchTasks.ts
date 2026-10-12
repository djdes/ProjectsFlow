import type {
  TaskSearchRepository,
  TaskSearchResult,
} from './TaskSearchRepository.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import { keyboardLayoutQueryVariants } from './keyboardLayoutSearch.js';

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 30;

export type SearchTasksDeps = {
  readonly search: TaskSearchRepository;
  // UI-скоуп по активному пространству. Передаётся для cookie-сессии (изоляция «Входящих»/
  // палитры по текущему пространству); ОПУСКАЕТСЯ для agent-токена, у которого нет
  // «текущего пространства» — он ищет по всем проектам владельца (by-design глобально).
  readonly resolveActiveWorkspace?: ResolveActiveWorkspace;
};

// Глобальный поиск по задачам. Скоуп: admin (isAdmin) — все задачи; иначе — проекты, где
// юзер member, дополнительно изолированные по активному пространству, если задан
export class SearchTasks {
  constructor(private readonly deps: SearchTasksDeps) {}

  async execute(
    userId: string,
    rawQuery: string,
    opts?: { isAdmin?: boolean },
  ): Promise<TaskSearchResult[]> {
    const query = rawQuery.trim();
    // Слишком короткий запрос — пустой результат, не грузим БД одно-символьными LIKE'ами.
    if (query.length < MIN_QUERY_LENGTH) return [];
    let workspaceId: string | undefined;
    if (this.deps.resolveActiveWorkspace) {
      const ws = await this.deps.resolveActiveWorkspace(userId);
      if (!ws) return [];
      workspaceId = ws.id;
    }
    const batches = await Promise.all(
      keyboardLayoutQueryVariants(query).map((variant) => this.deps.search.search({
        userId,
        query: variant,
        includeAllProjects: !this.deps.resolveActiveWorkspace && (opts?.isAdmin ?? false),
        workspaceId,
        limit: DEFAULT_LIMIT,
      })),
    );

    const seen = new Set<string>();
    const merged: TaskSearchResult[] = [];
    for (const batch of batches) {
      for (const result of batch) {
        if (seen.has(result.taskId)) continue;
        seen.add(result.taskId);
        merged.push(result);
        if (merged.length === DEFAULT_LIMIT) return merged;
      }
    }
    return merged;
  }
}
