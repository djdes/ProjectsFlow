import {
  COMMIT_SYNC_PLAN_REQUIRED,
  COMMIT_SYNC_USAGE_BLOCKED,
} from '../../domain/commit-sync/CommitSyncJob.js';
import {
  CommitSyncJobAlreadyClaimedError,
  CommitSyncJobNotFoundError,
} from '../../domain/commit-sync/errors.js';
import { PlanRequiredError, UsageBlockedError } from '../../domain/usage/errors.js';
import type { ServerQueueAdapter } from '../llm/ServerQueueRunner.js';
import type { ClaimCommitSyncJob } from './ClaimCommitSyncJob.js';
import type { CommitSyncJobRepository, QueuedCommitSyncJob } from './CommitSyncJobRepository.js';
import type { CompleteCommitSyncJob } from './CompleteCommitSyncJob.js';
import type { RunCommitSyncJobWithLlm } from './RunCommitSyncJobWithLlm.js';

// Сколько ожидающих job'ов просматриваем за опрос.
const SCAN_LIMIT = 50;

type Deps = {
  readonly commitSyncJobs: Pick<CommitSyncJobRepository, 'listQueued' | 'claimById'>;
  readonly claim: Pick<ClaimCommitSyncJob, 'execute'>;
  readonly run: Pick<RunCommitSyncJobWithLlm, 'execute'>;
  // Отказ гейта тарифа завершаем тем же путём, что и сбой модели: батч досылается, прогресс
  // перерисовывается.
  readonly complete: Pick<CompleteCommitSyncJob, 'execute'>;
};

// Очередь commit_sync для ServerQueueRunner: job'ы всех диспетчеров забираются тем же
// ClaimCommitSyncJob, что и у agent-роута, — от имени диспетчера job'а, с гейтом тарифа
// плательщика и атомарным claim'ом (если job успел взять диспетчер, просто пропускаем).
export function commitSyncServerQueue(deps: Deps): ServerQueueAdapter {
  // Исполнитель забранного job'а; null — job уже не наш.
  async function claimOrRefuse(job: QueuedCommitSyncJob): Promise<(() => Promise<void>) | null> {
    try {
      const claimed = await deps.claim.execute({ userId: job.dispatcherUserId, jobId: job.id });
      return () => deps.run.execute(claimed);
    } catch (e) {
      if (!(e instanceof PlanRequiredError || e instanceof UsageBlockedError)) throw e;
      // Раньше такой job оставался в очереди до отмены по застою (12 минут ⏳), а в группу
      // уходило «диспетчер не ответил вовремя» — хотя причина в тарифе плательщика. К сроку
      // сверки отказ сам не пройдёт: завершаем job сразу, с причиной для итога в группе.
      const refused = await deps.commitSyncJobs.claimById(job.id);
      if (!refused) return null;
      const error = e instanceof PlanRequiredError ? COMMIT_SYNC_PLAN_REQUIRED : COMMIT_SYNC_USAGE_BLOCKED;
      return () =>
        deps.complete.execute({ userId: job.dispatcherUserId, jobId: job.id, ok: false, matches: null, error });
    }
  }

  return {
    queue: 'commit_sync',
    async claim(limit) {
      const tasks: Array<() => Promise<void>> = [];
      if (limit <= 0) return tasks;

      const queued = await deps.commitSyncJobs.listQueued(SCAN_LIMIT);
      for (const job of queued) {
        if (tasks.length >= limit) break;
        let task: (() => Promise<void>) | null;
        try {
          task = await claimOrRefuse(job);
        } catch (e) {
          // Гонка с диспетчером или очисткой — job уже не наш.
          if (e instanceof CommitSyncJobAlreadyClaimedError || e instanceof CommitSyncJobNotFoundError) {
            continue;
          }
          // Прочий сбой (БД): уже забранные job'ы не теряем — отдаём их исполнителям.
          if (tasks.length > 0) break;
          throw e;
        }
        if (task) tasks.push(task);
      }
      return tasks;
    },
  };
}
