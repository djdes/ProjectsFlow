import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type {
  SendMessageResult,
  TelegramClient,
} from '../telegram/TelegramClient.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type {
  DigestTestDelivery,
} from './DigestSettingsRepository.js';
import type { WorkspaceAssigneeDigestRepository } from './WorkspaceAssigneeDigestRepository.js';
import type { CreateEmailActionToken } from '../email-action/CreateEmailActionToken.js';
import type { TelegramDigestActionDeliveryRepository } from './TelegramDigestActionDeliveryRepository.js';
import { extractTelegramDigestActionTokens } from './TelegramDigestActionService.js';
import type { Task } from '../../domain/task/Task.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import type { TaskWithCounts } from '../task/ListTasks.js';
import {
  buildDigestModel,
  renderDigestRich,
  telegramDigestTaskTitle,
  type DigestModel,
} from '../task/digest/buildTaskDigest.js';
import {
  escapeHtml,
  splitDescription,
} from '../../domain/task/digestFormat.js';

type Deps = {
  readonly settings: WorkspaceAssigneeDigestRepository;
  readonly workspaces: WorkspaceRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
  readonly telegram: TelegramClient;
  readonly appUrl: string;
  readonly createEmailActionToken: CreateEmailActionToken;
  readonly telegramDigestActions: TelegramDigestActionDeliveryRepository;
};

export type WorkspaceAssigneeDigestSendResult = {
  readonly taskCount: number;
  readonly sentCount: number;
  readonly skippedRecipientUserIds: string[];
  readonly projectCount: number;
};

type ProjectTasks = {
  readonly project: { id: string; name: string };
  readonly tasks: Task[];
};

const MAX_MESSAGE_LENGTH = 3800;

export class SendWorkspaceAssigneeDigest {
  constructor(private readonly deps: Deps) {}

