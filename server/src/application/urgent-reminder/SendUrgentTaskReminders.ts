import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import type { SendMessageResult, TelegramClient } from '../telegram/TelegramClient.js';
import type { TelegramMessageTaskRepository } from '../telegram/TelegramMessageTaskRepository.js';
import { telegramPersonMention } from '../telegram/telegramMention.js';
import type { UserRepository } from '../user/UserRepository.js';
import { telegramDigestTaskTitle } from '../task/digest/buildTaskDigest.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import {
  PRIORITY_DIGEST_META,
  escapeHtml,
  pluralTasksRu,
  splitDescription,
} from '../../domain/task/digestFormat.js';
import {
  formatUrgentDeadline,
  needsUrgentReminder,
  type UrgentReminderSlot,
} from '../../domain/task/urgentTaskReminder.js';
import type {
  UrgentReminderCandidate,
  UrgentTaskReminderRepository,
} from './UrgentTaskReminderRepository.js';

type Deps = {
  readonly reminders: UrgentTaskReminderRepository;
  readonly settings: Pick<WorkspaceAssigneeDigestRepository, 'get'>;
  readonly users: Pick<UserRepository, 'getTelegramLink'>;
  readonly telegram: Pick<TelegramClient, 'sendMessage'>;
  readonly appUrl: string;
  // Reply to a group reminder becomes a task comment (db/160).
  readonly messageTasks?: Pick<TelegramMessageTaskRepository, 'attach'>;
  // Telegram allows ~20 messages a minute into one group: pause between group messages.
  readonly sleep?: (ms: number) => Promise<void>;
  readonly groupMessageIntervalMs?: number;
};

export type UrgentReminderResult = {
  readonly taskCount: number;
  readonly personalSent: number;
  readonly groupSent: number;
};

const MAX_TASKS_IN_PERSONAL = 30;
const MAX_RATE_LIMIT_WAIT_SEC = 60;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class SendUrgentTaskReminders {
  constructor(private readonly deps: Deps) {}

  async execute(slot: UrgentReminderSlot): Promise<UrgentReminderResult> {
    const candidates = (await this.deps.reminders.listCandidates()).filter(needsUrgentReminder);

    const byWorkspace = new Map<string, UrgentReminderCandidate[]>();
    for (const task of candidates) {
      const bucket = byWorkspace.get(task.workspaceId) ?? [];
      bucket.push(task);
      byWorkspace.set(task.workspaceId, bucket);
    }

    // Claim before sending: a restart or a parallel process never repeats the slot.
    const claimed: Array<{ task: UrgentReminderCandidate; groupChatId: number | null }> = [];
    for (const [workspaceId, tasks] of byWorkspace) {
      const settings = await this.deps.settings.get(workspaceId);
      if (!settings.urgentRemindersEnabled) continue;
      for (const task of sortTasks(tasks)) {
        if (await this.deps.reminders.claim(task.taskId, slot.key)) {
          claimed.push({ task, groupChatId: settings.telegramGroupChatId });
        }
      }
    }
    if (claimed.length === 0) return { taskCount: 0, personalSent: 0, groupSent: 0 };

    const links = new Map<string, TelegramLink | null>();
    const linkOf = async (userId: string): Promise<TelegramLink | null> => {
      if (!links.has(userId)) {
        links.set(userId, await this.deps.users.getTelegramLink(userId).catch(() => null));
      }
      return links.get(userId) ?? null;
    };

    const byAssignee = new Map<string, UrgentReminderCandidate[]>();
    for (const { task } of claimed) {
      const bucket = byAssignee.get(task.assigneeUserId) ?? [];
      bucket.push(task);
      byAssignee.set(task.assigneeUserId, bucket);
    }

    let personalSent = 0;
    for (const [userId, tasks] of byAssignee) {
      const link = await linkOf(userId);
      // Bot can write only to someone who has pressed /start.
      if (!link || link.tgChatId === null || link.tgStartedAt === null) continue;
      const result = await this.send(
        link.tgChatId,
        buildUrgentPersonalMessage({ tasks, slot, appUrl: this.deps.appUrl }),
      );
      if (result?.kind === 'ok') personalSent += 1;
      else console.warn('[urgent-reminders] personal send failed', userId, result);
    }

    let groupSent = 0;
    const sleep = this.deps.sleep ?? defaultSleep;
    const interval = this.deps.groupMessageIntervalMs ?? 3_000;
    let first = true;
    for (const { task, groupChatId } of claimed) {
      if (groupChatId === null || !isTeamVisible(task)) continue;
      if (!first) await sleep(interval);
      first = false;
      const html = buildUrgentGroupMessage({
        task,
        telegramLink: await linkOf(task.assigneeUserId),
        slot,
        appUrl: this.deps.appUrl,
      });
      const result = await this.send(groupChatId, html);
      if (result?.kind !== 'ok') {
        console.warn('[urgent-reminders] group send failed', task.taskId, result);
        continue;
      }
      groupSent += 1;
      await this.deps.messageTasks
        ?.attach({
          chatId: groupChatId,
          messageId: result.messageId,
          tasks: [{ taskId: task.taskId, projectId: task.projectId }],
        })
        .catch((error) => console.warn('[urgent-reminders] remember message task failed', error));
    }

    return { taskCount: claimed.length, personalSent, groupSent };
  }

  private async send(chatId: number, text: string): Promise<SendMessageResult | null> {
    const attempt = () =>
      this.deps.telegram
        .sendMessage({ chatId, text, parseMode: 'HTML', disableWebPagePreview: true })
        .catch(() => null);
    const result = await attempt();
    if (result?.kind !== 'rate_limited') return result;
    await (this.deps.sleep ?? defaultSleep)(
      Math.min(result.retryAfter, MAX_RATE_LIMIT_WAIT_SEC) * 1000 + 500,
    );
    return attempt();
  }
}

