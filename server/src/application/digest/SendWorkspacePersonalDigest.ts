import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskCommentRepository } from '../task/TaskCommentRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type { InlineKeyboardMarkup } from '../telegram/TelegramClient.js';
import type {
  SendAgentNotificationCommand,
  SendAgentNotificationResult,
} from '../telegram/SendAgentTelegramNotification.js';
import { taskActionKeyboard } from '../telegram/taskActionKeyboard.js';
import type { WorkspaceAssigneeDigestRepository } from './WorkspaceAssigneeDigestRepository.js';
import { collectWorkspaceAssigneeTasks, type ProjectTasks } from './collectWorkspaceAssigneeTasks.js';
import type { Task } from '../../domain/task/Task.js';
import { STATUS_LABEL } from '../../domain/task/statusLabels.js';
import { isCustomKanbanSlot } from '../../domain/kanban/KanbanSettings.js';
import { moscowDateOnly } from '../../domain/time/moscowDate.js';
import {
  PRIORITY_DIGEST_META,
  escapeHtml,
  extractImageSrcs,
  formatDeadlineRemainingRu,
  formatDeadlineRu,
  pluralTasksRu,
  splitDescription,
  stripAllMarkdown,
} from '../../domain/task/digestFormat.js';

type Deps = {
  readonly settings: Pick<WorkspaceAssigneeDigestRepository, 'get'>;
  readonly workspaces: Pick<WorkspaceRepository, 'listMembers'>;
  readonly projects: Pick<ProjectRepository, 'listByWorkspace' | 'listInboxesByOwners'>;
  readonly tasks: Pick<TaskRepository, 'listByProject'>;
  readonly comments: Pick<TaskCommentRepository, 'countsByTasks'>;
  // Личка с ботом: проверка привязки/«Start», аудит, маппинг reply→комментарий на карточке.
  readonly telegram: { execute(cmd: SendAgentNotificationCommand): Promise<SendAgentNotificationResult> };
  readonly appUrl: string;
  // Пауза между повтором после 429 (тесты подменяют, чтобы не ждать).
  readonly sleep?: (ms: number) => Promise<void>;
};

export type WorkspacePersonalDigestSendResult = {
  // Скольким участникам сводка ушла и сколько задач в них было.
  readonly sentCount: number;
  readonly taskCount: number;
  // Есть задачи, но личка недоступна: Telegram не привязан, не нажат Start или бот заблокирован.
  readonly skippedRecipientUserIds: string[];
};

// Карточек на человека за утро: дальше — ссылкой в приложение, чтобы не засыпать чат.
// Порядок по срочности, поэтому за лимитом остаётся наименее важное.
export const PERSONAL_DIGEST_CARD_LIMIT = 15;
const TITLE_LIMIT = 160;
const DESCRIPTION_EXCERPT_LIMIT = 600;

// Kind карточки задачи: входит в TASK_ACTION_KINDS — reply на неё становится комментарием.
export const PERSONAL_DIGEST_CARD_KIND = 'task_digest_card';

const EMPTY_RESULT: WorkspacePersonalDigestSendResult = {
  sentCount: 0,
  taskCount: 0,
  skippedRecipientUserIds: [],
};

export type PersonalDigestItem = {
  readonly task: Task;
  readonly project: { id: string; name: string };
  readonly isInbox: boolean;
};

// Личная сводка в бота: каждому участнику — его открытые задачи по всему пространству.
// Заголовок с итогами и по карточке на задачу с кнопками «Завершить / Комментировать /
// Посмотреть / Открыть»; ответ (reply) на карточку — комментарий к задаче. Набор задач тот же,
// что в групповой таблице по ответственным (collectWorkspaceAssigneeTasks).
export class SendWorkspacePersonalDigest {
  constructor(private readonly deps: Deps) {}

