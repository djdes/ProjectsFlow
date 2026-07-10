import type { AppBackend } from '../../domain/app-backend/AppBackend.js';
import type { AppSchema } from '../../domain/app-backend/AppSchema.js';

export type UpsertAppBackendInput = {
  readonly projectId: string;
  readonly status: 'none' | 'active';
  readonly schema: AppSchema | null;
  readonly appKeyHash: string | null;
  // Опционально: переопределить лимит хранилища (по умолчанию колонка держит 100 МБ).
  readonly storageLimitBytes?: number;
};

// Порт реестра бэкендов приложений (метаданные в основной БД). Сами данные приложения —
// в SQLite-файлах (см. AppDatabaseStore).
export interface AppBackendRepository {
  getByProject(projectId: string): Promise<AppBackend | null>;
  upsert(input: UpsertAppBackendInput): Promise<AppBackend>;
  // Обновить учтённый размер per-project БД (после операций записи).
  setUsage(projectId: string, usageBytes: number): Promise<void>;
}