// Personal inbox notes are private: only tasks given by someone else go to the team chat
// (same rule as the assignee digest «Делегированные»).
function isTeamVisible(task: UrgentReminderCandidate): boolean {
  if (!task.isInbox) return true;
  return task.createdBy !== null && task.createdBy !== task.assigneeUserId;
}

function sortTasks(tasks: readonly UrgentReminderCandidate[]): UrgentReminderCandidate[] {
  return [...tasks].sort(
    (left, right) =>
      (left.priority ?? 9) - (right.priority ?? 9) ||
      (left.deadline ?? '9999').localeCompare(right.deadline ?? '9999') ||
      left.projectName.localeCompare(right.projectName, 'ru') ||
      left.taskId.localeCompare(right.taskId),
  );
}

function taskUrl(task: UrgentReminderCandidate, appUrl: string): string {
  const base = appUrl.replace(/\/+$/, '');
  return task.isInbox
    ? `${base}/inbox?task=${task.taskId}`
    : `${base}/projects/${task.projectId}?task=${task.taskId}`;
}

function taskTitle(task: UrgentReminderCandidate): string {
  return telegramDigestTaskTitle(splitDescription(task.description).name);
}

function projectLabel(task: UrgentReminderCandidate): string {
  return task.isInbox ? 'Входящие' : task.projectName;
}

export function urgencyLabel(task: Pick<UrgentReminderCandidate, 'priority'>): string {
  if (task.priority === 1 || task.priority === 2) {
    const meta = PRIORITY_DIGEST_META[task.priority];
    return `${meta.emoji} ${meta.label}`;
  }
  return '🔥 Пометка «срочно»';
}

export function buildUrgentPersonalMessage(input: {
  readonly tasks: readonly UrgentReminderCandidate[];
  readonly slot: UrgentReminderSlot;
  readonly appUrl: string;
}): string {
  const shown = input.tasks.slice(0, MAX_TASKS_IN_PERSONAL);
  const lines = [
    `<b>🔥 Срочные задачи — ${input.slot.hour === 8 ? 'утреннее' : 'дневное'} напоминание</b>`,
    `На вас ${pluralTasksRu(input.tasks.length)} с высоким приоритетом или пометкой «срочно». ` +
      'Займитесь ими в первую очередь.',
  ];
  for (const task of shown) {
    lines.push(
      '',
      `<b><a href="${escapeHtml(taskUrl(task, input.appUrl))}">${escapeHtml(taskTitle(task))}</a></b>`,
      `${escapeHtml(urgencyLabel(task))} · 📁 ${escapeHtml(projectLabel(task))} · ` +
        `⏰ ${escapeHtml(formatUrgentDeadline(task.deadline, input.slot.date))}`,
    );
  }
  const hidden = input.tasks.length - shown.length;
  if (hidden > 0) lines.push('', `<i>И ещё ${pluralTasksRu(hidden)} — откройте приложение.</i>`);
  return lines.join('\n');
}

export function buildUrgentGroupMessage(input: {
  readonly task: UrgentReminderCandidate;
  readonly telegramLink: TelegramLink | null;
  readonly slot: UrgentReminderSlot;
  readonly appUrl: string;
}): string {
  const { task } = input;
  const url = escapeHtml(taskUrl(task, input.appUrl));
  return [
    `<b>🔥 Срочная задача</b> · исполнитель ${telegramPersonMention(task.assigneeName, input.telegramLink)}`,
    `<b><a href="${url}">${escapeHtml(taskTitle(task))}</a></b>`,
    `Приоритет: ${escapeHtml(urgencyLabel(task))}`,
    `Проект: ${escapeHtml(projectLabel(task))}`,
    `Дедлайн: ${escapeHtml(formatUrgentDeadline(task.deadline, input.slot.date))}`,
    `<a href="${url}">Открыть задачу ↗</a>`,
  ].join('\n');
}
