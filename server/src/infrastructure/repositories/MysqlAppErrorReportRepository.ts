import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { AppErrorReport, AppErrorReportRepository, AppErrorSearch } from '../../application/app-errors/AppErrorReports.js';

const base = `id, report_id AS reportId, program, version, machine, user_name AS userName, level, caption, details, occurred_at AS occurredAt, received_at AS receivedAt`;

export class MysqlAppErrorReportRepository implements AppErrorReportRepository {
  constructor(private readonly pool: Pool) {}

  async insert(r: Omit<AppErrorReport, 'receivedAt'>): Promise<boolean> {
    const [res] = await this.pool.query<ResultSetHeader>(
      `INSERT IGNORE INTO app_error_reports (id, report_id, program, version, machine, user_name, level, caption, details, log_tail, occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [r.id, r.reportId, r.program, r.version, r.machine, r.userName, r.level, r.caption, r.details, r.logTail, r.occurredAt],
    );
    return res.affectedRows === 1;
  }

  async search(q: AppErrorSearch): Promise<AppErrorReport[]> {
    const where = ['occurred_at >= UTC_TIMESTAMP(3) - INTERVAL ? HOUR'];
    const params: unknown[] = [q.hours];
    if (q.program) { where.push('program = ?'); params.push(q.program); }
    const text = q.query?.trim();
    if (text) {
      const like = `%${text.replace(/[\%_]/g, (c) => `\${c}`)}%`;
      where.push('(caption LIKE ? OR details LIKE ? OR log_tail LIKE ? OR machine LIKE ? OR user_name LIKE ?)');
      params.push(like, like, like, like, like);
    }
    params.push(q.limit);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${base}, ${q.withLog ? 'log_tail' : 'NULL'} AS logTail FROM app_error_reports
       WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`, params);
    return rows as AppErrorReport[];
  }

  async purgeOlderThan(days: number): Promise<void> {
    await this.pool.query('DELETE FROM app_error_reports WHERE occurred_at < UTC_TIMESTAMP() - INTERVAL ? DAY LIMIT 5000', [days]);
  }
}
