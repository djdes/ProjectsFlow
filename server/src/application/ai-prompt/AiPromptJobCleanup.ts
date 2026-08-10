import type { AiPromptJobMode } from '../../domain/ai-prompt/AiPromptJob.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';

const STALE_AFTER_MS = 5 * 60 * 1000;        // 5 минут на queued/running (improve/compose)
// assistant — очередь ИИ-ассистентов продуктов (DocsFlow/ScanFlow): разбор фото/PDF и
// создание документов легко идёт дольше 5 минут, а продукты дают токену TTL 15 минут.
const ASSISTANT_STALE_AFTER_MS = 15 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000; // 7 дней на succeeded/failed/cancelled

const INTERACTIVE_MODES: readonly AiPromptJobMode[] = ['improve', 'compose', 'compose-advanced'];
const ASSISTANT_MODES: readonly AiPromptJobMode[] = ['assistant'];

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
};

/**
 * Housekeeping для ai_prompt_jobs:
 * - queued/running старше 5 минут (improve/compose*) или 15 минут (assistant) → cancelled с reason.
 * - succeeded/failed/cancelled старше 7 дней → DELETE.
 *
 * Запускается с интервалом 60 сек (см. composition в index.ts).
 */
export class AiPromptJobCleanup {
  constructor(private readonly deps: Deps) {}

  async runOnce(now: Date = new Date()): Promise<{ cancelled: number; deleted: number }> {
    const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS);
    const assistantStaleCutoff = new Date(now.getTime() - ASSISTANT_STALE_AFTER_MS);
    const terminalCutoff = new Date(now.getTime() - TERMINAL_RETENTION_MS);

    const [cancelled, cancelledAssistant, deleted] = await Promise.all([
      this.deps.aiPromptJobs.cancelStale({
        olderThan: staleCutoff,
        reason: 'dispatcher_timeout',
        statuses: ['queued', 'running'],
        modes: INTERACTIVE_MODES,
      }),
      this.deps.aiPromptJobs.cancelStale({
        olderThan: assistantStaleCutoff,
        reason: 'dispatcher_timeout',
        statuses: ['queued', 'running'],
        modes: ASSISTANT_MODES,
      }),
      this.deps.aiPromptJobs.deleteTerminal({ olderThan: terminalCutoff }),
    ]);

    return { cancelled: cancelled + cancelledAssistant, deleted };
  }
}
