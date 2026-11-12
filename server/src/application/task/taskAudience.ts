import type { Project } from '../../domain/project/Project.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository, ProjectMemberWithUser } from '../project/ProjectMemberRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

export type TaskAudienceDeps = {
  readonly members: ProjectMemberRepository;
  readonly users?: UserRepository;
};

/**
 * Everyone who can open the task and therefore may be notified about its comments.
 *
 * A named project is open to its workspace members (minus those hidden from the project),
 * which is exactly members.listByProject(). A personal inbox contains only its owner:
 * the approvers (leads and owner of the workspace), the delegated assignee and the colleague
 * who created the task reach that single task without joining the inbox (see
 * taskAuthorization), so they are added here as task-scoped participants.
 */
export async function listTaskAudienceMembers(
  deps: TaskAudienceDeps,
  project: Pick<Project, 'id' | 'isInbox' | 'ownerId' | 'workspaceId'>,
  task: (Pick<Task, 'assignee' | 'createdBy'> & Partial<Pick<Task, 'originWorkspaceId'>>) | null,
  approverIds: readonly string[],
  // Already loaded members.listByProject(project.id), to avoid a second query.
  projectMembers?: readonly ProjectMemberWithUser[],
): Promise<ProjectMemberWithUser[]> {
  const members = [...(projectMembers ?? await deps.members.listByProject(project.id))];
  if (!project.isInbox && task && deps.members.filterTaskAudience) {
    // Общий проект (db/182): о задаче узнают только те, кому она видна по правилам.
    const allowed = new Set(
      await deps.members.filterTaskAudience(
        {
          projectId: project.id,
          createdBy: task.createdBy,
          assignee: task.assignee,
          originWorkspaceId: task.originWorkspaceId ?? null,
        },
        members.map((m) => m.userId),
      ),
    );
    return members.filter((m) => allowed.has(m.userId));
  }
  if (!project.isInbox || !deps.users) return members;

  const involved = new Set([...approverIds, ...(task?.assignee?.userId ? [task.assignee.userId] : [])]);
  const creatorId = task?.createdBy ?? null;
  if (creatorId && !involved.has(creatorId) && await isColleague(deps, creatorId, project)) {
    involved.add(creatorId);
  }
  for (const userId of involved) {
    if (members.some((m) => m.userId === userId)) continue;
    if (await deps.members.isProjectHidden?.(project.id, userId)) continue;
    const user = await deps.users.getById(userId);
    if (user) members.push({ projectId: project.id, userId, role: 'viewer', joinedAt: new Date(), user,
      notificationPrefs: await deps.members.getNotificationPrefs(project.id, userId) });
  }
  return members;
}

// Same rule as the delegating colleague's read access: the creator still shares the
// inbox owner's workspace.
async function isColleague(
  deps: TaskAudienceDeps,
  userId: string,
  project: Pick<Project, 'ownerId' | 'workspaceId'>,
): Promise<boolean> {
  try {
    const colleagues = await deps.members.listSharedUsersInWorkspace(userId, project.workspaceId);
    return colleagues.some((c) => c.id === project.ownerId);
  } catch {
    return false;
  }
}
