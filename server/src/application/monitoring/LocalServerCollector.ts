import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { SnapshotMetrics, LogTails } from '../../domain/monitoring/ServerSnapshot.js';

export type LocalCollectResult = {
  readonly reachable: boolean;
  readonly metrics: SnapshotMetrics | null;
  readonly logs: LogTails | null;
  readonly errors: string[];
};

// Сбор метрик хоста, на котором крутится сам бэкенд PF (kind='local'). Реализация
// шеллит pm2/df + читает os/лог-файлы. Реализация ОБЯЗАНА быть безопасной (execFile
// argv-only, timeouts, allowlist путей) — см. ShellLocalServerCollector.
export interface LocalServerCollector {
  collect(server: ProjectServer): Promise<LocalCollectResult>;
}
