import type {
  CommitSyncJob,
  CommitSyncMatch,
  CommitSyncReview,
} from '../../domain/commit-sync/CommitSyncJob.js';
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
import type { CreateCloseProposals } from '../close-proposal/CreateCloseProposals.js';
import type { SendWorkspaceCommitReview } from './SendWorkspaceCommitReview.js';
import type {
  CommitSyncSnapshot,
  CommitSyncSnapshotEntry,
} from './prepareCommitSyncContext.js';

const MAX_ERROR = 500;
const MAX_MATCHES = 500;

type Deps = {
  readonly commitSyncJobs: CommitSyncJobRepository;
  readonly tasks: TaskRepository;
  // Опционально: привязать совпавший коммит к карточке (видимая ссылка). Сбой не валит move.
  readonly linkCommit?: LinkCommit;
  // Метеринг расхода ИИ (best-effort) — списываем с подписки диспетчера.
  readonly recordUsage?: RecordUsage;
  // Ветка action='propose' (db/101): вместо авто-перемещения создаём предложения закрыть.
  // Если не задан — propose-прогон завершается без предложений (только сводка).
  readonly createProposals?: CreateCloseProposals;
  // Consolidated 17:00 Telegram message: meaningful commit review + task action icons.
  readonly sendReview?: SendWorkspaceCommitReview;
};