  // force — ручной тест из настроек (даже если сводка выключена); onlyUserId — кому слать
  // (тест уходит только нажавшему, а не всей команде).
  async execute(
    workspaceId: string,
    opts: { force?: boolean; onlyUserId?: string } = {},
  ): Promise<WorkspacePersonalDigestSendResult> {
    const settings = await this.deps.settings.get(workspaceId);
    if (!opts.force && !settings.personalEnabled) return EMPTY_RESULT;

    const members = await this.deps.workspaces.listMembers(workspaceId);
    const { byAssignee } = await collectWorkspaceAssigneeTasks(this.deps, settings, members);
    const recipients = [...byAssignee.entries()].filter(
      ([userId]) => opts.onlyUserId === undefined || userId === opts.onlyUserId,
    );
    if (recipients.length === 0) return EMPTY_RESULT;

    const allTaskIds = recipients.flatMap(([, groups]) =>
      groups.flatMap((group) => group.tasks.map((task) => task.id)),
    );
    const commentCounts = await this.deps.comments
      .countsByTasks(allTaskIds)
      .catch(() => new Map<string, number>());

    const now = new Date();
    let sentCount = 0;
    let taskCount = 0;
    const skippedRecipientUserIds: string[] = [];
    for (const [userId, groups] of recipients) {
      const items = sortPersonalDigestItems(flattenGroups(groups), now);
      const sent = await this.sendTo(userId, items, commentCounts, now);
      if (!sent) {
        skippedRecipientUserIds.push(userId);
        continue;
      }
      sentCount += 1;
      taskCount += items.length;
    }
    return { sentCount, taskCount, skippedRecipientUserIds };
  }

  // false — личка недоступна (заголовок не ушёл), карточки тогда не шлём.
  private async sendTo(
    userId: string,
    items: readonly PersonalDigestItem[],
    commentCounts: ReadonlyMap<string, number>,
    now: Date,
  ): Promise<boolean> {
    const header = await this.send({
      userId,
      text: buildPersonalDigestHeader(items, now),
      parseMode: 'HTML',
      kind: 'task_digest',
      skipDedupCheck: true,
    });
    if (header.status !== 'ok') return false;

    const base = this.deps.appUrl.replace(/\/+$/, '');
    for (const item of items.slice(0, PERSONAL_DIGEST_CARD_LIMIT)) {
      const card = buildPersonalDigestCard(item, {
        appUrl: base,
        commentCount: commentCounts.get(item.task.id) ?? 0,
        now,
      });
      const result = await this.send({
        userId,
        text: card.text,
        parseMode: 'HTML',
        kind: PERSONAL_DIGEST_CARD_KIND,
        taskId: item.task.id,
        projectId: item.project.id,
        replyMarkup: card.keyboard,
        skipDedupCheck: true,
      });
      // Бот заблокирован посреди рассылки — дальше слать бессмысленно.
      if (result.status === 'forbidden') break;
    }

    const rest = items.length - PERSONAL_DIGEST_CARD_LIMIT;
    if (rest > 0) {
      await this.send({
        userId,
        text:
          `… и ещё ${pluralTasksRu(rest)} — ` +
          `<a href="${escapeHtml(`${base}/`)}">открыть в ProjectsFlow</a>`,
        parseMode: 'HTML',
        kind: 'task_digest',
        skipDedupCheck: true,
      });
    }
    return true;
  }

  // Подряд десяток сообщений в один чат упирается в лимит Telegram — один повтор после паузы.
  private async send(cmd: SendAgentNotificationCommand): Promise<SendAgentNotificationResult> {
    const first = await this.deps.telegram
      .execute(cmd)
      .catch((error: unknown): SendAgentNotificationResult => ({
        status: 'error',
        description: String(error),
      }));
    if (first.status !== 'rate_limited') return first;
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    await sleep(Math.min(first.retryAfter, 30) * 1000);
    return this.deps.telegram
      .execute(cmd)
      .catch((error: unknown): SendAgentNotificationResult => ({
        status: 'error',
        description: String(error),
      }));
  }
}

function flattenGroups(groups: readonly ProjectTasks[]): PersonalDigestItem[] {
  return groups.flatMap((group) =>
    group.tasks.map((task) => ({
      task,
      project: group.project,
      isInbox: group.isInbox === true,
    })),
  );
}

function isOverdue(task: Task, today: string): boolean {
  return task.deadline !== null && task.deadline < today;
}

// Сначала просроченные, затем по приоритету (без приоритета — в конце), затем по сроку.
// Сортировка стабильная: при равенстве сохраняется порядок проектов из настроек.
export function sortPersonalDigestItems(
  items: readonly PersonalDigestItem[],
  now: Date,
): PersonalDigestItem[] {
  const today = moscowDateOnly(now);
  const priorityRank = (task: Task): number => task.priority ?? 5;
  return [...items].sort((a, b) => {
    const overdue = Number(isOverdue(b.task, today)) - Number(isOverdue(a.task, today));
    if (overdue !== 0) return overdue;
    const priority = priorityRank(a.task) - priorityRank(b.task);
    if (priority !== 0) return priority;
    const left = a.task.deadline;
    const right = b.task.deadline;
    if (left !== null && right !== null) return left < right ? -1 : left > right ? 1 : 0;
    if (left !== null) return -1;
    if (right !== null) return 1;
    return 0;
  });
}

