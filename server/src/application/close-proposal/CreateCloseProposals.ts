import type { CloseProposalRepository } from './CloseProposalRepository.js';
import type { CreateTaskComment } from '../task/CreateTaskComment.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import { closeProposalKeyboard } from '../telegram/taskActionKeyboard.js';
import { buildTaskUrl } from '../notifications/taskUrl.js';

// Одно совпадение коммит↔задача, по которому создаём предложение закрыть.
export type CloseProposalMatchInput = {
  readonly taskId: string;
  readonly commitSha: string;
  readonly reason: string | null;
};

export type CreateCloseProposalsInput = {
  readonly projectId: string;
  // Диспетчер проекта — от его имени постим agent-комментарий (actorKind='agent').
  readonly dispatcherUserId: string;
  readonly sourceJobId: string | null;
  readonly matches: ReadonlyArray<CloseProposalMatchInput>;
};

type Deps = {
  readonly closeProposals: CloseProposalRepository;
  readonly createComment: CreateTaskComment;
  readonly notifications: NotificationRepository;
  readonly members: ProjectMemberRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly tgSend: SendAgentTelegramNotification;
  readonly telegram: TelegramClient;
  readonly workspaceDigestSettings: WorkspaceAssigneeDigestRepository;
  readonly idGen: () => string;
  readonly appUrl: string;
};

const EXCERPT_LIMIT = 100;

function excerpt(text: string | null, limit = EXCERPT_LIMIT): string {
  const s = (text ?? '').trim().replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Создание предложений закрыть задачи по совпадениям commit-sync (режим action='propose').
// Для каждого НОВОГО предложения: запись в task_close_proposals (идемпотентно) + agent-комментарий
// в задачу + фан-аут участникам (TG-личка с кнопками «✅ Закрыть / ✕ Не она» + in-app).
// Всё best-effort: сбой уведомления не откатывает предложение. Возвращает число созданных.
export class CreateCloseProposals {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateCloseProposalsInput): Promise<{ created: number }> {
    const project = await this.deps.projects.getById(input.projectId);
    if (!project) return { created: 0 };
    const members = await this.deps.members.listByProject(input.projectId);
    const workspaceId = await this.deps.projects.getWorkspaceId(input.projectId);
    const workspaceSettings = workspaceId
      ? await this.deps.workspaceDigestSettings.get(workspaceId).catch(() => null)
      : null;
    const selectedProjects = new Set(workspaceSettings?.projectIds ?? []);
    const groupChatId =
      workspaceSettings?.commitSyncEnabled &&
      workspaceSettings.telegramGroupChatId !== null &&
      (workspaceSettings.projectMode === 'all' || selectedProjects.has(input.projectId))
        ? workspaceSettings.telegramGroupChatId
        : null;

    let created = 0;
    // На одну задачу — максимум одно предложение за прогон (первое валидное совпадение).
    const handledTasks = new Set<string>();

    for (const m of input.matches) {
      if (handledTasks.has(m.taskId)) continue;

      const task = await this.deps.tasks.getById(m.taskId);
      if (!task || task.projectId !== input.projectId) continue;
      // Предлагаем закрыть только ещё открытые задачи.
      if (task.status !== 'todo' && task.status !== 'in_progress') continue;

      const { proposal, created: isNew } = await this.deps.closeProposals.create({
        projectId: input.projectId,
        taskId: m.taskId,
        commitSha: m.commitSha,
        reason: m.reason,
        sourceJobId: input.sourceJobId,
      });
      handledTasks.add(m.taskId);
      // Уже предлагали (или dismissed) по этому коммиту — не дублируем уведомления.
      if (!isNew) continue;
      created++;

      const sha7 = m.commitSha.slice(0, 7);
      const taskExcerpt = excerpt(task.description);
      const url = buildTaskUrl(this.deps.appUrl, input.projectId, m.taskId);

      // 1) Agent-комментарий в задачу (с маркером для меню/аудита). Best-effort.
      const reasonLine = m.reason && m.reason.trim().length > 0 ? `\n\n_${m.reason.trim()}_` : '';
      try {
        await this.deps.createComment.execute({
          projectId: input.projectId,
          ownerUserId: input.dispatcherUserId,
          taskId: m.taskId,
          body:
            `🔎 Похоже, задача выполнена по коммиту \`${sha7}\`. Закрыть её?${reasonLine}\n\n` +
            `Подтвердить может любой участник — кнопкой в Telegram или в приложении.\n` +
            `<!-- close-proposal:${proposal.id} -->`,
          actorKind: 'agent',
          agentName: 'ralph-dispatcher',
          notifyMode: 'none',
        });
      } catch (err) {
        console.warn('[CreateCloseProposals] comment failed', proposal.id, err);
      }

      // 2) Фан-аут участникам: in-app + TG-личка с кнопками.
      const tgText =
        `🔎 <b>Похоже, задача выполнена</b> по коммиту <code>${sha7}</code>:\n` +
        `<i>${escapeHtml(taskExcerpt)}</i>` +
        (m.reason && m.reason.trim() ? `\n\n${escapeHtml(excerpt(m.reason, 300))}` : '') +
        `\n\nЗакрыть? <a href="${url}">Открыть задачу</a>`;

      for (const mem of members) {
        try {
          await this.deps.notifications.create({
            id: this.deps.idGen(),
            userId: mem.userId,
            payload: {
              type: 'close_proposal',
              proposalId: proposal.id,
              projectId: input.projectId,
              projectName: project.name,
              taskId: m.taskId,
              taskExcerpt,
              commitSha: m.commitSha,
              reason: m.reason,
            },
          });
        } catch (err) {
          console.warn('[CreateCloseProposals] in-app notify failed', mem.userId, err);
        }
        if (groupChatId === null) {
          try {
            await this.deps.tgSend.execute({
              userId: mem.userId,
              text: tgText,
              parseMode: 'HTML',
              kind: 'close_proposal',
              taskId: m.taskId,
              projectId: input.projectId,
              replyMarkup: closeProposalKeyboard(proposal.id),
            });
          } catch (err) {
            console.warn('[CreateCloseProposals] TG notify failed', mem.userId, err);
          }
        }
      }
      if (groupChatId !== null) {
        await this.deps.telegram
          .sendMessage({
            chatId: groupChatId,
            text: tgText,
            parseMode: 'HTML',
            disableWebPagePreview: true,
            replyMarkup: closeProposalKeyboard(proposal.id),
          })
          .catch((err) =>
            console.warn('[CreateCloseProposals] group TG notify failed', groupChatId, err),
          );
      }
    }

    return { created };
  }
}
