import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import { escapeHtml } from '../../domain/task/digestFormat.js';

const OPEN_STATUSES = new Set(['todo', 'in_progress', 'awaiting_clarification']);

export class SendWorkspaceEodReminder {
  constructor(
    private readonly deps: {
      readonly settings: WorkspaceAssigneeDigestRepository;
      readonly projects: ProjectRepository;
      readonly tasks: TaskRepository;
      readonly telegram: TelegramClient;
      readonly appUrl: string;
    },
  ) {}

  async execute(workspaceId: string): Promise<{ projectCount: number; taskCount: number }> {
    const settings = await this.deps.settings.get(workspaceId);
    if (!settings.eodReminderEnabled || settings.telegramGroupChatId === null) {
      return { projectCount: 0, taskCount: 0 };
    }
    const configured = new Set(settings.projectIds);
    const projects = (await this.deps.projects.listByWorkspace(workspaceId)).filter(
      (project) => settings.projectMode === 'all' || configured.has(project.id),
    );
    const rows = (
      await Promise.all(
        projects.map(async (project) => ({
          project,
          count: (await this.deps.tasks.listByProject(project.id)).filter((task) =>
            OPEN_STATUSES.has(task.status),
          ).length,
        })),
      )
    ).filter((row) => row.count > 0);
    if (rows.length === 0) return { projectCount: projects.length, taskCount: 0 };

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const richHtml = [
      '<h2>🕔 Перед уходом — обновите задачи</h2>',
      `<p>Открытых задач в выбранных проектах: <b>${total}</b></p>`,
      '<table bordered striped>',
      '<tr><th>Проект</th><th>Открыто</th></tr>',
      ...rows.map(
        ({ project, count }) => {
          const projectUrl = `${this.deps.appUrl.replace(/\/+$/, '')}/projects/${project.id}`;
          return (
            `<tr><td><b>${escapeHtml(project.name)}</b>` +
            `<br><a href="${escapeHtml(projectUrl)}">↗ Перейти</a></td>` +
            `<td>${count}</td></tr>`
          );
        },
      ),
      '</table>',
      '<p>Проверьте статусы и оставьте комментарий, если работа остановилась.</p>',
    ].join('');
    if (this.deps.telegram.sendRichMessage) {
      const result = await this.deps.telegram.sendRichMessage({
        chatId: settings.telegramGroupChatId,
        html: richHtml,
      });
      if (result.kind === 'ok' || result.kind === 'error' && result.deliveryUnknown) {
        return { projectCount: rows.length, taskCount: total };
      }
    }
    const text =
      `🕔 <b>Перед уходом — обновите задачи</b>\nОткрытых задач: <b>${total}</b>\n\n` +
      rows.map(({ project, count }) => `• <b>${escapeHtml(project.name)}</b> — ${count}`).join('\n');
    await this.deps.telegram.sendMessage({
      chatId: settings.telegramGroupChatId,
      text,
      parseMode: 'HTML',
      disableWebPagePreview: true,
    });
    return { projectCount: rows.length, taskCount: total };
  }
}
