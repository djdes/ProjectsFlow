import type { CommitSyncJob, CommitSyncMatch } from '../../domain/commit-sync/CommitSyncJob.js';
import {
  CommitSyncJobNotFoundError,
  CommitSyncJobNotInRunningStateError,
  NotDispatcherForCommitSyncJobError,
} from '../../domain/commit-sync/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { LinkCommit } from '../task/LinkCommit.js';
import type { CommitSyncJobRepository } from './CommitSyncJobRepository.js';
import type { RecordUsage } from '../usage/RecordUsage.js';

const MAX_ERROR = 500;
const MAX_MATCHES = 500;

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
  readonly tasks: TaskRepository;
  // Опционально: привязать совпавший коммит к карточке (видимая ссылка). Сбой не валит move.
  readonly linkCommit?: LinkCommit;
  // Метеринг расхода ИИ (best-effort) — списываем с подписки диспетчера.
  readonly recordUsage?: RecordUsage;
};

export type CompleteCommitSyncJobInput = {
  readonly userId: string;
  readonly jobId: string;
  readonly ok: boolean;
  readonly matches: ReadonlyArray<CommitSyncMatch> | null;
  readonly error: string | null;
  readonly costUsd?: number | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
};

// Завершение commit-sync job'а. ИИ вернул только совпадения коммит↔задача; ПОРОГ и
// перемещения применяет СЕРВЕР детерминированно по сохранённому committedAt (commits_json) —
// не доверяя таймстемпам от модели. Правило:
//   ageHours < threshold && задача todo      → in_progress
//   ageHours >= threshold                    → done
//   ageHours < threshold && уже in_progress  → no-op
// Идемпотентно: двигаем только задачи, всё ещё в todo/in_progress.
export class CompleteCommitSyncJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: CompleteCommitSyncJobInput): Promise<void> {
    const job = await this.deps.commitSyncJobs.findById(input.jobId);
    if (!job) throw new CommitSyncJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForCommitSyncJobError(input.jobId);
    }
    if (job.status !== 'running') {
      throw new CommitSyncJobNotInRunningStateError(input.jobId, job.status);
    }

    if (!input.ok) {
      const err = (input.error ?? '').trim();
      if (err.length === 0) throw new Error('ok=false requires non-empty error');
      await this.deps.commitSyncJobs.complete({
        id: input.jobId,
        status: 'failed',
        matchesJson: null,
        resultSummary: null,
        error: err.slice(0, MAX_ERROR),
        costUsd: input.costUsd ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
      });
      this.meterUsage(job, input);
      return;
    }

    const matches = (input.matches ?? []).slice(0, MAX_MATCHES);
    const commitTimes = parseCommitsJson(job.commitsJson);
    const now = new Date();
    const threshold = job.thresholdHours;

    let toInProgress = 0;
    let toDone = 0;
    let skipped = 0;
    // На одну задачу применяем максимум один переход за прогон (первое валидное совпадение).
    const handledTasks = new Set<string>();

    for (const m of matches) {
      if (handledTasks.has(m.taskId)) continue;

      const committedAtIso = commitTimes.get(m.commitSha);
      if (!committedAtIso) {
        skipped++;
        continue;
      }
      const ageHours = (now.getTime() - new Date(committedAtIso).getTime()) / 3_600_000;

      const task = await this.deps.tasks.getById(m.taskId);
      if (!task || task.projectId !== job.projectId) {
        skipped++;
        continue;
      }
      if (task.status !== 'todo' && task.status !== 'in_progress') {
        skipped++;
        continue;
      }

      let moved = false;
      if (ageHours >= threshold) {
        // Старый коммит → готово. Снимок status_before_done как в MoveTask.
        await this.deps.tasks.update(task.id, { status: 'done', statusBeforeDone: task.status });
        toDone++;
        moved = true;
      } else if (task.status === 'todo') {
        // Свежий коммит, задача в черновике → в работу.
        await this.deps.tasks.update(task.id, { status: 'in_progress' });
        toInProgress++;
        moved = true;
      }

      if (moved) {
        handledTasks.add(task.id);
        await this.tryLinkCommit(job.projectId, job.dispatcherUserId, task, m.commitSha);
      }
    }

    const resultSummary =
      `Совпадений: ${matches.length}. Перемещено: в работу — ${toInProgress}, ` +
      `в готово — ${toDone}. Пропущено — ${skipped}.`;

    await this.deps.commitSyncJobs.complete({
      id: input.jobId,
      status: 'succeeded',
      matchesJson: JSON.stringify(matches),
      resultSummary,
      error: null,
      costUsd: input.costUsd ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
    });
    this.meterUsage(job, input);
  }

  // Метеринг: списываем с подписки диспетчера (best-effort, идемпотентно по source+ref).
  private meterUsage(job: CommitSyncJob, input: CompleteCommitSyncJobInput): void {
    void this.deps.recordUsage
      ?.execute({
        source: 'commit_sync',
        refId: input.jobId,
        // Списываем на инициатора (владельца проекта), не на диспетчера-админа.
        dispatcherUserId: job.createdBy ?? job.dispatcherUserId,
        projectId: job.projectId,
        model: null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        costUsd: input.costUsd ?? null,
      })
      .catch(() => {});
  }

  private async tryLinkCommit(
    projectId: string,
    dispatcherUserId: string,
    task: Task,
    sha: string,
  ): Promise<void> {
    if (!this.deps.linkCommit) return;
    try {
      await this.deps.linkCommit.execute({
        projectId,
        ownerUserId: dispatcherUserId,
        taskId: task.id,
        sha,
      });
    } catch {
      // Сбой привязки коммита не должен валить уже выполненный move — best-effort.
    }
  }
}

function parseCommitsJson(json: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!json) return map;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    for (const [sha, iso] of Object.entries(obj)) {
      if (typeof iso === 'string') map.set(sha, iso);
    }
  } catch {
    // Битый снапшот — вернём пустую карту, complete пропустит все совпадения (skipped).
  }
  return map;
}