export type CompleteCommitSyncJobInput = {
  readonly userId: string;
  readonly jobId: string;
  readonly ok: boolean;
  readonly matches: ReadonlyArray<CommitSyncMatch> | null;
  readonly reviews?: ReadonlyArray<CommitSyncReview> | null;
  readonly overallSummary?: string | null;
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

    const rawMatches = (input.matches ?? []).slice(0, MAX_MATCHES);
    const embeddedReview = extractEmbeddedReview(rawMatches);
    const matches = rawMatches.filter((match) => !match.taskId.startsWith('__commit_review'));
    const effectiveInput: CompleteCommitSyncJobInput = {
      ...input,
      matches,
      reviews: input.reviews ?? embeddedReview.reviews,
      overallSummary: input.overallSummary ?? embeddedReview.overallSummary,
    };

    // Ветка propose (db/101): НЕ двигаем задачи, а создаём предложения закрыть (human-in-the-loop).
    // Подтвердить сможет любой участник (TG-кнопка / in-app).
    if (job.action === 'propose') {
      await this.runProposeBranch(job, effectiveInput, matches);
      return;
    }

    const commitSnapshot = parseCommitsJson(job.commitsJson);
    const now = new Date();
    const threshold = job.thresholdHours;

    let toInProgress = 0;
    let toDone = 0;
    let skipped = 0;
    // На одну задачу применяем максимум один переход за прогон (первое валидное совпадение).
    const handledTasks = new Set<string>();

    for (const m of matches) {
      if (handledTasks.has(m.taskId)) continue;

      const commit = commitSnapshot[m.commitSha];
      if (!commit) {
        skipped++;
        continue;
      }
      const ageHours = (now.getTime() - new Date(commit.committedAt).getTime()) / 3_600_000;

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
        await this.deps.tasks.update(
          task.id,
          { status: 'done', statusBeforeDone: task.status },
          job.dispatcherUserId,
        );
        toDone++;
        moved = true;
      } else if (task.status === 'todo') {
        // Свежий коммит, задача в черновике → в работу.
        await this.deps.tasks.update(task.id, { status: 'in_progress' }, job.dispatcherUserId);
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
    await this.sendReview(job, effectiveInput, matches, commitSnapshot);
  }

  // Ветка propose (db/101): создаём предложения закрыть по совпадениям (через
  // CreateCloseProposals — там комментарий + TG-личка с кнопками + in-app), job → succeeded
  // со сводкой. Best-effort: сбой создания предложений не валит complete.
  private async runProposeBranch(
    job: CommitSyncJob,
    input: CompleteCommitSyncJobInput,
    matches: ReadonlyArray<CommitSyncMatch>,
  ): Promise<void> {
    let created = 0;
    if (this.deps.createProposals && matches.length > 0) {
      try {
        const r = await this.deps.createProposals.execute({
          projectId: job.projectId,
          dispatcherUserId: job.dispatcherUserId,
          sourceJobId: job.id,
          suppressGroupTelegram: true,
          matches: matches.map((m) => ({
            taskId: m.taskId,
            commitSha: m.commitSha,
            reason: m.reason,
          })),
        });
        created = r.created;
      } catch (e) {
        console.warn('[commit-sync] propose branch failed', job.id, e);
      }
    }
    await this.deps.commitSyncJobs.complete({
      id: input.jobId,
      status: 'succeeded',
      matchesJson: JSON.stringify(matches),
      resultSummary: `Совпадений: ${matches.length}. Предложено закрыть: ${created}.`,
      error: null,
      costUsd: input.costUsd ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
    });
    this.meterUsage(job, input);
    await this.sendReview(job, input, matches, parseCommitsJson(job.commitsJson));
  }

  private async sendReview(
    job: CommitSyncJob,
    input: CompleteCommitSyncJobInput,
    matches: readonly CommitSyncMatch[],
    commits: CommitSyncSnapshot,
  ): Promise<void> {
    if (!this.deps.sendReview) return;
    await this.deps.sendReview
      .execute({
        projectId: job.projectId,
        dispatcherUserId: job.dispatcherUserId,
        commits,
        matches,
        reviews: (input.reviews ?? []).slice(0, 50),
        overallSummary: input.overallSummary ?? null,
      })
      .catch((error) => console.warn('[commit-sync] Telegram review failed', job.id, error));
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

export function parseCommitsJson(json: string | null): CommitSyncSnapshot {
  const snapshot: Record<string, CommitSyncSnapshotEntry> = {};
  if (!json) return snapshot;
  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    for (const [sha, value] of Object.entries(obj)) {
      // Backwards compatibility with jobs queued before the richer snapshot was deployed.
      if (typeof value === 'string') {
        snapshot[sha] = {
          committedAt: value,
          message: '',
          htmlUrl: '',
          authorName: 'GitHub',
          authorLogin: null,
        };
        continue;
      }
      if (!value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry['committedAt'] !== 'string') continue;
      snapshot[sha] = {
        committedAt: entry['committedAt'],
        message: typeof entry['message'] === 'string' ? entry['message'] : '',
        htmlUrl: typeof entry['htmlUrl'] === 'string' ? entry['htmlUrl'] : '',
        authorName: typeof entry['authorName'] === 'string' ? entry['authorName'] : 'GitHub',
        authorLogin: typeof entry['authorLogin'] === 'string' ? entry['authorLogin'] : null,
      };
    }
  } catch {
    // Битый снапшот — вернём пустую карту, complete пропустит все совпадения (skipped).
  }
  return snapshot;
}

// Compatibility with already published MCP clients that only know the historic
// `matches` field. The context asks them to return review records as sentinel
// matches; newer clients may send first-class reviews/overallSummary instead.
export function extractEmbeddedReview(matches: readonly CommitSyncMatch[]): {
  readonly reviews: CommitSyncReview[];
  readonly overallSummary: string | null;
} {
  const reviews: CommitSyncReview[] = [];
  let overallSummary: string | null = null;
  for (const match of matches) {
    if (match.taskId === '__commit_review_summary__') {
      overallSummary = match.reason?.trim() || null;
      continue;
    }
    const verdict = match.taskId.match(/^__commit_review__:(good|attention)$/)?.[1] as
      | CommitSyncReview['verdict']
      | undefined;
    const summary = match.reason?.trim();
    if (!verdict || !summary) continue;
    reviews.push({ commitSha: match.commitSha, verdict, summary });
  }
  return { reviews, overallSummary };
}
