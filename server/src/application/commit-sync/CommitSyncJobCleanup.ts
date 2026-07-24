import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import type { FlushCommitSyncBatch } from './FlushCommitSyncBatch.js';

// A single agent-runner processes commit-sync jobs serially (GitHub fetch + task match), and a
// workspace can funnel dozens of projects through one dispatcher. 5 then 15 minutes still timed out
// the tail with `dispatcher_timeout` before the runner reached them (prod: ~half cancelled). 60
// minutes gives one slow runner room to clear a large batch; the digest still flushes as soon as
// the LAST job finishes, so this only raises the ceiling for the worst case, not the usual latency.
const STALE_AFTER_MS = 60 * 60 * 1000;
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
