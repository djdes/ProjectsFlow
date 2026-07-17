import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { SendMessageResult, TelegramClient } from '../telegram/TelegramClient.js';
import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { CreateEmailActionToken } from '../email-action/CreateEmailActionToken.js';
import type { TelegramDigestActionDeliveryRepository } from '../digest/TelegramDigestActionDeliveryRepository.js';
import { extractTelegramDigestActionTokens } from '../digest/TelegramDigestActionService.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import type { Task } from '../../domain/task/Task.js';
import { escapeHtml, formatDeadlineRemainingRu } from '../../domain/task/digestFormat.js';
import { telegramDigestTaskTitle } from '../task/digest/buildTaskDigest.js';

const MAX_TASKS_PER_PERSON = 30;

function mskDateOnly(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function needsEodAttention(task: Task, today: string): boolean {
  return task.status !== 'done' && task.deadline !== null && task.deadline <= today;
}

type Deps = {
  readonly settings: WorkspaceAssigneeDigestRepository;
  readonly workspaces: WorkspaceRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
  readonly telegram: TelegramClient;
  readonly createEmailActionToken: CreateEmailActionToken;
  readonly telegramDigestActions: TelegramDigestActionDeliveryRepository;
  readonly appUrl: string;
};

type PersonSection = {
  readonly userId: string;
  readonly displayName: string;
  readonly telegramLink: TelegramLink | null;
  readonly tasks: TaskRow[];
};

type TaskRow = {
  readonly task: Task;
  readonly project: { id: string; name: string };
  readonly completeUrl: string;
  readonly openUrl: string;
};

export class SendWorkspaceEodReminder {
  constructor(private readonly deps: Deps) {}

  async execute(workspaceId: string): Promise<{ projectCount: number; taskCount: number }> {
    const settings = await this.deps.settings.get(workspaceId);
    if (!settings.eodReminderEnabled || settings.telegramGroupChatId === null) {
      return { projectCount: 0, taskCount: 0 };
    }

    const [members, workspaceProjects] = await Promise.all([
      this.deps.workspaces.listMembers(workspaceId),
      this.deps.projects.listByWorkspace(workspaceId),
    ]);
    // EOD is a workspace-wide deadline ritual. Project selection still scopes the
    // regular digest and commit review, but must not hide a person's overdue work.
    const projects = workspaceProjects;
    const today = mskDateOnly(new Date());
    const tasksByProject = await Promise.all(
      projects.map(async (project) => ({
        project,
        tasks: (await this.deps.tasks.listByProject(project.id)).filter((task) =>
          needsEodAttention(task, today),
        ),
      })),
    );
    const byAssignee = new Map<string, Array<{ task: Task; project: { id: string; name: string } }>>();
    for (const group of tasksByProject) {
      for (const task of group.tasks) {
        const bucket = byAssignee.get(task.assignee.userId) ?? [];
        bucket.push({ task, project: group.project });
        byAssignee.set(task.assignee.userId, bucket);
      }
    }

    for (const rows of byAssignee.values()) {
      rows.sort(
        (left, right) =>
          (left.task.deadline ?? '').localeCompare(right.task.deadline ?? '') ||
          left.project.name.localeCompare(right.project.name, 'ru') ||
          (left.task.description ?? '').localeCompare(right.task.description ?? '', 'ru'),
      );
    }

    const base = this.deps.appUrl.replace(/\/+$/, '');
    const sections: PersonSection[] = [];
    const people = new Map(
      members.map((member) => [
        member.userId,
        member.displayName ?? member.email ?? 'Участник',
      ] as const),
    );
    // A task assignee is authoritative even when an old/imported account is not
    // present in workspace_members. Otherwise their due tasks silently disappear.
    for (const rows of byAssignee.values()) {
      const task = rows[0]?.task;
      if (task && !people.has(task.assignee.userId)) {
        people.set(task.assignee.userId, task.assignee.displayName ?? 'Участник');
      }
    }
    for (const [userId, displayName] of people) {
      const assigned = (byAssignee.get(userId) ?? []).slice(0, MAX_TASKS_PER_PERSON);
      const taskRows: TaskRow[] = [];
      for (const row of assigned) {
        const token = await this.deps.createEmailActionToken.execute({
          action: 'complete',
          taskId: row.task.id,
          projectId: row.project.id,
          userId,
        });
        taskRows.push({
          ...row,
          completeUrl: `${base}/api/telegram-digest-actions/${token}`,
          openUrl: `${base}/projects/${row.project.id}?task=${row.task.id}`,
        });
      }
      sections.push({
        userId,
        displayName,
        telegramLink: await this.deps.users.getTelegramLink(userId).catch(() => null),
        tasks: taskRows,
      });
    }
    sections.sort((left, right) => {
      if ((left.tasks.length > 0) !== (right.tasks.length > 0)) return left.tasks.length > 0 ? -1 : 1;
      return left.displayName.localeCompare(right.displayName, 'ru');
    });

    const total = sections.reduce((sum, section) => sum + section.tasks.length, 0);
    const richHtml = buildEodRichMessage(sections, total, new Date());
    let deliveredHtml = richHtml;
    let deliveredKind: 'rich' | 'html' = 'rich';
    let result: SendMessageResult | null = null;
    let fallbackAllowed = !this.deps.telegram.sendRichMessage;
    if (this.deps.telegram.sendRichMessage) {
      try {
        const richResult = await this.deps.telegram.sendRichMessage({
          chatId: settings.telegramGroupChatId,
          html: richHtml,
        });
        if (richResult.kind === 'ok') result = richResult;
        fallbackAllowed = richResult.kind === 'error' && richResult.deliveryUnknown !== true;
      } catch (error) {
        console.warn('[workspace-eod-reminder] rich message failed', error);
        fallbackAllowed = false;
      }
    }

    if (!result && fallbackAllowed) {
      deliveredHtml = buildEodFallbackMessage(sections, total, new Date());
      deliveredKind = 'html';
      result = await this.deps.telegram.sendMessage({
        chatId: settings.telegramGroupChatId,
        text: deliveredHtml,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
    }

    if (result?.kind === 'ok') {
      await this.deps.telegramDigestActions
        .attach({
          tokens: extractTelegramDigestActionTokens(deliveredHtml),
          chatId: settings.telegramGroupChatId,
          messageId: result.messageId,
          messageHtml: deliveredHtml,
          messageKind: deliveredKind,
        })
        .catch((error) => console.warn('[workspace-eod-reminder] remember actions failed', error));
    }
    return { projectCount: projects.length, taskCount: total };
  }
}

export function buildEodRichMessage(
  sections: readonly PersonSection[],
  total: number,
  now: Date,
): string {
  const attentionCount = sections.filter((section) => section.tasks.length > 0).length;
  const html: string[] = [
    '<h2>🕔 Перед уходом — обновите задачи</h2>',
    `<p>На сегодня и просрочено: <b>${total}</b> · требуют внимания: <b>${attentionCount}</b></p>`,
    `<details><summary>Показать по ответственным (${sections.length})</summary>`,
  ];
  for (const section of sections) {
    const mention = personMention(section.displayName, section.telegramLink);
    if (section.tasks.length === 0) {
      html.push(`<p>✅ ${mention} — молодец, всё сделано.</p>`);
      continue;
    }
    html.push(`<h3>⚠️ ${mention} — проверить и доделать (${section.tasks.length})</h3>`);
    html.push('<table bordered striped>');
    html.push('<tr><th>Задача</th><th>Проект</th><th>Дедлайн</th></tr>');
    for (const row of section.tasks) {
      const title = telegramDigestTaskTitle((row.task.description ?? '').split('\n')[0] ?? '');
      const deadline = row.task.deadline ? formatDeadlineRemainingRu(row.task.deadline, now) : '—';
      html.push(
        `<tr><td><b>${escapeHtml(title)}</b><br>` +
          `<a href="${escapeHtml(row.completeUrl)}">✓</a> · ` +
          `<a href="${escapeHtml(row.openUrl)}">↗</a></td>` +
          `<td>${escapeHtml(row.project.name)}</td><td>${escapeHtml(deadline)}</td></tr>`,
      );
    }
    html.push('</table>');
  }
  html.push('</details>');
  return html.join('');
}

export function buildEodFallbackMessage(
  sections: readonly PersonSection[],
  total: number,
  now: Date,
): string {
  const lines = [
    `<b>🕔 Перед уходом — обновите задачи</b>`,
    `На сегодня и просрочено: <b>${total}</b>`,
  ];
  const hidden: string[] = [];
  for (const section of sections) {
    const mention = personMention(section.displayName, section.telegramLink);
    if (section.tasks.length === 0) {
      hidden.push(`✅ ${mention} — молодец, всё сделано.`);
      continue;
    }
    hidden.push(`⚠️ <b>${mention} — проверить и доделать (${section.tasks.length})</b>`);
    for (const row of section.tasks) {
      const title = telegramDigestTaskTitle((row.task.description ?? '').split('\n')[0] ?? '');
      const deadline = row.task.deadline ? ` · ${formatDeadlineRemainingRu(row.task.deadline, now)}` : '';
      hidden.push(
        `<b>${escapeHtml(title)}</b>${escapeHtml(deadline)} ` +
          `<a href="${escapeHtml(row.completeUrl)}">✓</a> · ` +
          `<a href="${escapeHtml(row.openUrl)}">↗</a>`,
      );
    }
  }
  return `${lines.join('\n')}\n<blockquote expandable>${hidden.join('\n\n')}</blockquote>`;
}

function personMention(displayName: string, link: TelegramLink | null): string {
  if (!link) return escapeHtml(displayName);
  const username = link.telegramUsername?.replace(/^@/, '').trim();
  if (username && /^[A-Za-z0-9_]{5,32}$/.test(username)) return `@${escapeHtml(username)}`;
  return `@<a href="tg://user?id=${link.telegramUserId}">${escapeHtml(displayName)}</a>`;
}
