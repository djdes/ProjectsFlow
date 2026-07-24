import type { CommitSyncJob } from '../../domain/commit-sync/CommitSyncJob.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import { parseCommitReviewResult, type CommitReviewResult } from './CommitReviewResult.js';
import type { SendWorkspaceCommitReview } from './SendWorkspaceCommitReview.js';

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
  readonly sendReview: SendWorkspaceCommitReview;
  // Подменяемое «сейчас» для детерминированной даты в заголовке (тесты).
  readonly now?: () => Date;
};

// Сборка и отправка ОДНОГО объединённого сообщения сверки коммитов по паттерну «последний гасит
// свет». Каждый завершившийся job зовёт flushForJob:
//  - job с batch_key (плановый прогон): пытаемся атомарно выбрать сборщика на весь батч. Успех
//    только если ВСЕ job'ы батча уже терминальны и сообщение ещё не слали → агрегируем результаты
//    всех проектов и шлём одно сообщение. Иначе (есть незавершённые / уже слали) — молчок.
//  - job без batch_key (ручная «Сверить сейчас»): шлём сразу как батч из одного проекта, не ждём.
// Safety flush: sweep() догоняет батчи, чьи «зависшие» job'ы добил CommitSyncJobCleanup.cancelStale
// (перевёл в терминальный cancelled) — иначе батч молчал бы вечно из-за одного упавшего job'а.
export class FlushCommitSyncBatch {
  constructor(private readonly deps: Deps) {}

  async flushForJob(job: CommitSyncJob): Promise<void> {
    if (job.batchKey) {
      await this.flushBatch(job.batchKey);
    } else {
      await this.flushSingle(job.id);
    }
  }

  async flushBatch(batchKey: string): Promise<void> {
    // Атомарно гасим весь батч (SET batch_flushed_at на все строки при отсутствии незавершённых
    // job'ов и NULL-флаге). Ровно один вызов получит true — он и есть сборщик.
    const claimed = await this.deps.commitSyncJobs.tryMarkBatchFlushed(batchKey);
    if (!claimed) return;
    const jobs = await this.deps.commitSyncJobs.listByBatchKey(batchKey);
    await this.send(jobs);
  }

  async flushSingle(jobId: string): Promise<void> {
    const claimed = await this.deps.commitSyncJobs.tryMarkJobFlushed(jobId);
    if (!claimed) return;
    const job = await this.deps.commitSyncJobs.findById(jobId);
    if (!job) return;
    await this.send([job]);
  }

  // Safety flush: батчи, где не осталось незавершённых job'ов, но сообщение ещё не слали.
  async sweep(): Promise<number> {
    const keys = await this.deps.commitSyncJobs.findFlushableBatchKeys();
    for (const key of keys) {
      await this.flushBatch(key).catch((error) =>
        console.warn('[commit-sync-digest] batch sweep failed', key, error),
      );
    }
    return keys.length;
  }

  // Агрегируем per-job payload'ы в один дайджест. Чистые проекты (review_json = null) отсеиваются;
  // если чист весь батч — не шлём ничего. Проекты сортируем по названию для стабильного порядка.
  private async send(jobs: readonly CommitSyncJob[]): Promise<void> {
    const results: CommitReviewResult[] = [];
    for (const job of jobs) {
      const parsed = parseCommitReviewResult(job.reviewJson);
      if (parsed) results.push(parsed);
    }
    if (results.length === 0) return;
    results.sort((a, b) => a.projectName.localeCompare(b.projectName, 'ru'));
    // Все проекты батча идут в одну группу (chatId зашит в batch_key). Защитно берём чат первого
    // проекта и включаем только совпадающие по чату — на случай, если две подписки делят группу.
    const chatId = results[0]!.chatId;
    const sameChat = results.filter((result) => result.chatId === chatId);
    await this.deps.sendReview.execute({
      chatId,
      results: sameChat,
      now: this.deps.now?.() ?? new Date(),
    });
  }
}
