import type { DbHealth } from '../../domain/monitoring/ServerSnapshot.js';

// Снимает метрики БД (MariaDB) для local-сервера. Реализация — MysqlDbHealthProbe
// (использует тот же пул приложения). Возвращает null если зонд не сконфигурирован.
export interface DbHealthProbe {
  probe(): Promise<DbHealth | null>;
}
