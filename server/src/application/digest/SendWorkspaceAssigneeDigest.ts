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
import type { TelegramMessageTaskRepository } from '../telegram/TelegramMessageTaskRepository.js';
import { telegramPersonMention } from '../telegram/telegramMention.js';
import {
  collectWorkspaceAssigneeTasks,
  isAwaitingApproval,
  type ProjectTasks,
} from './collectWorkspaceAssigneeTasks.js';
import type { Task } from '../../domain/task/Task.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import type { WorkspaceMember } from '../../domain/workspace/WorkspaceMember.js';
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
import {
  APPROVAL_DELEGATED_GROUP_NAME,
  buildApprovalDigestFallback,
  buildApprovalDigestRich,
  type ApprovalDigestGroup,
  type ApprovalDigestPerson,
} from './approvalDigestMessage.js';

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
  // Задачи каждого отправленного сообщения (db/160): reply на сводку становится
  // комментарием к задаче. Отсутствие — без этой возможности (тесты, старый wiring).
  readonly messageTasks?: Pick<TelegramMessageTaskRepository, 'attach'>;
};

export type WorkspaceAssigneeDigestSendResult = {
  readonly taskCount: number;
  readonly sentCount: number;
  readonly skippedRecipientUserIds: string[];
  readonly projectCount: number;
  // Задач в сообщении «На утверждении» (0 — сообщения не было).
  readonly approvalTaskCount: number;
};

type Delivered = {
  readonly result: SendMessageResult | null;
  readonly html: string;
  readonly kind: 'rich' | 'html';
};

const MAX_MESSAGE_LENGTH = 3800;

const EMPTY_RESULT: WorkspaceAssigneeDigestSendResult = {
  taskCount: 0,
  sentCount: 0,
  skippedRecipientUserIds: [],
  projectCount: 0,
  approvalTaskCount: 0,
};

export class SendWorkspaceAssigneeDigest {
  constructor(private readonly deps: Deps) {}

  async execute(
    workspaceId: string,
    opts: { force?: boolean } = {},
  ): Promise<WorkspaceAssigneeDigestSendResult> {
    const settings = await this.deps.settings.get(workspaceId);
    if (!opts.force && !settings.enabled) return EMPTY_RESULT;
    const chatId = settings.telegramGroupChatId;
    if (chatId === null) return EMPTY_RESULT;

    if (opts.force) await this.cleanupPreviousTest(workspaceId);

    const members = await this.deps.workspaces.listMembers(workspaceId);
    const { selectedProjects, projectTasks, delegated, byAssignee } =
      await collectWorkspaceAssigneeTasks(this.deps, settings, members);

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
      // Без привязки Telegram сводка всё равно уходит в общий чат — с именем вместо
      // упоминания: команда должна видеть задачи каждого, кому что-то назначено.
      const telegramLink = await this.deps.users.getTelegramLink(userId).catch(() => null);
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
      const messageInput = {
        displayName: memberName(member),
        telegramLink,
        projects: grouped,
        appUrl: this.deps.appUrl,
        now,
        completeActionLinks,
      };
      const delivered = await this.deliver(
        chatId,
        buildWorkspaceAssigneeDigestRichMessage(messageInput),
        buildWorkspaceAssigneeDigestMessage(messageInput),
      );
      if (delivered.result?.kind !== 'ok') {
        skippedRecipientUserIds.push(userId);
        continue;
      }
      sentCount += 1;
      const messageId = delivered.result.messageId;
      if (opts.force) testMessageIds.push(messageId);
      await this.deps.telegramDigestActions
        .attach({
          tokens: extractTelegramDigestActionTokens(delivered.html),
          chatId,
          messageId,
          messageHtml: delivered.html,
          messageKind: delivered.kind,
        })
        .catch((error) =>
          console.warn('[workspace-assignee-digest] remember actions failed', error),
        );
      await this.rememberMessageTasks(chatId, messageId, grouped);
    }

    // Отдельное сообщение руководителям: что из сданного ждёт их утверждения.
    const approvalGroups: ApprovalDigestGroup[] = [
      ...projectTasks
        .map((item) => ({ project: item.project, tasks: item.tasks.filter(isAwaitingApproval) }))
        .filter((group) => group.tasks.length > 0),
      ...delegated
        .map(({ inbox, tasks }) => ({
          project: { id: inbox.id, name: APPROVAL_DELEGATED_GROUP_NAME },
          isInbox: true,
          tasks: tasks.filter(isAwaitingApproval),
        }))
        .filter((group) => group.tasks.length > 0),
    ];
    const approvalTaskCount = approvalGroups.reduce((sum, group) => sum + group.tasks.length, 0);
    if (approvalTaskCount > 0) {
      const messageId = await this.sendApprovalDigest(chatId, members, approvalGroups);
      if (messageId !== null && opts.force) testMessageIds.push(messageId);
    }

