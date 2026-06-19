import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';

const STALE_AFTER_MS = 5 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000;

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
};

// Housekeeping: queued/running старше 5 мин → cancelled; терминальные старше 7 дней → DELETE.
export class CommitSyncJobCleanup {
  constructor(private readonly deps: Deps) {}

  async runOnce(now: Date = new Date()): Promise<{ cancelled: number; deleted: number }> {
    const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);

    const [cancelled, deleted] = await Promise.all([
      this.deps.commitSyncJobs.cancelStale({
        olderThan: staleCutoff,
        statuses: ['queued', 'running'],
      }),
      this.deps.commitSyncJobs.deleteTerminal({ olderThan: terminalCutoff }),
    ]);
    return { cancelled, deleted };
  }
}
