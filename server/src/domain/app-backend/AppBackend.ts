import type { AppSchema } from './AppSchema.js';

export type AppBackendStatus = 'none' | 'active';

// Лимит хранилища по умолчанию — 100 МБ на проект (совпадает с DEFAULT в db/102).
export const DEFAULT_STORAGE_LIMIT_BYTES = 100 * 1024 * 1024;

// Реестровая запись бэкенда приложения (метаданные; сами данные — в SQLite-файле проекта).
export type AppBackend = {
  readonly projectId: string;
  readonly status: AppBackendStatus;
  readonly schema: AppSchema | null;
  readonly appKeyHash: string | null;
  readonly usageBytes: number;
  readonly storageLimitBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