  async execute(
    workspaceId: string,
    opts: { force?: boolean } = {},
  ): Promise<WorkspaceAssigneeDigestSendResult> {
    const settings = await this.deps.settings.get(workspaceId);
    if (!opts.force && !settings.enabled) {
      return { taskCount: 0, sentCount: 0, skippedRecipientUserIds: [], projectCount: 0 };
    }
    if (settings.telegramGroupChatId === null) {
      return { taskCount: 0, sentCount: 0, skippedRecipientUserIds: [], projectCount: 0 };
    }

    if (opts.force) await this.cleanupPreviousTest(workspaceId);

    const [members, projects] = await Promise.all([
      this.deps.workspaces.listMembers(workspaceId),
      this.deps.projects.listByWorkspace(workspaceId),
    ]);
    const configuredProjectIds = new Set(settings.projectIds);
    const selectedProjects = projects.filter(
      (project) => settings.projectMode === 'all' || configuredProjectIds.has(project.id),
    );
    const projectTasks: ProjectTasks[] = (
      await Promise.all(
        selectedProjects.map(async (project) => ({
          project,
          tasks: (await this.deps.tasks.listByProject(project.id)).filter(
            (task) => task.status !== 'done',
          ),
        })),
      )
    ).filter((item) => item.tasks.length > 0);

    const allowedRecipients = new Set(
      settings.recipientMode === 'all'
        ? members.map((member) => member.userId)
        : settings.recipientUserIds.filter((id) =>
            members.some((member) => member.userId === id),
          ),
    );
    const byAssignee = new Map<string, ProjectTasks[]>();
    for (const item of projectTasks) {
      for (const task of item.tasks) {
        if (!allowedRecipients.has(task.assignee.userId)) continue;
        const current = byAssignee.get(task.assignee.userId) ?? [];
        let projectBucket = current.find((bucket) => bucket.project.id === item.project.id);
        if (!projectBucket) {
          projectBucket = { project: item.project, tasks: [] };
          current.push(projectBucket);
        }
        projectBucket.tasks.push(task);
        byAssignee.set(task.assignee.userId, current);
      }
    }

    const memberById = new Map(members.map((member) => [member.userId, member] as const));
    const taskCount = [...byAssignee.values()].reduce(
      (total, groups) =>
        total + groups.reduce((groupTotal, group) => groupTotal + group.tasks.length, 0),
      0,
    );
    let sentCount = 0;
    const skippedRecipientUserIds: string[] = [];
    const testMessageIds: number[] = [];
    const now = new Date();

    const entries = [...byAssignee.entries()].sort(([leftId], [rightId]) => {
      const left = memberById.get(leftId)?.displayName ?? '';
      const right = memberById.get(rightId)?.displayName ?? '';
      return left.localeCompare(right, 'ru');
    });

    for (const [userId, grouped] of entries) {
      const member = memberById.get(userId);
      if (!member) continue;
      const telegramLink = await this.deps.users.getTelegramLink(userId).catch(() => null);
      if (!telegramLink) {
        skippedRecipientUserIds.push(userId);
        continue;
      }
      const completeActionLinks = new Map<string, string>();
      const base = this.deps.appUrl.replace(/\/+$/, '');
      for (const group of grouped) {
        for (const task of group.tasks) {
          const token = await this.deps.createEmailActionToken.execute({
            action: 'complete',
            taskId: task.id,
            projectId: group.project.id,
            userId,
          });
          completeActionLinks.set(
            task.id,
            `${base}/api/telegram-digest-actions/${token}`,
          );
        }
      }
      const message = buildWorkspaceAssigneeDigestMessage({
        displayName: member.displayName ?? member.email ?? 'Участник',
        telegramLink,
        projects: grouped,
        appUrl: this.deps.appUrl,
        now,
        completeActionLinks,
      });
      const richMessage = buildWorkspaceAssigneeDigestRichMessage({
        displayName: member.displayName ?? member.email ?? 'Участник',
        telegramLink,
        projects: grouped,
        appUrl: this.deps.appUrl,
        now,
        completeActionLinks,
      });
      let result: SendMessageResult | null = null;
      let deliveredHtml = richMessage;
      let deliveredKind: 'rich' | 'html' = 'rich';
      let fallbackAllowed = !this.deps.telegram.sendRichMessage;
      if (this.deps.telegram.sendRichMessage) {
        try {
          const richResult = await this.deps.telegram.sendRichMessage({
            chatId: settings.telegramGroupChatId,
            html: richMessage,
          });
          if (richResult.kind === 'ok') result = richResult;
          fallbackAllowed =
            richResult.kind === 'error' && richResult.deliveryUnknown !== true;
        } catch (error) {
          console.warn('[workspace-assignee-digest] rich message failed', error);
          // Сетевой сбой неоднозначен: запрос мог попасть в Telegram. Не отправляем
          // fallback следом, чтобы не создать дубликат участнику.
          fallbackAllowed = false;
        }
      }
      if (!result && fallbackAllowed) {
        deliveredHtml = message;
        deliveredKind = 'html';
        result = await this.deps.telegram
          .sendMessage({
            chatId: settings.telegramGroupChatId,
            text: message,
            parseMode: 'HTML',
            disableWebPagePreview: true,
          })
          .catch(() => null);
      }
      if (result?.kind === 'ok') {
        sentCount += 1;
        if (opts.force) testMessageIds.push(result.messageId);
        await this.deps.telegramDigestActions
          .attach({
            tokens: extractTelegramDigestActionTokens(deliveredHtml),
            chatId: settings.telegramGroupChatId,
            messageId: result.messageId,
            messageHtml: deliveredHtml,
            messageKind: deliveredKind,
          })
          .catch((error) =>
            console.warn('[workspace-assignee-digest] remember actions failed', error),
          );
      } else {
        skippedRecipientUserIds.push(userId);
      }
    }

    if (opts.force) {
      const deliveries: DigestTestDelivery[] =
        testMessageIds.length > 0
          ? [{ chatId: settings.telegramGroupChatId, messageIds: testMessageIds }]
          : [];
      await this.deps.settings
        .replaceLastTestDeliveries(workspaceId, deliveries)
        .catch(() => undefined);
    }

    return {
      taskCount,
      sentCount,
      skippedRecipientUserIds,
      projectCount: selectedProjects.length,
    };
  }

  private async cleanupPreviousTest(workspaceId: string): Promise<void> {
    const previous = await this.deps.settings
      .getLastTestDeliveries(workspaceId)
      .catch(() => []);
    if (this.deps.telegram.deleteMessages) {
      for (const delivery of previous) {
        await this.deps.telegram
          .deleteMessages({
            chatId: delivery.chatId,
            messageIds: delivery.messageIds,
          })
          .catch(() => undefined);
      }
    }
    await this.deps.settings
      .replaceLastTestDeliveries(workspaceId, [])
      .catch(() => undefined);
  }
}

