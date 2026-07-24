import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import type { FlushCommitSyncBatch } from './FlushCommitSyncBatch.js';

// A batched review shows a live «прогресс-сообщение» (⏳) in the Telegram group until the batch is
// terminal, and one agent-runner drains jobs serially. A fixed window couldn't serve both cases: a
// long window (60 min) left the progress hanging for an hour whenever the runner was off; a short
// window cancelled the tail before a busy runner reached it. So instead of a fixed age we detect a
// STALL: a batch is alive while the runner keeps making progress (claims or finishes jobs). If there
// is no progress for STALL_MS, the runner is stopped/off → cancel the batch's unfinished jobs so it
// closes (the sweep below deletes the progress message and posts the digest / a short conclusion).
// A runner that finishes a job every couple of minutes resets the clock and is never cut off.
const STALL_MS = 12 * 60 * 1000;

// Absolute backstop: any unfinished job (batched or not) older than this hard ceiling by created_at
// is cancelled regardless of activity — a safety net against pathologies (e.g. a batch that keeps
// churning activity yet never terminates).
const BACKSTOP_MS = 90 * 60 * 1000;

// Manual «Сверить сейчас» jobs (batch_key IS NULL): no batch, no progress message, nothing to keep
// alive — just cancel them once they are older than this by created_at.
const SINGLE_STALE_MS = 15 * 60 * 1000;

const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000;

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
  // Safety flush: после добивания зависших job'ов досылаем «осиротевшие» батчи (db/143).
  readonly flush?: FlushCommitSyncBatch;
};

// Housekeeping: stalled batches + backstop + single «Сверить сейчас» → cancelled; терминальные
// старше 7 дней → DELETE. После отмен зовём flush.sweep(): ставшие полностью терминальными батчи
// досылаются одним сообщением (удаляют прогресс, шлют итог/«не обработано»), чтобы не молчать вечно.
export class CommitSyncJobCleanup {
  constructor(private readonly deps: Deps) {}

  async runOnce(
    now: Date = new Date(),
  ): Promise<{ cancelled: number; deleted: number; flushed: number }> {
    const stallCutoff = new Date(now.getTime() - STALL_MS);
    const backstopCutoff = new Date(now.getTime() - BACKSTOP_MS);
    const singleCutoff = new Date(now.getTime() - SINGLE_STALE_MS);
    const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);

    // Order matters: run every cancel BEFORE the flush sweep so batches that become fully terminal
    // here are picked up in the same tick. The cancels run sequentially so a row is counted once
    // (a stalled batch job cancelled in step 1 is already terminal for steps 2/3).
    // 1. Stalled batches: runner stopped making progress → close them.
    const stalled = await this.deps.commitSyncJobs.cancelStalledBatches({ stalledBefore: stallCutoff });
    // 2. Absolute backstop for any unfinished job past the hard ceiling (batched or not).
    const backstop = await this.deps.commitSyncJobs.cancelStale({
      olderThan: backstopCutoff,
      statuses: ['queued', 'running'],
    });
    // 3. Single manual jobs: plain age-based cancel, unbatched only.
    const singles = await this.deps.commitSyncJobs.cancelStale({
      olderThan: singleCutoff,
      statuses: ['queued', 'running'],
      onlyUnbatched: true,
    });
    const deleted = await this.deps.commitSyncJobs.deleteTerminal({ olderThan: terminalCutoff });
    // Досылаем батчи, ставшие полностью терминальными (в т.ч. после отмен выше). Безопасно и когда
    // отмен не было: sweep сам отберёт только батчи без незавершённых job'ов и без отправки.
    const flushed = this.deps.flush
      ? await this.deps.flush.sweep().catch(() => 0)
      : 0;
    return { cancelled: stalled + backstop + singles, deleted, flushed };
  }
}
