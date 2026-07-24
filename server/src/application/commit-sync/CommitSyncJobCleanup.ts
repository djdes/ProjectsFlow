import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import type { FlushCommitSyncBatch } from './FlushCommitSyncBatch.js';

const STALE_AFTER_MS = 5 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000;

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
  // Safety flush: после добивания зависших job'ов досылаем «осиротевшие» батчи (db/143).
  readonly flush?: FlushCommitSyncBatch;
};

// Housekeeping: queued/running старше 5 мин → cancelled; терминальные старше 7 дней → DELETE.
// Плюс safety flush батчей: если один job батча завис (воркер упал) и был отменён здесь, батч
// теперь весь терминален — досылаем его одним сообщением, чтобы он не молчал вечно.
export class CommitSyncJobCleanup {
  constructor(private readonly deps: Deps) {}

  async runOnce(
    now: Date = new Date(),
  ): Promise<{ cancelled: number; deleted: number; flushed: number }> {
    const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);

    const [cancelled, deleted] = await Promise.all([
      this.deps.commitSyncJobs.cancelStale({
        olderThan: staleCutoff,
        statuses: ['queued', 'running'],
      }),
      this.deps.commitSyncJobs.deleteTerminal({ olderThan: terminalCutoff }),
    ]);
    // Досылаем батчи, ставшие полностью терминальными (в т.ч. после cancelStale выше). Безопасно
    // и когда cancelled=0: sweep сам отберёт только батчи без незавершённых job'ов и без отправки.
    const flushed = this.deps.flush
      ? await this.deps.flush.sweep().catch(() => 0)
      : 0;
    return { cancelled, deleted, flushed };
  }
}
