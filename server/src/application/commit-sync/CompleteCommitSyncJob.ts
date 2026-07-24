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
import type { PrepareCommitReviewResult } from './PrepareCommitReviewResult.js';
import { serializeCommitReviewResult } from './CommitReviewResult.js';
import type { FlushCommitSyncBatch } from './FlushCommitSyncBatch.js';
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
  // Готовит per-job payload сводки (проект + строки задач + токены). Пишется в review_json.
  readonly prepareReview?: PrepareCommitReviewResult;
  // Батчинг сводок (db/143): после завершения job'а пытаемся собрать/отправить сообщение батча.
  readonly flush?: FlushCommitSyncBatch;
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

// Завершение commit-sync job'а. ИИ вернул только совпадения коммит↔задача (коммит, который
// РЕАЛИЗУЕТ задачу — см. промпт в prepareCommitSyncContext). Перемещения применяет СЕРВЕР.
//
// Правило (action='auto'): совпадение → задача сразу в done, НЕЗАВИСИМО от возраста коммита.
// Раньше здесь был возрастной порог (свежий коммит → in_progress, старый → done). Он мешал
// реальному циклу: за день закрывается много задач, часть за час — и все они «зависали» в
// работе вместо готово. Раз промпт отбирает только коммиты, которые задачу ЗАКРЫВАЮТ, отдельная
// ступень in_progress не нужна: реализовано — значит готово.
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
        reviewJson: null,
        resultSummary: null,
        error: err.slice(0, MAX_ERROR),
        costUsd: input.costUsd ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
      });
      this.meterUsage(job, input);
      // Failed-job тоже терминален — даём батчу шанс схлопнуться (может быть последним).
      await this.triggerFlush(job);
      return;
    }

    const rawMatches = (input.matches ?? []).slice(0, MAX_MATCHES);
    // Старые MCP-клиенты могли слать служебные записи обзора (__commit_review*). Обзор коммитов на
    // значимость убран — сверка теперь только сопоставляет черновики с коммитами, поэтому такие
    // записи просто отбрасываем.
    const matches = rawMatches.filter((match) => !match.taskId.startsWith('__commit_review'));

    // Ветка propose (db/101): НЕ двигаем задачи, а создаём предложения закрыть (human-in-the-loop).
    // Подтвердить сможет любой участник (TG-кнопка / in-app).
    if (job.action === 'propose') {
      await this.runProposeBranch(job, input, matches);
      return;
    }

    const commitSnapshot = parseCommitsJson(job.commitsJson);

    let skipped = 0;
    // На одну задачу применяем максимум один переход за прогон (первое валидное совпадение).
    const handledTasks = new Set<string>();
    // Реально закрытые задачи — для короткой сводки «что закрыто» в Telegram.
    const moved: CommitSyncMatch[] = [];

    for (const m of matches) {
      if (handledTasks.has(m.taskId)) continue;

      // Коммит должен быть в снапшоте прогона — защита от галлюцинированного sha.
      if (!commitSnapshot[m.commitSha]) {
        skipped++;
        continue;
      }

      const task = await this.deps.tasks.getById(m.taskId);
      if (!task || task.projectId !== job.projectId) {
        skipped++;
        continue;
      }
      // Двигаем только черновики (первая колонка). Если задача уже уехала в другую колонку между
      // постановкой прогона и завершением — значит с ней уже работают руками, не трогаем.
      if (task.status !== 'backlog') {
        skipped++;
        continue;
      }

      // Совпадение = коммит РЕАЛИЗУЕТ черновик (см. промпт) → сразу в готово.
      // status_before_done — снимок текущей колонки, как в MoveTask (для «вернуть из готово»).
      await this.deps.tasks.update(
        task.id,
        { status: 'done', statusBeforeDone: task.status },
        job.dispatcherUserId,
      );
      handledTasks.add(task.id);
      moved.push(m);
      await this.tryLinkCommit(job.projectId, job.dispatcherUserId, task, m.commitSha);
    }

    const resultSummary =
      `Совпадений: ${matches.length}. Перемещено в готово — ${moved.length}. Пропущено — ${skipped}.`;

    // Сводка (auto): показываем именно реально закрытые задачи (moved), не все совпадения.
    const reviewJson = await this.buildReviewJson(job, 'auto', moved);
    await this.deps.commitSyncJobs.complete({
      id: input.jobId,
      status: 'succeeded',
      matchesJson: JSON.stringify(matches),
      reviewJson,
      resultSummary,
      error: null,
      costUsd: input.costUsd ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
    });
    this.meterUsage(job, input);
    await this.triggerFlush(job);
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
    // Сводка (propose): показываем задачи, которые предложено закрыть (все совпадения).
    const reviewJson = await this.buildReviewJson(job, 'propose', matches);
    await this.deps.commitSyncJobs.complete({
      id: input.jobId,
      status: 'succeeded',
      matchesJson: JSON.stringify(matches),
      reviewJson,
      resultSummary: `Совпадений: ${matches.length}. Предложено закрыть: ${created}.`,
      error: null,
      costUsd: input.costUsd ?? null,
      tokensIn: input.tokensIn ?? null,
      tokensOut: input.tokensOut ?? null,
    });
    this.meterUsage(job, input);
    await this.triggerFlush(job);
  }

  // Готовит per-job payload сводки (проект + строки задач + токены «закрыть») и сериализует его
  // в review_json. Применяет доставочный гейт пространства: чистый/не-для-группы проект → null,
  // тогда в объединённый дайджест он не попадёт. Best-effort — сбой не валит complete.
  private async buildReviewJson(
    job: CommitSyncJob,
    mode: 'auto' | 'propose',
    matches: readonly CommitSyncMatch[],
  ): Promise<string | null> {
    if (!this.deps.prepareReview || matches.length === 0) return null;
    const result = await this.deps.prepareReview
      .execute({ projectId: job.projectId, dispatcherUserId: job.dispatcherUserId, mode, matches })
      .catch((error) => {
        console.warn('[commit-sync] prepare review failed', job.id, error);
        return null;
      });
    return result ? serializeCommitReviewResult(result) : null;
  }

  // Паттерн «последний гасит свет»: после завершения любого job'а даём батчу схлопнуться в одно
  // сообщение (или, для ручного прогона без batch_key, отправиться сразу). Best-effort.
  private async triggerFlush(job: CommitSyncJob): Promise<void> {
    if (!this.deps.flush) return;
    await this.deps.flush
      .flushForJob(job)
      .catch((error) => console.warn('[commit-sync] batch flush failed', job.id, error));
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
