import type { AppBackendRepository } from './AppBackendRepository.js';
import type { AppDatabaseStore } from './AppDatabaseStore.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireDispatcherAccess } from '../project/projectAccess.js';
import { validateAppSchema } from './validateAppSchema.js';

type Deps = {
  readonly appBackends: AppBackendRepository;
  readonly appDb: AppDatabaseStore;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly genKey: () => string;
  readonly hashKey: (key: string) => string;
};

export type ProvisionAppBackendInput = {
  readonly projectId: string;
  readonly callerUserId: string;
  readonly rawSchema: unknown;
};

// Завести (или переобъявить) бэкенд приложения проекту. Действие ВОРКЕРА: гейт «назначенный
// диспетчер проекта» (как PublishSiteArtifact) — схему знает только сгенерированный код. Валидирует
// схему, создаёт/догоняет per-project SQLite, генерит app-ключ (возвращаем РАЗ, храним хеш),
// помечает реестр active. Идемпотентно (повторный вызов обновляет схему и ключ).
export class ProvisionAppBackend {
  constructor(private readonly deps: Deps) {}

  async execute(input: ProvisionAppBackendInput): Promise<{ appKey: string }> {
    await requireDispatcherAccess(this.deps, input.projectId, input.callerUserId);
    const schema = validateAppSchema(input.rawSchema);
    this.deps.appDb.ensureDatabase(input.projectId, schema);
    const appKey = this.deps.genKey();
    await this.deps.appBackends.upsert({
      projectId: input.projectId,
      status: 'active',
      schema,
      appKeyHash: this.deps.hashKey(appKey),
    });
    return { appKey };
  }
}
