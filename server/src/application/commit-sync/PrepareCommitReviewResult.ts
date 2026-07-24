import type { CommitSyncMatch } from '../../domain/commit-sync/CommitSyncJob.js';
import type { CreateEmailActionToken } from '../email-action/CreateEmailActionToken.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import { telegramDigestTaskTitle } from '../task/digest/buildTaskDigest.js';
import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import type { CommitReviewResult, CommitReviewRow } from './CommitReviewResult.js';

type Deps = {
  readonly settings: WorkspaceAssigneeDigestRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly createEmailActionToken: CreateEmailActionToken;
  readonly appUrl: string;
};

export type PrepareCommitReviewInput = {
  readonly projectId: string;
  readonly dispatcherUserId: string;
  readonly mode: 'auto' | 'propose';
  readonly matches: readonly CommitSyncMatch[];
};

const MAX_TASKS = 20;

// Готовит per-job payload сводки одного проекта: применяет доставочный гейт пространства
// (тумблер сверки + группа + выбор проекта), собирает строки задач и, для режима propose,
// одноразовые email-action токены «закрыть». Возвращает null, если показывать нечего или
// пространство сводку не ждёт — тогда проект молчит и в объединённый дайджест не попадает.
export class PrepareCommitReviewResult {
  constructor(private readonly deps: Deps) {}

  async execute(input: PrepareCommitReviewInput): Promise<CommitReviewResult | null> {
    if (input.matches.length === 0) return null;
    const [project, workspaceId] = await Promise.all([
      this.deps.projects.getById(input.projectId),
      this.deps.projects.getWorkspaceId(input.projectId),
    ]);
    if (!project || !workspaceId) return null;

    const settings = await this.deps.settings.get(workspaceId);
    const selectedProjects = new Set(settings.projectIds);
    if (
      !settings.commitSyncEnabled ||
      settings.telegramGroupChatId === null ||
      (settings.projectMode !== 'all' && !selectedProjects.has(input.projectId))
    ) {
      return null;
    }

    const rows = await this.buildTaskRows(input);
    if (rows.length === 0) return null;

    return {
      chatId: settings.telegramGroupChatId,
      projectName: project.name,
      mode: input.mode,
      rows,
    };
  }

  private async buildTaskRows(input: PrepareCommitReviewInput): Promise<CommitReviewRow[]> {
    const rows: CommitReviewRow[] = [];
    const handled = new Set<string>();
    const base = this.deps.appUrl.replace(/\/+$/, '');
    for (const match of input.matches) {
      if (handled.has(match.taskId) || rows.length >= MAX_TASKS) continue;
      handled.add(match.taskId);
      const task = await this.deps.tasks.getById(match.taskId).catch(() => null);
      if (!task || task.projectId !== input.projectId) continue;
      const openUrl = `${base}/projects/${input.projectId}?task=${task.id}`;
      // Ссылка «закрыть» нужна только в режиме «предложить» и только пока задача ещё не закрыта.
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
