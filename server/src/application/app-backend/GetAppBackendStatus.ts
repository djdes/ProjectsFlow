import type { AppBackendRepository } from './AppBackendRepository.js';
import type { AppDatabaseStore } from './AppDatabaseStore.js';
import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireProjectAccess } from '../project/projectAccess.js';

type Deps = ProjectAccessDeps & {
  readonly appBackends: AppBackendRepository;
  readonly appDb: AppDatabaseStore;
};

export type AppBackendStatus = {
  readonly status: 'none' | 'active';
  readonly usageBytes: number;
  readonly storageLimitBytes: number;
  // Имена таблиц объявленной схемы (без системных `_*`) — для показа в UI.
  readonly tables: readonly string[];
};

// Статус бэкенда приложения для проекта: включён ли, сколько занимает / лимит, какие таблицы.
// Read-доступ к проекту (member). usage читаем ЖИВЫМ размером SQLite (точнее реестрового счётчика).
export class GetAppBackendStatus {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<AppBackendStatus> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    const backend = await this.deps.appBackends.getByProject(projectId);
    if (!backend || backend.status !== 'active') {
      return { status: 'none', usageBytes: 0, storageLimitBytes: 0, tables: [] };
    }
    return {
      status: 'active',
      usageBytes: this.deps.appDb.sizeBytes(projectId),
      storageLimitBytes: backend.storageLimitBytes,
      tables: backend.schema?.tables.map((t) => t.name) ?? [],
    };
  }
}
