import type { AppAuditEntry, AppAuditInput, AppAuditListOpts } from './AppDatabaseStore.js';

// Порт надёжного журнала АДМИНИСТРАТИВНОГО аудита Data Explorer (события участников проекта:
// раскрытие секретов, экспорт, смена чувствительности, листинг рантайм-пользователей, CRUD).
//
// В отличие от per-project SQLite `_audit_log` (порт AppDatabaseStore.recordAudit), который
// наполняет недоверенный публичный App Runtime и который усекается до последних 2000 событий,
// этот журнал живёт в доверенной MariaDB, append-only и НЕ вытесняется трафиком приложения.
// Так административное раскрытие секрета всегда оставляет неудаляемый след — гарантия, на
// которую опирается всё маскирование.
export interface AppAdminAuditRepository {
  // Записать событие. id/createdAt проставляет реализация (как SqliteAppDatabaseStore.recordAudit).
  record(projectId: string, input: AppAuditInput): Promise<AppAuditEntry>;
  // Прочитать события проекта с фильтрами и пагинацией — для объединённой ленты логов.
  list(projectId: string, opts?: AppAuditListOpts): Promise<{ rows: AppAuditEntry[]; total: number }>;
}
