import type { Task } from '../../domain/task/Task.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { DigestSettingsRepository } from '../digest/DigestSettingsRepository.js';
import type { WorkspaceAssigneeDigestRepository } from '../digest/WorkspaceAssigneeDigestRepository.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';
import type { TelegramTaskOriginRepository } from './TelegramTaskOriginRepository.js';
import type { WorkerResultDestination } from './TelegramWorkerResultOutbox.js';

export class ResolveWorkerResultDestination {
  constructor(private readonly deps: {
    origins: Pick<TelegramTaskOriginRepository, 'getByTask'>;
    projects: Pick<ProjectRepository, 'getById'>;
    settings: Pick<DigestSettingsRepository, 'getByProject'>;
    workspaceSettings: Pick<WorkspaceAssigneeDigestRepository, 'get'>;
    automation: Pick<AutomationRepository, 'getConfig'>;
  }) {}

  async resolve(task: Task): Promise<WorkerResultDestination | null> {
    const base = { taskId: task.id, projectId: task.projectId, messageId: null };
    const origin = await this.deps.origins.getByTask(task.id);
    // A moved task never falls back to another group through its old intake record.
    if (origin) return origin.projectId === task.projectId
      ? { ...base, chatId: origin.chatId, messageId: origin.messageId, source: 'origin' } : null;
    const project = await this.deps.projects.getById(task.projectId);
    if (!project) return null;
    const settings = await this.deps.settings.getByProject(task.projectId);
    if (settings.telegramGroupChatId && settings.telegramGroupChatId < 0) {
      return { ...base, chatId: settings.telegramGroupChatId, source: 'project' };
    }
    if (project.isInbox) return null;
    const workspace = await this.deps.workspaceSettings.get(project.workspaceId);
    if (!workspace.enabled || !workspace.telegramGroupChatId || workspace.telegramGroupChatId >= 0) return null;
    if (workspace.projectMode === 'selected' && !workspace.projectIds.includes(project.id)) return null;
    if (workspace.recipientMode === 'selected' && !workspace.recipientUserIds.includes(task.assignee.userId)) return null;
    const automation = await this.deps.automation.getConfig(project.id);
    return automation?.assigneeDigestEnabled
      ? { ...base, chatId: workspace.telegramGroupChatId, source: 'workspace' } : null;
  }
}
