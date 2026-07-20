import type { UaClass } from '../../domain/app-backend/AppTraffic.js';

// Одна запись визита на запись (append-only). Никакого IP/raw UA — только производные поля.
export type AppVisitRecord = {
  readonly projectId: string;
  readonly path: string;
  readonly sessionHash: string;
  readonly userAgentClass: UaClass;
  readonly visitDay: string; // 'YYYY-MM-DD'
  readonly createdAt: string; // ISO-8601 ms
};

// Результат агрегации за окно. Только временные ряды + грубые корзины — никаких «топ значений».
export type AppTrafficAggregate = {
  readonly perDay: readonly { readonly date: string; readonly visits: number; readonly sessions: number }[];
  readonly byClass: Readonly<Partial<Record<UaClass, number>>>;
  readonly totalVisits: number;
  readonly totalSessions: number;
};

// Порт хранилища трафика приложения (db/137). Данные лежат в основной MariaDB (агрегируемо),
// в отличие от per-project SQLite приложения.
export interface AppTrafficRepository {
  record(visit: AppVisitRecord): Promise<void>;
  // Число записей проекта за конкретный день — для потолка записей в сутки (анти-абьюз квоты).
  countForDay(projectId: string, visitDay: string): Promise<number>;
  // Агрегация за окно [sinceDay .. включительно]. sinceDay — 'YYYY-MM-DD'.
  aggregate(projectId: string, sinceDay: string): Promise<AppTrafficAggregate>;
}
