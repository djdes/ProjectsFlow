import type { Pool } from 'mysql2/promise';
import type { DbHealthProbe } from '../../application/monitoring/DbHealthProbe.js';
import type { DbHealth } from '../../domain/monitoring/ServerSnapshot.js';

// Метрики MariaDB через тот же пул приложения: соединения, лимит, uptime, slow-queries,
// размер БД, версия. Всё best-effort — любая ошибка → reachable:false (или null-поля).
export class MysqlDbHealthProbe implements DbHealthProbe {
  constructor(private readonly pool: Pool) {}

  async probe(): Promise<DbHealth | null> {
    try {
      const connections = await this.statusNumber("SHOW GLOBAL STATUS LIKE 'Threads_connected'");
      const maxConnections = await this.statusNumber("SHOW VARIABLES LIKE 'max_connections'");
      const uptimeSeconds = await this.statusNumber("SHOW GLOBAL STATUS LIKE 'Uptime'");
      const slowQueries = await this.statusNumber("SHOW GLOBAL STATUS LIKE 'Slow_queries'");

      let sizeBytes: number | null = null;
      try {
        const [rows] = await this.pool.query(
          'SELECT SUM(data_length + index_length) AS bytes FROM information_schema.tables WHERE table_schema = DATABASE()',
        );
        const b = (rows as Array<{ bytes?: string | number | null }>)[0]?.bytes;
        sizeBytes = b === undefined || b === null ? null : Number(b);
      } catch {
        /* skip */
      }

      let version: string | null = null;
      try {
        const [rows] = await this.pool.query('SELECT VERSION() AS v');
        version = (rows as Array<{ v?: string }>)[0]?.v ?? null;
      } catch {
        /* skip */
      }

      return { reachable: true, connections, sizeBytes, maxConnections, uptimeSeconds, slowQueries, version };
    } catch {
      return { reachable: false, connections: null, sizeBytes: null };
    }
  }

  // SHOW ... LIKE → строки { Variable_name, Value }; берём числовое Value.
  private async statusNumber(query: string): Promise<number | null> {
    const [rows] = await this.pool.query(query);
    const row = (rows as Array<{ Value?: string }>)[0];
    if (!row || row.Value === undefined) return null;
    const n = Number(row.Value);
    return Number.isFinite(n) ? n : null;
  }
}
