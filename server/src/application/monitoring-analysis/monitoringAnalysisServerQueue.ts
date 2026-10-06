import {
  MonitoringAnalysisJobAlreadyClaimedError,
  MonitoringAnalysisJobNotFoundError,
} from '../../domain/monitoring-analysis/errors.js';
import { PlanRequiredError, UsageBlockedError } from '../../domain/usage/errors.js';
import type { ServerQueueAdapter } from '../llm/ServerQueueRunner.js';
import type { ClaimMonitoringAnalysisJob } from './ClaimMonitoringAnalysisJob.js';
import type { MonitoringAnalysisJobRepository } from './MonitoringAnalysisJobRepository.js';
import type { RunMonitoringAnalysisJobWithLlm } from './RunMonitoringAnalysisJobWithLlm.js';

// Job, которому гейт тарифа/лимита инициатора отказал в claim, остаётся queued — как у
// диспетчера: если тариф сменят или окно лимита сбросится, анализ ещё успеет пройти, иначе
// очистка снимет job через 5 минут. Гейт пересчитывает расход по ledger, поэтому такой job
// перепроверяем не на каждом тике раннера (1,5 с), а раз в REFUSED_RETRY_MS (диспетчер — ~8 с).
const REFUSED_RETRY_MS = 10_000;
// Окно выборки — как pollLimit диспетчера: job'ы, которым отказал гейт, не загораживают
// очередь остальным.
const POLL_WINDOW = 10;

type Deps = {
  readonly monitoringAnalysisJobs: Pick<MonitoringAnalysisJobRepository, 'listQueued'>;
  readonly claim: Pick<ClaimMonitoringAnalysisJob, 'execute'>;
  readonly run: Pick<RunMonitoringAnalysisJobWithLlm, 'execute'>;
  readonly now?: () => number;
};

export function monitoringAnalysisServerQueue(deps: Deps): ServerQueueAdapter {
  const refusedUntil = new Map<string, number>();
  const now = deps.now ?? Date.now;
  return {
    queue: 'monitoring',
    async claim(limit) {
      const at = now();
      for (const [id, until] of refusedUntil) if (until <= at) refusedUntil.delete(id);
      // Отложенные job'ы тоже попадают в выборку — расширяем окно на их число.
      const queued = await deps.monitoringAnalysisJobs.listQueued(Math.max(limit, POLL_WINDOW) + refusedUntil.size);
      const tasks: Array<() => Promise<void>> = [];
      for (const job of queued) {
        if (tasks.length >= limit) break;
        if (refusedUntil.has(job.id)) continue;
        try {
          // Тот же use-case, что у POST .../claim диспетчера: действуем от имени диспетчера
          // job'а, гейт тарифа/лимита — по инициатору (createdBy), сам claim атомарен.
          const claimed = await deps.claim.execute({ userId: job.dispatcherUserId, jobId: job.id });
          tasks.push(() => deps.run.execute(claimed));
        } catch (e) {
          if (e instanceof PlanRequiredError || e instanceof UsageBlockedError) {
            refusedUntil.set(job.id, at + REFUSED_RETRY_MS);
            continue;
          }
          // Job успел взять диспетчер (или его уже нет) — просто пропускаем.
          if (e instanceof MonitoringAnalysisJobAlreadyClaimedError || e instanceof MonitoringAnalysisJobNotFoundError) {
            continue;
          }
          // Прочий сбой (БД): уже забранные job'ы не теряем, остальные — на следующем тике.
          // Если не забрали ни одного, ошибку залогирует раннер.
          if (tasks.length > 0) break;
          throw e;
        }
      }
      return tasks;
    },
  };
}
