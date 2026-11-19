import { createHash, timingSafeEqual } from 'node:crypto';

export type AppErrorLevel = 'critical' | 'error' | 'minor' | 'manual';
export const APP_ERROR_LEVELS: readonly AppErrorLevel[] = ['critical', 'error', 'minor', 'manual'];

export type AppErrorReport = {
  id: string;
  reportId: string;
  program: string;
  version: string | null;
  machine: string | null;
  userName: string | null;
  level: AppErrorLevel;
  caption: string;
  details: string | null;
  logTail: string | null;
  occurredAt: Date;
  receivedAt: Date;
};

export type AppErrorSearch = { program?: string; query?: string; hours: number; limit: number; withLog: boolean };

export interface AppErrorReportRepository {
  // false — отчёт с таким reportId уже есть (повтор из очереди программы).
  insert(report: Omit<AppErrorReport, 'receivedAt'>): Promise<boolean>;
  search(q: AppErrorSearch): Promise<AppErrorReport[]>;
  // Хранить не дольше 90 дней: это журнал для диагностики, а не архив.
  purgeOlderThan(days: number): Promise<void>;
}

// Хеш ключа приёма: сам ключ зашит в сборки программ (приватные репозитории),
// в публичном репозитории ProjectsFlow — только SHA-256. APP_ERROR_INGEST_KEY_SHA256 переопределяет.
const DEFAULT_KEY_SHA256 = '17eccc24b710d5fe7fb2f80c212cc23dc250adddeca9c5499c0b455e3bf6c643';

export const LOG_TAIL_LIMIT = 256 * 1024;

export class AppErrorReports {
  constructor(private readonly deps: {
    repo: AppErrorReportRepository;
    idGen: () => string;
    now: () => Date;
    keySha256?: string;
  }) {}

  checkKey(key: string | undefined): boolean {
    if (!key) return false;
    const expected = Buffer.from((this.deps.keySha256 || DEFAULT_KEY_SHA256).toLowerCase(), 'hex');
    const actual = createHash('sha256').update(key).digest();
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async ingest(input: {
    reportId: string; program: string; version?: string | null; machine?: string | null; user?: string | null;
    level: AppErrorLevel; caption: string; details?: string | null; log?: string | null; occurredAt?: Date;
  }): Promise<void> {
    const log = input.log ? input.log.slice(-LOG_TAIL_LIMIT) : null;
    const now = this.deps.now();
    // Часы клиента могут врать: будущее время считаем временем приёма.
    const at = input.occurredAt && input.occurredAt.getTime() <= now.getTime() + 5 * 60_000 ? input.occurredAt : now;
    await this.deps.repo.insert({
      id: this.deps.idGen(), reportId: input.reportId, program: input.program,
      version: input.version ?? null, machine: input.machine ?? null, userName: input.user ?? null,
      level: input.level, caption: input.caption, details: input.details ?? null, logTail: log, occurredAt: at,
    });
    if (Math.random() < 0.01) await this.deps.repo.purgeOlderThan(90).catch(() => {});
  }

  search(q: AppErrorSearch): Promise<AppErrorReport[]> { return this.deps.repo.search(q); }
}
