import type { AiPromptJobRepository } from './AiPromptJobRepository.js';

const STALE_AFTER_MS = 5 * 60 * 1000;        // 5 минут на queued/running
const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000; // 7 дней на succeeded/failed/cancelled

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
};

/**
 * Housekeeping для ai_prompt_jobs:
 * - queued/running старше 5 минут → cancelled с reason.
 * - succeeded/failed/cancelled старше 7 дней → DELETE.
 *
 * Запускается с интервалом 60 сек (см. composition в index.ts).
 */
export class AiPromptJobCleanup {
  constructor(private readonly deps: Deps) {}

  async runOnce(now: Date = new Date()): Promise<{ cancelled: number; deleted: number }> {
    const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);

    const [cancelled, deleted] = await Promise.all([
      this.deps.aiPromptJobs.cancelStale({
        olderThan: staleCutoff,
        reason: 'dispatcher_timeout',
        statuses: ['queued', 'running'],
      }),
      this.deps.aiPromptJobs.deleteTerminal({ olderThan: terminalCutoff }),
    ]);

    return { cancelled, deleted };
  }
}
