import type {
  TaskSearchRepository,
  TaskSearchResult,
} from './TaskSearchRepository.js';

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 30;

export type SearchTasksDeps = {
  readonly search: TaskSearchRepository;
};

// Глобальный поиск по задачам. Скоуп определяется ролью: обычный юзер видит только
// задачи проектов, где он member; admin (isAdmin) — все задачи всех проектов.
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
    return this.deps.search.search({
      userId,
      query,
      includeAllProjects: opts?.isAdmin ?? false,
      limit: DEFAULT_LIMIT,
    });
  }
}
