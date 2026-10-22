import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireDispatcherAccess } from '../project/projectAccess.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskCommitRepository } from '../task/TaskCommitRepository.js';
import type { TelegramClient } from './TelegramClient.js';
import type { TelegramTaskOriginRepository } from './TelegramTaskOriginRepository.js';
import type { Task } from '../../domain/task/Task.js';
import type { TelegramWorkerResultOutbox, WorkerResultDelivery, WorkerResultDestination } from './TelegramWorkerResultOutbox.js';
import { escapeTelegramHtml } from './telegramMarkdown.js';
import type { UserRepository } from '../user/UserRepository.js';
import { telegramPersonMention } from './telegramMention.js';

type Deps = {
  readonly origins: Pick<TelegramTaskOriginRepository, 'getByTask'>;
  readonly outbox: TelegramWorkerResultOutbox;
  readonly destinations?: { resolve(task: Task): Promise<WorkerResultDestination | null> };
  readonly tasks: Pick<TaskRepository, 'getById'>;
  readonly commits: Pick<TaskCommitRepository, 'listByTask'>;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly client: Pick<TelegramClient, 'sendMessage'>;
  readonly users?: Pick<UserRepository, 'getTelegramLink'>;
  readonly now: () => Date;
  readonly idGen: () => string;
};

const RETRY_MS = 60_000;
const CLAIM_MS = 5 * 60_000;
const COMMIT_WAIT_MS = 5 * 60_000;
const compact = (text: string, max: number): string =>
  text.replace(/\s+/g, ' ').replace(/[*_`#]/g, '').trim().slice(0, max);

export class ReportTelegramWorkerResult {
  private running = false;

  constructor(private readonly deps: Deps) {}

  async request(taskId: string, actorUserId: string): Promise<void> {
    const task = await this.deps.tasks.getById(taskId);
    // Moving a task to another project must not expose its new contents to the old group.
    if (!task || task.deletedAt) return;
    const destination = await this.destination(task);
    if (!destination) return;
    await requireDispatcherAccess(this.deps, task.projectId, actorUserId);
    if (task.status !== 'done' && task.status !== 'pending_approval') return;
    await this.enqueue(task, destination);
    this.wake();
  }

  private async destination(task: Task): Promise<WorkerResultDestination | null> {
    if (this.deps.destinations) return this.deps.destinations.resolve(task);
    const origin = await this.deps.origins.getByTask(task.id);
    return origin?.projectId === task.projectId ? { ...origin, source: 'origin' } : null;
  }

  private async enqueue(task: Task, destination: WorkerResultDestination): Promise<void> {
    const completion = await this.deps.outbox.findCompletion(task.id, task.projectId);
    if (!completion) return;
    const origin = await this.deps.origins.getByTask(task.id);
    if (origin?.reportedAt && completion.startedAt <= origin.reportedAt) return;
    await this.deps.outbox.enqueue({ ...destination, id: this.deps.idGen(), completionKey: completion.key, requestedAt: this.deps.now() });
  }

  // Recover queued/failed deliveries on startup and between requests.
  readonly wake = (): void => {
    void this.deliverPending().catch((error: unknown) =>
      console.warn('[telegram-worker-result] delivery failed', error),
    );
  };

  async deliverPending(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const taskId of await this.deps.outbox.listRecoverable(this.deps.now(), 500)) {
        const task = await this.deps.tasks.getById(taskId);
        if (!task || task.deletedAt || !['done', 'pending_approval'].includes(task.status)) continue;
        const destination = await this.destination(task);
        if (destination) await this.enqueue(task, destination);
      }
      const due = await this.deps.outbox.listDue(this.deps.now(), 20);
      for (const origin of due) await this.deliver(origin);
    } finally {
      this.running = false;
    }
  }

  private async deliver(origin: WorkerResultDelivery): Promise<void> {
    const now = this.deps.now();
    const token = this.deps.idGen();
    if (!(await this.deps.outbox.claim(origin.id, token, now, new Date(now.getTime() + CLAIM_MS)))) return;
    try {
      const task = await this.deps.tasks.getById(origin.taskId);
      if (!task || task.deletedAt || task.projectId !== origin.projectId) {
        await this.deps.outbox.finish(origin.id, token, now);
        return;
      }
      const destination = await this.destination(task);
      if (!destination || destination.source !== origin.source || destination.chatId !== origin.chatId) {
        await this.deps.outbox.finish(origin.id, token, now);
        return;
      }
      if (task.status !== 'done' && task.status !== 'pending_approval') {
        await this.deps.outbox.retry(origin.id, token, new Date(now.getTime() + RETRY_MS));
        return;
      }
      const completion = await this.deps.outbox.findCompletion(task.id, task.projectId);
      if (!completion || completion.key !== origin.completionKey) {
        await this.deps.outbox.finish(origin.id, token, now);
        return;
      }
      const commits = await this.deps.commits.listByTask(task.id);
      const commit = [...commits].sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())[0];
      // Auto-linking can lag behind completion. Give it time before reporting no commit.
      if (!commit && now.getTime() - origin.requestedAt.getTime() < COMMIT_WAIT_MS) {
        await this.deps.outbox.retry(origin.id, token, new Date(now.getTime() + RETRY_MS));
        return;
      }
      const description = task.description ?? 'Задача';
      const title = compact(description.split('\n')[0] ?? description, 140);
      const status = task.status === 'pending_approval' ? 'Воркер закончил — на утверждении' : 'Воркер выполнил';
      // The task title describes the result. Raw git subjects can contain terminal mojibake
      // and technical bookkeeping; the verified commit remains available through its link.
      // No supplied URLs or claims about production: only a commit snapshot verified by LinkCommit.
      const commitLink = commit && /^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/commit\/[a-f0-9]{7,64}$/i.test(commit.htmlUrl)
        ? `🔗 <a href="${escapeTelegramHtml(commit.htmlUrl)}">Коммит ${escapeTelegramHtml(commit.sha.slice(0, 7))}</a>`
        : 'Коммит к задаче не привязан.';
      const assignee = task.assignee;
      const mention = assignee
        ? telegramPersonMention(assignee.displayName, await this.deps.users?.getTelegramLink(assignee.userId) ?? null)
        : '';
      const result = await this.deps.client.sendMessage({
        chatId: origin.chatId,
        replyToMessageId: origin.messageId ?? undefined,
        text: [mention, `✅ <b>${status}:</b> ${escapeTelegramHtml(title)}`, commitLink].filter(Boolean).join('\n'),
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
      if (result.kind === 'ok' || result.kind === 'forbidden') {
        await this.deps.outbox.finish(origin.id, token, now);
        if (result.kind === 'ok') console.info('[telegram-worker-result] sent', task.id, result.messageId);
        else console.warn('[telegram-worker-result] forbidden', task.id);
      } else {
        const delay = result.kind === 'rate_limited' ? Math.max(result.retryAfter * 1000, RETRY_MS) : RETRY_MS;
        await this.deps.outbox.retry(origin.id, token, new Date(now.getTime() + delay));
      }
    } catch (error) {
      await this.deps.outbox.retry(origin.id, token, new Date(now.getTime() + RETRY_MS));
      console.warn('[telegram-worker-result] retry', origin.taskId, error);
    }
  }
}
