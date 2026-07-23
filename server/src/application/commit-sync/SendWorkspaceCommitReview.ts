import type { CommitSyncMatch } from '../../domain/commit-sync/CommitSyncJob.js';
import { escapeHtml } from '../../domain/task/digestFormat.js';
import type { CreateEmailActionToken } from '../email-action/CreateEmailActionToken.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import { telegramDigestTaskTitle } from '../task/digest/buildTaskDigest.js';
import type { SendMessageResult, TelegramClient } from '../telegram/TelegramClient.js';
import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import type { TelegramDigestActionDeliveryRepository } from '../digest/TelegramDigestActionDeliveryRepository.js';
import { extractTelegramDigestActionTokens } from '../digest/TelegramDigestActionService.js';

type Deps = {
  readonly settings: WorkspaceAssigneeDigestRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly createEmailActionToken: CreateEmailActionToken;
  readonly telegram: TelegramClient;
  readonly telegramDigestActions: TelegramDigestActionDeliveryRepository;
  readonly appUrl: string;
};

export type SendWorkspaceCommitReviewInput = {
  readonly projectId: string;
  readonly dispatcherUserId: string;
  readonly mode: 'auto' | 'propose';
  readonly matches: readonly CommitSyncMatch[];
};

const MAX_TASKS = 20;

// Короткая сводка по итогам сверки коммитов в Telegram-группу пространства:
//  - auto: какие черновики закрыты (уехали в «Готово») по коммитам;
//  - propose: какие черновики предложено закрыть (с кнопкой ✓ подтвердить).
// Разбор коммитов на «значимость/качество» убран по требованию владельца — сводка только про задачи.
// Молчит, если сопоставлять/предлагать нечего (matches пуст или задачи не нашлись).
export class SendWorkspaceCommitReview {
  constructor(private readonly deps: Deps) {}

  async execute(input: SendWorkspaceCommitReviewInput): Promise<boolean> {
    if (input.matches.length === 0) return false;
    const [project, workspaceId] = await Promise.all([
      this.deps.projects.getById(input.projectId),
      this.deps.projects.getWorkspaceId(input.projectId),
    ]);
    if (!project || !workspaceId) return false;

    const settings = await this.deps.settings.get(workspaceId);
    const selectedProjects = new Set(settings.projectIds);
    if (
      !settings.commitSyncEnabled ||
      settings.telegramGroupChatId === null ||
      (settings.projectMode !== 'all' && !selectedProjects.has(input.projectId))
    ) {
      return false;
    }

    const taskRows = await this.buildTaskRows(input);
    if (taskRows.length === 0) return false;

    const richHtml = buildRichHtml(project.name, input.mode, taskRows);
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
        console.warn('[commit-sync-summary] rich message failed', error);
        fallbackAllowed = false;
      }
    }

    if (!result && fallbackAllowed) {
      deliveredHtml = buildFallbackHtml(project.name, input.mode, taskRows);
      deliveredKind = 'html';
      result = await this.deps.telegram.sendMessage({
        chatId: settings.telegramGroupChatId,
        text: deliveredHtml,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
    }

    if (result?.kind !== 'ok') return false;
    await this.deps.telegramDigestActions
      .attach({
        tokens: extractTelegramDigestActionTokens(deliveredHtml),
        chatId: settings.telegramGroupChatId,
        messageId: result.messageId,
        messageHtml: deliveredHtml,
        messageKind: deliveredKind,
      })
      .catch((error) => console.warn('[commit-sync-summary] remember actions failed', error));
    return true;
  }

  private async buildTaskRows(input: SendWorkspaceCommitReviewInput): Promise<TaskRow[]> {
    const rows: TaskRow[] = [];
    const handled = new Set<string>();
    const base = this.deps.appUrl.replace(/\/+$/, '');
    for (const match of input.matches) {
      if (handled.has(match.taskId) || rows.length >= MAX_TASKS) continue;
      handled.add(match.taskId);
      const task = await this.deps.tasks.getById(match.taskId).catch(() => null);
      if (!task || task.projectId !== input.projectId) continue;
      const openUrl = `${base}/projects/${input.projectId}?task=${task.id}`;
      // Кнопка ✓ нужна только в режиме «предложить» и только пока задача ещё не закрыта.
      let completeUrl: string | null = null;
      if (input.mode === 'propose' && task.status !== 'done') {
        const token = await this.deps.createEmailActionToken.execute({
          action: 'complete',
          taskId: task.id,
          projectId: input.projectId,
          userId: input.dispatcherUserId,
        });
        completeUrl = `${base}/api/telegram-digest-actions/${token}`;
      }
      rows.push({
        title: telegramDigestTaskTitle((task.description ?? '').split('\n')[0] ?? ''),
        openUrl,
        completeUrl,
      });
    }
    return rows;
  }
}

type TaskRow = {
  readonly title: string;
  readonly openUrl: string;
  readonly completeUrl: string | null;
};

function header(mode: 'auto' | 'propose', projectName: string): string {
  const name = escapeHtml(projectName);
  return mode === 'auto'
    ? `✅ Закрыто по коммитам · «${name}»`
    : `📋 Предложено закрыть · «${name}»`;
}

function buildRichHtml(
  projectName: string,
  mode: 'auto' | 'propose',
  rows: readonly TaskRow[],
): string {
  const body: string[] = [`<h2>${header(mode, projectName)}</h2>`, '<ul>'];
  for (const row of rows) {
    const actions = row.completeUrl
      ? ` — <a href="${escapeHtml(row.completeUrl)}">✓ закрыть</a> · <a href="${escapeHtml(row.openUrl)}">↗</a>`
      : ` — <a href="${escapeHtml(row.openUrl)}">↗</a>`;
    body.push(`<li><b>${escapeHtml(row.title)}</b>${actions}</li>`);
  }
  body.push('</ul>');
  return body.join('');
}

function buildFallbackHtml(
  projectName: string,
  mode: 'auto' | 'propose',
  rows: readonly TaskRow[],
): string {
  const lines = [`<b>${header(mode, projectName)}</b>`];
  for (const row of rows) {
    const actions = row.completeUrl
      ? ` <a href="${escapeHtml(row.completeUrl)}">✓</a> · <a href="${escapeHtml(row.openUrl)}">↗</a>`
      : ` <a href="${escapeHtml(row.openUrl)}">↗</a>`;
    lines.push(`• <b>${escapeHtml(row.title)}</b>${actions}`);
  }
  return lines.join('\n');
}
