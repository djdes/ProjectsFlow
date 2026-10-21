import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireDispatcherAccess } from '../project/projectAccess.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskCommitRepository } from '../task/TaskCommitRepository.js';
import type { TelegramClient } from './TelegramClient.js';
import type { TelegramTaskOriginRepository, TelegramTaskOrigin } from './TelegramTaskOriginRepository.js';
import { escapeTelegramHtml } from './telegramMarkdown.js';
import type { UserRepository } from '../user/UserRepository.js';
import { telegramPersonMention } from './telegramMention.js';

type Deps = {
  readonly origins: TelegramTaskOriginRepository;
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
    const origin = await this.deps.origins.getByTask(taskId);
    if (!origin) return;
    const task = await this.deps.tasks.getById(taskId);
    // Moving a task to another project must not expose its new contents to the old group.
    if (!task || task.deletedAt || task.projectId !== origin.projectId) return;
    await requireDispatcherAccess(this.deps, task.projectId, actorUserId);
    if (task.status !== 'done' && task.status !== 'pending_approval') return;
    await this.deps.origins.requestResult(taskId, this.deps.now());
    this.wake();
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
      await this.deps.origins.recoverCompleted?.(this.deps.now());
      const due = await this.deps.origins.listDue(this.deps.now(), 20);
      for (const origin of due) await this.deliver(origin);
    } finally {
      this.running = false;
    }
  }

  private async deliver(origin: TelegramTaskOrigin): Promise<void> {
    const now = this.deps.now();
    const token = this.deps.idGen();
    if (!(await this.deps.origins.claim(origin.taskId, token, now, new Date(now.getTime() + CLAIM_MS)))) return;
    try {
      const task = await this.deps.tasks.getById(origin.taskId);
      if (!task || task.deletedAt || task.projectId !== origin.projectId) {
        await this.deps.origins.finish(origin.taskId, token, now);
        return;
      }
      if (task.status !== 'done' && task.status !== 'pending_approval') {
        await this.deps.origins.retry(origin.taskId, token, new Date(now.getTime() + RETRY_MS));
        return;
      }
      const commits = await this.deps.commits.listByTask(task.id);
      const commit = [...commits].sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime())[0];
      // Auto-linking can lag behind completion. Give it time before reporting no commit.
      if (!commit && now.getTime() - (origin.requestedAt?.getTime() ?? now.getTime()) < COMMIT_WAIT_MS) {
        await this.deps.origins.retry(origin.taskId, token, new Date(now.getTime() + RETRY_MS));
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
        await this.deps.origins.finish(origin.taskId, token, now);
        if (result.kind === 'ok') console.info('[telegram-worker-result] sent', task.id, result.messageId);
        else console.warn('[telegram-worker-result] forbidden', task.id);
      } else {
        const delay = result.kind === 'rate_limited' ? Math.max(result.retryAfter * 1000, RETRY_MS) : RETRY_MS;
        await this.deps.origins.retry(origin.taskId, token, new Date(now.getTime() + delay));
      }
    } catch (error) {
      await this.deps.origins.retry(origin.taskId, token, new Date(now.getTime() + RETRY_MS));
      console.warn('[telegram-worker-result] retry', origin.taskId, error);
    }
  }
}