export function buildPersonalDigestHeader(
  items: readonly PersonalDigestItem[],
  now: Date,
): string {
  const today = moscowDateOnly(now);
  const byProject = new Map<string, { name: string; isInbox: boolean; count: number }>();
  for (const item of items) {
    const entry = byProject.get(item.project.id);
    if (entry) entry.count += 1;
    else byProject.set(item.project.id, { name: item.project.name, isInbox: item.isInbox, count: 1 });
  }
  const projects = [...byProject.values()]
    .map((p) => `${p.isInbox ? '🤝' : '📁'} ${escapeHtml(p.name)} — ${p.count}`)
    .join('\n');

  const overdue = items.filter((item) => isOverdue(item.task, today)).length;
  const dueToday = items.filter((item) => item.task.deadline === today).length;
  const urgent = items.filter((item) => item.task.priority === 1).length;
  const flags = [
    overdue > 0 ? `❗ Просрочено: <b>${overdue}</b>` : '',
    dueToday > 0 ? `⏰ Срок сегодня: <b>${dueToday}</b>` : '',
    urgent > 0 ? `🔴 Срочных: <b>${urgent}</b>` : '',
  ].filter(Boolean);

  return [
    `🗒 <b>Ваши задачи на сегодня</b> — ${pluralTasksRu(items.length)}`,
    '',
    projects,
    ...(flags.length > 0 ? ['', flags.join(' · ')] : []),
    '',
    '<i>Под каждой задачей — кнопки. Чтобы оставить комментарий, ответьте на карточку.</i>',
  ].join('\n');
}

export function buildPersonalDigestCard(
  item: PersonalDigestItem,
  opts: { readonly appUrl: string; readonly commentCount: number; readonly now: Date },
): { text: string; keyboard: InlineKeyboardMarkup } {
  const { task } = item;
  const { name, body } = splitDescription(task.description);
  // Длинная первая строка обрезается по слову, полный текст тогда уходит в цитату ниже.
  const title = clipAtWord(name, TITLE_LIMIT);
  const lines = [`📌 <b>${escapeHtml(title)}</b>`];

  const meta = [`${item.isInbox ? '🤝' : '📁'} ${escapeHtml(item.project.name)}`];
  if (task.priority !== null) {
    const priority = PRIORITY_DIGEST_META[task.priority];
    meta.push(`${priority.emoji} ${priority.label}`);
  }
  // Кастомные колонки называются в настройках доски проекта — общей подписи у них нет.
  if (!isCustomKanbanSlot(task.status)) meta.push(STATUS_LABEL[task.status]);
  lines.push(meta.join(' · '));

  if (task.deadline !== null) {
    const overdue = isOverdue(task, moscowDateOnly(opts.now));
    lines.push(
      `${overdue ? '❗' : '⏰'} Срок: ${formatDeadlineRu(task.deadline, opts.now)} — ` +
        `${formatDeadlineRemainingRu(task.deadline, opts.now)}`,
    );
  }
  if (task.creator && task.creator.userId !== task.assignee.userId) {
    lines.push(`👤 Поставил(а): ${escapeHtml(task.creator.displayName)}`);
  }

  const excerpt = descriptionExcerpt(title === name ? body : `${name}\n${body}`);
  if (excerpt) lines.push(`<blockquote expandable>${escapeHtml(excerpt)}</blockquote>`);

  const extras: string[] = [];
  if (opts.commentCount > 0) extras.push(`💬 ${opts.commentCount}`);
  const images = extractImageSrcs(task.description).length;
  if (images > 0) extras.push(`🖼 ${images}`);
  if (extras.length > 0) lines.push(extras.join(' · '));

  const url = item.isInbox
    ? `${opts.appUrl}/inbox?task=${task.id}`
    : `${opts.appUrl}/projects/${item.project.id}?task=${task.id}`;
  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...taskActionKeyboard(task.id).inline_keyboard,
        [{ text: '↗ Открыть в ProjectsFlow', url }],
      ],
    },
  };
}

// Начало описания чистым текстом: полная версия — по кнопке «Посмотреть задачу».
function descriptionExcerpt(body: string): string {
  return clipAtWord(stripAllMarkdown(body).replace(/\n{3,}/g, '\n\n').trim(), DESCRIPTION_EXCERPT_LIMIT);
}

function clipAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
