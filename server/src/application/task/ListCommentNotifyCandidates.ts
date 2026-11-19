import { TaskNotFoundError } from '../../domain/task/errors.js';
import { defaultNotifyRecipientIds } from '../../domain/task/defaultNotifyRecipients.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import { requireTaskReadAccess } from './taskAuthorization.js';
import { listTaskAudienceMembers } from './taskAudience.js';
import type { TaskRepository } from './TaskRepository.js';

export type CommentNotifyCandidate = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  // Selected in the composer unless the author picks someone else.
  readonly isDefault: boolean;
  // Workspace lead or owner: the people who accept the work («Кто утверждает»).
  readonly isManager: boolean;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
};

/**
 * Who the comment author may notify: everyone who can open the task (the same circle
 * DispatchCommentNotifications delivers to), the author excluded. Defaults come first.
 */
export class ListCommentNotifyCandidates {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, taskId: string): Promise<CommentNotifyCandidate[]> {
    const { project } = await requireTaskReadAccess(this.deps, projectId, taskId, userId);
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    const [approverIds, leadIds] = await Promise.all([
      this.deps.members.listApproverUserIdsForProject(projectId),
      this.deps.members.listLeadUserIdsForProject(projectId),
    ]);
    const audience = await listTaskAudienceMembers(this.deps, project, task, approverIds);
    const leads = new Set(leadIds);
    const defaults = new Set(defaultNotifyRecipientIds({
      actorUserId: userId,
      candidateUserIds: audience.map((m) => m.userId),
      leadUserIds: leadIds,
      ownerUserIds: approverIds.filter((id) => !leads.has(id)),
      assigneeUserId: task.assignee?.userId ?? null,
    }));
    const managers = new Set(approverIds);

    const candidates = audience
      .filter((m) => m.userId !== userId)
      .map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        avatarUrl: m.user.avatarUrl,
        isDefault: defaults.has(m.userId),
        isManager: managers.has(m.userId),
      }));
    // Stable: defaults first, the rest keeps the workspace order.
    return [...candidates.filter((c) => c.isDefault), ...candidates.filter((c) => !c.isDefault)];
  }
}