    if (opts.force) {
      const deliveries: DigestTestDelivery[] =
        testMessageIds.length > 0
          ? [{ chatId, messageIds: testMessageIds }]
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
      approvalTaskCount,
    };
  }

  // «На утверждении»: утверждают руководители пространства, владельцы — наблюдатели.
  // В пространстве без руководителей принимают работу владельцы, наблюдателей нет.
  private async sendApprovalDigest(
    chatId: number,
    members: readonly WorkspaceMember[],
    groups: readonly ApprovalDigestGroup[],
  ): Promise<number | null> {
    const leads = members.filter((member) => member.role === 'lead');
    const owners = members.filter((member) => member.role === 'owner');
    const toPeople = (list: readonly WorkspaceMember[]): Promise<ApprovalDigestPerson[]> =>
      Promise.all(
        list.map(async (member) => ({
          displayName: memberName(member),
          telegramLink: await this.deps.users.getTelegramLink(member.userId).catch(() => null),
        })),
      );
    const input = {
      approvers: await toPeople(leads.length > 0 ? leads : owners),
      observers: leads.length > 0 ? await toPeople(owners) : [],
      groups,
      appUrl: this.deps.appUrl,
    };
    const delivered = await this.deliver(
      chatId,
      buildApprovalDigestRich(input),
      buildApprovalDigestFallback(input),
    );
    if (delivered.result?.kind !== 'ok') return null;
    await this.rememberMessageTasks(chatId, delivered.result.messageId, groups);
    return delivered.result.messageId;
  }

  // Rich-сообщение, при ошибке Telegram — обычный HTML. Сетевой сбой неоднозначен: запрос
  // мог попасть в Telegram, поэтому fallback следом не шлём, чтобы не создать дубликат.
  private async deliver(chatId: number, richHtml: string, fallbackHtml: string): Promise<Delivered> {
    let fallbackAllowed = !this.deps.telegram.sendRichMessage;
    if (this.deps.telegram.sendRichMessage) {
      try {
        const richResult = await this.deps.telegram.sendRichMessage({ chatId, html: richHtml });
        if (richResult.kind === 'ok') return { result: richResult, html: richHtml, kind: 'rich' };
        fallbackAllowed = richResult.kind === 'error' && richResult.deliveryUnknown !== true;
      } catch (error) {
        console.warn('[workspace-assignee-digest] rich message failed', error);
        fallbackAllowed = false;
      }
    }
    if (!fallbackAllowed) return { result: null, html: richHtml, kind: 'rich' };
    const result = await this.deps.telegram
      .sendMessage({
        chatId,
        text: fallbackHtml,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      })
      .catch(() => null);
    return { result, html: fallbackHtml, kind: 'html' };
  }

  private async rememberMessageTasks(
    chatId: number,
    messageId: number,
    groups: ReadonlyArray<{ readonly project: { id: string }; readonly tasks: readonly Task[] }>,
  ): Promise<void> {
    if (!this.deps.messageTasks) return;
    await this.deps.messageTasks
      .attach({
        chatId,
        messageId,
        tasks: groups.flatMap((group) =>
          group.tasks.map((task) => ({ taskId: task.id, projectId: group.project.id })),
        ),
      })
      .catch((error) => console.warn('[workspace-assignee-digest] remember message tasks failed', error));
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

function memberName(member: WorkspaceMember): string {
  return member.displayName ?? member.email ?? 'Участник';
}

export function buildWorkspaceAssigneeDigestMessage(input: {
  readonly displayName: string;
  readonly telegramLink: TelegramLink | null;
  readonly projects: readonly ProjectTasks[];
  readonly appUrl: string;
  readonly now?: Date;
  readonly completeActionLinks?: ReadonlyMap<string, string>;
}): string {
  const mention = telegramPersonMention(input.displayName, input.telegramLink);
  const total = input.projects.reduce((sum, project) => sum + project.tasks.length, 0);
  const header =
    `<b>🗒 Ежедневные задачи для ${mention}</b>\n` +
    `Открытых задач: <b>${total}</b>`;
  const lines: string[] = [];
  let included = 0;
  const base = input.appUrl.replace(/\/+$/, '');

  outer: for (const group of input.projects) {
    const groupUrl = group.isInbox ? `${base}/inbox` : `${base}/projects/${group.project.id}`;
    const projectHeader =
      `<b>${group.isInbox ? '🤝' : '📁'} ` +
      `<a href="${escapeHtml(groupUrl)}">${escapeHtml(group.project.name)}</a></b>`;
    const projectLines: string[] = [projectHeader];
    for (const task of group.tasks) {
      const { name } = splitDescription(task.description);
      const taskUrl = group.isInbox
        ? `${base}/inbox?task=${task.id}`
        : `${base}/projects/${group.project.id}?task=${task.id}`;
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
        // Уже вошедшие задачи текущего проекта не теряем — иначе «Ещё N» не сойдётся.
        if (projectLines.length > 1) lines.push(...projectLines, '');
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
  readonly telegramLink: TelegramLink | null;
  readonly projects: readonly ProjectTasks[];
  readonly appUrl: string;
  readonly now?: Date;
  readonly completeActionLinks?: ReadonlyMap<string, string>;
}): string {
  const model = buildWorkspaceAssigneeDigestModel(input);
  return renderDigestRich(model, {
    titleHtml: `🗒 Ежедневные задачи для ${telegramPersonMention(
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
      // Дайджест не различает чужие личные входящие — подпись владельца ему не нужна.
      inboxOwner: null,
    }));
    const projectModel = buildDigestModel(tasks, {
      projectName: group.project.name,
      appUrl: input.appUrl,
      // Задачи без проекта живут во входящих — ссылки должны вести на /inbox.
      isInbox: group.isInbox === true,
      attachmentsByTask: new Map(),
      grouping: { by: 'priority' },
      completeActionLinks: input.completeActionLinks,
      now: input.now,
    });
    return {
      priority: null,
      heading: `${group.isInbox ? '🤝' : '📁'} ${group.project.name}`,
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
