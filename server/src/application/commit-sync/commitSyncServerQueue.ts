import {
  CommitSyncJobAlreadyClaimedError,
  CommitSyncJobNotFoundError,
} from '../../domain/commit-sync/errors.js';
import { PlanRequiredError, UsageBlockedError } from '../../domain/usage/errors.js';
import type { ServerQueueAdapter } from '../llm/ServerQueueRunner.js';
import type { ClaimCommitSyncJob } from './ClaimCommitSyncJob.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import type { RunCommitSyncJobWithLlm } from './RunCommitSyncJobWithLlm.js';

// Сколько ожидающих job'ов просматриваем за опрос — больше, чем свободных слотов: job'ы, которые
// гейт тарифа не пускает, остаются в очереди (как у диспетчера) и не должны загораживать остальные.
const SCAN_LIMIT = 50;
// Отказ гейта (free-тариф / исчерпано окно) меняется редко, а раннер опрашивает очередь каждые
// полторы секунды — плательщика с отказом перепроверяем не чаще раза в минуту.
const GATE_RETRY_MS = 60_000;

type Deps = {
  readonly commitSyncJobs: Pick<CommitSyncJobRepository, 'listQueued'>;
  readonly claim: Pick<ClaimCommitSyncJob, 'execute'>;
  readonly run: Pick<RunCommitSyncJobWithLlm, 'execute'>;
  readonly now?: () => number;
};

// Очередь commit_sync для ServerQueueRunner: job'ы всех диспетчеров забираются тем же
// ClaimCommitSyncJob, что и у agent-роута, — от имени диспетчера job'а, с гейтом тарифа
// плательщика и атомарным claim'ом (если job успел взять диспетчер, просто пропускаем).
export function commitSyncServerQueue(deps: Deps): ServerQueueAdapter {
  const gateRefusedUntil = new Map<string, number>();
  const now = (): number => (deps.now ? deps.now() : Date.now());

  return {
    queue: 'commit_sync',
    async claim(limit) {
      const tasks: Array<() => Promise<void>> = [];
      if (limit <= 0) return tasks;
      const at = now();
      for (const [userId, until] of gateRefusedUntil) if (until <= at) gateRefusedUntil.delete(userId);

      const queued = await deps.commitSyncJobs.listQueued(SCAN_LIMIT);
      for (const job of queued) {
        if (tasks.length >= limit) break;
        // Плательщик — как в гейте ClaimCommitSyncJob.
        const billedUserId = job.createdBy ?? job.dispatcherUserId;
        if (gateRefusedUntil.has(billedUserId)) continue;
        try {
          const claimed = await deps.claim.execute({ userId: job.dispatcherUserId, jobId: job.id });
          tasks.push(() => deps.run.execute(claimed));
        } catch (e) {
          if (e instanceof PlanRequiredError || e instanceof UsageBlockedError) {
            gateRefusedUntil.set(billedUserId, at + GATE_RETRY_MS);
            continue;
          }
          // Гонка с диспетчером или очисткой — job уже не наш.
          if (e instanceof CommitSyncJobAlreadyClaimedError || e instanceof CommitSyncJobNotFoundError) {
            continue;
          }
          // Прочий сбой (БД): уже забранные job'ы не теряем — отдаём их исполнителям.
          if (tasks.length > 0) break;
          throw e;
        }
      }
      return tasks;
    },
  };
}