export function buildWorkspaceAssigneeDigestMessage(input: {
  readonly displayName: string;
  readonly telegramLink: TelegramLink;
  readonly projects: readonly ProjectTasks[];
  readonly appUrl: string;
  readonly now?: Date;
  readonly completeActionLinks?: ReadonlyMap<string, string>;
}): string {
  const mention = telegramMention(input.displayName, input.telegramLink);
  const total = input.projects.reduce((sum, project) => sum + project.tasks.length, 0);
  const header =
    `<b>🗒 Ежедневные задачи для ${mention}</b>\n` +
    `Открытых задач: <b>${total}</b>`;
  const lines: string[] = [];
  let included = 0;
  const base = input.appUrl.replace(/\/+$/, '');

  outer: for (const group of input.projects) {
    const projectUrl = `${base}/projects/${group.project.id}`;
    const projectHeader = `<b>📁 <a href="${escapeHtml(projectUrl)}">${escapeHtml(group.project.name)}</a></b>`;
    const projectLines: string[] = [projectHeader];
    for (const task of group.tasks) {
      const { name } = splitDescription(task.description);
      const taskUrl = `${base}/projects/${group.project.id}?task=${task.id}`;
      const completeUrl = input.completeActionLinks?.get(task.id) ?? `${taskUrl}&done=1`;
      const taskLine =
        `• <b>${escapeHtml(telegramDigestTaskTitle(name))}</b> ` +
        `<a href="${escapeHtml(completeUrl)}">✓</a> · ` +
        `<a href="${escapeHtml(taskUrl)}">↗</a>`;
      const candidate = [...lines, ...projectLines, taskLine].join('\n');
      const remainingTail = `\n\n<i>Ещё ${total - included - 1} задач — откройте проекты выше.</i>`;
      if (
        header.length +
          candidate.length +
          '<blockquote expandable></blockquote>'.length +
          remainingTail.length >
        MAX_MESSAGE_LENGTH
      ) {
        break outer;
      }
      projectLines.push(taskLine);
      included += 1;
    }
    lines.push(...projectLines, '');
  }

  const hidden = total - included;
  const body = lines.join('\n').trim();
  const tail = hidden > 0 ? `\n\n<i>Ещё ${hidden} задач — откройте проекты выше.</i>` : '';
  return `${header}\n<blockquote expandable>${body}${tail}</blockquote>`;
}

export function buildWorkspaceAssigneeDigestRichMessage(input: {
  readonly displayName: string;
  readonly telegramLink: TelegramLink;
  readonly projects: readonly ProjectTasks[];
  readonly appUrl: string;
  readonly now?: Date;
  readonly completeActionLinks?: ReadonlyMap<string, string>;
}): string {
  const model = buildWorkspaceAssigneeDigestModel(input);
  return renderDigestRich(model, {
    titleHtml: `🗒 Ежедневные задачи для ${telegramMention(
      input.displayName,
      input.telegramLink,
    )}`,
  });
}

function buildWorkspaceAssigneeDigestModel(input: {
  readonly projects: readonly ProjectTasks[];
  readonly appUrl: string;
  readonly now?: Date;
  readonly completeActionLinks?: ReadonlyMap<string, string>;
}): DigestModel {
  const groups: DigestModel['groups'] = input.projects.map((group) => {
    const tasks: TaskWithCounts[] = group.tasks.map((task) => ({
      ...task,
      commitCount: 0,
      attachmentCount: 0,
      commentCount: 0,
    }));
    const projectModel = buildDigestModel(tasks, {
      projectName: group.project.name,
      appUrl: input.appUrl,
      isInbox: false,
      attachmentsByTask: new Map(),
      grouping: { by: 'priority' },
      completeActionLinks: input.completeActionLinks,
      now: input.now,
    });
    return {
      priority: null,
      heading: `📁 ${group.project.name}`,
      items: projectModel.groups.flatMap((projectGroup) => projectGroup.items),
      telegramAssignee: null,
    };
  });
  const model: DigestModel = {
    projectName: '',
    count: input.projects.reduce((sum, project) => sum + project.tasks.length, 0),
    groups,
  };
  return model;
}

function telegramMention(displayName: string, link: TelegramLink): string {
  const username = link.telegramUsername?.replace(/^@/, '').trim();
  if (username && /^[A-Za-z0-9_]{5,32}$/.test(username)) {
    return `@${escapeHtml(username)}`;
  }
  return `<a href="tg://user?id=${link.telegramUserId}">${escapeHtml(displayName)}</a>`;
}
